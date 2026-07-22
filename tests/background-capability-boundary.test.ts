import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

describe('linked-background Electron boundary', () => {
  const main = source('electron/main.cjs')
  const handlers = source('electron/ipc-handlers.cjs')
  const protocols = source('electron/studio-protocols.cjs')
  const windowSecurity = source('electron/window-security.cjs')
  const preload = source('electron/preload.cjs')
  const types = source('src/electron.d.ts')
  const videoExport = source('electron/video-export.cjs')

  it('keeps selection native, trusted, and pathless from the renderer', () => {
    const start = handlers.indexOf('channels.chooseBackgroundImage')
    const end = handlers.indexOf('channels.resolveProjectBackground', start)
    const handler = handlers.slice(start, end)
    expect(start).toBeGreaterThan(0)
    expect(handler.indexOf('assertTrustedSender(event)')).toBeLessThan(
      handler.indexOf('dialog.showOpenDialog(owner'),
    )
    expect(handler).toContain('filters: backgroundImageFilters')
    expect(handler).toContain('readLinkedImage(filePath')
    expect(handler).not.toContain('value.path')
    expect(preload).toContain(
      'chooseBackgroundImage: () => ipcRenderer.invoke(CHANNELS.chooseBackgroundImage)',
    )
  })

  it('serves background snapshot bytes and decoder MIME instead of reopening its path', () => {
    const start = protocols.indexOf("if (mediaFile.kind === 'background')")
    const end = protocols.indexOf('let fileStats', start)
    const branch = protocols.slice(start, end)
    expect(branch).toContain("'Content-Type': mediaFile.mime")
    expect(branch).toContain('Buffer.from(mediaFile.bytes.subarray')
    expect(branch).not.toContain('createReadStream')
    expect(main).toContain("mime: image.format === 'png' ? 'image/png' : 'image/jpeg'")
  })

  it('revalidates Image export before setup and gives offscreen rendering only snapshot bytes', () => {
    const authorization = source('electron/video-export-authorization.cjs')
    const operation = source('electron/video-export-operation.cjs')
    const exportSetup = main.slice(
      main.indexOf('function executeVideoExport'),
      main.indexOf('function parseVideoExportProject'),
    )
    expect(operation.indexOf('beginExport(sender.id)')).toBeLessThan(
      operation.indexOf('await authorizeExport'),
    )
    expect(operation).toContain('signal: operation.controller.signal')
    expect(authorization).toContain('backgroundExportSnapshot(')
    expect(authorization).toContain('await readLinkedImage(retained.filePath)')
    expect(authorization).toContain('sameMedia(retained, current)')
    expect(exportSetup).toContain('backgroundImage: authorization.backgroundImage')
    expect(exportSetup).not.toContain('readLinkedImage')
    expect(videoExport).not.toContain('readLinkedImage(background.imagePath)')
    expect(preload).not.toContain('backgroundImage.bytes')
    expect(handlers).toContain('linkedImageExportFailure(error, request.background, mediaScheme)')
  })

  it('exposes only opaque settlement and exact-project restore operations', () => {
    for (const name of [
      'resolveProjectBackground',
      'settleBackgroundImage',
      'retainBackground',
      'releaseBackground',
      'releaseBackgroundSnapshot',
      'getBackgroundState',
    ]) {
      expect(preload).toContain(`${name}:`)
      expect(types).toContain(`${name}(`)
    }
    expect(main).toContain('prepareProjectMedia(scope.path, scope.project, AUDIO_EXTENSIONS)')
    expect(main).toContain('mediaCapabilities.replaceProjectScope(ownerId, scope.projectPath')
    expect(handlers).toContain("normalizeBackgroundMutationRequest(value, 'nullable', mediaScheme)")
    expect(handlers).toContain("status: 'missing'")
    expect(handlers).toContain("return { status: 'stale' }")
    const retainHandler = handlers.slice(handlers.indexOf('channels.retainBackground'))
    expect(retainHandler.indexOf('assertTrustedSender(event)')).toBeLessThan(
      retainHandler.indexOf('normalizeBackgroundMutationRequest'),
    )
  })

  it('cleans capability ownership on navigation, renderer loss, and destruction', () => {
    const secureContents = windowSecurity.slice(
      windowSecurity.indexOf('function secureWebContents'),
    )
    expect(main).toContain('mediaCapabilities.releaseOwner(ownerId)')
    expect(secureContents).toContain('const releaseRendererScope = () => releaseOwner(ownerId)')
    expect(secureContents).toContain("contents.on('did-start-navigation'")
    expect(secureContents).toContain("contents.once('render-process-gone', releaseTerminalScope)")
    expect(secureContents).toContain("contents.once('destroyed'")
  })
})
