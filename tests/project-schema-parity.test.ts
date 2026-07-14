import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import {
  MAX_PROJECT_TRACKS,
  parseProject,
  serializeProject,
  type KaraokeProject,
} from '../src/lib/karaoke'

const require = createRequire(import.meta.url)
const projectSchema = require('../electron/project-schema.cjs') as {
  parseProjectJson(json: string): KaraokeProject
  withParsedProject<T>(json: string, operation: (project: KaraokeProject) => T): T
}
const videoExport = require('../electron/video-export.cjs') as {
  parseProjectForVideo(json: string): KaraokeProject
}

const GOLDEN_JSON = readFileSync(
  new URL('./fixtures/current-project-v4.json', import.meta.url),
  'utf8',
).trim()

type JsonObject = Record<string, unknown>

function golden(): JsonObject {
  return JSON.parse(GOLDEN_JSON) as JsonObject
}

function clone(value: JsonObject = golden()): JsonObject {
  return structuredClone(value)
}

function objectAt(value: JsonObject, path: Array<string | number>): JsonObject {
  return path.reduce<unknown>((current, key) => (current as JsonObject)[key], value) as JsonObject
}

function parity(json: string, accepted: boolean) {
  const outcomes = [
    () => parseProject(json),
    () => projectSchema.parseProjectJson(json),
    () => videoExport.parseProjectForVideo(json),
  ].map((parse) => {
    try {
      return { accepted: true, value: parse() }
    } catch {
      return { accepted: false, value: null }
    }
  })
  expect(outcomes.map(({ accepted: result }) => result)).toEqual([
    accepted,
    accepted,
    accepted,
  ])
  return outcomes
}

describe('current project schema parity', () => {
  it('deeply round-trips the independent v4 golden project in all three decoders', () => {
    const outcomes = parity(GOLDEN_JSON, true)
    const expected = golden()
    outcomes.forEach(({ value }) => expect(value).toStrictEqual(expected))

    const renderer = outcomes[0].value as KaraokeProject
    const main = outcomes[1].value as KaraokeProject
    renderer.stageStyle.background.imagePath = '/changed/in/renderer.png'
    renderer.tracks[0].vocalStyle.syncAid.minLeadMs = 0
    expect(main.stageStyle.background.imagePath).toBe('/fixtures/linked background.png')
    expect(main.tracks[0].vocalStyle.syncAid.minLeadMs).toBe(2_000)

    const serialized = serializeProject(main)
    expect(parseProject(serialized)).toStrictEqual(main)
    expect(JSON.parse(serialized)).toStrictEqual(expected)

    const localFontProject = clone()
    const localFace = {
      fullName: 'Fixture Local Regular', style: 'Regular',
      postscriptName: 'FixtureLocal-Regular', weight: 400, slant: 'normal',
    }
    const localVocal = objectAt(localFontProject, ['tracks', 0, 'vocalStyle'])
    localVocal.typeface = { kind: 'local', family: 'Fixture Local', faces: [localFace] }
    localVocal.fontStyle = localFace
    const localOutcomes = parity(JSON.stringify(localFontProject), true)
    localOutcomes.forEach(({ value }) => expect(value).toStrictEqual(localFontProject))
    expect(JSON.parse(serializeProject(localOutcomes[0].value as KaraokeProject)))
      .toStrictEqual(localFontProject)
  })

  it('requires exact keys at every persisted project boundary', () => {
    const boundaries: Array<Array<string | number>> = [
      [],
      ['lyricDisplay'],
      ['stageStyle'],
      ['stageStyle', 'background'],
      ['tracks', 0],
      ['tracks', 0, 'vocalStyle'],
      ['tracks', 0, 'vocalStyle', 'syncAid'],
      ['tracks', 0, 'lines', 0],
      ['tracks', 0, 'lines', 0, 'words', 0],
    ]
    boundaries.forEach((path, index) => {
      const value = clone()
      objectAt(value, path).unexpected = index
      parity(JSON.stringify(value), false)
    })

    const missing = clone()
    delete objectAt(missing, ['tracks', 0, 'lines', 0, 'words', 0]).text
    parity(JSON.stringify(missing), false)

    const extraForSerialize = parseProject(GOLDEN_JSON) as KaraokeProject & { unexpected?: true }
    extraForSerialize.unexpected = true
    expect(() => serializeProject(extraForSerialize)).toThrow('unexpected is not supported')
  })

  it('rejects schemas 1 through 3 and the legacy track color shape', () => {
    for (const schemaVersion of [1, 2, 3]) {
      const value = clone()
      value.schemaVersion = schemaVersion
      parity(JSON.stringify(value), false)
    }

    const legacy = clone()
    const track = objectAt(legacy, ['tracks', 0])
    track.color = '#22d3ee'
    delete track.vocalStyle
    parity(JSON.stringify(legacy), false)
  })

  it('matches on malformed, cardinality, timing, ID, and semantic rejection', () => {
    parity('{oops', false)

    const tooManyTracks = clone()
    const track = objectAt(tooManyTracks, ['tracks', 0])
    tooManyTracks.tracks = Array.from(
      { length: MAX_PROJECT_TRACKS + 1 },
      (_, index) => ({ ...structuredClone(track), id: `track-${index}`, lines: [] }),
    )

    const incomplete = clone()
    objectAt(incomplete, ['tracks', 0, 'lines', 0, 'words', 0]).endMs = null
    const fractional = clone()
    objectAt(fractional, ['tracks', 0, 'lines', 0, 'words', 0]).startMs = 1_000.5
    const duplicate = clone()
    objectAt(duplicate, ['tracks', 0, 'lines', 0]).id = 'golden-project'
    const outsideLine = clone()
    objectAt(outsideLine, ['tracks', 0, 'lines', 0, 'words', 0]).startMs = 500
    const badDisplay = clone()
    objectAt(badDisplay, ['lyricDisplay']).lineCount = 6

    for (const invalid of [
      tooManyTracks,
      incomplete,
      fractional,
      duplicate,
      outsideLine,
      badDisplay,
    ]) parity(JSON.stringify(invalid), false)
  })

  it('guards main-process open/save effects behind successful parsing', () => {
    let effects = 0
    const invalid = clone()
    invalid.schemaVersion = 3
    expect(() => projectSchema.withParsedProject(JSON.stringify(invalid), () => {
      effects += 1
    })).toThrow('Unsupported project schema version 3')
    expect(effects).toBe(0)

    projectSchema.withParsedProject(GOLDEN_JSON, () => { effects += 1 })
    expect(effects).toBe(1)
    const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    expect(mainSource).toContain('withParsedProject(contents, (project) => {')
    expect(mainSource).toContain('withParsedProject(request.contents, async () => {')
  })

  it('gates the video-export effect region behind strict project parsing', () => {
    let effects = 0
    const rejected = ['{oops', ...[1, 2, 3].map((schemaVersion) => {
      const project = clone()
      project.schemaVersion = schemaVersion
      return JSON.stringify(project)
    })]
    rejected.forEach((projectJson) => expect(() => projectSchema.withParsedProject(
      projectJson,
      () => { effects += 1 },
    )).toThrow())
    expect(effects).toBe(0)

    const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const start = mainSource.indexOf('ipcMain.handle(CHANNELS.exportVideo')
    const end = mainSource.indexOf('ipcMain.handle(CHANNELS.cancelVideoExport', start)
    const handler = mainSource.slice(start, end)
    const parseGate = handler.indexOf('withParsedProject(request.projectJson')
    expect(parseGate).toBeGreaterThan(handler.indexOf('normalizeVideoExportRequest(value)'))
    for (const effect of [
      'beginVideoExport(', 'ensureFfmpegForExport(',
      'showCanonicalSaveDialog(', 'exportKaraokeVideo(',
    ]) expect(parseGate).toBeLessThan(handler.indexOf(effect))
  })

  it('gates editable-project export effects behind strict project parsing', () => {
    let effects = 0
    const legacy = clone()
    const legacyTrack = objectAt(legacy, ['tracks', 0])
    legacyTrack.color = '#ffffff'
    delete legacyTrack.vocalStyle
    const rejected = ['{oops', legacy, ...[1, 2, 3].map((schemaVersion) => ({
      ...clone(),
      schemaVersion,
    }))]
    rejected.forEach((project) => expect(() => projectSchema.withParsedProject(
      typeof project === 'string' ? project : JSON.stringify(project),
      () => { effects += 1 },
    )).toThrow())
    expect(effects).toBe(0)

    const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const start = mainSource.indexOf('ipcMain.handle(CHANNELS.exportText')
    const end = mainSource.indexOf('ipcMain.handle(CHANNELS.exportVideo', start)
    const handler = mainSource.slice(start, end)
    expect(handler).toContain("request.format === 'oks'")
    expect(handler.indexOf('withParsedProject(request.contents')).toBeLessThan(
      handler.indexOf('writeTextExport(owner, request)'),
    )
  })
})
