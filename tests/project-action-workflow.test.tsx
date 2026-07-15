import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('project action workflow wiring', () => {
  it('routes UI, workflow, inspector, and project menu entry points through one dispatcher', () => {
    const app = source('../src/App.tsx')
    for (const action of [
      'new',
      'open',
      'save',
      'export',
      'import-audio',
      'import-lrc',
      'undo',
      'redo',
    ]) {
      expect(app).toContain(`requestProjectAction('${action}')`)
    }
    expect(app).toContain("requestProjectAction('save-as', 'menu')")
    expect(app).toContain("requestProjectAction('open', 'menu')")
    expect(app).toMatch(/onImportAudio=\{\(\) => requestProjectAction\('import-audio'\)\}/)
    expect(app).toMatch(/play-toggle'[\s\S]{0,80}playback\.toggle\(\)/)
    expect(app).toMatch(/select-all'[\s\S]{0,240}selectAllActiveTrackWords\(\)/)
    expect(app).toMatch(/onToggle=\{playback\.toggle\}/)
    expect(app).toMatch(/onStop=\{handleStop\}/)
  })

  it('keeps trusted, bounded, exact-ID close IPC and ordinary beforeunload', () => {
    const main = source('../electron/main.cjs')
    const preload = source('../electron/preload.cjs')

    expect(main).toMatch(/getPendingWindowClose[\s\S]{0,180}assertTrustedSender/)
    expect(main).toMatch(
      /getPendingWindowClose[\s\S]{0,220}assertTrustedSender[\s\S]{0,120}markReady\(event\.sender\.id\)/,
    )
    expect(main).toMatch(/resolveWindowClose[\s\S]{0,220}assertTrustedSender/)
    expect(main).toContain('isNativeCloseRequestId(value.requestId)')
    expect(main).toContain('nativeCloseArbiter.resolve(value.requestId, value.proceed)')
    expect(preload).toContain('value.length === 36')
    expect(preload).toContain('isWindowCloseRequestId(value.requestId)')
    expect(preload).toContain('isWindowCloseRequestId(requestId)')
    expect(main).toMatch(/will-prevent-unload[\s\S]{0,700}Discard the unsaved changes/)
  })

  it('gates arbitration on renderer readiness and clears it across renderer teardown', () => {
    const main = source('../electron/main.cjs')
    const hook = source('../src/hooks/useProjectActionArbiter.ts')

    expect(main).toMatch(
      /window\.on\('close',[\s\S]{0,260}nativeCloseRendererReadiness\.isReady[\s\S]{0,120}preventDefault\(\)/,
    )
    expect(main).toContain(
      "contents.once('render-process-gone', () => clearNativeCloseOwnership(ownerId))",
    )
    expect(main).toMatch(/did-start-navigation[\s\S]{0,180}clearNativeCloseOwnership\(ownerId\)/)
    expect(main).toMatch(/contents\.once\('destroyed',[\s\S]{0,100}clearNativeCloseOwnership/)
    expect(main).toMatch(/window\.on\('closed',[\s\S]{0,100}clearNativeCloseOwnership/)
    expect(main).toMatch(
      /app\.on\('before-quit',[\s\S]{0,360}nativeCloseRendererReadiness\.isReady[\s\S]{0,160}requestAppQuit\(\)/,
    )
    expect(hook.indexOf('onWindowCloseRequest((value)')).toBeLessThan(
      hook.indexOf('void query(true)'),
    )
    expect(main).toMatch(
      /Failed to start[\s\S]{0,300}mainWindow\.destroy\(\)[\s\S]{0,80}app\.quit\(\)/,
    )
  })
})
