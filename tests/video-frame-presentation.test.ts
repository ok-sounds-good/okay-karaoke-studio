import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

type VideoSettings = {
  resolution: string
  width: number
  height: number
  fps: 30 | 60
}

type FakeWebContents = EventEmitter & {
  capturePage?: () => never
  executeJavaScript(source: string): Promise<unknown>
  invalidate?: () => never
  setFrameRate(fps: number): void
  startPainting(): void
  stopPainting(): void
}

type BrowserWindowOptions = {
  show: boolean
  webPreferences: { offscreen: boolean }
}

type FakeWindow = {
  webContents: FakeWebContents
  loadURL(url: string): Promise<void>
  isDestroyed(): boolean
  destroy(): void
}

type VideoExportModule = {
  normalizeVideoSettings(value?: unknown): VideoSettings
  renderVideoFrames(
    BrowserWindow: new (options: BrowserWindowOptions) => FakeWindow,
    project: unknown,
    timeline: { times: number[] },
    stream: { destroyed: boolean; write(frame: Buffer): boolean },
    settings: VideoSettings,
    runtime: Record<string, unknown>,
    onProgress?: (progress: unknown) => void,
    signal?: AbortSignal,
  ): Promise<void>
}

const require = createRequire(import.meta.url)
const videoExport = require('../electron/video-export.cjs') as VideoExportModule
const project = JSON.parse(
  readFileSync(new URL('./fixtures/current-project-v0.json', import.meta.url), 'utf8'),
) as unknown
const runtime = {}

function isAssetInvocation(source: string) {
  return source.includes('prepareKaraokeAssets')
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

describe('offscreen video frame presentation', () => {
  it('encodes only the committed paint while stopped between frames', async () => {
    const order: string[] = []
    const frames: Buffer[] = []
    let currentFrame = -1
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.capturePage = vi.fn(() => {
      throw new Error('capturePage returned stale data')
    })
    contents.invalidate = vi.fn(() => {
      throw new Error('invalidate requested stale data')
    })
    contents.executeJavaScript = vi.fn(async (source: string) => {
      if (isAssetInvocation(source)) {
        order.push('assets')
        return { fontFallbacks: [] }
      }
      expect(contents.listenerCount('paint')).toBe(0)
      expect(source).toContain('requestAnimationFrame(()=>requestAnimationFrame(resolve))')
      currentFrame = Number(source.match(/,(\d+)\);await/u)?.[1])
      order.push(`update:${currentFrame}`)
      await Promise.resolve()
      order.push(`commit:${currentFrame}`)
      return true
    })
    contents.setFrameRate = vi.fn((fps: number) => order.push(`capture-rate:${fps}`))
    contents.startPainting = vi.fn(() => {
      expect(contents.listenerCount('paint')).toBe(1)
      order.push(`listen/start:${currentFrame}`)
      const resized = {
        toJPEG: () => {
          order.push(`encode:${currentFrame}`)
          return Buffer.from(`current-${currentFrame}`)
        },
      }
      contents.emit(
        'paint',
        {},
        {},
        {
          getSize: () => ({ width: 852, height: 480 }),
          isEmpty: () => false,
          resize: (size: unknown) => {
            expect(size).toEqual({ width: 426, height: 240, quality: 'best' })
            order.push(`resize:${currentFrame}`)
            return resized
          },
          toJPEG: () => {
            throw new Error('unresized paint encoded')
          },
        },
      )
    })
    contents.stopPainting = vi.fn(() => order.push(`stop:${currentFrame}`))

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      constructor(options: BrowserWindowOptions) {
        order.push('construct')
        expect(options).toMatchObject({ show: false, webPreferences: { offscreen: true } })
      }
      loadURL = async () => {
        order.push('load')
      }
      isDestroyed = () => destroyed
      destroy = vi.fn(() => {
        destroyed = true
        order.push('destroy')
      })
    }

    await videoExport.renderVideoFrames(
      FakeBrowserWindow,
      project,
      { times: [0, 17] },
      {
        destroyed: false,
        write: (frame) => {
          frames.push(frame)
          order.push(`write:${frames.length - 1}`)
          return true
        },
      },
      videoExport.normalizeVideoSettings({ resolution: '240p', fps: 60 }),
      runtime,
    )

    expect(contents.capturePage).not.toHaveBeenCalled()
    expect(contents.invalidate).not.toHaveBeenCalled()
    expect(frames.map((frame) => frame.toString())).toEqual(['current-0', 'current-1'])
    expect(order).toEqual([
      'construct',
      'capture-rate:240',
      'load',
      'stop:-1',
      'assets',
      'update:0',
      'commit:0',
      'listen/start:0',
      'resize:0',
      'encode:0',
      'stop:0',
      'write:0',
      'update:1',
      'commit:1',
      'listen/start:1',
      'resize:1',
      'encode:1',
      'stop:1',
      'write:1',
      'destroy',
    ])
    expect(contents.listenerCount('paint')).toBe(0)
  })

  it('stops painting and destroys the export window when encoding fails', async () => {
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.executeJavaScript = vi.fn(async () => true)
    contents.setFrameRate = vi.fn()
    contents.startPainting = vi.fn(() => {
      contents.emit(
        'paint',
        {},
        {},
        {
          getSize: () => ({ width: 426, height: 240 }),
          isEmpty: () => false,
          toJPEG: () => {
            throw new Error('JPEG encoding failed')
          },
        },
      )
    })
    contents.stopPainting = vi.fn()

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      loadURL = async () => {}
      isDestroyed = () => destroyed
      destroy = vi.fn(() => {
        destroyed = true
      })
    }

    await expect(
      videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write: vi.fn(() => true) },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
      ),
    ).rejects.toThrow('JPEG encoding failed')

    expect(contents.stopPainting).toHaveBeenCalledTimes(2)
    expect(contents.listenerCount('paint')).toBe(0)
    expect(destroyed).toBe(true)
  })

  it('aborts a pending renderer update and ignores its late completion', async () => {
    const update = deferred<unknown>()
    const updateStarted = deferred<void>()
    const controller = new AbortController()
    let destroyed = false
    const contents = new EventEmitter() as FakeWebContents
    contents.executeJavaScript = vi.fn((source: string) => {
      if (isAssetInvocation(source)) return Promise.resolve({ fontFallbacks: [] })
      updateStarted.resolve()
      return update.promise
    })
    contents.setFrameRate = vi.fn()
    contents.startPainting = vi.fn()
    contents.stopPainting = vi.fn()
    const destroyWindow = vi.fn(() => {
      destroyed = true
    })

    class FakeBrowserWindow implements FakeWindow {
      webContents = contents
      loadURL = async () => {}
      isDestroyed = () => destroyed
      destroy = destroyWindow
    }

    const rendering = videoExport.renderVideoFrames(
      FakeBrowserWindow,
      project,
      { times: [0] },
      { destroyed: false, write: vi.fn(() => true) },
      videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
      runtime,
      undefined,
      controller.signal,
    )
    await updateStarted.promise
    controller.abort()

    await expect(rendering).rejects.toMatchObject({ name: 'AbortError' })
    expect(contents.startPainting).not.toHaveBeenCalled()
    expect(contents.stopPainting).toHaveBeenCalledTimes(1)
    expect(contents.listenerCount('paint')).toBe(0)
    expect(destroyWindow).toHaveBeenCalledTimes(1)

    update.resolve(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(contents.startPainting).not.toHaveBeenCalled()
  }, 500)

  it('times out a pending renderer update and cleans up before late completion', async () => {
    vi.useFakeTimers()
    try {
      const update = deferred<unknown>()
      const updateStarted = deferred<void>()
      const controller = new AbortController()
      let destroyed = false
      const contents = new EventEmitter() as FakeWebContents
      contents.executeJavaScript = vi.fn((source: string) => {
        if (isAssetInvocation(source)) return Promise.resolve({ fontFallbacks: [] })
        updateStarted.resolve()
        return update.promise
      })
      contents.setFrameRate = vi.fn()
      contents.startPainting = vi.fn()
      contents.stopPainting = vi.fn()
      const destroyWindow = vi.fn(() => {
        destroyed = true
      })

      class FakeBrowserWindow implements FakeWindow {
        webContents = contents
        loadURL = async () => {}
        isDestroyed = () => destroyed
        destroy = destroyWindow
      }

      const rendering = videoExport.renderVideoFrames(
        FakeBrowserWindow,
        project,
        { times: [0] },
        { destroyed: false, write: vi.fn(() => true) },
        videoExport.normalizeVideoSettings({ resolution: '240p', fps: 30 }),
        runtime,
        undefined,
        controller.signal,
      )
      await updateStarted.promise
      const rejection = expect(rendering).rejects.toThrow('Timed out while rendering a video frame')
      await vi.advanceTimersByTimeAsync(10_000)
      await rejection

      expect(contents.startPainting).not.toHaveBeenCalled()
      expect(contents.stopPainting).toHaveBeenCalledTimes(1)
      expect(contents.listenerCount('paint')).toBe(0)
      expect(destroyWindow).toHaveBeenCalledTimes(1)

      update.resolve(true)
      await Promise.resolve()
      await Promise.resolve()
      controller.abort()
      expect(contents.startPainting).not.toHaveBeenCalled()
      expect(destroyWindow).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
