import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

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
})
