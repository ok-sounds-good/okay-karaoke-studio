import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const textExport = require('../electron/text-export.cjs') as {
  EXPORT_FILTERS: Record<string, Array<{ name: string; extensions: string[] }>>
  ensureExportExtension(fileName: string, format: string): string
  normalizeExportFormat(value: unknown): string
  normalizeExportPath(filePath: string, format: string): string
}

describe('desktop text export formats', () => {
  it('treats an editable project as an exact .oks export', () => {
    expect(textExport.normalizeExportFormat('OKS')).toBe('oks')
    expect(textExport.ensureExportExtension('my-song.oks', 'oks')).toBe('my-song.oks')
    expect(textExport.ensureExportExtension('my-song.OKS', 'oks')).toBe('my-song.oks')
    expect(textExport.ensureExportExtension('my-song.json', 'oks')).toBe('my-song.oks')
    expect(textExport.ensureExportExtension('my-song.JSON', 'oks')).toBe('my-song.oks')
    expect(textExport.EXPORT_FILTERS.oks).toEqual([
      { name: 'Okay Karaoke Studio Project', extensions: ['oks'] },
    ])
  })

  it('normalizes the selected destination while preserving its directory', () => {
    const nestedDirectory = join('MixedCase Exports', 'Nested Folder')

    expect(textExport.normalizeExportPath(join(nestedDirectory, 'my-song'), 'oks')).toBe(
      join(nestedDirectory, 'my-song.oks'),
    )
    expect(textExport.normalizeExportPath(join(nestedDirectory, 'my-song.ass'), 'oks')).toBe(
      join(nestedDirectory, 'my-song.oks'),
    )
    expect(textExport.normalizeExportPath(join(nestedDirectory, 'my-song.JSON'), 'oks')).toBe(
      join(nestedDirectory, 'my-song.oks'),
    )
  })

  it('rejects the obsolete JSON route and unknown formats', () => {
    expect(() => textExport.normalizeExportFormat('json')).toThrow(
      'format must be lrc, ass, or oks',
    )
    expect(() => textExport.normalizeExportFormat(null)).toThrow(
      'format must be a string',
    )
  })

  it('preserves LRC and ASS filename normalization', () => {
    expect(textExport.ensureExportExtension('lyrics', 'lrc')).toBe('lyrics.lrc')
    expect(textExport.ensureExportExtension('lyrics.txt', 'ass')).toBe('lyrics.ass')
    expect(textExport.ensureExportExtension('karaoke-video.mp4', 'mp4')).toBe('karaoke-video.mp4')
  })
})
