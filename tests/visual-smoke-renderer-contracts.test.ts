import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const contracts = require('../electron/visual-smoke-renderer-contracts.cjs')
const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

afterEach(() => vi.useRealTimers())

function rendererState(overrides: Record<string, unknown> = {}) {
  return {
    bridgeFrozen: true,
    bridgeFunctions: true,
    bridgeKeys: contracts.STUDIO_BRIDGE_KEYS,
    devicePixelRatio: 1,
    height: 720,
    href: contracts.PACKAGED_APP_URL,
    ipcReady: true,
    nodeAccess: false,
    readyState: 'complete',
    rootChildren: 1,
    stable: true,
    width: 1280,
    ...overrides,
  }
}

function styleTarget(overrides: Record<string, unknown> = {}) {
  return {
    boundsHeight: 24,
    boundsWidth: 60,
    height: 720,
    href: contracts.PACKAGED_APP_URL,
    readyState: 'complete',
    width: 1280,
    x: 100,
    y: 100,
    ...overrides,
  }
}

function preloadBridgeKeys() {
  const exposed: { api?: Record<string, unknown>; name?: string } = {}
  runInNewContext(source('electron/preload.cjs'), {
    require: (specifier: string) => {
      if (specifier !== 'electron') throw new Error(`Unexpected require: ${specifier}`)
      return {
        contextBridge: {
          exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
            exposed.name = name
            exposed.api = api
          },
        },
        ipcRenderer: {
          invoke: async () => undefined,
          on: () => {},
          removeListener: () => {},
        },
      }
    },
  })
  expect(exposed.name).toBe('studio')
  expect(exposed.api).toBeDefined()
  return Object.keys(exposed.api ?? {}).sort()
}

describe('visual smoke renderer contracts', () => {
  it('matches the bridge contract to the real preload API', () => {
    expect(preloadBridgeKeys()).toEqual(contracts.STUDIO_BRIDGE_KEYS)
  })

  it('accepts only the deterministic renderer state at the packaged origin', () => {
    expect(contracts.validRendererState(rendererState())).toBe(true)
    expect(contracts.validRendererState(rendererState({ nodeAccess: true }))).toBe(false)
    expect(contracts.validRendererState(rendererState({ bridgeKeys: ['exportVideo'] }))).toBe(false)
    expect(
      contracts.validRendererState(rendererState({ href: 'https://untrusted.invalid/' })),
    ).toBe(false)
  })

  it('rejects malformed or out-of-bounds trusted interaction targets', () => {
    expect(contracts.validStyleTarget(styleTarget())).toBe(true)
    expect(contracts.validStyleActionTarget({ ...styleTarget(), action: 'stage' }, 'stage')).toBe(
      true,
    )
    expect(
      contracts.validStyleActionTarget({ ...styleTarget(), action: 'background' }, 'stage'),
    ).toBe(false)
    expect(contracts.validStyleTarget(styleTarget({ x: 1280 }))).toBe(false)
    expect(contracts.validStyleTarget(styleTarget({ boundsWidth: 0 }))).toBe(false)
    expect(contracts.validStyleTarget(null)).toBe(false)
  })

  it('fails closed when a readiness result is incomplete or has unexpected media state', () => {
    const projectLyrics = {
      fontFamily: 'System UI',
      fontSize: '48px',
      fontStatus: 'loaded',
      height: 720,
      href: contracts.PACKAGED_APP_URL,
      readyState: 'complete',
      resourcesReady: true,
      stageHeight: 360,
      stageWidth: 640,
      typeface: 'System UI',
      width: 1280,
    }
    const background = {
      applied: false,
      css: 'linear-gradient(145deg, rgb(50, 34, 66), rgb(30, 22, 41))',
      gradientEndColor: '#1e1629',
      gradientStartColor: '#322242',
      height: 720,
      mode: 'gradient',
      resourcesReady: true,
      solidColor: '#21182d',
      stageHeight: 360,
      stageWidth: 640,
      width: 1280,
    }
    const viewport = { height: 720, width: 1280 }

    expect(contracts.validProjectLyricsState(projectLyrics, viewport)).toBe(true)
    expect(
      contracts.validProjectLyricsState({ ...projectLyrics, resourcesReady: false }, viewport),
    ).toBe(false)
    expect(contracts.validBackgroundState(background, viewport, 'gradient')).toBe(true)
    expect(
      contracts.validBackgroundState(
        { ...background, gradientEndColor: 'blue' },
        viewport,
        'gradient',
      ),
    ).toBe(false)
    expect(
      contracts.validLeadVocalState(
        {
          controls: 4,
          cueProgress: 0.5,
          height: 720,
          resourcesReady: true,
          stageHeight: 360,
          stageWidth: 640,
          width: 1280,
        },
        viewport,
      ),
    ).toBe(true)
    expect(
      contracts.validLeadVocalState(
        {
          controls: 4,
          cueProgress: 0.4,
          height: 720,
          resourcesReady: true,
          stageHeight: 360,
          stageWidth: 640,
          width: 1280,
        },
        viewport,
      ),
    ).toBe(false)
    const template = {
      controls: 5,
      height: 720,
      name: contracts.STYLE_TEMPLATE_NAME,
      resourcesReady: true,
      stageHeight: 360,
      stageWidth: 640,
      status: `Saved “${contracts.STYLE_TEMPLATE_NAME}”.`,
      width: 1280,
    }
    expect(contracts.validStyleTemplateState(template, viewport)).toBe(true)
    expect(contracts.validStyleTemplateState({ ...template, controls: 4 }, viewport)).toBe(false)
    const templateForm = {
      controls: 2,
      height: 720,
      nameReady: true,
      resourcesReady: true,
      stageHeight: 360,
      stageWidth: 640,
      width: 1280,
    }
    expect(contracts.validStyleTemplateFormState(templateForm, viewport)).toBe(true)
    expect(
      contracts.validStyleTemplateFormState({ ...templateForm, nameReady: false }, viewport),
    ).toBe(false)
  })

  it('treats keyboard assertions as exact contracts, including every selection change', () => {
    const keyboard = {
      changes: contracts.STYLE_KEY_CHANGES.map((role: string) => ({
        active: true,
        checked: true,
        checkedCount: 1,
        role,
      })),
      clean: true,
      closed: true,
      focus: contracts.STYLE_KEY_FOCUS,
      redoDisabled: true,
      undoDisabled: true,
    }
    expect(contracts.validStyleKeyboardState(keyboard)).toBe(true)
    expect(contracts.validStyleKeyboardState({ ...keyboard, focus: [] })).toBe(false)
    expect(
      contracts.validStyleKeyboardState({ ...keyboard, changes: keyboard.changes.slice(1) }),
    ).toBe(false)
  })

  it('uses a bounded deadline and exposes neither Node authority nor action interpolation', async () => {
    vi.useFakeTimers()
    const pending = contracts.executeBeforeDeadline(() => new Promise(() => {}), 10)
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'VISUAL_SMOKE_READINESS_INVALID',
    })
    await vi.advanceTimersByTimeAsync(10)
    await rejected
    await expect(contracts.executeBeforeDeadline(() => 'ready', 10)).resolves.toBe('ready')
    expect(() => contracts.executeBeforeDeadline(() => 'ready', 0)).toThrow(
      'VISUAL_SMOKE_READINESS_INVALID',
    )

    const action = contracts.styleSessionActionScript('"; globalThis.pwned = true; //')
    const template = contracts.styleTemplateReadinessScript(
      { height: 720, width: 1280 },
      contracts.STYLE_TEMPLATE_NAME,
    )
    const templateForm = contracts.styleTemplateFormReadinessScript({ height: 720, width: 1280 })
    for (const script of [
      contracts.STABLE_RENDERER_SCRIPT,
      contracts.STYLE_TARGET_SCRIPT,
      action,
      template,
      templateForm,
    ])
      expect(script).not.toContain('require(')
    expect(action).not.toContain('const action = "; globalThis.pwned')
    expect(template).not.toContain('window.studio')
    expect(template).toContain('Saved “')
    expect(templateForm).toContain('MutationObserver')
    expect(templateForm).toContain('aria-busy')
  })
})
