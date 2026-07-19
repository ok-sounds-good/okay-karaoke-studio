import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOGICAL_STAGE_HEIGHT, LOGICAL_STAGE_WIDTH } from '../src/lib/video-style'
import {
  STAGE_LAYOUT,
  logicalStageLayoutAtWidth,
  logicalStagePx,
  lyricGapPx,
  previewStageLayoutVariables,
} from '../src/lib/stage-layout'
import { SYNC_AID_GEOMETRY, syncAidBrightness, syncAidPosition } from '../src/lib/sync-aid-geometry'

describe('shared stage geometry', () => {
  it('uses one deeply frozen 1920 by 1080 contract at every scale', () => {
    expect(STAGE_LAYOUT.stage).toEqual({
      widthPx: LOGICAL_STAGE_WIDTH,
      heightPx: LOGICAL_STAGE_HEIGHT,
    })
    expect(Object.isFrozen(STAGE_LAYOUT)).toBe(true)
    expect(Object.isFrozen(STAGE_LAYOUT.lyric.gapsPx)).toBe(true)
    expect(logicalStagePx(19.2)).toBe('1cqw')
    expect(lyricGapPx(0)).toBe(STAGE_LAYOUT.lyric.gapsPx[1])
    expect(lyricGapPx(99)).toBe(STAGE_LAYOUT.lyric.gapsPx[5])
    expect(lyricGapPx(Number.NaN)).toBe(STAGE_LAYOUT.lyric.gapsPx[1])
    expect(previewStageLayoutVariables(3)['--stage-lyric-gap']).toBe(
      logicalStagePx(STAGE_LAYOUT.lyric.gapsPx[3]),
    )
    expect(logicalStageLayoutAtWidth(3, 1280)).toMatchObject({
      stage: { widthPx: 1280, heightPx: 720 },
      scale: 2 / 3,
    })
    expect(() => logicalStagePx(Number.POSITIVE_INFINITY)).toThrow(/finite/u)
    expect(() => logicalStageLayoutAtWidth(2, 0)).toThrow(/positive and finite/u)
  })

  it('shares finite sync-aid positioning and reduced-motion brightness rules', () => {
    expect(Object.isFrozen(SYNC_AID_GEOMETRY)).toBe(true)
    expect(syncAidPosition(400)).toEqual({
      endLeftPx: 314,
      startLeftPx: -86,
      travelPx: 400,
    })
    expect(syncAidPosition(10)).toEqual({ endLeftPx: -76, startLeftPx: -204, travelPx: 128 })
    expect(() => syncAidPosition(Number.NaN)).toThrow(/finite/u)
    expect([-1, 0, 0.34, 0.67, 1, 2, Number.NaN].map(syncAidBrightness)).toEqual([
      0.35, 0.35, 0.65, 1, 1, 1, 0.35,
    ])
  })
})

describe('preview stage stylesheet', () => {
  it('preserves 16:9 under both panel axes and remains palette-driven', () => {
    const css = readFileSync('src/stage-rendering.css', 'utf8')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
    expect(css).toContain('.preview-panel')
    expect(css).toContain('container-type: size')
    expect(css).toContain('height: min(calc(100cqh - 62px), calc(56.25cqw - 9px))')
    expect(css).toContain('.karaoke-stage .karaoke-stage__grain')
    expect(css).toContain('.karaoke-stage .karaoke-stage__glow')
    expect(css).toContain('.karaoke-stage .stage-word.is-done')
    expect(css).toContain('.karaoke-stage .active-lines--duet .stage-line p')
    expect(css).toContain('-webkit-text-fill-color: transparent')
  })
})
