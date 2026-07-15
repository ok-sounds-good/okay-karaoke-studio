import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const smoke = require('../electron/video-style-visual-smoke.cjs')
const profiles = require('../electron/smoke-profile.cjs')
const roots: string[] = []

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  ),
)

async function configuredArguments() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-config-'))
  roots.push(root)
  const user = await profiles.createOwnedSmokeProfile('user-', { temporaryRoot: root })
  const session = await profiles.createOwnedSmokeProfile('session-', { temporaryRoot: root })
  const output = join(root, 'evidence')
  return {
    argv: [
      smoke.TRIGGER,
      `${smoke.OPTIONS.output}${output}`,
      `${smoke.OPTIONS.userData}${user.path}`,
      `${smoke.OPTIONS.userIdentity}${user.serializedIdentity}`,
      `${smoke.OPTIONS.sessionData}${session.path}`,
      `${smoke.OPTIONS.sessionIdentity}${session.serializedIdentity}`,
    ],
    output,
  }
}

function fakeWindow(
  capturePage = vi.fn(async () => ({
    getSize: () => ({ height: 720, width: 1280 }),
    isEmpty: () => false,
    toPNG: () => validPng(1280, 720),
  })),
  displayScale = 1,
) {
  let destroyed = false
  let contentSize = [1280, 720]
  return {
    destroy: vi.fn(() => {
      destroyed = true
    }),
    getContentSize: () => contentSize,
    isDestroyed: () => destroyed,
    setContentSize: vi.fn((width: number, height: number) => {
      contentSize = [width, height]
    }),
    setMinimumSize: vi.fn(),
    webContents: {
      capturePage,
      executeJavaScript: vi.fn().mockResolvedValueOnce(displayScale).mockResolvedValueOnce({
        devicePixelRatio: 1,
        height: 720,
        href: smoke.PACKAGED_APP_URL,
        readyState: 'complete',
        rootChildren: 1,
        stable: true,
        width: 1280,
      }),
      getURL: () => smoke.PACKAGED_APP_URL,
      isDestroyed: () => destroyed,
      setZoomFactor: vi.fn(),
    },
  }
}

function fakeRendererContents() {
  let destroyed = false
  return Object.assign(new EventEmitter(), {
    destroy() {
      destroyed = true
      this.emit('destroyed')
    },
    isDestroyed: () => destroyed,
  })
}

describe('production-window visual smoke', () => {
  it('accepts one complete flag set and configures isolated paths before readiness', async () => {
    const { argv, output } = await configuredArguments()
    const config = smoke.parseVisualSmokeArguments(argv)
    const setPath = vi.fn()
    const appendSwitch = vi.fn()
    expect(
      smoke.configureVisualSmokeBeforeReady(
        {
          commandLine: { appendSwitch },
          getPath: (name: string) => join(tmpdir(), `default-${name}`),
          isReady: () => false,
          setPath,
        },
        config,
      ),
    ).toMatchObject({ output })
    expect(setPath.mock.calls.map(([name]) => name)).toEqual(['userData', 'sessionData'])
    expect(appendSwitch).toHaveBeenCalledWith('force-device-scale-factor', '1')
    expect(() => smoke.parseVisualSmokeArguments([...argv, argv[1]])).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
    expect(() =>
      smoke.parseVisualSmokeArguments([...argv, '--oks-video-style-visual-unknown=x']),
    ).toThrow('VISUAL_SMOKE_FLAG_INVALID')
  })

  it('captures, validates, publishes baseline before result, and destroys the window', async () => {
    const window = fakeWindow(undefined, 2)
    const publish = vi.fn(async (_output, artifacts) => {
      expect(window.isDestroyed()).toBe(true)
      expect(artifacts.map(({ name }: { name: string }) => name)).toEqual([
        '01-baseline.png',
        'result.json',
      ])
    })
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence' },
          window,
        },
        { focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })
    expect(window.setContentSize).toHaveBeenCalledWith(1280, 720, false)
    expect(window.setContentSize).toHaveBeenCalledWith(640, 360, false)
    expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(window.setMinimumSize).toHaveBeenCalledWith(1, 1)
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('publishes only a fixed failure and tears down when capture throws secret data', async () => {
    const window = fakeWindow(
      vi.fn(async () => {
        throw new Error('/private/song.mp3')
      }),
    )
    const writeFailure = vi.fn(async () => {
      expect(window.isDestroyed()).toBe(true)
    })
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: { output: '/safe/evidence' },
          window,
        },
        { focus: vi.fn(async () => true), writeFailure },
      ),
    ).resolves.toEqual({ ok: false })
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
    expect(JSON.stringify(writeFailure.mock.calls)).not.toContain('/private/song.mp3')
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('cannot publish or report success when window teardown throws', async () => {
    const window = fakeWindow()
    window.destroy.mockImplementation(() => {
      throw new Error('destroyed BrowserWindow access')
    })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)

    await expect(
      smoke.runVisualSmoke(
        { app: {}, config: { output: '/safe/evidence' }, window },
        { focus: vi.fn(async () => true), publish, writeFailure },
      ),
    ).resolves.toEqual({ ok: false })
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
  })

  it.each(['uncaughtException', 'unhandledRejection'])(
    'consumes a teardown %s without a default throw or success publication',
    async (fatalEvent) => {
      const stderr = { write: vi.fn(() => true) }
      const processLike = Object.assign(new EventEmitter(), { stderr })
      const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
      const window = fakeWindow()
      const publish = vi.fn()
      const writeFailure = vi.fn(async () => undefined)
      const secret = '/private/teardown-stack'

      await expect(
        smoke.runVisualSmoke(
          { app: {}, config: { output: '/safe/evidence' }, fatalObserver, window },
          {
            focus: vi.fn(async () => true),
            publish,
            settle: vi.fn(async () => {
              expect(() => processLike.emit(fatalEvent, new Error(secret))).not.toThrow()
            }),
            writeFailure,
          },
        ),
      ).resolves.toEqual({ ok: false })
      expect(publish).not.toHaveBeenCalled()
      expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
        code: 'VISUAL_SMOKE_FAILED',
        ok: false,
      })
      expect(stderr.write).toHaveBeenCalledWith(smoke.FATAL_DIAGNOSTIC)
      expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(secret)
      fatalObserver.dispose()
      expect(processLike.listenerCount('uncaughtException')).toBe(0)
      expect(processLike.listenerCount('unhandledRejection')).toBe(0)
    },
  )

  it.each([
    'Uncaught TypeError: renderer probe',
    'Uncaught (in promise) TypeError: renderer probe',
  ])('fails closed on a sanitized renderer console error: %s', (message) => {
    const stderr = { write: vi.fn(() => true) }
    const processLike = Object.assign(new EventEmitter(), { stderr })
    const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
    const contents = fakeRendererContents()
    fatalObserver.observeRenderer(contents)

    contents.emit('console-message', {
      level: 'error',
      message,
      sourceId: '/private/renderer-source.js',
    })

    expect(fatalObserver.hasFatal()).toBe(true)
    expect(stderr.write).toHaveBeenCalledWith(smoke.FATAL_DIAGNOSTIC)
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain(message)
    expect(JSON.stringify(stderr.write.mock.calls)).not.toContain('/private/renderer-source.js')
    fatalObserver.dispose()
    expect(contents.listenerCount('console-message')).toBe(0)
    expect(processLike.listenerCount('uncaughtException')).toBe(0)
    expect(processLike.listenerCount('unhandledRejection')).toBe(0)
  })

  it('ignores clean renderer console traffic and disposes safely after WebContents destruction', () => {
    const stderr = { write: vi.fn(() => true) }
    const processLike = Object.assign(new EventEmitter(), { stderr })
    const fatalObserver = smoke.installVisualSmokeFatalObserver(processLike)
    const contents = fakeRendererContents()
    fatalObserver.observeRenderer(contents)

    contents.emit('console-message', {
      level: 'info',
      message: 'Uncaught TypeError appears only as quoted informational text',
    })
    contents.emit('console-message', {}, 2, 'Uncaught (in promise) appears only in a warning')

    expect(fatalObserver.hasFatal()).toBe(false)
    expect(stderr.write).not.toHaveBeenCalled()
    contents.destroy()
    expect(() => fatalObserver.dispose()).not.toThrow()
    expect(fatalObserver.hasFatal()).toBe(false)
  })

  it('routes smoke mode through the built protocol without weakening window security', async () => {
    const source = await readFile(join(process.cwd(), 'electron/main.cjs'), 'utf8')
    expect(source.indexOf('configureVisualSmokeBeforeReady')).toBeLessThan(
      source.indexOf('requestSingleInstanceLock'),
    )
    expect(source).toContain('app.isPackaged || visualSmokeConfig !== null')
    expect(source).toContain('await window.loadURL(PACKAGED_APP_URL)')
    expect(source).toContain(
      'if (visualSmokeConfig) visualSmokeFatalObserver = installVisualSmokeFatalObserver(process)',
    )
    expect(
      source.indexOf('visualSmokeFatalObserver.observeRenderer(window.webContents)'),
    ).toBeLessThan(source.indexOf('await window.loadURL(PACKAGED_APP_URL)'))
    expect(source).toContain('createNativeCloseOwnershipCleanup(')
    expect(source).toContain('clearNativeCloseOwnershipAfterWindowClosed()')
    for (const invariant of [
      'contextIsolation: true',
      'nodeIntegration: false',
      'sandbox: true',
      'webSecurity: true',
      'allowRunningInsecureContent: false',
      'enableLargerThanScreen: visualSmokeConfig !== null',
    ])
      expect(source).toContain(invariant)
  })
})
