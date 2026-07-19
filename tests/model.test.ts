import { describe, expect, it, vi } from 'vitest'

import {
  clampTiming,
  createDemoProject,
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  exportAss,
  exportLrc,
  formatTime,
  importLrc,
  MAX_PROJECT_DURATION_MS,
  MAX_PROJECT_WORDS,
  parseLyrics,
  parseProject,
  planLyricDisplayLines,
  retimeLine,
  serializeProject,
  UNSUPPORTED_PROJECT_FORMAT_ERROR,
  validateProject,
  type KaraokeProject,
} from '../src/lib/karaoke'
import { DEFAULT_STAGE_STYLE, DEFAULT_VOCAL_STYLE } from '../src/lib/video-style'
import { effectiveDuration, motionAwareScrollBehavior, recalculateLine } from '../src/utils'

describe('karaoke project model', () => {
  it('creates a valid seeded project with integer word timings', () => {
    const project = createDemoProject()

    expect(project.schemaVersion).toBe(0)
    expect(project.lyricDisplay).toEqual({ lineCount: 3, advanceMode: 'clear' })
    expect(project.title).toBe('Neon Afterglow')
    expect(project.stageStyle).toEqual(DEFAULT_STAGE_STYLE)
    expect(project.stageStyle).not.toBe(DEFAULT_STAGE_STYLE)
    expect(project.tracks[0].vocalStyle).toEqual(DEFAULT_VOCAL_STYLE)
    expect(project.tracks[0].vocalStyle).not.toBe(DEFAULT_VOCAL_STYLE)
    expect(project.tracks[0].lines.length).toBeGreaterThan(3)
    expect(
      project.tracks[0].lines
        .flatMap((line) => line.words)
        .every((word) => Number.isInteger(word.startMs) && Number.isInteger(word.endMs)),
    ).toBe(true)
    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('parses plain lyrics as untimed words and carries aligned edits forward', () => {
    const initial = parseLyrics('Hello bright world\nSing with me', 'lead')
    expect(initial.lines[0].words.map((word) => word.text)).toEqual(['Hello', 'bright', 'world'])
    expect(initial.lines[0].words.every((word) => word.startMs === null)).toBe(true)

    const timed = {
      ...initial,
      lines: [retimeLine(initial.lines[0], 1_000, 2_500), initial.lines[1]],
    }
    const edited = parseLyrics('Hello wide bright world\nSing with me', 'lead', timed)

    expect(edited.lines[0].words[0].startMs).toBe(1_000)
    expect(edited.lines[0].words[1].text).toBe('wide')
    expect(edited.lines[0].words[1].startMs).toBeNull()
    expect(edited.lines[0].words[2].text).toBe('bright')
    expect(edited.lines[0].words[2].startMs).not.toBeNull()
  })

  it('preserves one internal blank row as a section separator', () => {
    const track = parseLyrics('\n  First phrase  \n\n\n Second phrase \n\n', 'lead')

    expect(track.lines.map((line) => line.text)).toEqual(['First phrase', '', 'Second phrase'])
    expect(track.lines[1].words).toEqual([])
    expect(track.lines.flatMap((line) => line.words)).toHaveLength(4)

    const reparsed = parseLyrics('First phrase\n\nSecond phrase', 'lead', track)
    expect(reparsed.lines.map((line) => line.id)).toEqual(track.lines.map((line) => line.id))
  })

  it('keeps timing attached to the right lines when text is inserted', () => {
    const initial = parseLyrics('First line\nSecond line\nThird line', 'lead')
    const timed = {
      ...initial,
      lines: initial.lines.map((line, index) =>
        retimeLine(line, 1_000 + index * 2_000, 2_000 + index * 2_000),
      ),
    }

    const edited = parseLyrics(
      'First line\nA brand new line\nSecond line\nThird line',
      'lead',
      timed,
    )

    expect(edited.lines[1].startMs).toBeNull()
    expect(edited.lines[2].id).toBe(timed.lines[1].id)
    expect(edited.lines[2].startMs).toBe(3_000)
    expect(edited.lines[3].id).toBe(timed.lines[2].id)
  })

  it('keeps an edited line aligned when an earlier line is deleted', () => {
    const initial = parseLyrics('I love alpha\nI love bravo\nI love charlie', 'lead')
    const timed = {
      ...initial,
      lines: initial.lines.map((line, index) =>
        retimeLine(line, 1_000 + index * 3_000, 2_000 + index * 3_000),
      ),
    }

    const edited = parseLyrics('I love BRAVO!\nI love charlie', 'lead', timed)

    expect(edited.lines[0].id).toBe(timed.lines[1].id)
    expect(edited.lines[0].startMs).toBe(4_000)
    expect(edited.lines[1].id).toBe(timed.lines[2].id)
  })

  it('fails fast when an edited lyric diff would require an unsafe alignment matrix', () => {
    const text = Array.from({ length: 2_100 }, (_, index) => `Line ${index}`).join('\n')
    const initial = parseLyrics(text, 'lead')
    const edited = text.replace('Line 1000', 'Changed 1000')

    expect(() => parseLyrics(edited, 'lead', initial)).toThrow('too large to align safely')
  })

  it('reports invalid and overlapping timing without rejecting untimed lyrics', () => {
    const first = retimeLine(createLyricLine('First line'), 1_000, 2_000)
    const second = retimeLine(createLyricLine('Second line'), 1_800, 2_800)
    second.words[0].startMs = 1_800.5
    const project = createProject({
      durationMs: 2_500,
      tracks: [createVocalTrack({ id: 'lead', lines: [first, second] })],
    })

    const issues = validateProject(project)
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['line-overlap', 'timing-not-integer', 'timing-after-duration']),
    )

    const plain = createProject({ tracks: [parseLyrics('No timing yet', 'plain')] })
    expect(validateProject(plain).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('validates word overlap across line boundaries while allowing edge-touching timing', () => {
    const timedLine = (
      lineId: string,
      wordId: string,
      text: string,
      startMs: number,
      endMs: number,
    ) =>
      createLyricLine(text, {
        id: lineId,
        startMs,
        endMs,
        words: [createLyricWord(text, { id: wordId, startMs, endMs })],
      })

    const overlapping = createProject({
      tracks: [
        createVocalTrack({
          id: 'lead',
          lines: [
            timedLine('first-line', 'first-word', 'First', 1_000, 1_500),
            timedLine('second-line', 'second-word', 'Second', 1_400, 1_900),
          ],
        }),
      ],
    })
    expect(validateProject(overlapping)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'word-overlap',
          path: 'tracks[0].lines[1].words[0]',
          trackId: 'lead',
          lineId: 'second-line',
          wordId: 'second-word',
        }),
      ]),
    )

    const edgeTouching = createProject({
      tracks: [
        createVocalTrack({
          id: 'lead',
          lines: [
            timedLine('first-line', 'first-word', 'First', 1_000, 1_500),
            timedLine('second-line', 'second-word', 'Second', 1_500, 1_900),
          ],
        }),
      ],
    })
    expect(validateProject(edgeTouching).map((issue) => issue.code)).not.toContain('word-overlap')
  })

  it('rejects unsafe, over-limit, and over-cardinality project state', () => {
    const project = createProject({
      durationMs: MAX_PROJECT_DURATION_MS + 1,
      offsetMs: Number.MAX_SAFE_INTEGER,
      tracks: Array.from({ length: 9 }, (_, index) => createVocalTrack({ id: `track-${index}` })),
    })

    expect(validateProject(project).map((validationIssue) => validationIssue.code)).toEqual(
      expect.arrayContaining(['duration-invalid', 'offset-not-integer', 'track-count-limit']),
    )
    expect(() => parseProject(JSON.stringify(project))).toThrow('limited to 8 vocal tracks')

    const shiftedPastLimit = createProject({
      offsetMs: 1_000,
      tracks: [
        createVocalTrack({
          id: 'lead',
          lines: [
            createLyricLine('Last line', {
              startMs: MAX_PROJECT_DURATION_MS - 2_000,
              endMs: MAX_PROJECT_DURATION_MS,
            }),
          ],
        }),
      ],
    })
    expect(
      validateProject(shiftedPastLimit).map((validationIssue) => validationIssue.code),
    ).toContain('timing-after-limit')
  })

  it('validates persisted lyric display settings', () => {
    const invalidCount = createProject({
      lyricDisplay: { lineCount: 6, advanceMode: 'clear' },
    })
    expect(validateProject(invalidCount).map((issue) => issue.code)).toContain(
      'lyric-display-line-count',
    )

    const invalidMode = createProject() as KaraokeProject
    invalidMode.lyricDisplay.advanceMode = 'page' as 'clear'
    expect(validateProject(invalidMode).map((issue) => issue.code)).toContain(
      'lyric-display-advance-mode',
    )
  })

  it('validates timing against duration after applying the global offset', () => {
    const shiftedLate = createProject({
      durationMs: 30_000,
      offsetMs: 10_000,
      tracks: [
        createVocalTrack({
          id: 'late',
          lines: [createLyricLine('Late', { startMs: 28_000, endMs: 30_000 })],
        }),
      ],
    })
    expect(validateProject(shiftedLate).map((issue) => issue.code)).toContain(
      'timing-after-duration',
    )

    const shiftedEarlier = createProject({
      durationMs: 30_000,
      offsetMs: -10_000,
      tracks: [
        createVocalTrack({
          id: 'earlier',
          lines: [createLyricLine('Earlier', { startMs: 32_000, endMs: 34_000 })],
        }),
      ],
    })
    expect(validateProject(shiftedEarlier).map((issue) => issue.code)).not.toContain(
      'timing-after-duration',
    )
  })
})

describe('lyric display planning', () => {
  function timedLine(id: string, startMs: number, endMs: number) {
    return retimeLine(createLyricLine(id, { id }), startMs, endMs)
  }

  const lineTexts = (lines: ReturnType<typeof planLyricDisplayLines>) =>
    lines.map((line) => line.text)

  it('keeps clear-mode pages inside blank-line sections', () => {
    const track = createVocalTrack({
      id: 'lead',
      lines: [
        timedLine('A', 0, 1_000),
        timedLine('B', 1_000, 2_000),
        timedLine('C', 2_000, 3_000),
        createLyricLine('', { id: 'separator' }),
        timedLine('D', 5_000, 6_000),
        timedLine('E', 6_000, 7_000),
        timedLine('F', 7_000, 8_000),
        timedLine('G', 8_000, 9_000),
        timedLine('H', 9_000, 10_000),
      ],
    })
    const settings = { lineCount: 5, advanceMode: 'clear' } as const

    expect(lineTexts(planLyricDisplayLines(track, -1, settings))).toEqual(['A', 'B', 'C'])
    expect(lineTexts(planLyricDisplayLines(track, 2_500, settings))).toEqual(['A', 'B', 'C'])
    expect(lineTexts(planLyricDisplayLines(track, 3_000, settings))).toEqual([
      'D',
      'E',
      'F',
      'G',
      'H',
    ])
    expect(planLyricDisplayLines(track, 10_000, settings)).toEqual([])
  })

  it('pages in clear mode and advances one line at a time in scroll mode', () => {
    const track = createVocalTrack({
      id: 'lead',
      lines: [
        timedLine('One', 0, 1_000),
        timedLine('Two', 1_000, 2_000),
        timedLine('Three', 2_000, 3_000),
        timedLine('Four', 3_000, 4_000),
      ],
    })

    expect(
      lineTexts(planLyricDisplayLines(track, 1_500, { lineCount: 2, advanceMode: 'clear' })),
    ).toEqual(['One', 'Two'])
    expect(
      lineTexts(planLyricDisplayLines(track, 2_000, { lineCount: 2, advanceMode: 'clear' })),
    ).toEqual(['Three', 'Four'])
    expect(
      lineTexts(planLyricDisplayLines(track, 1_000, { lineCount: 3, advanceMode: 'scroll' })),
    ).toEqual(['Two', 'Three', 'Four'])
    expect(
      lineTexts(planLyricDisplayLines(track, 2_000, { lineCount: 3, advanceMode: 'scroll' })),
    ).toEqual(['Two', 'Three', 'Four'])
  })

  it('uses an editor focus line for untimed lyrics', () => {
    const track = parseLyrics('Alpha\nBeta\nGamma', 'lead')
    expect(
      lineTexts(
        planLyricDisplayLines(track, 0, { lineCount: 2, advanceMode: 'scroll' }, track.lines[1].id),
      ),
    ).toEqual(['Beta', 'Gamma'])
  })
})

describe('timing helpers', () => {
  it('honors reduced motion for programmatic scrolling', () => {
    try {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: true })),
      )
      expect(motionAwareScrollBehavior()).toBe('auto')
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: false })),
      )
      expect(motionAwareScrollBehavior()).toBe('smooth')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('clamps, retimes, and formats integer millisecond timings', () => {
    expect(clampTiming(-500, 12_000, 10_000)).toEqual({
      startMs: 0,
      endMs: 10_000,
    })
    expect(clampTiming(9_999, 9_999, { maxMs: 10_000, minimumDurationMs: 25 })).toEqual({
      startMs: 9_975,
      endMs: 10_000,
    })
    expect(formatTime(65_432)).toBe('01:05.432')
    expect(formatTime(3_661_005)).toBe('1:01:01.005')
  })

  it('derives duration from line timing when words are untimed', () => {
    const track = importLrc('[03:00]Late lyric', 'lead')
    const project = createProject({ durationMs: null, tracks: [track] })

    expect(track.lines[0].endMs).toBe(183_000)
    expect(effectiveDuration(project)).toBe(187_000)
  })

  it('includes positive project offset in effective duration', () => {
    const line = createLyricLine('Late lyric', { startMs: 28_000, endMs: 30_000 })
    const project = createProject({
      durationMs: null,
      offsetMs: 10_000,
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })

    expect(effectiveDuration(project)).toBe(44_000)
  })

  it('recalculates a maximum-size line without spreading timing arrays', () => {
    const words = Array.from({ length: 150_000 }, (_, index) =>
      createLyricWord('x', { id: `word-${index}`, startMs: index, endMs: index + 1 }),
    )

    expect(recalculateLine(createLyricLine('', { words }))).toMatchObject({
      startMs: 0,
      endMs: 150_000,
    })
  })
})

describe('LRC interchange', () => {
  it('imports basic and enhanced timestamps and infers line endings', () => {
    const track = importLrc(
      [
        '[offset:100]',
        '[00:01.000]<00:01.000>Hello <00:01.500>world',
        '[00:03.250]Untimed words',
      ].join('\n'),
      'lead',
    )

    expect(track.lines).toHaveLength(2)
    expect(track.lines[0].startMs).toBe(1_100)
    expect(track.lines[0].endMs).toBe(3_350)
    expect(track.lines[0].words.map((word) => word.startMs)).toEqual([1_100, 1_600])
    expect(track.lines[0].words.map((word) => word.endMs)).toEqual([1_600, 3_350])
    expect(track.lines[1].words.every((word) => word.startMs === null)).toBe(true)

    const compact = importLrc('[00:01]<00:01>Hello<00:02>world', 'compact')
    expect(compact.lines[0].text).toBe('Hello world')
  })

  it('exports exact millisecond line and word timestamps', () => {
    const track = importLrc('[00:01.125]<00:01.125>Exact <00:01.875>timing', 'lead')
    const project = createProject({ title: 'Test', artist: 'Singer', tracks: [track] })
    const output = exportLrc(project, 'lead')

    expect(output).toContain('[ti:Test]')
    expect(output).toContain('[00:01.125]<00:01.125>Exact <00:01.875>timing')
    expect(() => exportLrc(project, 'missing')).toThrow(RangeError)
  })

  it('materializes an LRC offset relative to the target project offset', () => {
    const line = createLyricLine('Offset lyric', { startMs: 1_000, endMs: 2_000 })
    const project = createProject({
      offsetMs: 100,
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })
    const exported = exportLrc(project, 'lead')

    const imported = importLrc(exported, 'round-trip', project.offsetMs)

    expect(imported.lines[0].startMs).toBe(1_000)
    expect(imported.lines[0].endMs).toBe(4_000)
  })

  it('rejects unsafe and over-limit LRC timing before it reaches project state', () => {
    expect(() => importLrc('[offset:9007199254740991]\n[00:01]Unsafe', 'lead')).toThrow(
      'offsets must be within four hours',
    )
    expect(() => importLrc('[241:00]Too late', 'lead')).toThrow('cannot exceed four hours')
    expect(() => importLrc('[00:00.500]Too early', 'lead', 1_000)).toThrow('occurs before zero')
  })

  it('rejects compact LRC text before allocating over the word cap', () => {
    const tooManyWords = Array.from({ length: MAX_PROJECT_WORDS + 1 }, () => 'x').join(' ')
    expect(() => importLrc(`[00:01]${tooManyWords}`, 'lead')).toThrow('word limit')
  })

  it('round-trips timestamp-shaped lyric text without creating extra timing', () => {
    const text = '[12:34] Meet at <3:00> by C:\\Stage'
    const line = createLyricLine(text, {
      id: 'literal-line',
      startMs: 1_000,
      endMs: 2_000,
    })
    const project = createProject({
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })

    const output = exportLrc(project, 'lead')
    const imported = importLrc(output, 'round-trip')

    expect(output).toContain('\\[12:34]')
    expect(output).toContain('\\<3:00>')
    expect(imported.lines).toHaveLength(1)
    expect(imported.lines[0].text).toBe(text)
  })

  it('rejects enhanced word timing that cannot form a valid project', () => {
    expect(() => importLrc('[00:10]<00:05>Hello', 'lead')).toThrow(
      'Invalid LRC timing on source line 1',
    )
    expect(() => importLrc('[00:01]<00:02>A <00:01.500>B', 'lead')).toThrow(
      'Invalid LRC timing on source line 1',
    )
  })

  it('uses the next distinct line timestamp for duplicate starts', () => {
    const track = importLrc('[00:01]First\n[00:01]Second\n[00:03]Third', 'lead')

    expect(track.lines.map((line) => line.endMs)).toEqual([3_000, 3_000, 6_000])
  })
})

describe('ASS export', () => {
  it('writes one-window-editor timings as styled karaoke events', () => {
    const project = createDemoProject()
    const output = exportAss(project)

    expect(output).toContain('[V4+ Styles]')
    expect(output).toContain('[Events]')
    expect(output).toContain('Style: Lead Vocal,Arial,72,&H002B8AFF')
    expect(output).toMatch(/Dialogue: 0,0:00:02\.00,0:00:05\.40,Lead Vocal/)
    expect(output).toContain('{\\kf')
  })

  it('preserves word lead-ins, pauses, and literal backslashes', () => {
    const line = createLyricLine('AC\\DC rocks', {
      id: 'spaced-line',
      startMs: 1_000,
      endMs: 3_000,
      words: [
        createLyricWord('AC\\DC', {
          id: 'spaced-word-1',
          startMs: 1_500,
          endMs: 1_800,
        }),
        createLyricWord('rocks', {
          id: 'spaced-word-2',
          startMs: 2_200,
          endMs: 2_500,
        }),
      ],
    })
    const project = createProject({
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })

    const output = exportAss(project)
    expect(output).toContain('{\\k50}{\\kf30}AC\\\\DC {\\k40}{\\kf30}rocks')

    const shiftedAway = exportAss({ ...project, offsetMs: -4_000 })
    expect(shiftedAway).not.toContain('Dialogue:')
  })

  it('clips karaoke tags to the visible event after a negative offset', () => {
    const line = createLyricLine('held', {
      id: 'clipped-line',
      startMs: 1_000,
      endMs: 3_000,
      words: [
        createLyricWord('held', {
          id: 'clipped-word',
          startMs: 1_000,
          endMs: 3_000,
        }),
      ],
    })
    const project = createProject({
      offsetMs: -1_500,
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })

    const event = exportAss(project)
      .split('\n')
      .find((row) => row.startsWith('Dialogue:'))
    expect(event).toContain('0:00:00.00,0:00:01.50')
    expect(event).toContain('{\\kf150}held')
    expect(event).not.toContain('{\\kf200}')
  })

  it('truncates overlapping ASS syllables at the following word start', () => {
    const line = createLyricLine('first second', {
      id: 'overlap-line',
      startMs: 0,
      endMs: 2_000,
      words: [
        createLyricWord('first', {
          id: 'overlap-first',
          startMs: 0,
          endMs: 1_500,
        }),
        createLyricWord('second', {
          id: 'overlap-second',
          startMs: 1_000,
          endMs: 2_000,
        }),
      ],
    })
    const project = createProject({
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })

    const event = exportAss(project)
      .split('\n')
      .find((row) => row.startsWith('Dialogue:'))
    expect(event).toContain('{\\kf100}first {\\kf100}second')
  })
})

describe('strict current project serialization', () => {
  it('round-trips current project JSON', () => {
    const project = createProject({
      lyricDisplay: { lineCount: 5, advanceMode: 'scroll' },
      tracks: [parseLyrics('First section\n\nSecond section', 'lead')],
    })
    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('round-trips a current project with no vocal tracks', () => {
    const project = createProject({ id: 'empty-project', tracks: [] })

    expect(validateProject(project).filter((issue) => issue.severity === 'error')).toEqual([])
    expect(parseProject(serializeProject(project))).toEqual(project)
  })

  it('accepts only numeric schemaVersion 0 and rejects the legacy track shape', () => {
    const unsupportedDeclarations: unknown[] = [1, -1, 0.5, '0', null, false, {}, undefined]
    for (const schemaVersion of unsupportedDeclarations) {
      expect(() =>
        parseProject(
          JSON.stringify({
            ...createDemoProject(),
            schemaVersion,
          }),
        ),
      ).toThrow(UNSUPPORTED_PROJECT_FORMAT_ERROR)
    }

    const legacy = structuredClone(createDemoProject()) as unknown as {
      tracks: Array<Record<string, unknown>>
    }
    legacy.tracks[0].color = '#22d3ee'
    delete legacy.tracks[0].vocalStyle
    expect(() => parseProject(JSON.stringify(legacy))).toThrow('color is not supported')
  })

  it('rejects malformed and invalid current-v0 project JSON', () => {
    expect(() => parseProject('{oops')).toThrow('Invalid project JSON')
    const malformedCurrent = { ...createDemoProject(), title: 42 }
    expect(() => parseProject(JSON.stringify(malformedCurrent))).toThrow(
      'project.title must be a string',
    )
    const missingDisplay = createDemoProject() as KaraokeProject & {
      lyricDisplay?: KaraokeProject['lyricDisplay']
    }
    delete missingDisplay.lyricDisplay
    expect(() => parseProject(JSON.stringify(missingDisplay))).toThrow(
      'project.lyricDisplay is required',
    )
    const invalidDisplay = {
      ...createDemoProject(),
      lyricDisplay: { lineCount: 0, advanceMode: 'clear' },
    }
    expect(() => parseProject(JSON.stringify(invalidDisplay))).toThrow(
      'Lyric display line count must be an integer from 1 to 5',
    )

    const invalid = createDemoProject() as KaraokeProject
    invalid.tracks[0].lines[0].endMs = invalid.tracks[0].lines[0].startMs
    expect(() => serializeProject(invalid)).toThrow('Cannot serialize an invalid project')
  })
})
