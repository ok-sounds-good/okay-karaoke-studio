import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { decodeStageStyle, decodeVocalStyle } from '../src/lib/video-style-codec'
import {
  cloneStageStyle,
  cloneVocalStyle,
  FONT_SIZE_OPTIONS,
  SYSTEM_MONOSPACE_TYPEFACE,
  SYSTEM_UI_TYPEFACE,
  type FontFaceDescriptor,
  type FontSizePx,
  type FontTypefaceDescriptor,
  type StageStyle,
  type VocalStyle,
} from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const schema = require('../electron/video-style-schema.cjs') as {
  decodeStageStyle(value: unknown): StageStyle
  decodeVocalStyle(value: unknown, path: string): VocalStyle
  normalizeStageStyle(value: unknown): StageStyle
  normalizeVocalStyle(value: unknown, path: string): VocalStyle
}

const EXPECTED_FONT_SIZES = [
  8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 25, 27, 28, 32, 36, 40, 42, 48, 56, 64, 72, 82, 96, 104,
  120, 144, 180, 240, 320, 400,
] as const
const EXPECTED_SYSTEM_UI: FontTypefaceDescriptor = {
  kind: 'system-ui',
  family: 'System UI',
  faces: [
    {
      fullName: 'System UI Regular',
      style: 'Regular',
      postscriptName: null,
      weight: 400,
      slant: 'normal',
    },
    {
      fullName: 'System UI Italic',
      style: 'Italic',
      postscriptName: null,
      weight: 400,
      slant: 'italic',
    },
    {
      fullName: 'System UI Semi Bold',
      style: 'Semi Bold',
      postscriptName: null,
      weight: 600,
      slant: 'normal',
    },
    {
      fullName: 'System UI Bold',
      style: 'Bold',
      postscriptName: null,
      weight: 700,
      slant: 'normal',
    },
    {
      fullName: 'System UI Extra Bold',
      style: 'Extra Bold',
      postscriptName: null,
      weight: 800,
      slant: 'normal',
    },
  ],
}
const EXPECTED_SYSTEM_MONOSPACE: FontTypefaceDescriptor = {
  kind: 'system-monospace',
  family: 'System Monospace',
  faces: [
    {
      fullName: 'System Monospace Regular',
      style: 'Regular',
      postscriptName: null,
      weight: 400,
      slant: 'normal',
    },
    {
      fullName: 'System Monospace Italic',
      style: 'Italic',
      postscriptName: null,
      weight: 400,
      slant: 'italic',
    },
    {
      fullName: 'System Monospace Semi Bold',
      style: 'Semi Bold',
      postscriptName: null,
      weight: 600,
      slant: 'normal',
    },
    {
      fullName: 'System Monospace Bold',
      style: 'Bold',
      postscriptName: null,
      weight: 700,
      slant: 'normal',
    },
    {
      fullName: 'System Monospace Extra Bold',
      style: 'Extra Bold',
      postscriptName: null,
      weight: 800,
      slant: 'normal',
    },
  ],
}

const GOLDEN_STYLE_JSON = String.raw`{
  "stage": {
    "background": {"mode":"image","solidColor":"#aBcDeF","gradientStartColor":"#123aBc","gradientEndColor":"#DeF456","imagePath":"/golden/stage.png"},
    "lyrics": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":82,"unsungColor":"#ab12Cd","sungColor":"#Ef3456"},
    "titleCard": {
      "eyebrow": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":25,"color":"#A1b2C3","visible":true},
      "title": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":104,"color":"#d4E5f6","visible":false},
      "artist": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":42,"color":"#112aBc","visible":true}
    },
    "stageFrame": {
      "enabled":true,"lineColor":"#4a5B6c","lineWidthPx":32,
      "brand": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":24,"color":"#789aBc","visible":false},
      "clock": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":27,"color":"#cDeF01","visible":true},
      "footer": {"typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"}]},"fontStyle":{"fullName":"Golden Sans Regular","style":"Regular","postscriptName":"Golden:\"\\Face","weight":400,"slant":"normal"},"sizePx":20,"color":"#234AbC","visible":false}
    }
  },
  "vocal": {
    "typeface":{"kind":"local","family":"Golden Sans","faces":[{"fullName":"Golden Sans Oblique","style":"Oblique","postscriptName":"Golden:Oblique","weight":900,"slant":"oblique"}]},
    "fontStyle":{"fullName":"Golden Sans Oblique","style":"Oblique","postscriptName":"Golden:Oblique","weight":900,"slant":"oblique"},
    "sizePx":400,"unsungColor":"#a1B2c3","sungColor":"#D4e5F6","alignment":"right","previewMs":60000,
    "syncAid":{"enabled":true,"minLeadMs":0,"maxLeadMs":60000}
  }
}`

type JsonObject = Record<string, unknown>
type PathPart = string | number
type Outcome<T> = { ok: true; value: T } | { ok: false; error: Error }

function capture<T>(action: () => T): Outcome<T> {
  try {
    return { ok: true, value: action() }
  } catch (error) {
    return { ok: false, error: error as Error }
  }
}

function expectParity(kind: 'stage' | 'vocal', input: unknown, accepted: boolean): void {
  const typescript = capture(() =>
    kind === 'stage'
      ? decodeStageStyle(input)
      : decodeVocalStyle(input, 'project.tracks[0].vocalStyle'),
  )
  const commonJs = capture(() =>
    kind === 'stage'
      ? schema.decodeStageStyle(input)
      : schema.decodeVocalStyle(input, 'project.tracks[0].vocalStyle'),
  )
  expect(typescript.ok).toBe(accepted)
  expect(commonJs.ok).toBe(accepted)
  if (typescript.ok && commonJs.ok) expect(commonJs.value).toStrictEqual(typescript.value)
  if (!typescript.ok && !commonJs.ok) {
    expect(commonJs.error.constructor).toBe(typescript.error.constructor)
    expect(commonJs.error.message).toBe(typescript.error.message)
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function localTypeface(count = 2): FontTypefaceDescriptor {
  return {
    kind: 'local',
    family: 'Parity Sans',
    faces: Array.from({ length: count }, (_, index) => ({
      fullName: `Parity Sans ${index}`,
      style: `Style ${index}`,
      postscriptName: `ParitySans-${index}`,
      weight: 100 + (index % 9) * 100,
      slant: (['normal', 'italic', 'oblique'] as const)[index % 3],
    })),
  }
}

function localStage(count = 2): StageStyle {
  const stage = cloneStageStyle()
  stage.lyrics.typeface = localTypeface(count)
  stage.lyrics.fontStyle = { ...stage.lyrics.typeface.faces[0] }
  return stage
}

function localVocal(): VocalStyle {
  const vocal = cloneVocalStyle()
  vocal.typeface = localTypeface()
  vocal.fontStyle = { ...vocal.typeface.faces[1] }
  vocal.sizePx = 400
  vocal.unsungColor = '#aBcDeF'
  vocal.sungColor = '#12aBcD'
  return vocal
}

function valueAt(root: unknown, path: readonly PathPart[]): unknown {
  return path.reduce((value, part) => (value as Record<PathPart, unknown>)[part], root)
}

function replaceAt(root: unknown, path: readonly PathPart[], replacement: unknown): unknown {
  if (path.length === 0) return replacement
  const parent = valueAt(root, path.slice(0, -1)) as Record<PathPart, unknown>
  parent[path.at(-1)!] = replacement
  return root
}

function setAt(root: unknown, path: readonly PathPart[], value: unknown): void {
  replaceAt(root, path, value)
}

function exactKeyMutation(
  root: unknown,
  path: readonly PathPart[],
  key: string,
  kind: 'missing' | 'extra' | 'inherited',
): unknown {
  const target = valueAt(root, path) as JsonObject
  if (kind === 'missing') delete target[key]
  if (kind === 'extra') target.future = true
  if (kind === 'inherited') {
    const own = { ...target }
    const inheritedValue = own[key]
    delete own[key]
    return replaceAt(root, path, Object.assign(Object.create({ [key]: inheritedValue }), own))
  }
  return root
}

function expectNoAliases(source: unknown, decoded: unknown): void {
  if (typeof source !== 'object' || source === null) return
  expect(decoded).not.toBe(source)
  if (Array.isArray(source)) {
    source.forEach((value, index) => expectNoAliases(value, (decoded as unknown[])[index]))
    return
  }
  Object.keys(source).forEach((key) => {
    expectNoAliases((source as JsonObject)[key], (decoded as JsonObject)[key])
  })
}

const STAGE_SIZE_PATHS = [
  ['lyrics', 'sizePx'],
  ['titleCard', 'eyebrow', 'sizePx'],
  ['titleCard', 'title', 'sizePx'],
  ['titleCard', 'artist', 'sizePx'],
  ['stageFrame', 'brand', 'sizePx'],
  ['stageFrame', 'clock', 'sizePx'],
  ['stageFrame', 'footer', 'sizePx'],
] as const
const EXACT_KEY_SHAPES = [
  { kind: 'stage', path: [], key: 'background' },
  { kind: 'stage', path: ['background'], key: 'mode' },
  { kind: 'stage', path: ['lyrics'], key: 'unsungColor' },
  { kind: 'stage', path: ['lyrics', 'typeface'], key: 'kind' },
  { kind: 'stage', path: ['lyrics', 'typeface', 'faces', 0], key: 'fullName' },
  { kind: 'stage', path: ['titleCard'], key: 'eyebrow' },
  { kind: 'stage', path: ['titleCard', 'eyebrow'], key: 'visible' },
  { kind: 'stage', path: ['stageFrame'], key: 'enabled' },
  { kind: 'vocal', path: [], key: 'alignment' },
  { kind: 'vocal', path: ['syncAid'], key: 'enabled' },
] as const

describe('TypeScript and main-process video style schema parity', () => {
  it('uses a small export surface and accepts independent hand-authored JSON goldens', () => {
    expect(Object.keys(schema).sort()).toEqual([
      'decodeStageStyle',
      'decodeVocalStyle',
      'normalizeStageStyle',
      'normalizeVocalStyle',
    ])
    expect(FONT_SIZE_OPTIONS).toStrictEqual(EXPECTED_FONT_SIZES)
    expect(SYSTEM_UI_TYPEFACE).toStrictEqual(EXPECTED_SYSTEM_UI)
    expect(SYSTEM_MONOSPACE_TYPEFACE).toStrictEqual(EXPECTED_SYSTEM_MONOSPACE)
    const expected = JSON.parse(GOLDEN_STYLE_JSON) as { stage: StageStyle; vocal: VocalStyle }
    const tsStage = decodeStageStyle((JSON.parse(GOLDEN_STYLE_JSON) as typeof expected).stage)
    const cjsStage = schema.decodeStageStyle(
      (JSON.parse(GOLDEN_STYLE_JSON) as typeof expected).stage,
    )
    const tsVocal = decodeVocalStyle(
      (JSON.parse(GOLDEN_STYLE_JSON) as typeof expected).vocal,
      'golden.vocal',
    )
    const cjsVocal = schema.decodeVocalStyle(
      (JSON.parse(GOLDEN_STYLE_JSON) as typeof expected).vocal,
      'golden.vocal',
    )
    expect(tsStage).toStrictEqual(expected.stage)
    expect(cjsStage).toStrictEqual(expected.stage)
    expect(tsVocal).toStrictEqual(expected.vocal)
    expect(cjsVocal).toStrictEqual(expected.vocal)
    expect(cjsStage.background.solidColor).toBe('#aBcDeF')
    expect(cjsVocal.unsungColor).toBe('#a1B2c3')
    expect(schema.normalizeStageStyle(jsonClone(expected.stage))).toStrictEqual(expected.stage)
    expect(schema.normalizeVocalStyle(jsonClone(expected.vocal), 'golden.vocal')).toStrictEqual(
      expected.vocal,
    )
  })

  it('returns deeply equal fresh values without input or cross-decode aliases', () => {
    const fixtures: Array<['stage' | 'vocal', StageStyle | VocalStyle]> = [
      ['stage', cloneStageStyle()],
      ['stage', localStage()],
      ['vocal', cloneVocalStyle()],
      ['vocal', localVocal()],
    ]
    fixtures.forEach(([kind, input]) => {
      const decoders =
        kind === 'stage'
          ? [decodeStageStyle, schema.decodeStageStyle]
          : [
              (value: unknown) => decodeVocalStyle(value, 'vocal'),
              (value: unknown) => schema.decodeVocalStyle(value, 'vocal'),
            ]
      decoders.forEach((decode) => {
        const first = decode(input)
        const second = decode(input)
        expect(first).toStrictEqual(input)
        expect(second).toStrictEqual(first)
        expectNoAliases(input, first)
        expectNoAliases(input, second)
        expectNoAliases(first, second)
      })
    })
  })

  it('requires exact own keys at every StageStyle and VocalStyle nesting level', () => {
    for (const shape of EXACT_KEY_SHAPES) {
      for (const mutation of ['missing', 'extra', 'inherited'] as const) {
        const input = shape.kind === 'stage' ? cloneStageStyle() : cloneVocalStyle()
        const mutated = exactKeyMutation(input, shape.path, shape.key, mutation)
        expectParity(shape.kind, mutated, false)
      }
    }
  })

  it('accepts only the literal font-size catalog for every text role and vocal override', () => {
    EXPECTED_FONT_SIZES.forEach((size) => {
      const stage = cloneStageStyle()
      stage.lyrics.sizePx = size
      const vocal = cloneVocalStyle()
      vocal.sizePx = size
      expectParity('stage', stage, true)
      expectParity('vocal', vocal, true)
    })
    STAGE_SIZE_PATHS.forEach((path, index) => {
      const valid = cloneStageStyle()
      setAt(valid, path, EXPECTED_FONT_SIZES[index])
      expectParity('stage', valid, true)
      const invalid = cloneStageStyle()
      setAt(invalid, path, 15)
      expectParity('stage', invalid, false)
    })
    for (const invalid of [7, 15, 401, 82.5, '82', Number.NaN, Number.POSITIVE_INFINITY]) {
      const vocal = cloneVocalStyle() as unknown as JsonObject
      vocal.sizePx = invalid
      expectParity('vocal', vocal, false)
    }
  })

  it('enforces canonical generic catalogs and bounded local face identities', () => {
    for (const canonical of [EXPECTED_SYSTEM_UI, EXPECTED_SYSTEM_MONOSPACE]) {
      const stage = cloneStageStyle()
      stage.lyrics.typeface = jsonClone(canonical)
      stage.lyrics.fontStyle = { ...canonical.faces[0] }
      expectParity('stage', stage, true)
    }
    const spoofMutations = [
      (font: FontTypefaceDescriptor) => {
        font.family += ' Spoof'
      },
      (font: FontTypefaceDescriptor) => {
        font.faces.reverse()
      },
      (font: FontTypefaceDescriptor) => {
        font.faces[0].weight = 500
      },
      (font: FontTypefaceDescriptor) => {
        ;(font.faces[0] as FontFaceDescriptor & { future?: boolean }).future = true
      },
    ]
    spoofMutations.forEach((mutate) => {
      const stage = cloneStageStyle()
      stage.lyrics.typeface = jsonClone(EXPECTED_SYSTEM_UI)
      mutate(stage.lyrics.typeface)
      expectParity('stage', stage, false)
    })
    for (const count of [1, 100]) expectParity('stage', localStage(count), true)
    const boundary = localStage(3)
    const names = ['A', 'Quoted"\\:Face', 'Z'.repeat(63)]
    boundary.lyrics.typeface.faces.forEach((face, index) => {
      face.postscriptName = names[index]
      face.weight = index === 0 ? 100 : index === 1 ? 900 : 400
      face.slant = (['normal', 'italic', 'oblique'] as const)[index]
    })
    boundary.lyrics.fontStyle = { ...boundary.lyrics.typeface.faces[1] }
    expectParity('stage', boundary, true)

    const invalidNames = [
      '',
      'A'.repeat(64),
      'has space',
      'Nul\0Name',
      `Delete${String.fromCharCode(0x7f)}`,
      'NonASCIIÅ',
      ...[...'[](){}<>/%'].map((delimiter) => `A${delimiter}B`),
    ]
    invalidNames.forEach((postscriptName) => {
      const stage = localStage(1)
      stage.lyrics.typeface.faces[0].postscriptName = postscriptName
      expectParity('stage', stage, false)
    })
    for (const invalid of [99, 901, 400.5, '400', Number.NaN]) {
      const stage = localStage(1)
      stage.lyrics.typeface.faces[0].weight = invalid as number
      expectParity('stage', stage, false)
    }
    for (const slant of ['', 'bold', 'Normal']) {
      const stage = localStage(1)
      stage.lyrics.typeface.faces[0].slant = slant as FontFaceDescriptor['slant']
      expectParity('stage', stage, false)
    }
    const invalidCatalogs = [localStage(0), localStage(101), localStage(2), localStage(1)]
    invalidCatalogs[2].lyrics.typeface.faces[1].postscriptName = 'ParitySans-0'
    invalidCatalogs[3].lyrics.typeface.faces[0].postscriptName = null
    invalidCatalogs.forEach((stage) => expectParity('stage', stage, false))
    const sparseLocal = localStage(1)
    sparseLocal.lyrics.typeface.faces = new Array(1)
    const sparseSystem = cloneStageStyle()
    delete sparseSystem.lyrics.typeface.faces[0]
    expectParity('stage', sparseLocal, false)
    expectParity('stage', sparseSystem, false)
  })

  it('preserves color case and rejects invalid colors, visibility, frame, and object types', () => {
    const colors = [
      ['background', 'solidColor'],
      ['background', 'gradientStartColor'],
      ['background', 'gradientEndColor'],
      ['lyrics', 'unsungColor'],
      ['lyrics', 'sungColor'],
      ['titleCard', 'eyebrow', 'color'],
      ['titleCard', 'title', 'color'],
      ['titleCard', 'artist', 'color'],
      ['stageFrame', 'lineColor'],
      ['stageFrame', 'brand', 'color'],
      ['stageFrame', 'clock', 'color'],
      ['stageFrame', 'footer', 'color'],
    ] as const
    const stage = cloneStageStyle()
    colors.forEach((path, index) => setAt(stage, path, index % 2 ? '#aBcDeF' : '#12aBcD'))
    expectParity('stage', stage, true)
    for (const invalidColor of ['abcdef', '#abcde', '#abcdef0', '#gggggg', 7, null]) {
      const invalid = cloneStageStyle()
      setAt(invalid, colors[0], invalidColor)
      expectParity('stage', invalid, false)
    }
    for (const width of [0, 32]) {
      const valid = cloneStageStyle()
      valid.stageFrame.lineWidthPx = width
      valid.stageFrame.enabled = width === 0
      valid.titleCard.title.visible = width !== 0
      expectParity('stage', valid, true)
    }
    for (const width of [-1, 33, 1.5, '2', Number.NaN]) {
      const invalid = cloneStageStyle() as unknown as JsonObject
      ;(invalid.stageFrame as JsonObject).lineWidthPx = width
      expectParity('stage', invalid, false)
    }
    const badBooleans = [
      ['stageFrame', 'enabled'],
      ['titleCard', 'title', 'visible'],
      ['stageFrame', 'brand', 'visible'],
    ] as const
    badBooleans.forEach((path) => {
      const invalid = cloneStageStyle()
      setAt(invalid, path, 'yes')
      expectParity('stage', invalid, false)
    })
    for (const path of [
      ['background'],
      ['lyrics'],
      ['titleCard'],
      ['titleCard', 'title'],
      ['stageFrame'],
      ['stageFrame', 'brand'],
      ['lyrics', 'typeface'],
      ['lyrics', 'typeface', 'faces', 0],
    ] as const) {
      const invalid = cloneStageStyle()
      replaceAt(invalid, path, null)
      expectParity('stage', invalid, false)
    }
    for (const root of [null, [], 'stage', 4]) expectParity('stage', root, false)
  })

  it('accepts only NUL-free cross-platform absolute image paths up to 8192 characters', () => {
    const validPaths = [
      '/golden/stage.png',
      'C:\\golden\\stage.png',
      '\\\\server\\share\\stage.png',
      `/${'a'.repeat(8_191)}`,
    ]
    validPaths.forEach((imagePath) => {
      const stage = cloneStageStyle()
      stage.background.mode = 'image'
      stage.background.imagePath = imagePath
      expect(imagePath).toHaveLength(imagePath === validPaths[3] ? 8_192 : imagePath.length)
      expectParity('stage', stage, true)
    })
    const noImage = cloneStageStyle()
    noImage.background.imagePath = null
    expectParity('stage', noImage, true)
    for (const imagePath of [
      '',
      'relative.png',
      'C:relative.png',
      'K:/spoof.png',
      'ſ:/spoof.png',
      '/golden/bad\0.png',
      `/${'a'.repeat(8_192)}`,
    ]) {
      const stage = cloneStageStyle()
      stage.background.imagePath = imagePath
      expectParity('stage', stage, false)
    }
    const missing = cloneStageStyle()
    missing.background.mode = 'image'
    expectParity('stage', missing, false)
  })

  it('validates independent nullable vocal overrides, alignment, and sync timing bounds', () => {
    expectParity('vocal', cloneVocalStyle(), true)
    const populated = localVocal()
    for (const alignment of ['left', 'center', 'right'] as const) {
      populated.alignment = alignment
      expectParity('vocal', populated, true)
    }
    for (const key of ['typeface', 'fontStyle', 'sizePx', 'unsungColor', 'sungColor'] as const) {
      const inherited = localVocal()
      inherited[key] = null
      expectParity('vocal', inherited, true)
    }
    for (const [previewMs, minLeadMs, maxLeadMs] of [
      [0, 0, 0],
      [60_000, 0, 60_000],
      [60_000, 60_000, 60_000],
    ]) {
      const vocal = cloneVocalStyle()
      vocal.previewMs = previewMs
      vocal.syncAid.minLeadMs = minLeadMs
      vocal.syncAid.maxLeadMs = maxLeadMs
      expectParity('vocal', vocal, true)
    }
    const invalidTimings = [
      [-1, 0, 0],
      [60_001, 0, 0],
      [100, -1, 0],
      [100, 0, -1],
      [100, 51, 50],
      [100, 0, 101],
      [100.5, 0, 0],
      [100, 0.5, 1],
      [100, 0, 1.5],
    ]
    invalidTimings.forEach(([previewMs, minLeadMs, maxLeadMs]) => {
      const vocal = cloneVocalStyle()
      vocal.previewMs = previewMs
      vocal.syncAid.minLeadMs = minLeadMs
      vocal.syncAid.maxLeadMs = maxLeadMs
      expectParity('vocal', vocal, false)
    })
    const invalidFields: Array<[readonly PathPart[], unknown]> = [
      [['typeface'], 'local'],
      [['fontStyle'], {}],
      [['unsungColor'], 'orange'],
      [['sungColor'], 7],
      [['alignment'], 'middle'],
      [['syncAid', 'enabled'], 1],
      [['syncAid'], null],
    ]
    invalidFields.forEach(([path, value]) => {
      const vocal = localVocal()
      replaceAt(vocal, path, value)
      expectParity('vocal', vocal, false)
    })
    for (const root of [null, [], 'vocal', 4]) expectParity('vocal', root, false)
  })
})
