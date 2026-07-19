import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import { cloneVocalStyle } from '../src/lib/video-style'
import { previewFrameStateAt } from '../src/lib/stage-frame-state'

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
  frameStateAt(
    project: unknown,
    playbackMs: number,
  ): {
    showTitle: boolean
    lines: Array<{
      style: { sungColor: string }
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
  prepareStyleRuntime(
    project: unknown,
    backgroundImage?: { bytes: Buffer; mime: 'image/png' | 'image/jpeg' },
  ): Promise<any>
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
    tracks: [
      createVocalTrack({
        id: 'video-lead',
        name: 'Lead',
        vocalStyle,
        muted: false,
        solo: false,
        lines: [
          createLyricLine('Hello world', {
            id: 'video-line',
            startMs: 1_000,
            endMs: 3_000,
            words: [
              createLyricWord('Hello', {
                id: 'video-word-1',
                startMs: 1_000,
                endMs: 2_000,
              }),
              createLyricWord('world', {
                id: 'video-word-2',
                startMs: 2_000,
                endMs: 3_000,
              }),
            ],
          }),
        ],
      }),
    ],
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
  it('keeps the 50 ms synchronization clock path unchanged', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('refreshIntervalMs: syncMode ? 50 : 16')
  })

  it('uses visible lead, configured caps, and the exact minimum threshold for section cues', () => {
    const project = videoProject()
    const track = project.tracks[0]!
    project.offsetMs = 0
    project.durationMs = 15_000
    project.lyricDisplay = { lineCount: 1, advanceMode: 'clear' }
    track.vocalStyle.previewMs = 6_000
    track.vocalStyle.syncAid = { enabled: true, minLeadMs: 2_000, maxLeadMs: 4_000 }
    track.lines = [
      timedVideoLine('Prior', 7_000, 8_000),
      blankVideoLine(),
      timedVideoLine('Section start', 10_000, 11_000),
    ]

    expect(previewFrameStateAt(project, 7_999).syncAids).toHaveLength(0)
    expect(previewFrameStateAt(project, 8_000).syncAids[0]).toMatchObject({
      lineId: track.lines[2]!.id,
      startMs: 8_000,
      endMs: 10_000,
      durationMs: 2_000,
      progress: 0,
    })
    expect(previewFrameStateAt(project, 9_000).syncAids[0]?.progress).toBe(0.5)
    expect(previewFrameStateAt(project, 10_000).syncAids).toHaveLength(0)

    track.lines[0] = timedVideoLine('Prior', 7_500, 8_001)
    expect(previewFrameStateAt(project, 8_001).syncAids).toHaveLength(0)
    for (const time of [8_000, 8_001, 9_000, 10_000]) {
      expect(previewFrameStateAt(project, time)).toEqual(videoExport.frameStateAt(project, time))
    }
  })

  it('never transfers a section cue beyond the literal first line or its literal first word', () => {
    const project = videoProject()
    const track = project.tracks[0]!
    project.offsetMs = 0
    project.durationMs = 15_000
    project.lyricDisplay = { lineCount: 2, advanceMode: 'clear' }
    track.vocalStyle.previewMs = 4_000
    track.vocalStyle.syncAid = { enabled: true, minLeadMs: 2_000, maxLeadMs: 4_000 }
    track.lines = [
      createLyricLine('Untimed first word timed second', {
        id: 'literal-first-word-line',
        startMs: 10_000,
        endMs: 12_000,
        words: [
          createLyricWord('Untimed', { id: 'literal-untimed-word' }),
          createLyricWord('timed', {
            id: 'later-timed-word',
            startMs: 10_000,
            endMs: 11_000,
          }),
        ],
      }),
      timedVideoLine('Later line', 12_000, 13_000),
    ]
    expect(previewFrameStateAt(project, 8_000).lines).toHaveLength(2)
    expect(previewFrameStateAt(project, 8_000).syncAids).toHaveLength(0)

    track.lines = [
      createLyricLine('Literal untimed line', { id: 'literal-untimed-line' }),
      timedVideoLine('Later timed line', 10_000, 11_000),
    ]
    expect(previewFrameStateAt(project, 8_000).lines.map(({ text }) => text)).toEqual([
      'Later timed line',
    ])
    expect(previewFrameStateAt(project, 8_000).syncAids).toHaveLength(0)
    expect(previewFrameStateAt(project, 8_000)).toEqual(videoExport.frameStateAt(project, 8_000))
  })

  it('refuses cancellation once an existing destination enters atomic promotion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'okay-video-promotion-'))
    const partialPath = join(directory, 'song.partial.mp4')
    const outputPath = join(directory, 'song.mp4')
    const commitState = videoExport.createVideoExportCommitState()
    let releaseRename = () => {}
    let reportRenameStarted = () => {}
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve
    })
    const renameStarted = new Promise<void>((resolve) => {
      reportRenameStarted = resolve
    })

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
    expect(timeline30.times.every((time, index) => time === Math.round((index * 1_000) / 30))).toBe(
      true,
    )
    expect(timeline60.durationMs).toBe(6_000)
    expect(timeline60.times).toHaveLength(360)
    expect(timeline60.times.every((time, index) => time === Math.round((index * 1_000) / 60))).toBe(
      true,
    )
  })

  it('renders title and per-word progress aligned to word starts and ends', () => {
    expect(videoExport.frameStateAt(videoProject(), 0).showTitle).toBe(false)

    const firstStart = videoExport.frameStateAt(videoProject(), 2_000)
    expect(firstStart.showTitle).toBe(false)
    expect(firstStart.lines[0].text).toBe('Hello world')
    expect(firstStart.lines[0].words.map(({ text, progress }) => ({ text, progress }))).toEqual([
      { text: 'Hello', progress: 0 },
      { text: 'world', progress: 0 },
    ])

    const firstMiddle = videoExport.frameStateAt(videoProject(), 2_500)
    expect(firstMiddle.lines[0].words[0].progress).toBeCloseTo(0.5)
    expect(firstMiddle.lines[0].words[1].progress).toBe(0)

    const secondStart = videoExport.frameStateAt(videoProject(), 3_000)
    expect(secondStart.lines[0].words.map(({ text, progress }) => ({ text, progress }))).toEqual([
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
      tracks: [
        {
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
        },
      ],
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

    expect(
      videoExport
        .frameStateAt(
          {
            ...project,
            lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
          },
          1_500,
        )
        .lines.map((line) => line.text),
    ).toEqual(['One', 'Two'])
    expect(
      videoExport
        .frameStateAt(
          {
            ...project,
            lyricDisplay: { lineCount: 2, advanceMode: 'clear' },
          },
          2_000,
        )
        .lines.map((line) => line.text),
    ).toEqual(['Three', 'Four'])
    expect(
      videoExport
        .frameStateAt(
          {
            ...project,
            lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
          },
          1_000,
        )
        .lines.map((line) => line.text),
    ).toEqual(['Two', 'Three', 'Four'])
    expect(
      videoExport
        .frameStateAt(
          {
            ...project,
            lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
          },
          2_000,
        )
        .lines.map((line) => line.text),
    ).toEqual(['Two', 'Three', 'Four'])
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
    expect(
      videoExport.parseProjectForVideo(
        JSON.stringify({
          ...videoProject(),
          tracks: [],
        }),
      ),
    ).toMatchObject({ tracks: [] })

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

    expect(() =>
      videoExport.parseProjectForVideo(
        JSON.stringify({
          ...videoProject(),
          lyricDisplay: { lineCount: 6, advanceMode: 'clear' },
        }),
      ),
    ).toThrow('line count must be an integer from 1 to 5')
  })

  it('renders neither track labels, mini upcoming lines, nor an instrumental fallback', () => {
    const document = videoExport.renderDocument()
    expect(document).not.toContain('state.nextLine')
    expect(document).not.toContain('Next ·')
    expect(document).not.toContain('line-label')
    expect(document).not.toMatch(/instrumental/iu)
    const source = readFileSync('electron/video-export.cjs', 'utf8')
    expect(source).not.toContain('window.renderKaraokeFrame=')
    expect(source).toContain('renderStyleDocument')
    const script = document.match(/<script>([\s\S]*)<\/script>/u)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Script(script)).not.toThrow()
  })

  it('installs the frozen planner without CommonJS globals for Vite/browser use', () => {
    const browserGlobal = {}
    new Script(readFileSync('electron/stage-frame-state.cjs', 'utf8')).runInNewContext({
      globalThis: browserGlobal,
      Symbol,
    })
    const api = Reflect.get(browserGlobal, Symbol.for('studio.okay-karaoke.stage-frame-state')) as {
      frameStateAt(project: unknown, playbackMs: number): { lines: Array<{ text: string }> }
    }
    expect(Object.isFrozen(api)).toBe(true)
    expect(api.frameStateAt(videoProject(), 2_000).lines[0].text).toBe('Hello world')
    expect(readFileSync('src/lib/stage-frame-state.ts', 'utf8')).toContain(
      "import '../../electron/stage-frame-state.cjs'",
    )
  })

  it('uses the app palette for stage chrome while preserving authored word accents', () => {
    const document = videoExport.renderDocument()

    expect(document).not.toMatch(/#(?:17111e|21172b|9b78cf)/iu)
    expect(document).toContain('state.stageStyle.background')

    const project = videoProject()
    project.stageStyle.background.solidColor = '#123456'
    project.tracks[0].vocalStyle.sungColor = '#A1b2C3'
    expect(videoExport.frameStateAt(project, 2_000)).toMatchObject({
      stageStyle: { background: { solidColor: '#123456' } },
      lines: [{ style: { sungColor: '#A1b2C3' } }],
    })
    project.tracks[0].vocalStyle.sungColor = null
    project.stageStyle.lyrics.sungColor = '#C3b2A1'
    expect(videoExport.frameStateAt(project, 2_000).lines[0].style.sungColor).toBe('#C3b2A1')
  })

  it('uses only visible tracks when extending duration', () => {
    const project = videoProject()
    project.durationMs = null
    project.tracks.push(
      createVocalTrack({
        id: 'muted-guide',
        name: 'Muted guide',
        muted: true,
        solo: false,
        lines: [
          createLyricLine('Hidden', {
            id: 'muted-line',
            startMs: 20_000,
            endMs: 25_000,
            words: [
              createLyricWord('Hidden', {
                id: 'muted-word',
                startMs: 20_000,
                endMs: 25_000,
              }),
            ],
          }),
        ],
      }),
    )

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
        id: 'untimed-line-one',
        startMs: 0,
        endMs: 2_000,
        words: untimedWords,
      }),
      createLyricLine('After the break', {
        id: 'untimed-line-two',
        startMs: 20_000,
        endMs: 22_000,
        words: untimedWords.map((word) => ({ ...word, id: `later-${word.id}` })),
      }),
    ]

    expect(
      videoExport
        .frameStateAt(project, 1_000)
        .lines[0].words.map(({ text, progress }) => ({ text, progress })),
    ).toEqual([
      { text: 'Line', progress: 0 },
      { text: 'timed', progress: 0 },
      { text: 'only', progress: 0 },
    ])
  })

  it.each([30, 60] as const)(
    'preserves one output frame per JPEG with index-derived timestamps at %i fps',
    (fps) => {
      const args = videoExport.buildFfmpegArguments(
        '/music/source.wav',
        '/exports/video.mp4',
        5_000,
        { resolution: '1440p', fps },
      )

      expect(args).toEqual(
        expect.arrayContaining([
          '-f',
          'image2pipe',
          '-framerate',
          String(fps),
          '-vcodec',
          'mjpeg',
          '-i',
          'pipe:0',
          '-vf',
          `setpts=N/(${fps}*TB),format=yuv420p`,
          '-fps_mode:v',
          'passthrough',
          '-enc_time_base:v',
          `1:${fps}`,
          '-af',
          'apad',
          '-t',
          '5.000',
        ]),
      )
      expect(args.indexOf('-framerate')).toBeLessThan(args.indexOf('pipe:0'))
      expect(args.indexOf('-fps_mode:v')).toBeGreaterThan(args.lastIndexOf('-i'))
      expect(args.some((argument) => /(?:^|,)fps=/u.test(argument))).toBe(false)
      expect(args).not.toContain('-r')
      expect(args).not.toContain('cfr')
      expect(args).not.toContain('concat')
      expect(args).not.toContain('-shortest')
      expect(args.at(-1)).toBe('/exports/video.mp4')
    },
  )

  it('shares title, Clear/Scroll, section, resolved style, Preview, and sync-aid state', () => {
    const project = videoProject()
    const vocal = project.tracks[0].vocalStyle
    project.durationMs = 10_000
    project.offsetMs = 0
    project.lyricDisplay = { lineCount: 2, advanceMode: 'clear' }
    vocal.previewMs = 2_000
    vocal.sizePx = 96
    vocal.unsungColor = '#123456'
    vocal.sungColor = null
    vocal.alignment = 'right'
    vocal.fontStyle =
      project.stageStyle.lyrics.typeface.faces.find(({ style }) => style === 'Bold') ?? null
    vocal.syncAid = { enabled: true, minLeadMs: 1_000, maxLeadMs: 2_000 }
    project.tracks[0].lines = [
      timedVideoLine('A', 3_000, 4_000),
      timedVideoLine('B', 4_000, 5_000),
      timedVideoLine('C', 5_000, 6_000),
      blankVideoLine(),
      timedVideoLine('D', 8_000, 9_000),
      timedVideoLine('E', 9_000, 10_000),
    ]

    for (const time of [999, 1_000, 2_500, 5_000, 6_000, 7_500, 10_000]) {
      expect(previewFrameStateAt(project, time)).toEqual(videoExport.frameStateAt(project, time))
    }
    const first = previewFrameStateAt(project, 1_000)
    expect(first.showTitle).toBe(false)
    expect(first.lines[0]).toMatchObject({
      text: 'A',
      style: {
        alignment: 'right',
        sizePx: 96,
        unsungColor: '#123456',
        sungColor: project.stageStyle.lyrics.sungColor,
      },
    })
    expect(first.syncAids[0]).toMatchObject({ lineId: project.tracks[0].lines[0].id, progress: 0 })
    expect(previewFrameStateAt(project, 999).showTitle).toBe(true)
    expect(previewFrameStateAt(project, 6_000).lines.map(({ text }) => text)).toEqual(['D', 'E'])

    project.lyricDisplay.advanceMode = 'scroll'
    expect(previewFrameStateAt(project, 4_000).lines.map(({ text }) => text)).toEqual(['B', 'C'])
    expect(previewFrameStateAt(project, 6_000)).toEqual(videoExport.frameStateAt(project, 6_000))
  })

  it('prepares bounded image and font assets', async () => {
    const project = videoProject()
    project.stageStyle.background.mode = 'image'
    project.stageStyle.background.imagePath = '/linked/background.png'
    const runtime = await videoExport.prepareStyleRuntime(project, {
      bytes: Buffer.from('png'),
      mime: 'image/png',
    })
    expect(runtime.backgroundDataUrl).toBe('data:image/png;base64,cG5n')
  })
})
