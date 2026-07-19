import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const focus = require('../electron/smoke-window-focus.cjs') as {
  focusSmokeWindow(options: Record<string, unknown>): Promise<boolean>
}

function fixture() {
  const methods = {
    app: vi.fn(),
    destroyed: vi.fn(() => false),
    execute: vi.fn(async () => true),
    native: vi.fn(() => true),
    renderer: vi.fn(),
    show: vi.fn(),
    webDestroyed: vi.fn(() => false),
    window: vi.fn(),
  }
  return {
    app: { focus: methods.app },
    methods,
    window: {
      focus: methods.window,
      isDestroyed: methods.destroyed,
      isFocused: methods.native,
      show: methods.show,
      webContents: {
        executeJavaScript: methods.execute,
        focus: methods.renderer,
        isDestroyed: methods.webDestroyed,
      },
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('font smoke focus acquisition', () => {
  it('activates the app and waits for both native and renderer focus', async () => {
    const setup = fixture()
    let attempts = 0
    setup.methods.native.mockImplementation(() => attempts >= 2)
    setup.methods.execute.mockImplementation(async () => {
      attempts += 1
      return attempts >= 2
    })
    await expect(
      focus.focusSmokeWindow({
        ...setup,
        delay: async () => undefined,
        now: () => attempts * 10,
        timeoutMs: 100,
      }),
    ).resolves.toBe(true)
    expect(setup.methods.app).toHaveBeenCalledWith({ steal: true })
    expect(setup.methods.show).toHaveBeenCalledTimes(2)
    expect(setup.methods.window).toHaveBeenCalledTimes(2)
    expect(setup.methods.renderer).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['FONT_ACCESS_SMOKE_FOCUS_FAILED', false],
    ['VISUAL_SMOKE_FOCUS_FAILED', true],
  ])('never weakens focus and fails with fixed code %s', async (code, customCode) => {
    const setup = fixture()
    let current = 0
    setup.methods.native.mockReturnValue(false)
    setup.methods.execute.mockResolvedValue(false)
    const failure = await focus
      .focusSmokeWindow({
        ...setup,
        delay: async () => {
          current += 10
        },
        now: () => current,
        timeoutMs: 20,
        ...(customCode ? { errorCode: code } : {}),
      })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code, message: code })
  })

  it('retries a transient activation exception and succeeds inside the bound', async () => {
    const setup = fixture()
    const secret = 'TransientSecret-DoNotLeak'
    let current = 0
    setup.methods.app
      .mockImplementationOnce(() => {
        throw new Error(secret)
      })
      .mockImplementationOnce(() => undefined)
    await expect(
      focus.focusSmokeWindow({
        ...setup,
        delay: async () => {
          current += 10
        },
        now: () => current,
        timeoutMs: 30,
      }),
    ).resolves.toBe(true)
    expect(setup.methods.app).toHaveBeenCalledTimes(2)
    expect(setup.methods.show).toHaveBeenCalledTimes(1)
  })

  it.each(['app', 'show', 'window', 'renderer', 'execute'] as const)(
    'deadline-races a never-settling %s focus operation and clears its timer',
    async (source) => {
      vi.useFakeTimers()
      const setup = fixture()
      setup.methods[source].mockReturnValue(new Promise(() => undefined))
      const pending = focus
        .focusSmokeWindow({
          ...setup,
          errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
          now: () => 0,
          timeoutMs: 20,
        })
        .catch((error: unknown) => error)

      await vi.advanceTimersByTimeAsync(20)
      await expect(pending).resolves.toMatchObject({
        code: 'VISUAL_SMOKE_FOCUS_FAILED',
        message: 'VISUAL_SMOKE_FOCUS_FAILED',
      })
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each(['app', 'show', 'execute', 'destroyed', 'native'] as const)(
    'redacts a persistent secret-bearing %s exception behind the fixed code',
    async (source) => {
      const setup = fixture()
      const secret = `PersistentSecret-${source}-DoNotLeak`
      let current = 0
      setup.methods[source].mockImplementation(() => {
        throw new Error(secret)
      })
      const failure = await focus
        .focusSmokeWindow({
          ...setup,
          delay: async () => {
            current += 10
          },
          errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
          intervalMs: 10,
          now: () => current,
          timeoutMs: 20,
        })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: 'VISUAL_SMOKE_FOCUS_FAILED',
        message: 'VISUAL_SMOKE_FOCUS_FAILED',
      })
      expect(String(failure)).not.toContain(secret)
    },
  )

  it('fails a destroyed window with only the caller fixed code', async () => {
    const setup = fixture()
    setup.methods.destroyed.mockReturnValue(true)
    const failure = await focus
      .focusSmokeWindow({
        ...setup,
        errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
      })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'VISUAL_SMOKE_FOCUS_FAILED',
      message: 'VISUAL_SMOKE_FOCUS_FAILED',
    })
    expect(setup.methods.app).not.toHaveBeenCalled()
    expect(setup.methods.show).not.toHaveBeenCalled()
  })

  it('fails when webContents is destroyed without attempting focus', async () => {
    const setup = fixture()
    setup.methods.webDestroyed.mockReturnValue(true)
    await expect(
      focus.focusSmokeWindow({
        ...setup,
        errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
      }),
    ).rejects.toMatchObject({ code: 'VISUAL_SMOKE_FOCUS_FAILED' })
    expect(setup.methods.app).not.toHaveBeenCalled()
  })

  it.each([
    { timeoutMs: Number.NaN },
    { timeoutMs: Number.POSITIVE_INFINITY },
    { timeoutMs: 1.5 },
    { timeoutMs: Number.MAX_SAFE_INTEGER + 1 },
    { intervalMs: 0 },
    { intervalMs: 1.5 },
  ])('rejects invalid bounded timing %# with a fixed fallback code', async (timing) => {
    const setup = fixture()
    const failure = await focus
      .focusSmokeWindow({
        ...setup,
        ...timing,
        errorCode: 'PrivateSecret-DoNotLeak',
      })
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'FONT_ACCESS_SMOKE_FOCUS_FAILED',
      message: 'FONT_ACCESS_SMOKE_FOCUS_FAILED',
    })
    expect(String(failure)).not.toContain('PrivateSecret')
  })

  it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [-1], [10, 9]])(
    'rejects a non-finite, negative, or decreasing monotonic clock',
    async (...values) => {
      const setup = fixture()
      let index = 0
      const failure = await focus
        .focusSmokeWindow({
          ...setup,
          now: () => values[Math.min(index++, values.length - 1)],
          timeoutMs: 20,
        })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'FONT_ACCESS_SMOKE_FOCUS_FAILED' })
    },
  )
})
