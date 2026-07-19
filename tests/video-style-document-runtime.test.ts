// @vitest-environment happy-dom

import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cloneStageStyle,
  deterministicFontFamily,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
} from '../src/lib/video-style'
import { STAGE_LAYOUT } from '../src/lib/stage-layout'
import { SYNC_AID_GEOMETRY } from '../src/lib/sync-aid-geometry'

const require = createRequire(import.meta.url)
const documentApi = require('../electron/video-style-document.cjs') as {
  FRAME_MARKER_BITS: number
  assetInvocation(runtime: object): string
  frameInvocation(state: object, sequence: number): string
  renderDocument(options: object): string
}
const { installKaraokeRuntime } = require('../electron/video-style-render-runtime.cjs') as {
  installKaraokeRuntime(): void
}

function decodedInvocationValue(invocation: string): unknown {
  const payload = invocation.match(/atob\("([^"]+)"\)/u)?.[1]
  if (!payload) throw new Error('Invocation payload was not found.')
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
}

function stageDom(): void {
  document.body.innerHTML = `
    <div id="scene"><div id="frame"></div><div id="brand"></div><div id="clock"></div>
      <main id="content"></main><div id="syncs"></div><footer id="footer"></footer></div>`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('isolated video-style document boundary', () => {
  it('renders only safe positive dimensions and one escaped runtime script', () => {
    const html = documentApi.renderDocument({ width: 1280, height: 720 })
    expect(html).toContain('transform: scale(0.6666666666666666, 0.6666666666666666)')
    expect(html.match(/<\/script/giu)).toHaveLength(1)
    expect(html).toContain('window.prepareKaraokeAssets')
    expect(documentApi.FRAME_MARKER_BITS).toBe(18)
    expect(html).toContain('id="frame-marker" class="frame-marker" style="left: 1280px"')
    expect(html.match(/<i><\/i>/gu)).toHaveLength(18)
    expect(html).toContain('const encodedSequence = sequence + 1')
    for (const options of [null, [], {}, { width: 0, height: 720 }, { width: 1.5, height: 1 }]) {
      expect(() => documentApi.renderDocument(options as object)).toThrow()
    }
  })

  it('round-trips Unicode and markup as inert base64 data', () => {
    const state = { lyric: '</script><img src=x onerror=alert(1)> Å♫' }
    const runtime = { backgroundDataUrl: 'data:image/png;base64,Å♫' }
    const frame = documentApi.frameInvocation(state, 7)
    const assets = documentApi.assetInvocation(runtime)
    expect(frame).not.toContain(state.lyric)
    expect(frame).toContain('requestAnimationFrame')
    expect(assets).not.toContain(runtime.backgroundDataUrl)
    expect(decodedInvocationValue(frame)).toEqual(state)
    expect(decodedInvocationValue(assets)).toEqual(runtime)
    expect(() => documentApi.frameInvocation(state, -1)).toThrow(/nonnegative/u)
    expect(() => documentApi.frameInvocation(state, Number.MAX_SAFE_INTEGER + 1)).toThrow()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => documentApi.assetInvocation(cyclic)).toThrow(/JSON-serializable/u)
  })
})

describe('browser render runtime', () => {
  it('matches fonts, text safety, tuple line identities, progress, and asset reloads', async () => {
    stageDom()
    const loadedFaces: Array<{ family: string; source: string }> = []
    const rejectedSources = new Set<string>()
    const deferredSources = new Map<string, Promise<void>>()
    class TestFontFace {
      constructor(
        public family: string,
        public source: string,
      ) {
        loadedFaces.push({ family, source })
      }
      async load() {
        const deferred = deferredSources.get(this.source)
        if (deferred) await deferred
        if (rejectedSources.has(this.source)) throw new Error('private font loader detail')
        return this
      }
    }
    vi.stubGlobal('FontFace', TestFontFace)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const x = this.id === 'scene' ? 0 : this.textContent?.includes('First') ? 100 : 300
      const width = this.id === 'scene' ? 960 : 100
      return DOMRect.fromRect({ x, width, height: 40 })
    })

    const typeface: FontTypefaceDescriptor = {
      kind: 'local',
      family: 'Tie Sans',
      faces: [
        {
          fullName: 'Tie Zulu',
          style: 'Zulu',
          postscriptName: 'Tie"Zulu',
          weight: 300,
          slant: 'normal',
        },
        {
          fullName: 'Tie Angstrom',
          style: 'Ångstrom',
          postscriptName: 'Tie-Angstrom',
          weight: 500,
          slant: 'normal',
        },
      ],
    }
    const requested: FontFaceDescriptor = {
      fullName: 'Missing',
      style: 'Missing',
      postscriptName: null,
      weight: 400,
      slant: 'normal',
    }
    const style = {
      typeface,
      fontStyle: requested,
      sizePx: 82,
      unsungColor: '#72687D',
      sungColor: '#FF8A2B',
      alignment: 'left',
    }
    const equivalentFaces: FontFaceDescriptor[] = [
      {
        fullName: 'Exact Zulu',
        style: 'Regular',
        postscriptName: 'Tie\\Zulu',
        weight: 400,
        slant: 'normal',
      },
      {
        fullName: 'Exact Alpha',
        style: 'Regular',
        postscriptName: 'Tie\\Alpha',
        weight: 400,
        slant: 'normal',
      },
    ]
    const equivalentRequest = { ...requested, style: 'Regular', weight: 400 }
    const exactStyle = {
      ...style,
      typeface: { kind: 'local', family: 'Exact Sans', faces: equivalentFaces } as const,
      fontStyle: equivalentRequest,
    }
    const reversedExactStyle = {
      ...exactStyle,
      typeface: { ...exactStyle.typeface, faces: [...equivalentFaces].reverse() },
    }
    window.eval(`(${installKaraokeRuntime.toString()})()`)
    const runtime = window as unknown as {
      prepareKaraokeAssets(value: object): Promise<{ fontFallbacks: unknown[] }>
      renderKaraokeFrame(state: object, sequence: number): boolean
      backgroundDataUrl: string
      stageLayout: typeof STAGE_LAYOUT
    }
    const assets = (fonts: object[]) => ({
      backgroundDataUrl: '',
      fonts,
      stageLayout: structuredClone(STAGE_LAYOUT),
      syncAidGeometry: structuredClone(SYNC_AID_GEOMETRY),
    })
    await runtime.prepareKaraokeAssets(assets([style, style, exactStyle, reversedExactStyle]))
    expect(Object.isFrozen(runtime.stageLayout.lyric.gapsPx)).toBe(true)
    expect(loadedFaces.map((face) => face.source)).toEqual([
      String.raw`local("Tie\"Zulu")`,
      String.raw`local("Tie\\Alpha")`,
    ])
    expect(loadedFaces[0].family).not.toBe(loadedFaces[1].family)
    expect(loadedFaces.map((face) => face.family)).toEqual(['OKSLocalFont0', 'OKSLocalFont1'])

    const stageStyle = cloneStageStyle()
    stageStyle.lyrics = style
    const lines = [
      { id: 'c', trackId: 'a:b', text: 'First', style, words: [{ text: '<First>', progress: 2 }] },
      {
        id: 'b:c',
        trackId: 'a',
        text: 'Second',
        style,
        words: [{ text: 'Second', progress: NaN }],
      },
    ]
    const syncAids = lines.map((line, index) => ({
      lineId: line.id,
      trackId: line.trackId,
      style,
      progress: index ? Number.NaN : 0.5,
    }))
    const frameState = {
      artist: 'Artist',
      title: 'Title',
      playbackMs: 1234,
      showTitle: false,
      stageStyle,
      lines,
      syncAids,
    }
    expect(runtime.renderKaraokeFrame(frameState, 9)).toBe(true)
    const sceneRect = vi.fn(() => DOMRect.fromRect({ x: 0, width: 960, height: 540 }))
    Object.defineProperty(document.querySelector('#scene'), 'getBoundingClientRect', {
      value: sceneRect,
    })
    const lyricRects: ReturnType<typeof vi.fn>[] = []
    document.querySelectorAll('.lyric-text').forEach((element, index) => {
      const lyricRect = vi.fn(() =>
        DOMRect.fromRect({ x: index ? 300 : 100, width: 100, height: 40 }),
      )
      lyricRects.push(lyricRect)
      Object.defineProperty(element, 'getBoundingClientRect', { value: lyricRect })
    })
    expect(runtime.renderKaraokeFrame(frameState, 10)).toBe(true)
    expect(sceneRect).toHaveBeenCalledTimes(2)
    expect(lyricRects.map((rect) => rect.mock.calls.length)).toEqual([1, 1])

    const lyrics = [...document.querySelectorAll<HTMLElement>('.lyric')]
    const expectedFamily = deterministicFontFamily(typeface, loadedFaces[0].family).replace(
      `"${loadedFaces[0].family}"`,
      loadedFaces[0].family,
    )
    expect(lyrics[0].style.fontFamily).toBe(expectedFamily)
    expect(lyrics[0].style.fontWeight).toBe('300')
    expect(lyrics[0].style.fontSynthesis).toBe('none')
    expect(document.querySelector('.word-base')?.textContent).toBe('<First>')
    expect(document.querySelector('img')).toBeNull()
    expect(
      [...document.querySelectorAll<HTMLElement>('.word-fill')].map((node) => node.style.width),
    ).toEqual(['100.000%', '0.000%'])
    expect(
      [...document.querySelectorAll<HTMLElement>('.sync i')].map((node) => node.style.left),
    ).toEqual(['-86px', '-86px'])
    expect(
      [...document.querySelectorAll<HTMLElement>('.sync i')].map((node) => node.style.transform),
    ).toEqual(['translateX(100px)', 'translateX(0px)'])
    expect(document.body.dataset.frame).toBe('10')

    rejectedSources.add(loadedFaces[0].source)
    rejectedSources.add(loadedFaces[1].source)
    const cached = await runtime.prepareKaraokeAssets(assets([style, reversedExactStyle]))
    expect(cached.fontFallbacks).toEqual([])
    expect(loadedFaces).toHaveLength(2)
    expect(runtime.renderKaraokeFrame(frameState, 11)).toBe(true)
    expect(document.querySelector<HTMLElement>('.lyric')?.style.fontFamily).toBe(expectedFamily)
    expect(document.body.dataset.frame).toBe('11')

    const retryFace: FontFaceDescriptor = {
      fullName: 'Retry Face',
      style: 'Regular',
      postscriptName: 'Retry-Face',
      weight: 400,
      slant: 'normal',
    }
    const retryTypeface: FontTypefaceDescriptor = {
      kind: 'local',
      family: 'Retry Sans',
      faces: [retryFace],
    }
    const retryStyle = {
      ...style,
      typeface: retryTypeface,
      fontStyle: retryFace,
    }
    rejectedSources.add('local("Retry-Face")')
    const failed = await runtime.prepareKaraokeAssets(assets([retryStyle, retryStyle]))
    expect(failed.fontFallbacks).toEqual([{ requested: 'Retry Face', effective: 'System UI' }])
    expect(JSON.stringify(failed)).not.toContain('private font loader detail')
    expect(loadedFaces).toHaveLength(3)

    rejectedSources.delete('local("Retry-Face")')
    const retried = await runtime.prepareKaraokeAssets(assets([retryStyle]))
    expect(retried.fontFallbacks).toEqual([])
    expect(loadedFaces).toHaveLength(4)

    const makeLocalStyle = (postscriptName: string) => {
      const face: FontFaceDescriptor = {
        fullName: postscriptName,
        style: 'Regular',
        postscriptName,
        weight: 400,
        slant: 'normal',
      }
      const localTypeface: FontTypefaceDescriptor = {
        kind: 'local',
        family: postscriptName,
        faces: [face],
      }
      return { ...style, typeface: localTypeface, fontStyle: face }
    }
    const frameForStyle = (activeStyle: ReturnType<typeof makeLocalStyle>) => {
      const activeStage = cloneStageStyle()
      activeStage.lyrics = activeStyle
      return {
        ...frameState,
        stageStyle: activeStage,
        syncAids: [],
        lines: [{ ...lines[0], id: 'active', trackId: 'active', style: activeStyle }],
      }
    }
    const expectedStyleFamily = (
      activeStyle: ReturnType<typeof makeLocalStyle>,
      loaded: { family: string },
    ) =>
      deterministicFontFamily(activeStyle.typeface, loaded.family).replace(
        `"${loaded.family}"`,
        loaded.family,
      )

    let releaseDeferred!: () => void
    deferredSources.set(
      'local("Deferred-A")',
      new Promise((resolve) => {
        releaseDeferred = resolve
      }),
    )
    const deferredStyle = makeLocalStyle('Deferred-A')
    const freshStyle = makeLocalStyle('Fresh-B')
    const pendingA = runtime.prepareKaraokeAssets(assets([deferredStyle]))
    expect(runtime.renderKaraokeFrame(frameForStyle(retryStyle), 12)).toBe(true)
    expect(document.querySelector<HTMLElement>('.lyric')?.style.fontFamily).toBe(
      expectedStyleFamily(retryStyle, loadedFaces[3]),
    )

    await runtime.prepareKaraokeAssets(assets([freshStyle]))
    const freshLoaded = loadedFaces.find((face) => face.source === 'local("Fresh-B")')!
    const freshFamily = expectedStyleFamily(freshStyle, freshLoaded)
    const freshFrame = frameForStyle(freshStyle)
    expect(runtime.renderKaraokeFrame(freshFrame, 13)).toBe(true)
    expect(document.querySelector<HTMLElement>('.lyric')?.style.fontFamily).toBe(freshFamily)
    releaseDeferred()
    await pendingA
    expect(runtime.renderKaraokeFrame(freshFrame, 14)).toBe(true)
    expect(document.querySelector<HTMLElement>('.lyric')?.style.fontFamily).toBe(freshFamily)
    expect(runtime.renderKaraokeFrame(frameForStyle(deferredStyle), 15)).toBe(true)
    expect(document.querySelector<HTMLElement>('.lyric')?.style.fontFamily).toBe(
      deterministicFontFamily(deferredStyle.typeface),
    )

    class RejectingImage {
      onerror: ((event: Event) => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.(new Event('error')))
      }
    }
    vi.stubGlobal('Image', RejectingImage)
    const failedBackground = {
      ...assets([deferredStyle]),
      backgroundDataUrl: 'data:image/png;base64,invalid',
    }
    await expect(runtime.prepareKaraokeAssets(failedBackground)).rejects.toBeTruthy()
    expect(runtime.backgroundDataUrl).toBe('')
    expect(runtime.renderKaraokeFrame(freshFrame, 16)).toBe(true)
    expect(document.querySelector<HTMLElement>('.lyric')?.style.fontFamily).toBe(freshFamily)

    const invalidFace = { ...retryFace, fullName: 'Invalid Face', postscriptName: 'bad name' }
    const invalidStyle = {
      ...retryStyle,
      typeface: { kind: 'local', family: 'Invalid Sans', faces: [invalidFace] } as const,
      fontStyle: invalidFace,
    }
    const invalid = await runtime.prepareKaraokeAssets(assets([invalidStyle]))
    expect(invalid.fontFallbacks).toEqual([{ requested: 'Invalid Face', effective: 'System UI' }])
    expect(loadedFaces).toHaveLength(6)
  })
})
