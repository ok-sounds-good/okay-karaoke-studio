// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProjectActionArbiter } from '../src/hooks/useProjectActionArbiter'
import {
  PROJECT_ACTION_KINDS,
  createProjectActionCoordinator,
  type NativeProjectActionRequest,
  type ProjectActionDraftGuard,
  type ProjectActionExecutors,
  type ProjectActionRequest,
} from '../src/lib/project-action-arbiter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ordinary = (kind: Exclude<ProjectActionRequest['kind'], 'native-close'>) =>
  ({ kind, source: 'ui' }) as ProjectActionRequest
const native = (nativeRequestId: string): ProjectActionRequest => ({
  kind: 'native-close',
  source: 'native',
  nativeRequestId,
  nativeScope: 'window',
})
const flush = () => new Promise((resolve) => queueMicrotask(resolve))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, reject, resolve }
}

function guardedCoordinator(options: {
  settle: ProjectActionDraftGuard['settle']
  execute?: (request: ProjectActionRequest) => unknown
  cancelNative?: (requestId: string) => Promise<boolean>
}) {
  return createProjectActionCoordinator(
    {
      getGuard: () => ({ needsResolution: () => true, settle: options.settle }),
      execute: options.execute ?? (() => undefined),
      cancelNative: options.cancelNative ?? (async () => true),
    },
    () => undefined,
  )
}

function executors(run: (request: ProjectActionRequest) => unknown) {
  return Object.fromEntries(
    PROJECT_ACTION_KINDS.map((kind) => [kind, run]),
  ) as ProjectActionExecutors
}

describe('project action coordinator', () => {
  it('executes every unguarded user action synchronously', () => {
    const trace: string[] = []
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute: (request) => trace.push(request.kind),
        cancelNative: async () => true,
      },
      () => undefined,
    )

    trace.push('before')
    for (const kind of PROJECT_ACTION_KINDS.slice(0, -1)) {
      coordinator.request(ordinary(kind as Exclude<ProjectActionRequest['kind'], 'native-close'>))
    }
    trace.push('after')

    expect(trace).toEqual(['before', ...PROJECT_ACTION_KINDS.slice(0, -1), 'after'])
    expect(coordinator.getState()).toMatchObject({ phase: 'idle', pending: null })
  })

  it('guards every future project mutation while a draft is open', () => {
    const execute = vi.fn()
    const coordinator = guardedCoordinator({ settle: async () => true, execute })

    for (const kind of PROJECT_ACTION_KINDS.slice(0, -1)) {
      const request = ordinary(kind as Exclude<ProjectActionRequest['kind'], 'native-close'>)
      coordinator.request(request)
      expect(coordinator.getState().pending).toEqual(request)
      expect(execute).not.toHaveBeenCalled()
      coordinator.keep()
    }
  })

  it.each(['settlement-first', 'cancellation-first'] as const)(
    'serializes native cancellation and the render barrier when %s',
    async (ordering) => {
      const settlement = deferred<boolean>()
      const cancellation = deferred<boolean>()
      const execute = vi.fn()
      const settle = vi.fn(() => settlement.promise)
      const cancelNative = vi.fn(() => cancellation.promise)
      const coordinator = guardedCoordinator({ settle, execute, cancelNative })

      coordinator.request(native('native-1'))
      coordinator.settle('apply')
      coordinator.settle('discard')
      coordinator.request(ordinary('export'))

      expect(settle).toHaveBeenCalledOnce()
      expect(cancelNative).toHaveBeenCalledWith('native-1')
      expect(coordinator.getState().phase).toBe('canceling-native')

      if (ordering === 'settlement-first') {
        settlement.resolve(true)
        await flush()
        expect(coordinator.getState().phase).toBe('canceling-native')
        cancellation.resolve(true)
      } else {
        cancellation.resolve(true)
        await flush()
        expect(coordinator.getState().phase).toBe('settling-draft')
        settlement.resolve(true)
      }
      await flush()

      const barrier = coordinator.getState().renderBarrier
      expect(coordinator.getState()).toMatchObject({
        phase: 'awaiting-render',
        pending: ordinary('export'),
      })
      expect(execute).not.toHaveBeenCalled()
      coordinator.crossRenderBarrier(barrier!)
      coordinator.crossRenderBarrier(barrier!)

      expect(execute).toHaveBeenCalledOnce()
      expect(execute).toHaveBeenCalledWith(ordinary('export'))
      expect(coordinator.getState().phase).toBe('idle')
    },
  )

  it.each([
    ['false acknowledgment', () => Promise.resolve(false)],
    ['rejection', () => Promise.reject(new Error('Cancellation IPC failed'))],
  ])(
    'retains the native owner for retry and drops its replacement after %s',
    async (_label, cancel) => {
      const execute = vi.fn()
      const cancelNative = vi.fn().mockImplementationOnce(cancel).mockResolvedValueOnce(true)
      const coordinator = guardedCoordinator({ settle: async () => true, execute, cancelNative })

      coordinator.request(native('native-1'))
      coordinator.request(ordinary('open'))
      await flush()

      expect(coordinator.getState()).toMatchObject({
        phase: 'awaiting-draft-decision',
        pending: native('native-1'),
      })
      expect(coordinator.getState().error).toBeTruthy()
      expect(execute).not.toHaveBeenCalled()

      coordinator.request(ordinary('save'))
      await flush()

      expect(cancelNative).toHaveBeenCalledTimes(2)
      expect(coordinator.getState()).toMatchObject({
        phase: 'awaiting-draft-decision',
        pending: ordinary('save'),
      })
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('keeps the draft and cancels only the exact native request', async () => {
    const cancelNative = vi.fn(async () => true)
    const settle = vi.fn(async () => true)
    const coordinator = guardedCoordinator({ settle, cancelNative })

    coordinator.request(native('native-keep'))
    coordinator.keep()
    await flush()

    expect(cancelNative).toHaveBeenCalledWith('native-keep')
    expect(settle).not.toHaveBeenCalled()
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('lets a newer main-owned native request supersede an older one', () => {
    const coordinator = guardedCoordinator({ settle: async () => true })

    coordinator.request(native('native-1'))
    coordinator.request(native('native-2'))

    expect(coordinator.getState().pending).toEqual(native('native-2'))
  })

  it('clears native state after authorization acknowledgment and does not revoke in flight', async () => {
    const acknowledgment = deferred<boolean>()
    const execute = vi.fn(() => acknowledgment.promise)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative: async () => true,
      },
      () => undefined,
    )

    coordinator.request(native('native-authorized'))
    coordinator.request(ordinary('save'))

    expect(execute).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toMatchObject({
      phase: 'authorizing-native',
      pending: native('native-authorized'),
    })

    acknowledgment.resolve(true)
    await flush()

    expect(coordinator.getState().phase).toBe('idle')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('queues a newer native event without revoking an authorization in flight', async () => {
    const first = deferred<boolean>()
    const execute = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(true)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative: async () => true,
      },
      () => undefined,
    )

    coordinator.request(native('native-1'))
    coordinator.request(native('native-2'))
    expect(execute).toHaveBeenCalledOnce()

    first.resolve(false)
    await flush()
    await flush()

    expect(execute).toHaveBeenNthCalledWith(2, native('native-2'))
    expect(coordinator.getState().phase).toBe('idle')
  })

  it.each([
    ['false acknowledgment', () => Promise.resolve(false)],
    ['rejection', () => Promise.reject(new Error('Authorization IPC failed'))],
  ])('queries and retries the same native ID once after %s', async (_label, firstResult) => {
    const execute = vi.fn().mockImplementationOnce(firstResult).mockResolvedValueOnce(true)
    const getPendingNative = vi.fn(async () => native('native-retry'))
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative: async () => true,
        getPendingNative,
      },
      () => undefined,
    )

    coordinator.request(native('native-retry'))
    await flush()
    await flush()
    await flush()

    expect(getPendingNative).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('takes a newer main-owned ID returned by reconciliation', async () => {
    const execute = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative: async () => true,
        getPendingNative: async () => native('native-newer'),
      },
      () => undefined,
    )

    coordinator.request(native('native-old'))
    await flush()
    await flush()

    expect(execute).toHaveBeenNthCalledWith(2, native('native-newer'))
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('clears ownership only after main confirms no pending native request', async () => {
    const execute = vi.fn(async () => false)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative: async () => true,
        getPendingNative: async () => null,
      },
      () => undefined,
    )

    coordinator.request(native('native-gone'))
    await flush()
    await flush()

    expect(execute).toHaveBeenCalledOnce()
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('retains retryable ownership when reconciliation or its bounded retry fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const getPendingNative = vi.fn(async () => native('native-still-pending'))
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative: async () => true,
        getPendingNative,
      },
      () => undefined,
    )

    coordinator.request(native('native-still-pending'))
    await flush()
    await flush()
    await flush()

    expect(coordinator.getState()).toMatchObject({
      phase: 'awaiting-native-retry',
      pending: native('native-still-pending'),
    })
    expect(coordinator.getState().error).toBeTruthy()
    expect(getPendingNative).toHaveBeenCalledOnce()

    coordinator.request(native('native-still-pending'))
    await flush()

    expect(execute).toHaveBeenCalledTimes(3)
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('retains retryable ownership when the reconciliation query rejects', async () => {
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute: async () => false,
        cancelNative: async () => true,
        getPendingNative: async () => {
          throw new Error('Query failed')
        },
      },
      () => undefined,
    )

    coordinator.request(native('native-query-failed'))
    await flush()
    await flush()

    expect(coordinator.getState()).toMatchObject({
      phase: 'awaiting-native-retry',
      pending: native('native-query-failed'),
      error: 'Query failed',
    })
  })

  it('persists Keep through reconciliation and cancels the confirmed native ID', async () => {
    const query = deferred<NativeProjectActionRequest | null>()
    const cancellation = deferred<boolean>()
    const execute = vi.fn(async () => false)
    const cancelNative = vi.fn(() => cancellation.promise)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative,
        getPendingNative: () => query.promise,
      },
      () => undefined,
    )

    coordinator.request(native('native-A'))
    await flush()
    coordinator.keep()
    query.resolve(native('native-B'))
    await flush()

    expect(cancelNative).toHaveBeenCalledOnce()
    expect(cancelNative).toHaveBeenCalledWith('native-B')
    expect(execute).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toMatchObject({
      phase: 'canceling-native',
      pending: native('native-B'),
    })

    cancellation.resolve(true)
    await flush()
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('clears a reconciled Keep when main confirms no pending native request', async () => {
    const query = deferred<NativeProjectActionRequest | null>()
    const cancelNative = vi.fn(async () => true)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute: async () => false,
        cancelNative,
        getPendingNative: () => query.promise,
      },
      () => undefined,
    )

    coordinator.request(native('native-A'))
    await flush()
    coordinator.keep()
    query.resolve(null)
    await flush()

    expect(cancelNative).not.toHaveBeenCalled()
    expect(coordinator.getState().phase).toBe('idle')
  })

  it('keeps Keep intent after query rejection and cancels the next main-owned ID', async () => {
    const query = deferred<NativeProjectActionRequest | null>()
    const cancellation = deferred<boolean>()
    const execute = vi.fn(async () => false)
    const cancelNative = vi.fn(() => cancellation.promise)
    const coordinator = createProjectActionCoordinator(
      {
        getGuard: () => undefined,
        execute,
        cancelNative,
        getPendingNative: () => query.promise,
      },
      () => undefined,
    )

    coordinator.request(native('native-A'))
    await flush()
    coordinator.keep()
    query.reject(new Error('Query failed'))
    await flush()
    coordinator.request(native('native-B'))

    expect(cancelNative).toHaveBeenCalledOnce()
    expect(cancelNative).toHaveBeenCalledWith('native-B')
    expect(execute).toHaveBeenCalledOnce()
    expect(coordinator.getState().phase).toBe('canceling-native')

    cancellation.resolve(true)
    await flush()
    expect(coordinator.getState().phase).toBe('idle')
  })
})

describe('useProjectActionArbiter', () => {
  let root: Root | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('crosses a React layout barrier before using the canonical executor', async () => {
    const calls: string[] = []
    let arbiter!: ReturnType<typeof useProjectActionArbiter>

    function Harness({ version }: { version: string }) {
      const [draftOpen, setDraftOpen] = useState(true)
      arbiter = useProjectActionArbiter({
        draftGuard: {
          needsResolution: () => draftOpen,
          settle: () => {
            setDraftOpen(false)
            return true
          },
        },
        executors: executors((request) => calls.push(`${request.kind}:${version}:${draftOpen}`)),
      })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<Harness version="canonical" />))

    await act(async () => {
      arbiter.request(ordinary('save'))
      arbiter.apply()
      await flush()
    })

    expect(calls).toEqual(['save:canonical:false'])
  })

  it('ignores an older query result after a newer subscribed event', async () => {
    const query = deferred<StudioWindowCloseRequest | null>()
    const resolveWindowClose = vi.fn(async () => true)
    const nativeClose = {
      onWindowCloseRequest(callback: (request: StudioWindowCloseRequest) => void) {
        callback({ requestId: 'native-2', action: 'app' })
        return () => undefined
      },
      getPendingWindowClose: () => query.promise,
      resolveWindowClose,
    }

    function Harness() {
      useProjectActionArbiter({
        executors: executors((request) =>
          request.kind === 'native-close'
            ? resolveWindowClose(request.nativeRequestId, true)
            : undefined,
        ),
        nativeClose,
      })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<Harness />))
    await act(async () => {
      query.resolve({ requestId: 'native-1', action: 'window' })
      await flush()
    })

    expect(resolveWindowClose).toHaveBeenCalledOnce()
    expect(resolveWindowClose).toHaveBeenCalledWith('native-2', true)
  })

  it('recovers a lost event and one rejected query without resubscribing', async () => {
    const onWindowCloseRequest = vi.fn(() => () => undefined)
    const getPendingWindowClose = vi
      .fn<() => Promise<StudioWindowCloseRequest | null>>()
      .mockRejectedValueOnce(new Error('Renderer was loading'))
      .mockResolvedValueOnce({ requestId: 'native-recovered', action: 'window' })
    const resolveWindowClose = vi.fn(async () => true)
    const nativeClose = { onWindowCloseRequest, getPendingWindowClose, resolveWindowClose }

    function Harness() {
      useProjectActionArbiter({
        executors: executors((request) =>
          request.kind === 'native-close'
            ? resolveWindowClose(request.nativeRequestId, true)
            : undefined,
        ),
        nativeClose,
      })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<Harness />)
      await flush()
      await flush()
    })

    expect(onWindowCloseRequest).toHaveBeenCalledOnce()
    expect(getPendingWindowClose).toHaveBeenCalledTimes(2)
    expect(resolveWindowClose).toHaveBeenCalledWith('native-recovered', true)
  })

  it('deduplicates event and query delivery without blocking an explicit same-ID retry', async () => {
    const request = { requestId: 'native-retry', action: 'window' } as const
    let receive!: (request: StudioWindowCloseRequest) => void
    const onWindowCloseRequest = vi.fn((callback: typeof receive) => {
      receive = callback
      callback(request)
      return () => undefined
    })
    const getPendingWindowClose = vi
      .fn<() => Promise<StudioWindowCloseRequest | null>>()
      .mockResolvedValueOnce(request)
      .mockRejectedValueOnce(new Error('Query failed'))
    const resolveWindowClose = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const nativeClose = { onWindowCloseRequest, getPendingWindowClose, resolveWindowClose }

    function Harness() {
      useProjectActionArbiter({
        executors: executors((action) =>
          action.kind === 'native-close'
            ? resolveWindowClose(action.nativeRequestId, true)
            : undefined,
        ),
        nativeClose,
      })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<Harness />)
      await flush()
    })
    expect(resolveWindowClose).toHaveBeenCalledOnce()

    await act(async () => {
      await flush()
      await flush()
      receive(request)
      await flush()
    })

    expect(onWindowCloseRequest).toHaveBeenCalledOnce()
    expect(getPendingWindowClose).toHaveBeenCalledTimes(2)
    expect(resolveWindowClose).toHaveBeenCalledTimes(2)
  })
})
