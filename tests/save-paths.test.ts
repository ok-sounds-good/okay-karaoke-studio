import { createRequire } from 'node:module'
import { posix, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const savePaths = require('../electron/save-paths.cjs') as {
  PROJECT_OPEN_FILTERS: Array<{ name: string; extensions: string[] }>
  PROJECT_SAVE_FILTERS: Array<{ name: string; extensions: string[] }>
  canonicalSavePath(filePath: string, format: string, pathApi?: typeof posix): string
  isCanonicalSavePath(filePath: string, format: string, pathApi?: typeof posix): boolean
  showCanonicalSaveDialog(
    showSaveDialog: (owner: object, options: Record<string, unknown>) => Promise<{
      canceled: boolean
      filePath?: string
    }>,
    owner: object,
    options: Record<string, unknown> & { defaultPath: string },
    format: string,
    pathApi?: typeof posix,
  ): Promise<string | null>
}

describe('canonical native save destinations', () => {
  it('keeps legacy project formats read-only and advertises only lowercase .oks for saves', () => {
    expect(savePaths.PROJECT_OPEN_FILTERS).toEqual([
      { name: 'Okay Karaoke Studio Project', extensions: ['oks', 'okstudio', 'json'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    expect(savePaths.PROJECT_SAVE_FILTERS).toEqual([
      { name: 'Okay Karaoke Studio Project', extensions: ['oks'] },
    ])
  })

  it('canonicalizes POSIX and Windows-native paths to the exact requested extension', () => {
    expect(savePaths.canonicalSavePath('/projects/song.JSON', 'oks', posix)).toBe(
      '/projects/song.oks',
    )
    expect(savePaths.canonicalSavePath('/projects/song.OKS', 'oks', posix)).toBe(
      '/projects/song.oks',
    )
    expect(savePaths.isCanonicalSavePath('/projects/song.oks', 'oks', posix)).toBe(true)
    expect(savePaths.isCanonicalSavePath('/projects/song.OKS', 'oks', posix)).toBe(false)

    expect(savePaths.canonicalSavePath('C:\\Projects\\song.okstudio', 'oks', win32)).toBe(
      'C:\\Projects\\song.oks',
    )
    expect(savePaths.canonicalSavePath('C:\\Projects\\song.MP4', 'mp4', win32)).toBe(
      'C:\\Projects\\song.mp4',
    )
    expect(savePaths.isCanonicalSavePath('C:\\Projects\\song.mp4', 'mp4', win32)).toBe(true)
    expect(savePaths.isCanonicalSavePath('C:\\Projects\\song.MP4', 'mp4', win32)).toBe(false)
  })

  it('reconfirms every normalized Windows destination in the native dialog before returning it', async () => {
    const owner = {}
    const showSaveDialog = vi.fn()
      .mockResolvedValueOnce({ canceled: false, filePath: 'C:\\Exports\\song.json' })
      .mockResolvedValueOnce({ canceled: false, filePath: 'C:\\Exports\\song.OKS' })
      .mockResolvedValueOnce({ canceled: false, filePath: 'C:\\Exports\\song.oks' })

    await expect(savePaths.showCanonicalSaveDialog(
      showSaveDialog,
      owner,
      { defaultPath: 'C:\\Documents\\draft.OKS', filters: [] },
      'oks',
      win32,
    )).resolves.toBe('C:\\Exports\\song.oks')

    expect(showSaveDialog).toHaveBeenCalledTimes(3)
    expect(showSaveDialog.mock.calls.map(([, options]) => options.defaultPath)).toEqual([
      'C:\\Documents\\draft.oks',
      'C:\\Exports\\song.oks',
      'C:\\Exports\\song.oks',
    ])
  })

  it('returns an already canonical destination after one native confirmation', async () => {
    const owner = {}
    const showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: '/exports/already-confirmed.ass',
    }))

    await expect(savePaths.showCanonicalSaveDialog(
      showSaveDialog,
      owner,
      { defaultPath: '/exports/already-confirmed.ass', filters: [] },
      'ass',
      posix,
    )).resolves.toBe('/exports/already-confirmed.ass')
    expect(showSaveDialog).toHaveBeenCalledOnce()
  })

  it('returns only the exact POSIX MP4 path confirmed by the OS and respects cancellation', async () => {
    const owner = {}
    const showSaveDialog = vi.fn()
      .mockResolvedValueOnce({ canceled: false, filePath: '/exports/show.json' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/exports/show.mp4' })

    await expect(savePaths.showCanonicalSaveDialog(
      showSaveDialog,
      owner,
      { defaultPath: '/videos/show.MP4', filters: [] },
      'mp4',
      posix,
    )).resolves.toBe('/exports/show.mp4')
    expect(showSaveDialog.mock.calls.map(([, options]) => options.defaultPath)).toEqual([
      '/videos/show.mp4',
      '/exports/show.mp4',
    ])

    await expect(savePaths.showCanonicalSaveDialog(
      vi.fn(async () => ({ canceled: true })),
      owner,
      { defaultPath: '/videos/show.mp4', filters: [] },
      'mp4',
      posix,
    )).resolves.toBeNull()

    const cancelAfterNormalization = vi.fn()
      .mockResolvedValueOnce({ canceled: false, filePath: '/videos/unconfirmed.json' })
      .mockResolvedValueOnce({ canceled: true })
    await expect(savePaths.showCanonicalSaveDialog(
      cancelAfterNormalization,
      owner,
      { defaultPath: '/videos/show.mp4', filters: [] },
      'mp4',
      posix,
    )).resolves.toBeNull()
    expect(cancelAfterNormalization).toHaveBeenNthCalledWith(2, owner, expect.objectContaining({
      defaultPath: '/videos/unconfirmed.mp4',
    }))
  })
})
