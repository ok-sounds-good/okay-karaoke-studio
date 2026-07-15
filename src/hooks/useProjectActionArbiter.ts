import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  INITIAL_PROJECT_ACTION_STATE,
  createProjectActionCoordinator,
  type ProjectActionDraftGuard,
  type ProjectActionExecutors,
  type ProjectActionRequest,
  type NativeProjectActionRequest,
} from '../lib/project-action-arbiter'

export type { ProjectActionDraftGuard, ProjectActionExecutors }

export interface NativeCloseBridge {
  onWindowCloseRequest(callback: (request: StudioWindowCloseRequest) => void): () => void
  getPendingWindowClose(): Promise<StudioWindowCloseRequest | null>
  resolveWindowClose(requestId: string, proceed: boolean): Promise<boolean>
}

export interface UseProjectActionArbiterOptions {
  executors: ProjectActionExecutors
  draftGuard?: ProjectActionDraftGuard
  nativeClose?: NativeCloseBridge
}

function nativeRequest(value: StudioWindowCloseRequest | null): NativeProjectActionRequest | null {
  return value
    ? {
        kind: 'native-close',
        source: 'native',
        nativeRequestId: value.requestId,
        nativeScope: value.action,
      }
    : null
}

export function useProjectActionArbiter({
  executors,
  draftGuard,
  nativeClose,
}: UseProjectActionArbiterOptions) {
  const [state, setState] = useState(INITIAL_PROJECT_ACTION_STATE)
  const runtimeRef = useRef({ executors, draftGuard, nativeClose })
  const coordinatorRef = useRef<ReturnType<typeof createProjectActionCoordinator> | null>(null)

  if (!coordinatorRef.current) {
    coordinatorRef.current = createProjectActionCoordinator(
      {
        getGuard: () => runtimeRef.current.draftGuard,
        execute: (request) => runtimeRef.current.executors[request.kind](request),
        cancelNative: (requestId) =>
          runtimeRef.current.nativeClose?.resolveWindowClose(requestId, false) ??
          Promise.resolve(false),
        getPendingNative: async () => {
          const bridge = runtimeRef.current.nativeClose
          return bridge ? nativeRequest(await bridge.getPendingWindowClose()) : null
        },
      },
      setState,
    )
  }
  const coordinator = coordinatorRef.current

  useLayoutEffect(() => {
    runtimeRef.current = { executors, draftGuard, nativeClose }
    if (state.renderBarrier !== null) coordinator.crossRenderBarrier(state.renderBarrier)
  }, [coordinator, draftGuard, executors, nativeClose, state.renderBarrier])

  const request = useCallback(
    (action: ProjectActionRequest) => coordinator.request(action),
    [coordinator],
  )
  const apply = useCallback(() => coordinator.settle('apply'), [coordinator])
  const discard = useCallback(() => coordinator.settle('discard'), [coordinator])
  const keep = useCallback(() => coordinator.keep(), [coordinator])

  useEffect(() => {
    if (!nativeClose) return
    let active = true
    let receivedEvent = false
    const receive = (value: StudioWindowCloseRequest | null) => {
      const action = nativeRequest(value)
      if (active && action) request(action)
    }
    const unsubscribe = nativeClose.onWindowCloseRequest((value) => {
      receivedEvent = true
      receive(value)
    })
    const query = async (retry: boolean) => {
      try {
        const value = await nativeClose.getPendingWindowClose()
        if (!receivedEvent) receive(value)
      } catch {
        if (active && retry && !receivedEvent) void query(false)
      }
    }
    void query(true)
    return () => {
      active = false
      unsubscribe()
    }
  }, [nativeClose, request])

  return {
    request,
    pending: state.pending,
    phase: state.phase,
    error: state.error,
    apply,
    discard,
    keep,
  }
}
