import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const videoExport = require('../electron/video-export.cjs') as {
  buildFrameTimeline(project: unknown, durationMs?: number): { durationMs: number; times: number[] }
  frameStateAt(project: unknown, playbackMs: number): {
    showTitle: boolean
    instrumental: boolean
    lines: Array<{ text: string; progress: number }>
  }
  parseProjectForVideo(json: string): unknown
}

function videoProject() {
  return {
    title: 'Video Test',
    artist: 'Okay Singer',
    audioPath: '/music/test.mp3',
    durationMs: 5_000,
    offsetMs: 1_000,
    tracks: [
      {
        name: 'Lead',
        color: '#d7fa4a',
        muted: false,
        solo: false,
        lines: [
          {
            text: 'Hello world',
            startMs: 1_000,
            endMs: 3_000,
            words: [
              { text: 'Hello', startMs: 1_000, endMs: 2_000 },
              { text: 'world', startMs: 2_000, endMs: 3_000 },
            ],
          },
        ],
      },
    ],
  }
}

describe('karaoke video frame planning', () => {
  it('builds progressive word frames on the offset-adjusted playback clock', () => {
    const timeline = videoExport.buildFrameTimeline(videoProject(), 6_000)

    expect(timeline.durationMs).toBe(6_000)
    expect(timeline.times).toEqual(
      expect.arrayContaining([0, 500, 2_000, 2_250, 2_500, 2_750, 3_000, 4_000, 6_000]),
    )
  })

  it('renders title, active lyric progress, and instrumental states', () => {
    expect(videoExport.frameStateAt(videoProject(), 0).showTitle).toBe(true)

    const active = videoExport.frameStateAt(videoProject(), 2_500)
    expect(active.showTitle).toBe(false)
    expect(active.lines[0].text).toBe('Hello world')
    expect(active.lines[0].progress).toBeGreaterThan(0.2)
    expect(active.lines[0].progress).toBeLessThan(0.3)

    const finished = videoExport.frameStateAt(videoProject(), 4_500)
    expect(finished.instrumental).toBe(true)
    expect(finished.lines).toEqual([])
  })

  it('rejects malformed and unbounded project payloads', () => {
    expect(() => videoExport.parseProjectForVideo('{oops')).toThrow('project JSON is invalid')
    expect(() => videoExport.parseProjectForVideo(JSON.stringify({ tracks: [] }))).toThrow(
      'between 1 and 8 vocal tracks',
    )
  })
})
