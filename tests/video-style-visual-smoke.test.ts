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
      `${smoke.OPTIONS.scenario}${smoke.BASELINE_SCENARIO}`,
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
      sendInputEvent: vi.fn(),
      setZoomFactor: vi.fn(),
    },
  }
}

function projectLyricsState(width: number, height: number) {
  return {
    fontFamily: '"System UI"',
    fontSize: '48px',
    fontStatus: 'loaded',
    height,
    href: smoke.PACKAGED_APP_URL,
    readyState: 'complete',
    resourcesReady: true,
    stageHeight: height / 2,
    stageWidth: width / 2,
    typeface: 'System UI',
    width,
  }
}

function styleActionTarget(action: string) {
  return {
    action,
    boundsHeight: 24,
    boundsWidth: 60,
    height: 720,
    href: smoke.PACKAGED_APP_URL,
    readyState: 'complete',
    width: 1280,
    x: 120,
    y: 20,
  }
}

function backgroundState(mode: 'gradient' | 'solid', applied = false) {
  return {
    applied,
    css:
      mode === 'solid'
        ? 'rgb(33, 24, 45)'
        : 'linear-gradient(145deg, rgb(50, 34, 66), rgb(30, 22, 41))',
    gradientEndColor: '#1E1629',
    gradientStartColor: '#322242',
    height: 720,
    mode,
    resourcesReady: true,
    solidColor: '#21182D',
    stageHeight: 480,
    stageWidth: 853.33,
    width: 1280,
  }
}

function fakeStyleSessionWindow(
  options: { displayScale?: number; readiness?: Promise<never>; target?: unknown } = {},
) {
  const window = fakeWindow()
  const captures = [
    { height: 720, width: 1280 },
    { height: 900, width: 1440 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
    { height: 720, width: 1280 },
  ]
  window.webContents.capturePage.mockImplementation(async () => {
    const viewport = captures.shift()!
    return {
      getSize: () => viewport,
      isEmpty: () => false,
      toPNG: () => validPng(viewport.width, viewport.height),
    }
  })
  window.webContents.executeJavaScript
    .mockReset()
    .mockResolvedValueOnce(options.displayScale ?? 1)
    .mockResolvedValueOnce(
      options.target === undefined
        ? {
            boundsHeight: 24,
            boundsWidth: 60,
            height: 720,
            href: smoke.PACKAGED_APP_URL,
            readyState: 'complete',
            width: 1280,
            x: 120,
            y: 20,
          }
        : options.target,
    )
  if (options.readiness) {
    window.webContents.executeJavaScript.mockReturnValueOnce(options.readiness)
  } else {
    window.webContents.executeJavaScript
      .mockResolvedValueOnce(projectLyricsState(1280, 720))
      .mockResolvedValueOnce(projectLyricsState(1440, 900))
      .mockResolvedValueOnce(projectLyricsState(1280, 720))
      .mockResolvedValueOnce(styleActionTarget('background'))
      .mockResolvedValueOnce(backgroundState('gradient'))
      .mockResolvedValueOnce(styleActionTarget('solid'))
      .mockResolvedValueOnce(backgroundState('solid'))
      .mockResolvedValueOnce(styleActionTarget('apply'))
      .mockResolvedValueOnce(backgroundState('solid', true))
  }
  return window
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
    ).toMatchObject({ output, scenario: smoke.BASELINE_SCENARIO })
    expect(setPath.mock.calls.map(([name]) => name)).toEqual(['userData', 'sessionData'])
    expect(appendSwitch).toHaveBeenCalledWith('force-device-scale-factor', '1')
    expect(() => smoke.parseVisualSmokeArguments([...argv, argv[1]])).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
    expect(() =>
      smoke.parseVisualSmokeArguments([...argv, '--oks-video-style-visual-unknown=x']),
    ).toThrow('VISUAL_SMOKE_FLAG_INVALID')
    const scenarioIndex = argv.findIndex((argument) => argument.startsWith(smoke.OPTIONS.scenario))
    expect(() =>
      smoke.parseVisualSmokeArguments(argv.filter((_, index) => index !== scenarioIndex)),
    ).toThrow('VISUAL_SMOKE_FLAG_INVALID')
    const styleSessionScenario = [...argv]
    styleSessionScenario[scenarioIndex] = `${smoke.OPTIONS.scenario}${smoke.STYLE_SESSION_SCENARIO}`
    expect(smoke.parseVisualSmokeArguments(styleSessionScenario)).toMatchObject({
      scenario: smoke.STYLE_SESSION_SCENARIO,
    })
    const retiredScenario = [...argv]
    retiredScenario[scenarioIndex] = `${smoke.OPTIONS.scenario}project-typography`
    expect(() => smoke.parseVisualSmokeArguments(retiredScenario)).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
    const unknownScenario = [...argv]
    unknownScenario[scenarioIndex] = `${smoke.OPTIONS.scenario}unknown`
    expect(() => smoke.parseVisualSmokeArguments(unknownScenario)).toThrow(
      'VISUAL_SMOKE_FLAG_INVALID',
    )
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

  it('uses trusted input and publishes exact Style-session captures in viewport order', async () => {
    const window = fakeStyleSessionWindow()
    const publish = vi.fn(async (_output, artifacts) => {
      expect(window.isDestroyed()).toBe(true)
      expect(artifacts.map(({ name }: { name: string }) => name)).toEqual([
        '01-project-lyrics-1280x720.png',
        '02-project-lyrics-1440x900.png',
        '03-background-gradient-draft-1280x720.png',
        '04-background-solid-draft-1280x720.png',
        '05-background-solid-applied-1280x720.png',
        'result.json',
      ])
    })
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        { focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })
    const inputEvents = window.webContents.sendInputEvent.mock.calls.map(([event]) => event)
    expect(inputEvents).toHaveLength(12)
    expect(inputEvents.filter(({ type }) => type === 'mouseDown')).toHaveLength(4)
    expect(window.setContentSize.mock.calls).toContainEqual([1280, 720, false])
    expect(window.setContentSize.mock.calls).toContainEqual([1440, 900, false])
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(5)
    expect(smoke.STYLE_TARGET_SCRIPT).not.toContain('.click(')
    expect(smoke.STYLE_TARGET_SCRIPT).not.toContain('setTimeout')
    const readinessScript = smoke.projectLyricsReadinessScript({ height: 720, width: 1280 })
    for (const contract of [
      '.style-workspace[role="dialog"]',
      'Project lyric typeface',
      'Project lyrics design preview',
      'data-logical-stage',
      'document.fonts',
      'document.images',
      'MutationObserver',
      'ResizeObserver',
    ])
      expect(readinessScript).toContain(contract)
    expect(readinessScript).not.toContain('setTimeout')
  })

  it('converts Retina Style target coordinates for trusted input', async () => {
    const window = fakeStyleSessionWindow({
      displayScale: 2,
      target: {
        boundsHeight: 24,
        boundsWidth: 60,
        height: 720,
        href: smoke.PACKAGED_APP_URL,
        readyState: 'complete',
        width: 1280,
        x: 121,
        y: 21,
      },
    })
    const publish = vi.fn(async () => undefined)

    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        { focus: vi.fn(async () => true), publish },
      ),
    ).resolves.toEqual({ ok: true })

    expect(window.webContents.sendInputEvent).toHaveBeenCalledTimes(12)
    expect(window.webContents.sendInputEvent.mock.calls[0][0]).toEqual({
      type: 'mouseMove',
      x: 61,
      y: 11,
    })
    expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(0.5)
    expect(window.setContentSize.mock.calls).toContainEqual([640, 360, false])
    expect(window.setContentSize.mock.calls).toContainEqual([720, 450, false])
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(5)
    expect(publish).toHaveBeenCalledOnce()
  })

  it('rejects unsupported display scales and out-of-bounds trusted input coordinates', () => {
    const contents = { sendInputEvent: vi.fn() }
    const target = {
      boundsHeight: 24,
      boundsWidth: 60,
      height: 720,
      href: smoke.PACKAGED_APP_URL,
      readyState: 'complete',
      width: 1280,
      x: 120,
      y: 20,
    }

    expect(() => smoke.sendTrustedStyleActivation(contents, target, 1.5)).toThrow(
      'VISUAL_SMOKE_ACTIVATION_INVALID',
    )
    expect(() => smoke.sendTrustedStyleActivation(contents, { ...target, x: 1279 }, 2)).toThrow(
      'VISUAL_SMOKE_ACTIVATION_INVALID',
    )
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
  })

  it('fails closed without capture when the trusted Style target is missing', async () => {
    const window = fakeStyleSessionWindow({ target: null })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        { focus: vi.fn(async () => true), publish, writeFailure },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.sendInputEvent).not.toHaveBeenCalled()
    expect(window.webContents.capturePage).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledWith('/safe/evidence', {
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('uses a deadline only to fail closed when semantic readiness never arrives', async () => {
    const window = fakeStyleSessionWindow({ readiness: new Promise(() => undefined) })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        {
          focus: vi.fn(async () => true),
          publish,
          readinessTimeoutMs: 5,
          writeFailure,
        },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.sendInputEvent).toHaveBeenCalledTimes(3)
    expect(window.webContents.capturePage).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('publishes no partial scenario evidence when the second capture is invalid', async () => {
    const window = fakeStyleSessionWindow()
    window.webContents.capturePage
      .mockReset()
      .mockResolvedValueOnce({
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => validPng(1280, 720),
      })
      .mockResolvedValueOnce({
        getSize: () => ({ height: 720, width: 1280 }),
        isEmpty: () => false,
        toPNG: () => validPng(1280, 720),
      })
    const publish = vi.fn()
    const writeFailure = vi.fn(async () => undefined)
    await expect(
      smoke.runVisualSmoke(
        {
          app: {},
          config: {
            output: '/safe/evidence',
            scenario: smoke.STYLE_SESSION_SCENARIO,
          },
          window,
        },
        { focus: vi.fn(async () => true), publish, writeFailure },
      ),
    ).resolves.toEqual({ ok: false })
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(2)
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).toHaveBeenCalledOnce()
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
