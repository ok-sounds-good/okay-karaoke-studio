// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useProjectBackgroundImage,
  type BackgroundImageResolutionStatus,
  type ProjectBackgroundImagePreview,
} from '../src/hooks/useProjectBackgroundImage'
import { cloneStageStyle, type BackgroundStyle } from '../src/lib/video-style'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function imageBackground(imagePath: string): BackgroundStyle {
  return {
    ...cloneStageStyle().background,
    imagePath,
    mode: 'image',
  }
}

interface ProbeProps {
  acceptedProjectPath: string | null
  background: BackgroundStyle
  lifecycle: number
  reachableImagePaths: readonly string[]
}

let latest: ProjectBackgroundImagePreview

function Probe(props: ProbeProps) {
  latest = useProjectBackgroundImage(props)
  return <output>{latest.preview.resolutionStatus}</output>
}

function expectPreview(resolutionStatus: BackgroundImageResolutionStatus, url: string | null) {
  expect(latest.preview).toMatchObject({ resolutionStatus, url })
}

const probeProps = (
  imagePath: string,
  lifecycle: number,
  acceptedProjectPath: string | null,
): ProbeProps => ({
  acceptedProjectPath,
  background: imageBackground(imagePath),
  lifecycle,
  reachableImagePaths: [imagePath],
})

function installStudio({
  getBackgroundState = vi.fn(async () => ({ activeUrl: null, revision: 'empty' })),
  releaseBackgroundSnapshot,
  resolveProjectBackground,
  retainBackground = vi.fn(async () => null),
}: {
  getBackgroundState?: StudioApi['getBackgroundState']
  releaseBackgroundSnapshot?: StudioApi['releaseBackgroundSnapshot']
  resolveProjectBackground: StudioApi['resolveProjectBackground']
  retainBackground?: StudioApi['retainBackground']
}) {
  Object.defineProperty(window, 'studio', {
    configurable: true,
    value: {
      getBackgroundState,
      ...(releaseBackgroundSnapshot ? { releaseBackgroundSnapshot } : {}),
      resolveProjectBackground,
      retainBackground,
    } as unknown as StudioApi,
  })
}

function restored(
  path: string,
  url: string,
  revision: string,
): Extract<StudioBackgroundRestoreResult, { status: 'success' }> {
  return {
    status: 'success',
    media: { path, name: path.split('/').at(-1)!, url },
    state: { activeUrl: url, revision },
  }
}

describe('project background image Preview capability', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (props: ProbeProps) => {
    await act(async () => {
      root.render(<Probe {...props} />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'studio')
    vi.restoreAllMocks()
  })

  it('restores only the accepted project link and exposes its immutable URL', async () => {
    const result = restored('/media/background.png', 'studio-media://asset/restored', 'restored-1')
    const resolveProjectBackground = vi.fn(async () => result)
    installStudio({ resolveProjectBackground })

    await render(probeProps('/media/background.png', 4, '/projects/song.oks'))

    expect(resolveProjectBackground).toHaveBeenCalledExactlyOnceWith('/projects/song.oks')
    expect(latest.ready).toBe(true)
    expectPreview('available', 'studio-media://asset/restored')
    expect(latest.preview.onRetryResolution).toBeUndefined()
  })

  it.each([
    ['POSIX', '/media/assets/../background.png', '/media/background.png'],
    ['Windows', 'C:/media/background.png', 'C:\\media\\background.png'],
  ])(
    'accepts a trusted %s restore after main native-normalizes its linked path',
    async (_platform, serializedPath, nativePath) => {
      const resolveProjectBackground = vi.fn(async () =>
        restored(nativePath, 'studio-media://asset/normalized', 'normalized-1'),
      )
      installStudio({ resolveProjectBackground })

      await render(probeProps(serializedPath, 5, '/projects/normalized.oks'))

      expect(resolveProjectBackground).toHaveBeenCalledExactlyOnceWith('/projects/normalized.oks')
      expect(latest.ready).toBe(true)
      expectPreview('available', 'studio-media://asset/normalized')
      expect(latest.preview.onRetryResolution).toBeUndefined()
    },
  )

  it('keeps an exact missing link retryable without accepting another history path', async () => {
    const missingState = { activeUrl: null, revision: 'missing-1' }
    const resolveProjectBackground = vi
      .fn<StudioApi['resolveProjectBackground']>()
      .mockResolvedValueOnce({ status: 'missing', state: missingState })
      .mockResolvedValueOnce(
        restored('/media/missing.jpg', 'studio-media://asset/relinked', 'restored-2'),
      )
    installStudio({
      resolveProjectBackground,
      retainBackground: vi.fn(async () => ({ activeUrl: null, revision: 'inactive-3' })),
    })
    const props = probeProps('/media/missing.jpg', 7, '/projects/song.oks')

    await render(props)
    expect(latest.preview.resolutionStatus).toBe('missing')
    expect(latest.preview.onRetryResolution).toBeTypeOf('function')
    expect(latest.sourceFor(props.background).onRetryResolution).toBeTypeOf('function')
    await act(async () => {
      latest.preview.onRetryResolution?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(resolveProjectBackground).toHaveBeenNthCalledWith(2, '/projects/song.oks')
    expectPreview('available', 'studio-media://asset/relinked')

    await render({ ...props, background: imageBackground('/media/other.jpg') })
    expect(latest.preview.resolutionStatus).toBe('missing')
    expect(latest.preview.onRetryResolution).toBeUndefined()
    expect(latest.sourceFor(props.background).onRetryResolution).toBeUndefined()
  })

  it('deactivates an Image capability in Gradient mode and reactivates it on undo', async () => {
    const result = restored('/media/history.png', 'studio-media://asset/history', 'active-1')
    const active = result.state
    const inactive = { activeUrl: null, revision: 'inactive-2' }
    const reactivated = { activeUrl: active.activeUrl, revision: 'active-3' }
    const resolveProjectBackground = vi.fn(async () => result)
    const retainBackground = vi
      .fn<StudioApi['retainBackground']>()
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(reactivated)
    installStudio({ resolveProjectBackground, retainBackground })
    const props = probeProps('/media/history.png', 2, '/projects/history.oks')

    await render(props)
    await render({
      ...props,
      background: { ...props.background, mode: 'gradient' },
    })
    expect(retainBackground).toHaveBeenNthCalledWith(1, active, null)
    expectPreview('none', null)

    await render(props)
    expect(retainBackground).toHaveBeenNthCalledWith(2, inactive, active.activeUrl)
    expectPreview('available', active.activeUrl)
    expect(resolveProjectBackground).toHaveBeenCalledOnce()
  })

  it('retries a stale CAS while pruning only snapshots excluded from reachable history', async () => {
    const pathA = '/media/reachable-a.png'
    const pathB = '/media/pruned-b.png'
    const urlA = 'studio-media://asset/reachable-a'
    const urlB = 'studio-media://asset/pruned-b'
    const retained = { activeUrl: urlA, revision: 'retained-b-1' }
    const refreshed = { activeUrl: urlA, revision: 'newer-active-a-2' }
    const released = { activeUrl: urlA, revision: 'released-b-3' }
    const getBackgroundState = vi.fn(async () => refreshed)
    const releaseBackgroundSnapshot = vi
      .fn<StudioApi['releaseBackgroundSnapshot']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(released)
    installStudio({
      getBackgroundState,
      releaseBackgroundSnapshot,
      resolveProjectBackground: vi.fn(async () => restored(pathA, urlA, retained.revision)),
    })
    const props = {
      ...probeProps(pathA, 6, '/projects/history.oks'),
      reachableImagePaths: [pathA, pathB],
    }

    await render(props)
    await act(async () => {
      expect(latest.rememberSnapshot(pathB, urlB, retained)).toBe(true)
    })
    await render({ ...props, reachableImagePaths: [pathA] })

    expect(releaseBackgroundSnapshot).toHaveBeenNthCalledWith(1, retained, urlB)
    expect(getBackgroundState).toHaveBeenCalledOnce()
    expect(releaseBackgroundSnapshot).toHaveBeenNthCalledWith(2, refreshed, urlB)
    expect(latest.getCapability()).toEqual(released)
    expect(latest.sourceFor(imageBackground(pathA))).toMatchObject({
      resolutionStatus: 'available',
      url: urlA,
    })
    expect(latest.sourceFor(imageBackground(pathB))).toMatchObject({
      resolutionStatus: 'missing',
      url: null,
    })
  })

  it('does not expose an inactive retained URL while history reconciliation is pending', async () => {
    const result = restored('/media/deferred.png', 'studio-media://asset/deferred', 'active-d-1')
    const active = result.state
    const inactive = { activeUrl: null, revision: 'inactive-d-2' }
    const reactivation = deferred<StudioBackgroundCapabilityState | null>()
    const resolveProjectBackground = vi.fn(async () => result)
    const retainBackground = vi
      .fn<StudioApi['retainBackground']>()
      .mockResolvedValueOnce(inactive)
      .mockImplementationOnce(() => reactivation.promise)
    installStudio({ resolveProjectBackground, retainBackground })
    const props = probeProps('/media/deferred.png', 5, '/projects/deferred.oks')

    await render(props)
    await render({ ...props, background: imageBackground('/media/other.png') })
    await render(props)

    expect(retainBackground).toHaveBeenCalledTimes(2)
    expectPreview('loading', null)
    await act(async () => {
      reactivation.resolve({ activeUrl: active.activeUrl, revision: 'active-d-3' })
      await reactivation.promise
    })
    expectPreview('available', active.activeUrl)
  })

  it.each([
    ['miss', 'rejection'],
    ['rejection', 'same-state success'],
  ] as const)(
    'turns a CAS %s plus refresh %s into a paused retryable error',
    async (failure, refreshResult) => {
      const result = restored(
        '/media/retry-cas.png',
        'studio-media://asset/retry-cas',
        'active-cas-1',
      )
      const active = result.state
      const inactive = { activeUrl: null, revision: 'inactive-cas-2' }
      const retried = { activeUrl: active.activeUrl, revision: 'active-cas-3' }
      const retryRetain = deferred<StudioBackgroundCapabilityState | null>()
      const resolveProjectBackground = vi.fn(async () => result)
      const retainBackground = vi
        .fn<StudioApi['retainBackground']>()
        .mockResolvedValueOnce(inactive)
      if (failure === 'miss') retainBackground.mockResolvedValueOnce(null)
      else retainBackground.mockRejectedValueOnce(new Error('CAS rejected'))
      retainBackground.mockImplementationOnce(() => retryRetain.promise)
      const getBackgroundState = vi.fn<StudioApi['getBackgroundState']>()
      if (refreshResult === 'rejection') {
        getBackgroundState.mockRejectedValueOnce(new Error('refresh rejected'))
      } else {
        getBackgroundState.mockResolvedValueOnce(inactive)
      }
      getBackgroundState.mockResolvedValueOnce(inactive)
      installStudio({
        getBackgroundState,
        resolveProjectBackground,
        retainBackground,
      })
      const props = probeProps('/media/retry-cas.png', 8, '/projects/retry-cas.oks')

      await render(props)
      await render({ ...props, background: imageBackground('/media/other.png') })
      await render(props)
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      })

      expectPreview('error', null)
      expect(latest.preview.onRetryResolution).toBeTypeOf('function')
      expect(retainBackground).toHaveBeenCalledTimes(2)
      if (refreshResult === 'same-state success') {
        await render({ ...props, background: { ...props.background, mode: 'gradient' } })
        expectPreview('none', null)
        expect(latest.preview.onRetryResolution).toBeUndefined()
        expect(retainBackground).toHaveBeenCalledTimes(2)
        await render(props)
      } else {
        await act(async () => {
          latest.preview.onRetryResolution?.()
          await new Promise((resolve) => window.setTimeout(resolve, 0))
        })
      }

      expectPreview('loading', null)
      expect(retainBackground).toHaveBeenNthCalledWith(3, inactive, active.activeUrl)
      expect(retainBackground).toHaveBeenCalledTimes(3)
      await act(async () => {
        retryRetain.resolve(retried)
        await retryRetain.promise
      })
      expectPreview('available', active.activeUrl)
      expect(getBackgroundState).toHaveBeenCalledTimes(2)
      expect(resolveProjectBackground).toHaveBeenCalledOnce()
    },
  )

  it('releases the active image when a failed intent changes while refresh is pending', async () => {
    const result = restored('/media/active.png', 'studio-media://asset/active', 'active-i-1')
    const active = result.state
    const inactive = { activeUrl: null, revision: 'inactive-i-2' }
    const staleRefresh = deferred<StudioBackgroundCapabilityState>()
    const resolveProjectBackground = vi.fn(async () => result)
    const retainBackground = vi
      .fn<StudioApi['retainBackground']>()
      .mockRejectedValueOnce(new Error('Image intent failed'))
      .mockResolvedValueOnce(inactive)
    const getBackgroundState = vi
      .fn<StudioApi['getBackgroundState']>()
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce(active)
    installStudio({
      getBackgroundState,
      resolveProjectBackground,
      retainBackground,
    })
    const props = probeProps('/media/active.png', 9, '/projects/intent.oks')
    const changed = { ...props, background: imageBackground('/media/other.png') }

    await render(props)
    await render(changed)
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)))
    expect(retainBackground).toHaveBeenCalledTimes(1)

    await render({ ...changed, background: { ...changed.background, mode: 'gradient' } })
    expect(retainBackground).toHaveBeenCalledTimes(1)
    await act(async () => {
      staleRefresh.reject(new Error('old Image refresh failed'))
      await Promise.allSettled([staleRefresh.promise])
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(getBackgroundState).toHaveBeenCalledTimes(2)
    expect(retainBackground).toHaveBeenNthCalledWith(2, active, null)
    expect(retainBackground).toHaveBeenCalledTimes(2)
    expectPreview('none', null)
  })

  it('ignores an older lifecycle result and clears its obsolete URL immediately', async () => {
    const first = deferred<StudioBackgroundRestoreResult>()
    const second = deferred<StudioBackgroundRestoreResult>()
    const resolveProjectBackground = vi
      .fn<StudioApi['resolveProjectBackground']>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    installStudio({ resolveProjectBackground })

    await render(probeProps('/media/shared.png', 10, '/projects/old.oks'))
    await render(probeProps('/media/shared.png', 11, '/projects/new.oks'))
    expectPreview('loading', null)

    await act(async () => {
      second.resolve(restored('/media/shared.png', 'studio-media://asset/new', 'new-state'))
      await second.promise
    })
    await act(async () => {
      first.resolve(restored('/media/shared.png', 'studio-media://asset/old', 'old-state'))
      await first.promise
    })

    expectPreview('available', 'studio-media://asset/new')
  })

  it('ignores a stale recovery rejection after a newer lifecycle is available', async () => {
    const staleRecovery = deferred<StudioBackgroundCapabilityState>()
    const resolveProjectBackground = vi
      .fn<StudioApi['resolveProjectBackground']>()
      .mockRejectedValueOnce(new Error('old restore failed'))
      .mockResolvedValueOnce(
        restored('/media/new.png', 'studio-media://asset/newer', 'newer-state'),
      )
    const getBackgroundState = vi
      .fn<StudioApi['getBackgroundState']>()
      .mockImplementationOnce(() => staleRecovery.promise)
    installStudio({ getBackgroundState, resolveProjectBackground })

    await render(probeProps('/media/old.png', 20, '/projects/old.oks'))
    expect(getBackgroundState).toHaveBeenCalledOnce()
    await render(probeProps('/media/new.png', 21, '/projects/new.oks'))
    expect(latest.preview.url).toBe('studio-media://asset/newer')

    await act(async () => {
      staleRecovery.reject(new Error('old recovery failed'))
      await Promise.allSettled([staleRecovery.promise])
    })
    expectPreview('available', 'studio-media://asset/newer')
  })

  it('does not treat a null-to-saved project path as accepted restoration authority', async () => {
    const resolveProjectBackground = vi.fn<StudioApi['resolveProjectBackground']>()
    installStudio({ resolveProjectBackground })
    const props = probeProps('/media/not-authorized.png', 30, null)

    await render(props)
    await render({ ...props })

    expect(resolveProjectBackground).not.toHaveBeenCalled()
    expectPreview('missing', null)
    expect(latest.preview.onRetryResolution).toBeUndefined()
  })
})
