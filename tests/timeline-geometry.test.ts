import { describe, expect, it } from 'vitest'

import {
  buildTimelineTrackLayout,
  timelineWordIdsInRect,
} from '../src/components/timeline-geometry'
import { createLyricLine, createLyricWord, createVocalTrack } from '../src/lib/karaoke'

describe('Lyric Timing layout and selection geometry', () => {
  it('keeps long labels independent and separates overlapping lines and same-line blocks', () => {
    const firstLine = createLyricLine('Extraordinarily brief', {
      id: 'first-line',
      startMs: 1_000,
      endMs: 1_100,
      words: [
        createLyricWord('Extraordinarily', {
          id: 'long-label',
          startMs: 1_000,
          endMs: 1_050,
        }),
        createLyricWord('brief', {
          id: 'overlapping-block',
          startMs: 1_020,
          endMs: 1_100,
        }),
      ],
    })
    const overlappingLine = createLyricLine('Second line', {
      id: 'second-line',
      startMs: 1_025,
      endMs: 1_400,
      words: [
        createLyricWord('Second', {
          id: 'second-line-word',
          startMs: 1_025,
          endMs: 1_400,
        }),
      ],
    })
    const track = createVocalTrack({ id: 'lead', lines: [firstLine, overlappingLine] })
    const layout = buildTimelineTrackLayout(track, 0, 100)
    const firstLayout = layout.lines.find((line) => line.line.id === 'first-line')!
    const secondLayout = layout.lines.find((line) => line.line.id === 'second-line')!
    const longLabel = firstLayout.words.find((word) => word.word.id === 'long-label')!
    const overlappingBlock = firstLayout.words.find((word) => word.word.id === 'overlapping-block')!

    expect(longLabel.width).toBe(5)
    expect(longLabel.labelWidth).toBeGreaterThan(longLabel.width)
    expect(longLabel.top).not.toBe(overlappingBlock.top)
    expect(firstLayout.lane).not.toBe(secondLayout.lane)
    expect(firstLayout.top).not.toBe(secondLayout.top)
  })

  it('keeps edge-touching timing blocks on one baseline and separates only genuine overlap', () => {
    const line = createLyricLine('One Two Three Four', {
      id: 'baseline-line',
      startMs: 13_953,
      endMs: 14_929,
      words: [
        createLyricWord('One', { id: 'edge-first', startMs: 13_953, endMs: 14_271 }),
        createLyricWord('Two', { id: 'edge-second', startMs: 14_271, endMs: 14_554 }),
        createLyricWord('Three', { id: 'edge-third', startMs: 14_554, endMs: 14_829 }),
        createLyricWord('Four', { id: 'true-overlap', startMs: 14_800, endMs: 14_929 }),
      ],
    })
    const layout = buildTimelineTrackLayout(createVocalTrack({ id: 'lead', lines: [line] }), 0, 72)
    const words = Object.fromEntries(layout.lines[0].words.map((word) => [word.word.id, word]))

    expect(words['edge-first'].top).toBe(words['edge-second'].top)
    expect(words['edge-second'].top).toBe(words['edge-third'].top)
    expect(words['true-overlap'].top).not.toBe(words['edge-third'].top)
  })

  it('returns only active-layout timing blocks intersected by a marquee rectangle', () => {
    const line = createLyricLine('First Second', {
      id: 'selection-line',
      startMs: 1_000,
      endMs: 3_500,
      words: [
        createLyricWord('First', { id: 'first', startMs: 1_000, endMs: 1_500 }),
        createLyricWord('Second', { id: 'second', startMs: 3_000, endMs: 3_500 }),
      ],
    })
    const layout = buildTimelineTrackLayout(
      createVocalTrack({ id: 'active-track', lines: [line] }),
      0,
      100,
    )
    const first = layout.lines[0].words[0]

    expect(
      timelineWordIdsInRect(layout, {
        left: first.left + 8,
        top: first.top + 8,
        right: first.left + 2,
        bottom: first.top + 2,
      }),
    ).toEqual(new Set(['first']))
  })
})
