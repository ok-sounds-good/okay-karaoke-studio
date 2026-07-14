import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS,
  createVideoExportLifecycleGuard,
} = require('../electron/video-export-lifecycle.cjs') as {
  VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS: {
    buttons: string[]
    defaultId: number
    cancelId: number
    message: string
    detail: string
  }
  createVideoExportLifecycleGuard(options: {
    confirmCancellation: () => Promise<boolean>
    abortActiveExport: () => Promise<void>
    closeWindow: () => void
    quitApp: () => void
    onError?: (error: unknown) => void
  }): {
    requestAppQuit(): Promise<boolean>
    requestWindowClose(): Promise<boolean>
  }
}

function lifecycleGuard(confirmed: boolean) {
  const actions: string[] = []
  const abortActiveExport = vi.fn(async () => { actions.push('abort') })
  const closeWindow = vi.fn(() => { actions.push('close') })
  const quitApp = vi.fn(() => { actions.push('quit') })
  const guard = createVideoExportLifecycleGuard({
    confirmCancellation: vi.fn(async () => confirmed),
    abortActiveExport,
    closeWindow,
    quitApp,
  })
  return { actions, abortActiveExport, closeWindow, guard, quitApp }
}

describe('video export lifecycle cancellation guard', () => {
  it('keeps an active export and window open when close cancellation is declined', async () => {
    const fixture = lifecycleGuard(false)

    await expect(fixture.guard.requestWindowClose()).resolves.toBe(false)

    expect(fixture.abortActiveExport).not.toHaveBeenCalled()
    expect(fixture.closeWindow).not.toHaveBeenCalled()
    expect(fixture.quitApp).not.toHaveBeenCalled()
  })

  it('aborts before resuming a confirmed window close', async () => {
    const fixture = lifecycleGuard(true)

    await expect(fixture.guard.requestWindowClose()).resolves.toBe(true)

    expect(fixture.actions).toEqual(['abort', 'close'])
    expect(fixture.quitApp).not.toHaveBeenCalled()
  })

  it('aborts before resuming a confirmed application quit', async () => {
    const fixture = lifecycleGuard(true)

    await expect(fixture.guard.requestAppQuit()).resolves.toBe(true)

    expect(fixture.actions).toEqual(['abort', 'quit'])
    expect(fixture.closeWindow).not.toHaveBeenCalled()
  })

  it('does not close when promotion starts while cancellation confirmation is open', async () => {
    let resolveConfirmation = (_confirmed: boolean) => {}
    const confirmation = new Promise<boolean>((resolve) => { resolveConfirmation = resolve })
    const error = Object.assign(
      new Error('Video export promotion has already begun and cannot be canceled'),
      { code: 'VIDEO_EXPORT_NOT_CANCELLABLE' },
    )
    const closeWindow = vi.fn()
    const abortActiveExport = vi.fn(async () => { throw error })
    const onError = vi.fn()
    const guard = createVideoExportLifecycleGuard({
      confirmCancellation: () => confirmation,
      abortActiveExport,
      closeWindow,
      quitApp: vi.fn(),
      onError,
    })

    const closeRequest = guard.requestWindowClose()
    resolveConfirmation(true)

    await expect(closeRequest).resolves.toBe(false)
    expect(abortActiveExport).toHaveBeenCalledOnce()
    expect(closeWindow).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('uses a non-destructive default and explains partial preservation', () => {
    expect(VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.buttons).toEqual(['Keep Exporting', 'Cancel Export'])
    expect(VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.defaultId).toBe(0)
    expect(VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.cancelId).toBe(0)
    expect(VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.message).toBe('Cancel the video export?')
    expect(VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.detail).toContain('partial MP4 will remain')
  })

  it('routes native window close and application quit through the guard', () => {
    const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')

    expect(electronMain).toMatch(
      /window\.on\('close',[\s\S]{0,220}?preventDefault\(\)[\s\S]{0,220}?requestWindowClose\(\)/,
    )
    expect(electronMain).toMatch(
      /app\.on\('before-quit',[\s\S]{0,220}?preventDefault\(\)[\s\S]{0,220}?requestAppQuit\(\)/,
    )
    expect(electronMain).toMatch(
      /onPromotionStart:\s*\(\)\s*=>\s*operation\.commitState\.beginPromotion\(\)/,
    )
    expect(electronMain).toMatch(
      /cancelVideoExport,[\s\S]{0,280}?tryBeginCancellation\(\)[\s\S]{0,120}?return false/,
    )
  })
})
