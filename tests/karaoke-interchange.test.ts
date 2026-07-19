import { describe, expect, it } from 'vitest'

import {
  createDemoProject,
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  exportAss,
  exportLrc,
  importLrc,
  MAX_PROJECT_WORDS,
} from '../src/lib/karaoke'
import { effectiveDuration } from '../src/utils'

describe('LRC duration integration', () => {
  it('derives duration from line timing when words are untimed', () => {
    const track = importLrc('[03:00]Late lyric', 'lead')
    const project = createProject({ durationMs: null, tracks: [track] })

    expect(track.lines[0].endMs).toBe(183_000)
    expect(effectiveDuration(project)).toBe(187_000)
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
