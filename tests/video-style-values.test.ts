import { describe, expect, it } from 'vitest'
import {
  decodeFontFace,
  decodeStageStyle,
  decodeTypeface,
  decodeVocalStyle,
  validFontFaceDescriptor,
  validTypefaceDescriptor,
  videoStyleValidationErrors,
} from '../src/lib/video-style-codec'
import {
  DEFAULT_STAGE_STYLE,
  DEFAULT_VOCAL_STYLE,
  FONT_SIZE_OPTIONS,
  SYSTEM_MONOSPACE_TYPEFACE,
  SYSTEM_UI_TYPEFACE,
  backgroundReadiness,
  cloneStageStyle,
  cloneVocalStyle,
  createFontAliasBatch,
  deterministicFontFamily,
  fontFaceKey,
  fontSlantFromStyle,
  fontStyleFromDescriptor,
  fontTypefaceKey,
  fontWeightFromStyle,
  genericFontFace,
  isFontSizePx,
  isHexColor,
  isValidPostScriptName,
  isValidSyncAid,
  localFontSource,
  normalizeStyleInteger,
  resolveFontFace,
  resolveVocalStyle,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
  type StageStyle,
  type VocalStyle,
} from '../src/lib/video-style'
const EXPECTED_SIZES = [
  8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 25, 27, 28, 32, 36, 40, 42, 48, 56, 64, 72, 82, 96, 104,
  120, 144, 180, 240, 320, 400,
] as const

const LOCAL_TYPEFACE: FontTypefaceDescriptor = {
  kind: 'local',
  family: 'Demo Sans',
  faces: [
    {
      fullName: 'Demo Sans Regular',
      style: 'Regular',
      postscriptName: 'DemoSans-Regular',
      weight: 400,
      slant: 'normal',
    },
    {
      fullName: 'Demo Sans Bold',
      style: 'Bold',
      postscriptName: 'DemoSans-Bold',
      weight: 700,
      slant: 'normal',
    },
  ],
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

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function setStageSize(stage: StageStyle, path: readonly string[], value: unknown): void {
  let target = stage as unknown as Record<string, unknown>
  for (const part of path.slice(0, -1)) target = target[part] as Record<string, unknown>
  target[path.at(-1)!] = value
}

describe('video style value contracts', () => {
  it('publishes one frozen, ordered, unique font-size catalog used by defaults', () => {
    expect(FONT_SIZE_OPTIONS).toEqual(EXPECTED_SIZES)
    expect(Object.isFrozen(FONT_SIZE_OPTIONS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_STAGE_STYLE.titleCard.title.typeface.faces[0])).toBe(true)
    expect(Object.isFrozen(DEFAULT_VOCAL_STYLE.syncAid)).toBe(true)
    expect(new Set(FONT_SIZE_OPTIONS).size).toBe(FONT_SIZE_OPTIONS.length)
    expect(isFontSizePx(8)).toBe(true)
    expect(isFontSizePx(15)).toBe(false)
    for (const path of STAGE_SIZE_PATHS) {
      let value: unknown = DEFAULT_STAGE_STYLE
      for (const part of path) value = (value as Record<string, unknown>)[part]
      expect(isFontSizePx(value)).toBe(true)
    }
  })

  it('accepts only catalog sizes for every stage text role without rounding', () => {
    STAGE_SIZE_PATHS.forEach((path, index) => {
      const allowed = cloneStageStyle()
      setStageSize(allowed, path, FONT_SIZE_OPTIONS[index])
      expect(decodeStageStyle(allowed)).toEqual(allowed)
      const unlisted = cloneStageStyle()
      setStageSize(unlisted, path, 15)
      expect(() => decodeStageStyle(unlisted)).toThrow(/supported sizes/u)
    })
    const fractional = cloneStageStyle()
    setStageSize(fractional, STAGE_SIZE_PATHS[0], 82.4)
    expect(() => decodeStageStyle(fractional)).toThrow(/supported sizes/u)
  })

  it('allows a vocal size to inherit or use a catalog value, but nothing else', () => {
    expect(decodeVocalStyle(cloneVocalStyle(), 'vocal').sizePx).toBeNull()
    const listed = cloneVocalStyle()
    listed.sizePx = 400
    expect(decodeVocalStyle(listed, 'vocal').sizePx).toBe(400)
    for (const invalid of [15, 82.4]) {
      const vocal = cloneVocalStyle() as unknown as Record<string, unknown>
      vocal.sizePx = invalid
      expect(() => decodeVocalStyle(vocal, 'vocal')).toThrow(/supported font size/u)
    }
  })

  it('accepts only the exact canonical generic font catalogs', () => {
    expect(decodeTypeface(jsonClone(SYSTEM_UI_TYPEFACE), 'font')).toEqual(SYSTEM_UI_TYPEFACE)
    expect(decodeTypeface(jsonClone(SYSTEM_MONOSPACE_TYPEFACE), 'font')).toEqual(
      SYSTEM_MONOSPACE_TYPEFACE,
    )
    const renamed = jsonClone(SYSTEM_UI_TYPEFACE)
    renamed.family = 'System UI Spoof'
    const changedTrait = jsonClone(SYSTEM_UI_TYPEFACE)
    changedTrait.faces[0].weight = 500
    const reordered = jsonClone(SYSTEM_MONOSPACE_TYPEFACE)
    reordered.faces.reverse()
    const synthesized = jsonClone(SYSTEM_UI_TYPEFACE) as unknown as Record<string, unknown>
    ;(synthesized.faces as Array<Record<string, unknown>>)[0].synthesized = true
    for (const spoof of [renamed, changedTrait, reordered, synthesized]) {
      expect(() => decodeTypeface(spoof, 'font')).toThrow()
    }
  })

  it('bounds local catalogs and requires unique valid PostScript identities', () => {
    expect(decodeTypeface(jsonClone(LOCAL_TYPEFACE), 'font')).toEqual(LOCAL_TYPEFACE)
    const hundred = jsonClone(LOCAL_TYPEFACE)
    hundred.faces = Array.from({ length: 100 }, (_, index) => ({
      ...LOCAL_TYPEFACE.faces[0],
      fullName: `Demo Sans ${index}`,
      postscriptName: `DemoSans-${index}`,
    }))
    expect(decodeTypeface(hundred, 'font').faces).toHaveLength(100)
    const invalids = [
      jsonClone(LOCAL_TYPEFACE),
      jsonClone(LOCAL_TYPEFACE),
      jsonClone(LOCAL_TYPEFACE),
      jsonClone(LOCAL_TYPEFACE),
      jsonClone(LOCAL_TYPEFACE),
    ]
    invalids[0].faces = []
    invalids[1].faces = [...hundred.faces, LOCAL_TYPEFACE.faces[0]]
    invalids[2].faces[1].postscriptName = invalids[2].faces[0].postscriptName
    invalids[3].faces[0].postscriptName = null
    invalids[4].faces[0].postscriptName = 'bad name'
    invalids.forEach((typeface) => {
      expect(() => decodeTypeface(typeface, 'font')).toThrow()
    })
    const sparseLocal = jsonClone(LOCAL_TYPEFACE)
    sparseLocal.faces = new Array(1)
    const sparseSystem = jsonClone(SYSTEM_UI_TYPEFACE)
    delete sparseSystem.faces[0]
    expect(() => decodeTypeface(sparseLocal, 'font')).toThrow()
    expect(() => decodeTypeface(sparseSystem, 'font')).toThrow()
  })

  it('uses the exact PostScript grammar and opaque, collision-free CSS aliases', () => {
    const maximumName = 'A'.repeat(63)
    const escapedName = 'Demo"\\Face'
    expect(isValidPostScriptName(maximumName)).toBe(true)
    expect(isValidPostScriptName('A'.repeat(64))).toBe(false)
    expect(isValidPostScriptName(escapedName)).toBe(true)
    expect(localFontSource(escapedName)).toBe(String.raw`local("Demo\"\\Face")`)
    const face = LOCAL_TYPEFACE.faces[0]
    expect(validFontFaceDescriptor({ ...face, postscriptName: escapedName })).toBe(true)
    expect(validFontFaceDescriptor({ ...face, postscriptName: 'A'.repeat(64) })).toBe(false)
    const invalidNames = ['', 'has space', 'UnicodeÅ', 'Line\nBreak', `Delete\u007f`]
    for (const delimiter of '[](){}<>/%') invalidNames.push(`A${delimiter}B`)
    for (const invalid of invalidNames) {
      expect(isValidPostScriptName(invalid)).toBe(false)
      expect(() => localFontSource(invalid)).toThrow(/PostScript/u)
    }
    const aliases = createFontAliasBatch()
    const quoted = aliases.aliasFor('Demo"Face')
    const slashed = aliases.aliasFor('Demo\\Face')
    expect(aliases.aliasFor('Demo"Face')).toBe(quoted)
    expect(slashed).not.toBe(quoted)
    expect([quoted, slashed]).toEqual(['OKSLocalFont0', 'OKSLocalFont1'])
    const fallbackStack = deterministicFontFamily(LOCAL_TYPEFACE)
    expect(deterministicFontFamily(LOCAL_TYPEFACE, 'K')).toBe(fallbackStack)
    expect(deterministicFontFamily(LOCAL_TYPEFACE, 'ſ')).toBe(fallbackStack)
  })

  it('deep-clones mutable stage and vocal values', () => {
    const stage = cloneStageStyle()
    stage.background.solidColor = '#abcdef'
    stage.lyrics.typeface.faces[0].style = 'Changed'
    expect(DEFAULT_STAGE_STYLE.background.solidColor).not.toBe(stage.background.solidColor)
    expect(DEFAULT_STAGE_STYLE.lyrics.typeface.faces[0].style).toBe('Regular')
    const vocal = cloneVocalStyle({
      ...DEFAULT_VOCAL_STYLE,
      typeface: LOCAL_TYPEFACE,
      fontStyle: LOCAL_TYPEFACE.faces[0],
    })
    vocal.typeface!.faces[0].fullName = 'Changed'
    vocal.fontStyle!.style = 'Changed'
    expect(LOCAL_TYPEFACE.faces[0]).toMatchObject({
      fullName: 'Demo Sans Regular',
      style: 'Regular',
    })
  })

  it('inherits vocal fields independently and resolves font fallback deterministically', () => {
    const vocal = cloneVocalStyle()
    vocal.typeface = jsonClone(LOCAL_TYPEFACE)
    vocal.sizePx = 96
    vocal.sungColor = '#aBcDeF'
    const resolved = resolveVocalStyle(DEFAULT_STAGE_STYLE.lyrics, vocal)
    expect(resolved).toMatchObject({
      sizePx: 96,
      unsungColor: DEFAULT_STAGE_STYLE.lyrics.unsungColor,
      sungColor: '#aBcDeF',
    })
    expect(resolved.fontStyle.postscriptName).toBe('DemoSans-Bold')
    const tied: FontTypefaceDescriptor = {
      ...LOCAL_TYPEFACE,
      faces: LOCAL_TYPEFACE.faces.map((face, index) => ({
        ...face,
        style: index ? 'Ångstrom' : 'Zulu',
        weight: 500,
      })),
    }
    const requested: FontFaceDescriptor = {
      fullName: 'Requested',
      style: 'Missing',
      postscriptName: null,
      weight: 400,
      slant: 'normal',
    }
    expect(resolveFontFace(tied, requested).style).toBe('Zulu')
    const equivalentFaces: FontFaceDescriptor[] = [
      {
        fullName: 'Twin Zulu',
        style: 'Regular',
        postscriptName: 'Twin-Zulu',
        weight: 400,
        slant: 'normal',
      },
      {
        fullName: 'Twin Alpha',
        style: 'Regular',
        postscriptName: 'Twin-Alpha',
        weight: 400,
        slant: 'normal',
      },
    ]
    const equivalentRequest = { ...requested, style: 'Regular' }
    const forward = { ...LOCAL_TYPEFACE, faces: equivalentFaces }
    const reverse = { ...LOCAL_TYPEFACE, faces: [...equivalentFaces].reverse() }
    expect(fontTypefaceKey(forward)).toBe(fontTypefaceKey(reverse))
    expect(resolveFontFace(forward, equivalentRequest).postscriptName).toBe('Twin-Alpha')
    expect(resolveFontFace(reverse, equivalentRequest).postscriptName).toBe('Twin-Alpha')
    expect(resolveFontFace(reverse, equivalentFaces[0]).postscriptName).toBe('Twin-Zulu')
    expect(JSON.parse(fontFaceKey(LOCAL_TYPEFACE.faces[0]))).toEqual([
      'DemoSans-Regular',
      'Demo Sans Regular',
      'Regular',
      400,
      'normal',
    ])
    expect(JSON.parse(fontFaceKey(genericFontFace(SYSTEM_UI_TYPEFACE, 'Regular')))[0]).toBeNull()
    const reversed = { ...LOCAL_TYPEFACE, faces: [...LOCAL_TYPEFACE.faces].reverse() }
    expect(fontTypefaceKey(reversed)).toBe(fontTypefaceKey(LOCAL_TYPEFACE))
    const baseFace = LOCAL_TYPEFACE.faces[0]
    const collidingOldKeys = [
      { ...LOCAL_TYPEFACE, family: 'A:B', faces: [{ ...baseFace, postscriptName: 'C|D' }] },
      { ...LOCAL_TYPEFACE, family: 'A', faces: [{ ...baseFace, postscriptName: 'B:C|D' }] },
    ]
    expect(fontTypefaceKey(collidingOldKeys[0])).not.toBe(fontTypefaceKey(collidingOldKeys[1]))
    expect(fontFaceKey({ ...LOCAL_TYPEFACE.faces[0], fullName: 'Another name' })).not.toBe(
      fontFaceKey(LOCAL_TYPEFACE.faces[0]),
    )
    expect(deterministicFontFamily(LOCAL_TYPEFACE, 'OKSLocalFont0')).toContain('"OKSLocalFont0"')
    expect(deterministicFontFamily(LOCAL_TYPEFACE, 'Demo "Alias"')).toBe(
      deterministicFontFamily(LOCAL_TYPEFACE),
    )
  })

  it('preserves valid color spelling and validates linked image readiness', () => {
    const stage = cloneStageStyle()
    stage.background.solidColor = '#aBcDeF'
    stage.lyrics.sungColor = '#Ab12eF'
    const decoded = decodeStageStyle(stage)
    expect(decoded.background.solidColor).toBe('#aBcDeF')
    expect(decoded.lyrics.sungColor).toBe('#Ab12eF')
    stage.stageFrame.lineColor = 'abcdef'
    expect(() => decodeStageStyle(stage)).toThrow(/six-digit hex color/u)
    const image = cloneStageStyle().background
    expect(backgroundReadiness(image, null, 'stale error')).toEqual({ ready: true, reason: null })
    image.mode = 'image'
    image.imagePath = null
    expect(backgroundReadiness(image, null).ready).toBe(false)
    image.imagePath = '/linked/background.png'
    expect(backgroundReadiness(image, null).reason).toMatch(/missing or unreadable/u)
    expect(backgroundReadiness(image, null, 'resolution failed').reason).toBe('resolution failed')
    expect(backgroundReadiness(image, 'app-image://linked').ready).toBe(true)
    const imageStage = cloneStageStyle()
    imageStage.background = image
    expect(decodeStageStyle(imageStage).background.imagePath).toBe('/linked/background.png')
    for (const validPath of [
      'C:\\linked\\background.png',
      '\\\\server\\share\\background.png',
      `/${'a'.repeat(8_191)}`,
    ]) {
      imageStage.background.imagePath = validPath
      expect(decodeStageStyle(imageStage).background.imagePath).toBe(validPath)
    }
    for (const invalidPath of [
      '',
      'relative.png',
      'K:/linked/background.png',
      'ſ:/linked/background.png',
      '/linked/bad\0.png',
      `/${'a'.repeat(8_192)}`,
    ]) {
      imageStage.background.imagePath = invalidPath
      expect(() => decodeStageStyle(imageStage)).toThrow(/absolute path|required|too long/u)
    }
  })

  it('enforces sync-aid boundaries and keeps integer normalization stable', () => {
    expect(decodeVocalStyle(cloneVocalStyle(), 'vocal').syncAid.maxLeadMs).toBe(3_000)
    for (const mutate of [
      (value: ReturnType<typeof cloneVocalStyle>) => {
        value.syncAid.minLeadMs = 3_001
      },
      (value: ReturnType<typeof cloneVocalStyle>) => {
        value.syncAid.maxLeadMs = 3_001
      },
      (value: ReturnType<typeof cloneVocalStyle>) => {
        value.previewMs = -1
      },
      (value: ReturnType<typeof cloneVocalStyle>) => {
        value.syncAid.minLeadMs = 0.5
      },
    ]) {
      const vocal = cloneVocalStyle()
      mutate(vocal)
      expect(() => decodeVocalStyle(vocal, 'vocal')).toThrow(/sync-aid timing|safe integer/u)
    }
    const invalidEnabled = cloneVocalStyle() as unknown as Record<string, unknown>
    ;(invalidEnabled.syncAid as Record<string, unknown>).enabled = 'yes'
    expect(isValidSyncAid(invalidEnabled as unknown as VocalStyle)).toBe(false)
    expect(() => decodeVocalStyle(invalidEnabled, 'vocal')).toThrow(/boolean/u)
    expect(normalizeStyleInteger('4.6', 0, 10)).toBe(5)
    expect(normalizeStyleInteger(-9, 0, 10)).toBe(0)
    expect(normalizeStyleInteger(99, 0, 10)).toBe(10)
    expect(normalizeStyleInteger('nope', 3, 10)).toBe(3)
  })

  it('keeps public descriptor, normalization, and aggregate validation contracts aligned', () => {
    const regular = genericFontFace(SYSTEM_UI_TYPEFACE, 'Regular')
    expect(validFontFaceDescriptor(regular)).toBe(true)
    expect(decodeFontFace(jsonClone(regular), 'face')).toEqual(regular)
    expect(validFontFaceDescriptor({ ...regular, extra: true })).toBe(false)
    expect(validTypefaceDescriptor(jsonClone(SYSTEM_UI_TYPEFACE))).toBe(true)
    expect(validTypefaceDescriptor({ ...LOCAL_TYPEFACE, extra: true })).toBe(false)
    expect(fontWeightFromStyle('Extra Light')).toBe(200)
    expect(fontWeightFromStyle('Semi Bold')).toBe(600)
    expect(fontWeightFromStyle('Black')).toBe(900)
    expect(fontSlantFromStyle('Bold Italic')).toBe('italic')
    expect(fontSlantFromStyle('Oblique')).toBe('oblique')
    expect(fontStyleFromDescriptor(regular)).toBe('normal')
    expect(isHexColor('#aBcDeF')).toBe(true)
    expect(isHexColor('aBcDeF')).toBe(false)
    expect(deterministicFontFamily(SYSTEM_UI_TYPEFACE)).toContain('system-ui')
    expect(deterministicFontFamily(SYSTEM_MONOSPACE_TYPEFACE)).toContain('ui-monospace')

    const invalidStage = cloneStageStyle() as unknown as Record<string, unknown>
    ;(invalidStage.stageFrame as Record<string, unknown>).lineColor = 'invalid'
    const invalidVocal = cloneVocalStyle()
    invalidVocal.previewMs = -1
    expect(
      videoStyleValidationErrors(invalidStage, [
        { path: 'project.tracks[0].vocalStyle', style: invalidVocal },
      ]),
    ).toEqual([
      expect.objectContaining({ code: 'stage-style-invalid', path: 'stageStyle' }),
      expect.objectContaining({
        code: 'vocal-style-invalid',
        path: 'project.tracks[0].vocalStyle',
      }),
    ])
  })
})
