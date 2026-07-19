import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  MAX_STYLE_TEMPLATES,
  STYLE_TEMPLATE_SCHEMA_VERSION,
  canonicalizeStyleTemplateName,
  captureStyleTemplate,
  decodeStyleTemplateFile,
  parseStyleTemplateJson,
  serializeStyleTemplateFile,
  type StyleTemplate,
  type StyleTemplateFile,
} from '../src/lib/style-template-codec'
import { cloneStageStyle, cloneVocalStyle } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const schema = require('../electron/style-template-schema.cjs') as {
  MAX_STYLE_TEMPLATES: number
  STYLE_TEMPLATE_SCHEMA_VERSION: number
  canonicalizeStyleTemplateName(value: unknown, path?: string): string
  decodeStyleTemplateFile(value: unknown): StyleTemplateFile
  parseStyleTemplateJson(json: string): StyleTemplateFile
  serializeStyleTemplateFile(value: unknown): string
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: Error }

function capture<T>(action: () => T): Outcome<T> {
  try {
    return { ok: true, value: action() }
  } catch (error) {
    return { ok: false, error: error as Error }
  }
}

function expectOutcomeParity<T>(typescript: Outcome<T>, commonJs: Outcome<T>, accepted: boolean) {
  expect(typescript.ok).toBe(accepted)
  expect(commonJs.ok).toBe(accepted)
  if (typescript.ok && commonJs.ok) expect(commonJs.value).toStrictEqual(typescript.value)
  if (!typescript.ok && !commonJs.ok) {
    expect(commonJs.error.constructor).toBe(typescript.error.constructor)
    expect(commonJs.error.message).toBe(typescript.error.message)
  }
}

function expectDecodeParity(input: unknown, accepted: boolean): void {
  expectOutcomeParity(
    capture(() => decodeStyleTemplateFile(input)),
    capture(() => schema.decodeStyleTemplateFile(input)),
    accepted,
  )
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function template(id = 'template-1', name = 'Warm Stage'): StyleTemplate {
  const stageStyle = cloneStageStyle()
  stageStyle.background.mode = 'image'
  stageStyle.background.imagePath = '/missing-but-retained/background.png'
  const vocalStyle = cloneVocalStyle()
  vocalStyle.typeface = {
    kind: 'local',
    family: 'Unavailable Template Font',
    faces: [
      {
        fullName: 'Unavailable Template Font Bold',
        style: 'Bold',
        postscriptName: 'UnavailableTemplateFont-Bold',
        weight: 700,
        slant: 'normal',
      },
    ],
  }
  vocalStyle.fontStyle = { ...vocalStyle.typeface.faces[0]! }
  return {
    id,
    name,
    preferences: {
      stageStyle,
      lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
      vocalStyle,
      videoExportDefaults: { resolution: '1440p', fps: 60 },
    },
  }
}

function file(templates: StyleTemplate[] = [template()]): StyleTemplateFile {
  return { schemaVersion: 0, templates }
}

function inheritedRequired(source: Record<string, unknown>, key: string): object {
  const own = { ...source }
  const inherited = own[key]
  delete own[key]
  return Object.assign(Object.create({ [key]: inherited }), own)
}

describe('TypeScript and main-process style template schema parity', () => {
  it('exposes the matched persistence surface and accepts the exact golden shape', () => {
    expect(Object.keys(schema).sort()).toEqual([
      'MAX_STYLE_TEMPLATES',
      'STYLE_TEMPLATE_SCHEMA_VERSION',
      'canonicalizeStyleTemplateName',
      'decodeStyleTemplateFile',
      'parseStyleTemplateJson',
      'serializeStyleTemplateFile',
    ])
    expect(STYLE_TEMPLATE_SCHEMA_VERSION).toBe(0)
    expect(schema.STYLE_TEMPLATE_SCHEMA_VERSION).toBe(0)
    expect(MAX_STYLE_TEMPLATES).toBe(100)
    expect(schema.MAX_STYLE_TEMPLATES).toBe(100)

    const golden = file()
    expectDecodeParity(jsonClone(golden), true)
    const decoded = decodeStyleTemplateFile(jsonClone(golden))
    expect(decoded).toStrictEqual(golden)
    expect(decoded.templates[0]?.preferences.stageStyle.background.imagePath).toBe(
      '/missing-but-retained/background.png',
    )
    expect(decoded.templates[0]?.preferences.vocalStyle.typeface?.family).toBe(
      'Unavailable Template Font',
    )
  })

  it('canonicalizes Unicode whitespace at decode, capture, parse, and serialize boundaries', () => {
    const value = file([template('opaque!~ID', '\u2003 Warm\t\nStage \u00a0')])
    const expected = file([template('opaque!~ID', 'Warm Stage')])
    expect(decodeStyleTemplateFile(jsonClone(value))).toStrictEqual(expected)
    expect(captureStyleTemplate(jsonClone(value.templates[0]))).toStrictEqual(expected.templates[0])
    expect(parseStyleTemplateJson(JSON.stringify(value))).toStrictEqual(expected)
    expect(JSON.parse(serializeStyleTemplateFile(value))).toStrictEqual(expected)

    expect(schema.canonicalizeStyleTemplateName('\u2003 Warm\t Stage \u00a0')).toBe('Warm Stage')
    expect(canonicalizeStyleTemplateName('\u2003 Warm\t Stage \u00a0')).toBe('Warm Stage')
    expect(schema.parseStyleTemplateJson(JSON.stringify(value))).toStrictEqual(expected)
    expect(schema.serializeStyleTemplateFile(value)).toBe(serializeStyleTemplateFile(value))
  })

  it('returns deep fresh clones with inert path and font descriptor values', () => {
    const source = file()
    const first = decodeStyleTemplateFile(source)
    const second = decodeStyleTemplateFile(source)
    expect(first).not.toBe(source)
    expect(first.templates).not.toBe(source.templates)
    expect(first.templates[0]).not.toBe(source.templates[0])
    expect(first.templates[0]?.preferences).not.toBe(source.templates[0]?.preferences)
    expect(first.templates[0]?.preferences.stageStyle).not.toBe(
      source.templates[0]?.preferences.stageStyle,
    )
    expect(first.templates[0]?.preferences.vocalStyle.typeface).not.toBe(
      source.templates[0]?.preferences.vocalStyle.typeface,
    )
    expect(first.templates[0]?.preferences.vocalStyle.typeface?.faces[0]).not.toBe(
      source.templates[0]?.preferences.vocalStyle.typeface?.faces[0],
    )
    expect(first.templates[0]).not.toBe(second.templates[0])
    first.templates[0]!.preferences.stageStyle.background.imagePath = '/changed.png'
    first.templates[0]!.preferences.vocalStyle.typeface!.faces[0]!.fullName = 'Changed'
    expect(source.templates[0]?.preferences.stageStyle.background.imagePath).toBe(
      '/missing-but-retained/background.png',
    )
    expect(second.templates[0]?.preferences.vocalStyle.typeface?.faces[0]?.fullName).toBe(
      'Unavailable Template Font Bold',
    )
  })

  it('rejects root, template, and preference keys that are missing, extra, or inherited', () => {
    const cases: unknown[] = []
    for (const [path, key] of [
      [[], 'templates'],
      [['templates', 0], 'id'],
      [['templates', 0], 'name'],
      [['templates', 0, 'preferences'], 'stageStyle'],
      [['templates', 0, 'preferences'], 'lyricDisplay'],
      [['templates', 0, 'preferences', 'lyricDisplay'], 'lineCount'],
      [['templates', 0, 'preferences', 'videoExportDefaults'], 'fps'],
    ] as const) {
      const missing = jsonClone(file()) as unknown as Record<string, unknown>
      let target = path.reduce((value, part) => (value as any)[part], missing) as Record<
        string,
        unknown
      >
      delete target[key]
      cases.push(missing)

      const extra = jsonClone(file()) as any
      target = path.reduce((value, part) => value[part], extra)
      target.future = true
      cases.push(extra)

      const inherited = jsonClone(file()) as any
      if (path.length === 0) cases.push(inheritedRequired(inherited, key))
      else {
        const parentPath = path.slice(0, -1)
        const parent = parentPath.reduce((value, part) => value[part], inherited)
        const final = path.at(-1)!
        parent[final] = inheritedRequired(parent[final], key)
        cases.push(inherited)
      }
    }
    cases.forEach((value) => expectDecodeParity(value, false))
    expectDecodeParity(Object.assign(Object.create({ future: true }), jsonClone(file())), false)
  })

  it('rejects sparse arrays, unsupported versions, excessive cardinality, and invalid IDs', () => {
    const sparse = file()
    sparse.templates = new Array(1)
    expectDecodeParity(sparse, false)
    expectDecodeParity({ schemaVersion: 1, templates: [] }, false)
    expectDecodeParity({ schemaVersion: '0', templates: [] }, false)
    expectDecodeParity(
      file(Array.from({ length: 101 }, (_, index) => template(`id-${index}`))),
      false,
    )

    for (const id of ['', 'has space', 'line\nbreak', '\u00a1', 'a'.repeat(129)]) {
      expectDecodeParity(file([template(id)]), false)
    }
    for (const id of ['!', '~', 'a'.repeat(128), '!opaque:/?#[]@~']) {
      const input = file([template(id)])
      expectDecodeParity(input, true)
      expect(decodeStyleTemplateFile(input).templates[0]?.id).toBe(id)
    }
  })

  it('enforces canonical names, exact case-sensitive uniqueness, and UTF-16 bounds', () => {
    for (const name of ['', ' \t\n ', 'x'.repeat(81), `${'x'.repeat(79)}\u2003 y`]) {
      expectDecodeParity(file([template('id', name)]), false)
    }
    expectDecodeParity(file([template('a', 'Same'), template('b', '\tSame\u2003')]), false)
    expectDecodeParity(file([template('same-id', 'First'), template('same-id', 'Second')]), false)
    expectDecodeParity(file([template('a', 'Same'), template('b', 'same')]), true)
    expectDecodeParity(file([template('a', 'x'.repeat(80))]), true)
  })

  it('rejects invalid lyric-display and export-default values with exact error parity', () => {
    const mutations: Array<[string, unknown[]]> = [
      ['lineCount', [0, 6, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '3']],
      ['advanceMode', ['', 'page', 1, null]],
      ['resolution', ['', '4320p', 720, null]],
      ['fps', [24, 29.97, 30n, '30', null]],
    ]
    for (const [key, values] of mutations) {
      for (const value of values) {
        const input = file() as any
        if (key === 'lineCount' || key === 'advanceMode') {
          input.templates[0].preferences.lyricDisplay[key] = value
        } else input.templates[0].preferences.videoExportDefaults[key] = value
        expectDecodeParity(input, false)
      }
    }
    for (const lineCount of [1, 5]) {
      for (const advanceMode of ['clear', 'scroll']) {
        for (const resolution of ['240p', '2160p']) {
          for (const fps of [30, 60]) {
            const input = file() as any
            Object.assign(input.templates[0].preferences, {
              lyricDisplay: { lineCount, advanceMode },
              videoExportDefaults: { resolution, fps },
            })
            expectDecodeParity(input, true)
          }
        }
      }
    }
  })

  it('rejects project, media, timing, track, history, and identity fields at every boundary', () => {
    for (const [target, key] of [
      ['root', 'project'],
      ['template', 'trackId'],
      ['template', 'history'],
      ['preferences', 'title'],
      ['preferences', 'artist'],
      ['preferences', 'audioPath'],
      ['preferences', 'lyrics'],
      ['preferences', 'offsetMs'],
      ['preferences', 'wordTimings'],
    ]) {
      const input = file() as any
      const destination =
        target === 'root'
          ? input
          : target === 'template'
            ? input.templates[0]
            : input.templates[0].preferences
      destination[key] = target
      expectDecodeParity(input, false)
      if (target !== 'root') expect(() => captureStyleTemplate(input.templates[0])).toThrow()
      expect(() => serializeStyleTemplateFile(input)).toThrow()
    }
  })

  it('keeps parse and serialize acceptance and errors identical across runtimes', () => {
    const accepted = JSON.stringify(file([template('a', ' First\tTemplate ')]))
    expectOutcomeParity(
      capture(() => parseStyleTemplateJson(accepted)),
      capture(() => schema.parseStyleTemplateJson(accepted)),
      true,
    )
    expectOutcomeParity(
      capture(() => serializeStyleTemplateFile(JSON.parse(accepted))),
      capture(() => schema.serializeStyleTemplateFile(JSON.parse(accepted))),
      true,
    )
    for (const invalid of ['{', '', 'null', '[]', '{"schemaVersion":0}']) {
      expectOutcomeParity(
        capture(() => parseStyleTemplateJson(invalid)),
        capture(() => schema.parseStyleTemplateJson(invalid)),
        false,
      )
    }
    expectOutcomeParity(
      capture(() => parseStyleTemplateJson(null as never)),
      capture(() => schema.parseStyleTemplateJson(null as never)),
      false,
    )
  })
})
