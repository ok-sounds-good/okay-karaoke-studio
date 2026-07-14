import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  parseProject,
  serializeProject,
  type KaraokeProject,
} from '../src/lib/karaoke'
import { cloneStageStyle, cloneVocalStyle } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const projectFiles = require('../electron/project-files.cjs') as {
  queueProjectWrite(filePath: string, contents: string): Promise<void>
  readUtf8FileWithinLimit(filePath: string, maxBytes: number, label: string): Promise<string>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

async function temporaryProjectPath() {
  const directory = await mkdtemp(join(tmpdir(), 'okay-karaoke-persistence-'))
  temporaryDirectories.push(directory)
  return { directory, filePath: join(directory, 'round-trip.oks') }
}

function completeProjectFixture(): KaraokeProject {
  const stageStyle = cloneStageStyle()
  stageStyle.background = {
    ...stageStyle.background,
    mode: 'image',
    imagePath: '/linked/background image.png',
  }
  const leadStyle = cloneVocalStyle()
  leadStyle.sungColor = '#12aBcD'
  const guideStyle = cloneVocalStyle()
  guideStyle.sungColor = '#fedcba'
  const leadLine = createLyricLine('Café lights', {
    id: 'line-lead-1',
    startMs: 1_001,
    endMs: 3_337,
    words: [
      createLyricWord('Café', { id: 'word-lead-1', startMs: 1_001, endMs: 2_009 }),
      createLyricWord('lights', { id: 'word-lead-2', startMs: 2_009, endMs: 3_337 }),
    ],
  })
  const guideLine = createLyricLine('Count me in', {
    id: 'line-guide-1',
    startMs: null,
    endMs: null,
    words: [
      createLyricWord('Count', { id: 'word-guide-1' }),
      createLyricWord('me', { id: 'word-guide-2' }),
      createLyricWord('in', { id: 'word-guide-3' }),
    ],
  })

  return createProject({
    id: 'project-round-trip',
    title: 'Midnight / Morning 🌙',
    artist: 'Singer & Friend',
    audioPath: '../Audio/source mix.flac',
    durationMs: 245_678,
    offsetMs: -317,
    createdAt: '2026-02-03T04:05:06.789Z',
    updatedAt: '2026-07-12T17:18:19.123Z',
    lyricDisplay: { lineCount: 5, advanceMode: 'scroll' },
    stageStyle,
    tracks: [
      createVocalTrack({
        id: 'track-lead',
        name: 'Lead Vocal',
        vocalStyle: leadStyle,
        muted: false,
        solo: true,
        lines: [leadLine],
      }),
      createVocalTrack({
        id: 'track-guide',
        name: 'Guide / Harmony',
        vocalStyle: guideStyle,
        muted: true,
        solo: false,
        lines: [guideLine],
      }),
    ],
  })
}

describe('Electron project file persistence', () => {
  it('reopens an atomically saved project with identical metadata, tracks, lyrics, and timings', async () => {
    const { directory, filePath } = await temporaryProjectPath()
    const original = completeProjectFixture()
    const serialized = serializeProject(original)

    await projectFiles.queueProjectWrite(filePath, serialized)
    const reopened = parseProject(
      await projectFiles.readUtf8FileWithinLimit(filePath, 32 * 1024 * 1024, 'Project file'),
    )

    expect(reopened).toStrictEqual(original)
    expect(reopened).not.toBe(original)
    expect(reopened.tracks[0]).not.toBe(original.tracks[0])
    expect(reopened.tracks[0].lines[0].words[0]).not.toBe(original.tracks[0].lines[0].words[0])
    expect(reopened.lyricDisplay).toEqual({ lineCount: 5, advanceMode: 'scroll' })
    expect(reopened.lyricDisplay).not.toBe(original.lyricDisplay)
    expect(reopened.stageStyle.background.imagePath).toBe('/linked/background image.png')
    expect(reopened.stageStyle).not.toBe(original.stageStyle)
    expect(reopened.tracks[0].vocalStyle).not.toBe(original.tracks[0].vocalStyle)
    expect(await readdir(directory)).toEqual(['round-trip.oks'])
  })

  it('serializes concurrent saves to one path and reopens the last requested revision', async () => {
    const { filePath } = await temporaryProjectPath()
    const first = completeProjectFixture()
    const second = {
      ...first,
      title: 'Latest saved title',
      updatedAt: '2026-07-12T20:21:22.456Z',
      tracks: first.tracks.map((track, index) => index === 0
        ? {
            ...track,
            lines: track.lines.map((line) => ({
              ...line,
              words: line.words.map((word, wordIndex) => wordIndex === 0
                ? { ...word, startMs: 1_111, endMs: 2_111 }
                : { ...word, startMs: 2_111 }),
            })),
          }
        : track),
    } satisfies KaraokeProject

    await Promise.all([
      projectFiles.queueProjectWrite(filePath, serializeProject(first)),
      projectFiles.queueProjectWrite(filePath, serializeProject(second)),
    ])

    const reopened = parseProject(await readFile(filePath, 'utf8'))
    expect(reopened).toStrictEqual(second)
  })
})
