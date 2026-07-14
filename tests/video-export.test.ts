import { createRequire } from 'node:module'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import { cloneVocalStyle } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const videoExport = require('../electron/video-export.cjs') as {
  VIDEO_RESOLUTION_PRESETS: Record<string, { width: number; height: number }>
  buildFfmpegArguments(
    audioPath: string,
    outputPath: string,
    durationMs: number,
    settings?: { resolution?: string; fps?: number },
  ): string[]
  buildFrameTimeline(
    project: unknown,
    durationMs?: number,
    settings?: { resolution?: string; fps?: number },
  ): { durationMs: number; times: number[] }
  createVideoExportCommitState(): {
    readonly state: 'cancellable' | 'canceling' | 'promoting' | 'committed'
    tryBeginCancellation(): boolean
    beginPromotion(): boolean
    finishPromotion(): void
  }
  effectiveVideoDuration(project: unknown, durationMs?: number): number
  frameStateAt(project: unknown, playbackMs: number): {
    showTitle: boolean
    lines: Array<{
      color: string
      text: string
      words: Array<{ text: string; progress: number }>
    }>
  }
  normalizeVideoSettings(value?: unknown): {
    resolution: string
    width: number
    height: number
    fps: 30 | 60
  }
  parseProjectForVideo(json: string): unknown
  promoteVideoOutput(
    partialPath: string,
    outputPath: string,
    options?: {
      renameFile?: (partialPath: string, outputPath: string) => Promise<void>
      onPromotionStart?: () => boolean
      onPromotionComplete?: () => void
    },
  ): Promise<void>
  renderDocument(settings?: { resolution?: string; fps?: number }): string
}

function videoProject() {
  const vocalStyle = cloneVocalStyle()
  vocalStyle.sungColor = '#d7fa4a'
  return createProject({
    id: 'video-project',
    title: 'Video Test',
    artist: 'Okay Singer',
    audioPath: '/music/test.mp3',
    durationMs: 5_000,
    offsetMs: 1_000,
    lyricDisplay: { lineCount: 3, advanceMode: 'clear' },
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    tracks: [createVocalTrack({
      id: 'video-lead',
      name: 'Lead',
      vocalStyle,
      muted: false,
      solo: false,
      lines: [createLyricLine('Hello world', {
        id: 'video-line',
        startMs: 1_000,
        endMs: 3_000,
        words: [
          createLyricWord('Hello', {
            id: 'video-word-1', startMs: 1_000, endMs: 2_000,
          }),
          createLyricWord('world', {
            id: 'video-word-2', startMs: 2_000, endMs: 3_000,
          }),
        ],
      })],
    })],
  })
}

function timedVideoLine(text: string, startMs: number, endMs: number) {
  const key = `${text.toLowerCase().replaceAll(' ', '-')}-${startMs}`
  return createLyricLine(text, {
    id: `line-${key}`,
    startMs,
    endMs,
    words: [createLyricWord(text, { id: `word-${key}`, startMs, endMs })],
  })
}

function blankVideoLine() {
  return createLyricLine('', { id: 'line-separator', words: [] })
}

describe('karaoke video frame planning', () => {
  it('refuses cancellation once an existing destination enters atomic promotion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'okay-video-promotion-'))
    const partialPath = join(directory, 'song.partial.mp4')
    const outputPath = join(directory, 'song.mp4')
    const commitState = videoExport.createVideoExportCommitState()
    let releaseRename = () => {}
    let reportRenameStarted = () => {}
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve })
    const renameStarted = new Promise<void>((resolve) => { reportRenameStarted = resolve })

    await writeFile(partialPath, 'new complete video')
    await writeFile(outputPath, 'existing destination')

    const promotion = videoExport.promoteVideoOutput(partialPath, outputPath, {
      onPromotionStart: () => commitState.beginPromotion(),
      onPromotionComplete: () => commitState.finishPromotion(),
      renameFile: async (source, destination) => {
        reportRenameStarted()
        await renameGate
        await rename(source, destination)
      },
    })

    try {
      await renameStarted

      expect(commitState.state).toBe('promoting')
      expect(commitState.tryBeginCancellation()).toBe(false)
      expect(await readFile(outputPath, 'utf8')).toBe('existing destination')

      releaseRename()
      await promotion

      expect(commitState.state).toBe('committed')
      expect(await readFile(outputPath, 'utf8')).toBe('new complete video')
      await expect(readFile(partialPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      releaseRename()
      await promotion.catch(() => {})
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('keeps cancellation atomic before promotion begins', () => {
    const commitState = videoExport.createVideoExportCommitState()

    expect(commitState.tryBeginCancellation()).toBe(true)
    expect(commitState.state).toBe('canceling')
    expect(commitState.beginPromotion()).toBe(false)
  })

  it('maps every supported resolution exactly and accepts only 30 or 60 fps', () => {
    expect(videoExport.VIDEO_RESOLUTION_PRESETS).toEqual({
      '240p': { width: 426, height: 240 },
      '360p': { width: 640, height: 360 },
      '480p': { width: 854, height: 480 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '1440p': { width: 2560, height: 1440 },
      '2160p': { width: 3840, height: 2160 },
    })

    for (const [resolution, dimensions] of Object.entries(videoExport.VIDEO_RESOLUTION_PRESETS)) {
      for (const fps of [30, 60] as const) {
        expect(videoExport.normalizeVideoSettings({ resolution, fps })).toEqual({
          resolution,
          ...dimensions,
          fps,
        })
      }
    }
    expect(videoExport.normalizeVideoSettings()).toEqual({
      resolution: '720p',
      width: 1280,
      height: 720,
      fps: 30,
    })
    expect(() => videoExport.normalizeVideoSettings({ resolution: '4320p', fps: 30 })).toThrow()
    expect(() => videoExport.normalizeVideoSettings({ resolution: '__proto__', fps: 30 })).toThrow()
    expect(() => videoExport.normalizeVideoSettings({ resolution: '720p', fps: 24 })).toThrow()
  })

  it('builds frames at the selected output rate on the offset-adjusted playback clock', () => {
    const timeline30 = videoExport.buildFrameTimeline(videoProject(), 6_000, { fps: 30 })
    const timeline60 = videoExport.buildFrameTimeline(videoProject(), 6_000, { fps: 60 })

    expect(timeline30.durationMs).toBe(6_000)
    expect(timeline30.times).toHaveLength(180)
    expect(timeline30.times.every(
      (time, index) => time === Math.round(index * 1_000 / 30),
    )).toBe(true)
    expect(timeline60.durationMs).toBe(6_000)
    expect(timeline60.times).toHaveLength(360)
    expect(timeline60.times.every(
      (time, index) => time === Math.round(index * 1_000 / 60),
    )).toBe(true)
  })

  it('renders title and per-word progress aligned to word starts and ends', () => {
    expect(videoExport.frameStateAt(videoProject(), 0).showTitle).toBe(true)

    const firstStart = videoExport.frameStateAt(videoProject(), 2_000)
    expect(firstStart.showTitle).toBe(false)
    expect(firstStart.lines[0].text).toBe('Hello world')
    expect(firstStart.lines[0].words).toEqual([
      { text: 'Hello', progress: 0 },
      { text: 'world', progress: 0 },
    ])

    const firstMiddle = videoExport.frameStateAt(videoProject(), 2_500)
    expect(firstMiddle.lines[0].words[0].progress).toBeCloseTo(0.5)
    expect(firstMiddle.lines[0].words[1].progress).toBe(0)

    const secondStart = videoExport.frameStateAt(videoProject(), 3_000)
    expect(secondStart.lines[0].words).toEqual([
      { text: 'Hello', progress: 1 },
      { text: 'world', progress: 0 },
    ])

    const secondMiddle = videoExport.frameStateAt(videoProject(), 3_500)
    expect(secondMiddle.lines[0].words[0].progress).toBe(1)
    expect(secondMiddle.lines[0].words[1].progress).toBeCloseTo(0.5)

    const finished = videoExport.frameStateAt(videoProject(), 4_600)
    expect(finished.lines).toEqual([])
    expect(finished).not.toHaveProperty('instrumental')
    expect(finished).not.toHaveProperty('nextInMs')
  })

  it('renders clear-mode lyric groups without crossing blank separators', () => {
    const base = videoProject()
    const project = {
      ...base,
      offsetMs: 0,
      durationMs: 11_000,
      lyricDisplay: { lineCount: 5, advanceMode: 'clear' },
      tracks: [{
        ...base.tracks[0],
        lines: [
          timedVideoLine('A', 0, 1_000),
          timedVideoLine('B', 1_000, 2_000),
          timedVideoLine('C', 2_000, 3_000),
          blankVideoLine(),
          timedVideoLine('D', 5_000, 6_000),
          timedVideoLine('E', 6_000, 7_000),
          timedVideoLine('F', 7_000, 8_000),
          timedVideoLine('G', 8_000, 9_000),
          timedVideoLine('H', 9_000, 10_000),
        ],
      }],
    }

    expect(videoExport.frameStateAt(project, 0).lines.map((line) => line.text)).toEqual([
      'A',
      'B',
      'C',
    ])
    expect(videoExport.frameStateAt(project, 3_000).lines.map((line) => line.text)).toEqual([
      'D',
      'E',
      'F',
      'G',
      'H',
    ])
    expect(videoExport.frameStateAt(project, 10_000).lines).toEqual([])
    expect(videoExport.frameStateAt(project, 3_000)).not.toHaveProperty('nextLine')
  })

  it('pages in clear mode and advances one line in scroll mode', () => {
    const base = videoProject()
    const lines = [
      timedVideoLine('One', 0, 1_000),
      timedVideoLine('Two', 1_000, 2_000),
      timedVideoLine('Three', 2_000, 3_000),
      timedVideoLine('Four', 3_000, 4_000),
    ]
    const project = {
      ...base,
      offsetMs: 0,
      tracks: [{ ...base.tracks[0], lines }],
    }

    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
    }, 1_500).lines.map((line) => line.text)).toEqual(['One', 'Two'])
    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
    }, 2_000).lines.map((line) => line.text)).toEqual(['Three', 'Four'])
    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
    }, 1_000).lines.map((line) => line.text)).toEqual(['Two', 'Three', 'Four'])
    expect(videoExport.frameStateAt({
      ...project,
      lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
    }, 2_000).lines.map((line) => line.text)).toEqual(['Two', 'Three', 'Four'])
  })

  it('treats line count as a stage-wide limit while retaining both visible voices', () => {
    const base = videoProject()
    const lines = [
      timedVideoLine('Lead one', 0, 1_000),
      timedVideoLine('Lead two', 1_000, 2_000),
      timedVideoLine('Lead three', 2_000, 3_000),
    ]
    const project = {
      ...base,
      offsetMs: 0,
      lyricDisplay: { lineCount: 3, advanceMode: 'clear' },
      tracks: [
        { ...base.tracks[0], name: 'Lead', lines },
        {
          ...base.tracks[0],
          id: 'video-harmony',
          name: 'Harmony',
          vocalStyle: { ...base.tracks[0].vocalStyle, sungColor: '#58d6de' },
          lines: lines.map((line) => ({
            ...line,
            id: `harmony-${line.id}`,
            text: line.text.replace('Lead', 'Harmony'),
            words: line.words.map((word) => ({
              ...word,
              id: `harmony-${word.id}`,
              text: word.text.replace('Lead', 'Harmony'),
            })),
          })),
        },
      ],
    }

    const state = videoExport.frameStateAt(project, 0)
    expect(state.lines).toHaveLength(3)
    expect(new Set(state.lines.map((line) => line.text.split(' ')[0]))).toEqual(
      new Set(['Lead', 'Harmony']),
    )
  })

  it('rejects malformed and semantically invalid current projects', () => {
    expect(() => videoExport.parseProjectForVideo('{oops')).toThrow('Invalid project JSON')
    expect(videoExport.parseProjectForVideo(JSON.stringify({
      ...videoProject(),
      tracks: [],
    }))).toMatchObject({ tracks: [] })

    const invalidTiming = videoProject()
    invalidTiming.tracks[0].lines[0].words[0].startMs = -1
    expect(() => videoExport.parseProjectForVideo(JSON.stringify(invalidTiming))).toThrow(
      'cannot be negative',
    )

    const incompleteTiming = videoProject()
    incompleteTiming.tracks[0].lines[0].words[0].endMs = null as unknown as number
    expect(() => videoExport.parseProjectForVideo(JSON.stringify(incompleteTiming))).toThrow(
      'must have both a start and end time',
    )

    expect(() => videoExport.parseProjectForVideo(JSON.stringify({
      ...videoProject(),
      lyricDisplay: { lineCount: 6, advanceMode: 'clear' },
    }))).toThrow('line count must be an integer from 1 to 5')
  })

  it('renders neither track labels, mini upcoming lines, nor an instrumental fallback', () => {
    const document = videoExport.renderDocument()
    expect(document).not.toContain('state.nextLine')
    expect(document).not.toContain('Next ·')
    expect(document).not.toContain('line-label')
    expect(document).not.toContain('item.track')
    expect(document).not.toMatch(/instrumental/iu)
    const script = document.match(/<script>([\s\S]*)<\/script>/u)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Script(script)).not.toThrow()
  })

  it('uses the app palette for stage chrome while preserving authored word accents', () => {
    const document = videoExport.renderDocument()

    expect(document).toContain('#17111e')
    expect(document).toContain('#21172b')
    expect(document).toContain('#9b78cf')
    expect(document).toContain('#ff8a2b')
    expect(document).toContain('#f8f6fb')
    expect(document).not.toMatch(/#(?:080a0e|171e1b|0e1217|171119|d7fa4a)/iu)
    expect(document).not.toContain('rgba(215,250,74')
    expect(document).not.toContain('rgba(88,214,222')
    expect(document).toContain("lyric.style.setProperty('--accent',item.color)")
    expect(document).toContain('color:var(--accent)')

    const project = videoProject()
    project.tracks[0].vocalStyle.sungColor = '#A1b2C3'
    expect(videoExport.frameStateAt(project, 2_000).lines[0].color).toBe('#A1b2C3')
    project.tracks[0].vocalStyle.sungColor = null
    project.stageStyle.lyrics.sungColor = '#C3b2A1'
    expect(videoExport.frameStateAt(project, 2_000).lines[0].color).toBe('#C3b2A1')
  })

  it('uses only visible tracks when extending duration', () => {
    const project = videoProject()
    project.durationMs = null
    project.tracks.push(createVocalTrack({
      id: 'muted-guide',
      name: 'Muted guide',
      muted: true,
      solo: false,
      lines: [createLyricLine('Hidden', {
        id: 'muted-line',
        startMs: 20_000,
        endMs: 25_000,
        words: [createLyricWord('Hidden', {
          id: 'muted-word', startMs: 20_000, endMs: 25_000,
        })],
      })],
    }))

    expect(videoExport.effectiveVideoDuration(project, 1_000)).toBe(4_000)
  })

  it('leaves untimed words unfilled even when the containing line has timing', () => {
    const project = videoProject()
    project.offsetMs = 0
    project.durationMs = 23_000
    const untimedWords = [
      createLyricWord('Line', { id: 'untimed-line' }),
      createLyricWord('timed', { id: 'untimed-timed' }),
      createLyricWord('only', { id: 'untimed-only' }),
    ]
    project.tracks[0].lines = [
      createLyricLine('Line timed only', {
        id: 'untimed-line-one', startMs: 0, endMs: 2_000, words: untimedWords,
      }),
      createLyricLine('After the break', {
        id: 'untimed-line-two', startMs: 20_000, endMs: 22_000,
        words: untimedWords.map((word) => ({ ...word, id: `later-${word.id}` })),
      }),
    ]

    expect(videoExport.frameStateAt(project, 1_000).lines[0].words).toEqual([
      { text: 'Line', progress: 0 },
      { text: 'timed', progress: 0 },
      { text: 'only', progress: 0 },
    ])
  })

  it('streams JPEG frames at the selected output rate without a duplicate-frame filter', () => {
    const args = videoExport.buildFfmpegArguments(
      '/music/source.wav',
      '/exports/video.mp4',
      5_000,
      { resolution: '1440p', fps: 60 },
    )

    expect(args).toEqual(expect.arrayContaining([
      '-f', 'image2pipe',
      '-framerate', '60',
      '-vcodec', 'mjpeg',
      '-i', 'pipe:0',
      '-af', 'apad',
      '-t', '5.000',
    ]))
    expect(args.some((argument) => /(?:^|,)fps=/u.test(argument))).toBe(false)
    expect(args).not.toContain('concat')
    expect(args).not.toContain('-shortest')
    expect(args.at(-1)).toBe('/exports/video.mp4')
  })
})
