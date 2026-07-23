import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { cloneStageStyle, cloneVocalStyle } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const {
  createIpcHandlerRegistration,
  installIpcHandlerRegistration,
}: {
  createIpcHandlerRegistration(
    dependencies: Record<string, unknown>,
  ): Array<[string, (event: unknown, value?: unknown) => Promise<unknown>]>
  installIpcHandlerRegistration(
    ipcMain: {
      handle(channel: string, handler: unknown): void
      removeHandler(channel: string): void
    },
    handlers: Array<[string, unknown]>,
  ): void
} = require('../electron/ipc-handlers.cjs')

const channelNames = [
  'listStyleTemplates',
  'createStyleTemplate',
  'renameStyleTemplate',
  'deleteStyleTemplate',
  'resolveStyleTemplateBackground',
  'getPendingWindowClose',
  'resolveWindowClose',
  'openProject',
  'settleProjectOpen',
  'resetProjectScope',
  'saveProject',
  'importAudio',
  'resolveProjectAudio',
  'releaseAudio',
  'getBackgroundState',
  'chooseBackgroundImage',
  'resolveProjectBackground',
  'settleBackgroundImage',
  'retainBackground',
  'releaseBackground',
  'releaseBackgroundSnapshot',
  'importLrc',
  'exportText',
  'exportVideo',
  'cancelVideoExport',
] as const

function dependencies(overrides: Record<string, unknown> = {}) {
  const channels = Object.fromEntries(channelNames.map((name) => [name, `studio:${name}`]))
  const required = () => undefined
  return {
    assertTrustedSender: required,
    backgroundCapabilityState: required,
    backgroundImageFilters: [],
    channels,
    createElectronNativeImageDecoder: required,
    dialog: {},
    fs: {},
    isNativeCloseRequestId: required,
    isRecord: required,
    linkedImageExportFailure: required,
    linkedImageMedia: required,
    lrcFilters: [],
    maxLrcFileBytes: 1,
    maxProjectFileBytes: 1,
    makeMediaResult: required,
    mediaCapabilities: {},
    mediaScheme: 'studio-media',
    normalizeBackgroundMutationRequest: required,
    normalizeExportRequest: required,
    normalizeMediaCapabilityReference: required,
    normalizeProjectRequest: required,
    normalizeVideoExportRequest: required,
    nativeCloseArbiter: {},
    nativeCloseRendererReadiness: {},
    path: {},
    projectOpenFilters: [],
    projectOpens: {},
    readLinkedImage: required,
    readUtf8FileWithinLimit: required,
    registerAudioResult: required,
    requireString: required,
    styleTemplateStore: {},
    withParsedProject: required,
    writeTextExport: required,
    videoExportOperation: {},
    audioExtensions: new Set(),
    audioFilters: [],
    saveValidatedProject: required,
    ...overrides,
  }
}

describe('IPC handler registration', () => {
  it('loads without Electron and constructs the complete injected handler set', () => {
    expect(() => createIpcHandlerRegistration({})).toThrow('assertTrustedSender must be a function')

    const registrations = createIpcHandlerRegistration(dependencies())
    expect(registrations.map(([channel]) => channel)).toEqual(
      channelNames.map((name) => `studio:${name}`),
    )
  })

  it('rejects an untrusted sender before every handler reads values or services', async () => {
    const rejected = new Error('untrusted')
    const registrations = createIpcHandlerRegistration(
      dependencies({
        assertTrustedSender: () => {
          throw rejected
        },
      }),
    )

    await Promise.all(
      registrations.map(async ([, handler]) =>
        expect(handler({ sender: { id: 9 } }, null)).rejects.toBe(rejected),
      ),
    )
  })

  it('rolls back any installed handlers if registration cannot finish', () => {
    const installed: string[] = []
    const removed: string[] = []
    expect(() =>
      installIpcHandlerRegistration(
        {
          handle(channel) {
            if (channel === 'second') throw new Error('install failed')
            installed.push(channel)
          },
          removeHandler(channel) {
            removed.push(channel)
          },
        },
        [
          ['first', () => undefined],
          ['second', () => undefined],
        ],
      ),
    ).toThrow('install failed')
    expect(installed).toEqual(['first'])
    expect(removed).toEqual(['first'])
  })

  it('uses the trusted sender as the sole cancellation owner and waits for cleanup', async () => {
    const ownerIds: number[] = []
    let aborted = false
    let finished = false
    const registrations = createIpcHandlerRegistration(
      dependencies({
        assertTrustedSender: () => ({ id: 7 }),
        videoExportOperation: {
          activeExportForOwner(ownerId: number) {
            ownerIds.push(ownerId)
            return {
              commitState: { tryBeginCancellation: () => true },
              controller: { abort: () => (aborted = true) },
              finished: Promise.resolve().then(() => (finished = true)),
            }
          },
        },
      }),
    )
    const cancel = registrations.find(([channel]) => channel === 'studio:cancelVideoExport')
    if (!cancel) throw new Error('cancelVideoExport handler was not registered')

    await expect(cancel[1]({ sender: { id: 7 } })).resolves.toBe(true)
    expect(ownerIds).toEqual([7])
    expect(aborted).toBe(true)
    expect(finished).toBe(true)
  })

  it('rejects a renderer-authored image path before it can become resolver authority', async () => {
    const readLinkedImage = vi.fn()
    const beginRequest = vi.fn()
    const registerBackgroundCandidate = vi.fn()
    const makeMediaResult = vi.fn()
    const stageStyle = cloneStageStyle()
    stageStyle.background = { ...stageStyle.background, mode: 'image', imagePath: '/hostile.png' }
    const hostile = {
      name: 'Hostile',
      preferences: {
        stageStyle,
        lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
        vocalStyle: cloneVocalStyle(),
        videoExportDefaults: { resolution: '720p', fps: 30 },
      },
    }
    const store = {
      authorizedBackgroundPaths: async () => new Set<string>(),
      create: async (
        value: typeof hostile,
        options: { authorizeBackgroundPath(path: string): boolean },
      ) => {
        if (!options.authorizeBackgroundPath(value.preferences.stageStyle.background.imagePath!)) {
          throw new Error('The linked background image is not authorized by Studio.')
        }
        return { id: 'hostile-id', ...value }
      },
      findAuthorized: async () => null,
    }
    const registrations = createIpcHandlerRegistration(
      dependencies({
        assertTrustedSender: (event: { sender: { id: number } }) => event.sender,
        isRecord: (value: unknown) => Boolean(value && typeof value === 'object'),
        linkedImageMedia: (value: unknown) => value,
        makeMediaResult,
        mediaCapabilities: {
          backgroundPathIsAuthorized: () => false,
          beginRequest,
          finishRequest: () => true,
          registerBackgroundCandidate,
        },
        readLinkedImage,
        styleTemplateStore: store,
      }),
    )
    const create = registrations.find(([channel]) => channel === 'studio:createStyleTemplate')![1]
    const resolve = registrations.find(
      ([channel]) => channel === 'studio:resolveStyleTemplateBackground',
    )![1]

    await expect(create({ sender: { id: 17 } }, hostile)).rejects.toThrow('not authorized')
    await expect(resolve({ sender: { id: 17 } }, { id: 'hostile-id' })).resolves.toEqual({
      status: 'stale',
    })
    expect(readLinkedImage).not.toHaveBeenCalled()
    expect(beginRequest).not.toHaveBeenCalled()
    expect(registerBackgroundCandidate).not.toHaveBeenCalled()
    expect(makeMediaResult).not.toHaveBeenCalled()
  })
})
