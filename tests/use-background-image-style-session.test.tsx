// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useBackgroundImageStyleSession,
  type BackgroundImageStyleSession,
} from '../src/hooks/useBackgroundImageStyleSession'
import type { ProjectBackgroundImageController } from '../src/hooks/useProjectBackgroundImage'
import {
  createProjectStyleDraft,
  useProjectStyleSession,
  type ProjectStyleCommitResult,
  type ProjectStyleDraft,
  type ProjectStyleSession,
} from '../src/hooks/useProjectStyleSession'
import { DEFAULT_VOCAL_STYLE, cloneStageStyle } from '../src/lib/video-style'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, reject, resolve }
}

function capability(activeUrl: string | null, revision: string) {
  return { activeUrl, revision } satisfies StudioBackgroundCapabilityState
}

function styleDraft(
  mode: 'solid' | 'gradient' | 'image' = 'gradient',
  imagePath: string | null = null,
) {
  const stage = cloneStageStyle()
  stage.background = {
    ...stage.background,
    gradientStartColor: '#123456',
    gradientEndColor: '#abcdef',
    imagePath,
    mode,
    solidColor: '#654321',
  }
  return createProjectStyleDraft(stage, DEFAULT_VOCAL_STYLE)
}

function chosen(path: string, url: string): StudioBackgroundImageResult {
  return { name: path.split('/').at(-1)!, path, url }
}

interface ControllerHarness {
  controller: ProjectBackgroundImageController
  snapshots: Map<string, string>
  get capability(): StudioBackgroundCapabilityState | null
  set capability(value: StudioBackgroundCapabilityState | null)
}

function createController(
  initial: StudioBackgroundCapabilityState | null,
  retained: Array<[string, string]> = [],
): ControllerHarness {
  let current = initial
  let settlement = 0
  const snapshots = new Map(retained)
  const controller: ProjectBackgroundImageController = {
    preview: { url: null, resolutionStatus: 'none' },
    ready: true,
    beginSettlement: vi.fn(() => ++settlement),
    endSettlement: vi.fn(() => true),
    forgetSnapshot: vi.fn((path, url) => {
      if (snapshots.get(path) !== url) return false
      snapshots.delete(path)
      return true
    }),
    getCapability: vi.fn(() => current),
    reconcileCapability: vi.fn(async () => current),
    rememberSnapshot: vi.fn((path, url, next) => {
      snapshots.set(path, url)
      if (next) current = next
      return true
    }),
    setCapability: vi.fn((next) => {
      current = next
      return true
    }),
    sourceFor: vi.fn((background) => {
      if (background.mode !== 'image') return { url: null, resolutionStatus: 'none' }
      const url = background.imagePath ? (snapshots.get(background.imagePath) ?? null) : null
      return { url, resolutionStatus: url ? 'available' : 'missing' }
    }),
    urlForPath: vi.fn((path) => (path ? (snapshots.get(path) ?? null) : null)),
  }
  return {
    controller,
    snapshots,
    get capability() {
      return current
    },
    set capability(value) {
      current = value
    },
  }
}

let latest: { background: BackgroundImageStyleSession; style: ProjectStyleSession }

function Probe({
  controller,
  source,
  commitDraft,
  lifecycle = 1,
}: {
  controller: ProjectBackgroundImageController
  source: ProjectStyleDraft
  commitDraft: (draft: ProjectStyleDraft) => ProjectStyleCommitResult
  lifecycle?: number
}) {
  const style = useProjectStyleSession({
    ownerKey: { projectId: 'project', lifecycle, trackId: 'lead' },
    source,
    canInteract: () => true,
    requestFonts: () => undefined,
    commitDraft: (_owner, draft) => commitDraft(draft),
  })
  const background = useBackgroundImageStyleSession({
    backgroundImages: controller,
    session: style,
    sourceBackground: source.stageStyle.background,
  })
  latest = { background, style }
  return <output>{style.isOpen ? 'open' : 'closed'}</output>
}

function installStudio(overrides: Partial<StudioApi> = {}) {
  const base = capability(null, 'base')
  Object.defineProperty(window, 'studio', {
    configurable: true,
    value: {
      chooseBackgroundImage: vi.fn(async () => null),
      getBackgroundState: vi.fn(async () => base),
      releaseBackgroundSnapshot: vi.fn(async (expected) => expected),
      retainBackground: vi.fn(async (expected, url) => ({ ...expected, activeUrl: url })),
      settleBackgroundImage: vi.fn(async () => base),
      ...overrides,
    } as unknown as StudioApi,
  })
}

describe('transactional Style linked-image editing', () => {
  let container: HTMLDivElement
  let root: Root
  let trigger: HTMLButtonElement

  const render = async (
    controller: ProjectBackgroundImageController,
    source: ProjectStyleDraft,
    commitDraft: (draft: ProjectStyleDraft) => ProjectStyleCommitResult,
    lifecycle = 1,
  ) => {
    await act(async () => {
      root.render(
        <Probe
          controller={controller}
          source={source}
          commitDraft={commitDraft}
          lifecycle={lifecycle}
        />,
      )
      await Promise.resolve()
    })
  }

  const open = async () => act(async () => latest.background.start(trigger))
  const readyCandidate = async () => {
    const source = latest.background.preview
    expect(source.url).not.toBeNull()
    await act(async () => source.onLoadStatusChange?.(source.url!, 'ready'))
  }

  beforeEach(() => {
    container = document.createElement('div')
    trigger = document.createElement('button')
    document.body.append(container, trigger)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    trigger.remove()
    Reflect.deleteProperty(window, 'studio')
    vi.restoreAllMocks()
  })

  it('keeps the applied image active until one verified candidate and the aggregate Style apply succeed', async () => {
    const appliedUrl = 'studio-media://asset/applied'
    const candidateUrl = 'studio-media://asset/candidate'
    const initial = capability(appliedUrl, 'initial')
    const promoted = capability(candidateUrl, 'promoted')
    const controller = createController(initial, [['/media/applied.png', appliedUrl]])
    const picker = deferred<StudioBackgroundImageResult | null>()
    const chooseBackgroundImage = vi.fn(() => picker.promise)
    const settleBackgroundImage = vi.fn(async (_url: string, accepted: boolean) =>
      accepted ? promoted : initial,
    )
    installStudio({ chooseBackgroundImage, settleBackgroundImage })
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft('image', '/media/applied.png'), commit)
    await open()

    let first!: Promise<void>
    let duplicate!: Promise<void>
    await act(async () => {
      first = latest.background.controls.choose()
      duplicate = latest.background.controls.choose()
      picker.resolve(chosen('/media/candidate.jpg', candidateUrl))
      await Promise.all([first, duplicate])
    })
    expect(chooseBackgroundImage).toHaveBeenCalledOnce()
    expect(controller.capability).toEqual(initial)
    expect(settleBackgroundImage).not.toHaveBeenCalled()
    expect(latest.background.controls.applyBlockedReason).toContain('finish loading')
    await readyCandidate()
    await act(async () => expect(await latest.background.apply()).toBe(true))

    expect(settleBackgroundImage).toHaveBeenCalledExactlyOnceWith(candidateUrl, true)
    expect(commit).toHaveBeenCalledOnce()
    expect(controller.snapshots.get('/media/candidate.jpg')).toBe(candidateUrl)
    expect(latest.style.isOpen).toBe(false)
  })

  it('loads a main-authorized saved-template image as a preview candidate and promotes it on Apply', async () => {
    const path = '/templates/available.png'
    const candidateUrl = 'studio-media://asset/template-candidate'
    const initial = capability(null, 'initial')
    const promoted = capability(candidateUrl, 'promoted')
    const controller = createController(initial)
    const resolveStyleTemplateBackground = vi.fn<StudioApi['resolveStyleTemplateBackground']>(
      async () => ({ status: 'success', media: chosen(path, candidateUrl) }),
    )
    const settleBackgroundImage = vi.fn(async (_url: string, accepted: boolean) =>
      accepted ? promoted : initial,
    )
    installStudio({ resolveStyleTemplateBackground, settleBackgroundImage })
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft(), commit)
    await open()

    let loaded!: Awaited<ReturnType<BackgroundImageStyleSession['prepareTemplateBackground']>>
    await act(async () => {
      loaded = await latest.background.prepareTemplateBackground('template-available')
      if (loaded.status === 'stale' || loaded.status === 'cleared') {
        throw new Error('Expected template background')
      }
      latest.style.change((current) => ({
        ...current,
        stageStyle: {
          ...current.stageStyle,
          background: { ...current.stageStyle.background, imagePath: loaded.path, mode: 'image' },
        },
      }))
    })
    expect(resolveStyleTemplateBackground).toHaveBeenCalledExactlyOnceWith('template-available')
    expect(latest.background.preview.url).toBe(candidateUrl)
    await readyCandidate()
    await act(async () => expect(await latest.background.apply()).toBe(true))

    expect(settleBackgroundImage).toHaveBeenCalledWith(candidateUrl, true)
    expect(controller.snapshots.get(path)).toBe(candidateUrl)
    expect(commit).toHaveBeenCalledOnce()
  })

  it('keeps a missing saved-template link in the draft while dropping any stale snapshot', async () => {
    const path = '/templates/missing.png'
    const staleUrl = 'studio-media://asset/stale-snapshot'
    const controller = createController(capability(staleUrl, 'initial'), [[path, staleUrl]])
    const retainBackground = vi.fn(async (expected, url) => ({ ...expected, activeUrl: url }))
    installStudio({
      resolveStyleTemplateBackground: vi.fn(async () => ({ status: 'missing', path })),
      retainBackground,
    })
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft(), commit)
    await open()

    await act(async () => {
      const loaded = await latest.background.prepareTemplateBackground('template-missing')
      expect(loaded).toEqual({ status: 'missing', path })
      latest.style.change((current) => ({
        ...current,
        stageStyle: {
          ...current.stageStyle,
          background: { ...current.stageStyle.background, imagePath: path, mode: 'image' },
        },
      }))
    })
    expect(controller.snapshots.has(path)).toBe(false)
    expect(latest.background.preview.resolutionStatus).toBe('missing')
    await act(async () => expect(await latest.background.apply()).toBe(true))
    expect(retainBackground).toHaveBeenCalledWith(expect.anything(), null)
    expect(commit).toHaveBeenCalledOnce()
  })

  it('discards an image candidate before loading a non-image template without rewriting its background', async () => {
    const candidatePath = '/media/discarded-candidate.png'
    const candidateUrl = 'studio-media://asset/discarded-candidate'
    const initial = capability(null, 'initial')
    const controller = createController(initial)
    const settleBackgroundImage = vi.fn(async () => initial)
    const resolveStyleTemplateBackground = vi.fn()
    installStudio({
      chooseBackgroundImage: vi.fn(async () => chosen(candidatePath, candidateUrl)),
      resolveStyleTemplateBackground,
      settleBackgroundImage,
    })
    const templateBackground = {
      ...cloneStageStyle().background,
      imagePath: '/templates/remembered-image.png',
      mode: 'solid' as const,
      solidColor: '#102030',
    }
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft(), commit)
    await open()
    await act(async () => latest.background.controls.choose())

    await act(async () => {
      await expect(latest.background.prepareTemplateBackground(null)).resolves.toEqual({
        status: 'cleared',
      })
      latest.style.change((current) => ({
        ...current,
        stageStyle: { ...current.stageStyle, background: templateBackground },
      }))
    })
    expect(settleBackgroundImage).toHaveBeenCalledExactlyOnceWith(candidateUrl, false)
    expect(resolveStyleTemplateBackground).not.toHaveBeenCalled()
    expect(latest.background.preview).toMatchObject({ url: null, resolutionStatus: 'none' })

    await act(async () => expect(await latest.background.apply()).toBe(true))
    expect(commit.mock.calls[0]![0].stageStyle.background).toEqual(templateBackground)
  })

  it('preserves the current draft when a replacement picker is canceled or decoder validation fails', async () => {
    const draftUrl = 'studio-media://asset/draft'
    const chooseBackgroundImage = vi
      .fn<StudioApi['chooseBackgroundImage']>()
      .mockResolvedValueOnce(chosen('/media/draft.png', draftUrl))
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('decoder rejected the image'))
    installStudio({ chooseBackgroundImage })
    await render(
      createController(capability(null, 'initial')).controller,
      styleDraft(),
      () => 'applied',
    )
    await open()
    await act(async () => latest.background.controls.choose())
    await act(async () => latest.background.controls.choose())
    expect(latest.style.draft?.stageStyle.background.imagePath).toBe('/media/draft.png')
    expect(latest.background.preview.url).toBe(draftUrl)

    await act(async () => latest.background.controls.choose())
    expect(latest.style.draft?.stageStyle.background.imagePath).toBe('/media/draft.png')
    expect(latest.background.preview.url).toBe(draftUrl)
    expect(latest.background.controls.message).toContain('could not be linked')
  })

  it('retries a failed Preview, clears safely, and preserves latent Solid and Gradient colors', async () => {
    const initial = capability('studio-media://asset/applied', 'initial')
    const inactive = capability(null, 'inactive')
    const controller = createController(initial, [['/media/applied.png', initial.activeUrl!]])
    const settleBackgroundImage = vi.fn(async () => initial)
    const retainBackground = vi.fn(async () => inactive)
    installStudio({
      chooseBackgroundImage: vi.fn(async () =>
        chosen('/media/new.png', 'studio-media://asset/new'),
      ),
      retainBackground,
      settleBackgroundImage,
    })
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft('image', '/media/applied.png'), commit)
    await open()
    await act(async () => latest.background.controls.choose())
    const failed = latest.background.preview
    await act(async () => failed.onLoadStatusChange?.(failed.url!, 'error'))
    const reloadKey = latest.background.preview.reloadKey
    await act(async () => latest.background.controls.retryPreview())
    expect(latest.background.preview.reloadKey).toBe((reloadKey ?? 0) + 1)

    await act(async () => latest.background.controls.clear())
    expect(settleBackgroundImage).toHaveBeenCalledWith('studio-media://asset/new', false)
    expect(latest.style.draft?.stageStyle.background).toEqual({
      gradientEndColor: '#abcdef',
      gradientStartColor: '#123456',
      imagePath: null,
      mode: 'gradient',
      solidColor: '#654321',
    })
    await act(async () => expect(await latest.background.apply()).toBe(true))
    expect(retainBackground).toHaveBeenCalledWith(expect.anything(), null)
    expect(commit).toHaveBeenCalledOnce()
  })

  it('keeps Cancel retryable until candidate rejection is confirmed and never commits', async () => {
    const controller = createController(capability(null, 'initial'))
    const settleBackgroundImage = vi
      .fn<StudioApi['settleBackgroundImage']>()
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValueOnce(capability(null, 'rejected'))
    installStudio({
      chooseBackgroundImage: vi.fn(async () =>
        chosen('/media/cancel.png', 'studio-media://asset/cancel'),
      ),
      settleBackgroundImage,
    })
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft(), commit)
    await open()
    await act(async () => latest.background.controls.choose())

    await act(async () => expect(await latest.background.cancel()).toBe(false))
    expect(latest.style.isOpen).toBe(true)
    expect(latest.background.controls.message).toContain('could not be discarded')
    await act(async () => expect(await latest.background.cancel()).toBe(true))
    expect(commit).not.toHaveBeenCalled()
    expect(latest.style.isOpen).toBe(false)
  })

  it('restores and releases a promoted snapshot when aggregate Style commit is blocked', async () => {
    const acceptedUrl = 'studio-media://asset/accepted'
    const promotedUrl = 'studio-media://asset/promoted'
    const accepted = capability(acceptedUrl, 'accepted')
    const promoted = capability(promotedUrl, 'promoted')
    const restored = capability(acceptedUrl, 'restored')
    const released = capability(acceptedUrl, 'released')
    const controller = createController(accepted, [['/media/accepted.png', acceptedUrl]])
    const settleBackgroundImage = vi.fn(async () => promoted)
    const retainBackground = vi.fn(async () => restored)
    const releaseBackgroundSnapshot = vi.fn(async () => released)
    installStudio({ retainBackground, releaseBackgroundSnapshot, settleBackgroundImage })
    const commit = vi.fn(() => 'blocked' as const)
    await render(controller.controller, styleDraft('image', '/media/accepted.png'), commit)
    await open()
    vi.mocked(window.studio!.chooseBackgroundImage).mockResolvedValueOnce(
      chosen('/media/promoted.png', promotedUrl),
    )
    await act(async () => latest.background.controls.choose())
    await readyCandidate()
    await act(async () => expect(await latest.background.apply()).toBe(false))

    expect(retainBackground).toHaveBeenCalledWith(promoted, acceptedUrl)
    expect(releaseBackgroundSnapshot).toHaveBeenCalledWith(restored, promotedUrl)
    expect(controller.snapshots.has('/media/promoted.png')).toBe(false)
    expect(latest.style.draft?.stageStyle.background.imagePath).toBe('/media/accepted.png')
    expect(latest.background.controls.message).toContain('project Style was not changed')
  })

  it('keeps Style open with no commit when candidate promotion is stale', async () => {
    const initial = capability(null, 'initial')
    const controller = createController(initial)
    const settleBackgroundImage = vi.fn(async (_url: string, accepted: boolean) =>
      accepted ? null : initial,
    )
    installStudio({
      chooseBackgroundImage: vi.fn(async () =>
        chosen('/media/stale.png', 'studio-media://asset/stale'),
      ),
      settleBackgroundImage,
    })
    const commit = vi.fn(() => 'applied' as const)
    await render(controller.controller, styleDraft(), commit)
    await open()
    await act(async () => latest.background.controls.choose())
    await readyCandidate()
    await act(async () => expect(await latest.background.apply()).toBe(false))

    expect(commit).not.toHaveBeenCalled()
    expect(latest.style.isOpen).toBe(true)
    expect(latest.style.draft?.stageStyle.background).toMatchObject({
      imagePath: null,
      mode: 'gradient',
    })
    expect(latest.background.controls.message).toContain('project Style was not changed')
  })

  it('makes a same-path immutable replacement a semantic no-op and releases the old snapshot', async () => {
    const path = '/media/same.png'
    const oldUrl = 'studio-media://asset/old'
    const nextUrl = 'studio-media://asset/next'
    const initial = capability(oldUrl, 'initial')
    const promoted = capability(nextUrl, 'promoted')
    const released = capability(nextUrl, 'released')
    const controller = createController(initial, [[path, oldUrl]])
    const releaseBackgroundSnapshot = vi.fn(async () => released)
    installStudio({
      chooseBackgroundImage: vi.fn(async () => chosen(path, nextUrl)),
      releaseBackgroundSnapshot,
      settleBackgroundImage: vi.fn(async () => promoted),
    })
    const commit = vi.fn(() => 'noop' as const)
    await render(controller.controller, styleDraft('image', path), commit)
    await open()
    await act(async () => latest.background.controls.choose())
    await readyCandidate()
    await act(async () => expect(await latest.background.apply()).toBe(true))

    expect(commit).toHaveBeenCalledOnce()
    expect(releaseBackgroundSnapshot).toHaveBeenCalledWith(promoted, oldUrl)
    expect(controller.snapshots.get(path)).toBe(nextUrl)
    expect(latest.style.isOpen).toBe(false)
  })

  it('rejects stale chooser generations after owner change and rejects a candidate on teardown', async () => {
    const pending = deferred<StudioBackgroundImageResult | null>()
    const settleBackgroundImage = vi.fn(async () => capability(null, 'rejected'))
    installStudio({
      chooseBackgroundImage: vi
        .fn<StudioApi['chooseBackgroundImage']>()
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValueOnce(chosen('/media/teardown.png', 'studio-media://asset/teardown')),
      settleBackgroundImage,
    })
    const controller = createController(capability(null, 'initial'))
    const source = styleDraft()
    await render(controller.controller, source, () => 'applied')
    await open()
    let choosing!: Promise<void>
    await act(async () => {
      choosing = latest.background.controls.choose()
      await Promise.resolve()
    })
    await render(controller.controller, source, () => 'applied', 2)
    await act(async () => {
      pending.resolve(chosen('/media/stale.png', 'studio-media://asset/stale'))
      await choosing
    })
    expect(settleBackgroundImage).toHaveBeenCalledWith('studio-media://asset/stale', false)

    await open()
    await act(async () => latest.background.controls.choose())
    await act(async () => root.unmount())
    expect(settleBackgroundImage).toHaveBeenCalledWith('studio-media://asset/teardown', false)
  })
})
