import { describe, expect, it } from 'vitest'
import { normalizeInstalledFontCatalog } from '../src/lib/installed-font-catalog'
import { MAX_FONT_FACES_PER_TYPEFACE } from '../src/lib/font-identity'
import { validTypefaceDescriptor } from '../src/lib/video-style-codec'

const fonts = [
  {
    family: 'Avenir Next',
    fullName: 'Avenir Next Bold',
    postscriptName: 'AvenirNext-Bold',
    style: 'Bold',
    path: '/private/font-file.ttf',
    blob: () => 'private bytes',
  },
  {
    family: 'Avenir Next',
    fullName: 'Avenir Next Italic',
    postscriptName: 'AvenirNext-Italic',
    style: 'Italic',
  },
  {
    family: 'Berkeley Mono',
    fullName: 'Berkeley Mono Regular',
    postscriptName: 'BerkeleyMono-Regular',
    style: 'Regular',
  },
]

describe('installed font catalog normalization', () => {
  it('groups real faces deterministically without retaining private extras', () => {
    const forward = normalizeInstalledFontCatalog(fonts)
    const reverse = normalizeInstalledFontCatalog([...fonts].reverse())

    expect(reverse).toEqual(forward)
    expect(forward).toEqual([
      {
        kind: 'local',
        family: 'Avenir Next',
        faces: [
          {
            fullName: 'Avenir Next Bold',
            style: 'Bold',
            postscriptName: 'AvenirNext-Bold',
            weight: 700,
            slant: 'normal',
          },
          {
            fullName: 'Avenir Next Italic',
            style: 'Italic',
            postscriptName: 'AvenirNext-Italic',
            weight: 400,
            slant: 'italic',
          },
        ],
      },
      {
        kind: 'local',
        family: 'Berkeley Mono',
        faces: [
          {
            fullName: 'Berkeley Mono Regular',
            style: 'Regular',
            postscriptName: 'BerkeleyMono-Regular',
            weight: 400,
            slant: 'normal',
          },
        ],
      },
    ])
    expect(JSON.stringify(forward)).not.toContain('/private/')
    expect(JSON.stringify(forward)).not.toContain('private bytes')
  })

  it('rejects malformed and guessed identities and deduplicates PostScript names', () => {
    const catalog = normalizeInstalledFontCatalog([
      ...fonts,
      fonts[0],
      { ...fonts[0], family: 'Z Duplicate' },
      { ...fonts[0], postscriptName: 'invalid name' },
      { ...fonts[0], postscriptName: null },
      { ...fonts[0], family: '' },
      { ...fonts[0], fullName: 'x'.repeat(301) },
      { ...fonts[0], style: 'x'.repeat(121) },
      null,
      [],
    ])
    const faces = catalog.flatMap((typeface) => typeface.faces)

    expect(faces.filter((face) => face.postscriptName === 'AvenirNext-Bold')).toHaveLength(1)
    expect(
      faces.every((face) => fonts.some((font) => font.postscriptName === face.postscriptName)),
    ).toBe(true)
    expect(catalog.every((typeface) => typeface.kind === 'local')).toBe(true)
    expect(catalog.every(validTypefaceDescriptor)).toBe(true)
  })

  it('normalizes a large mixed-order catalog into ordinal family order', () => {
    const input = Array.from({ length: 1_000 }, (_, index) => ({
      family: `Family ${String(999 - index).padStart(4, '0')}`,
      fullName: `Face ${index}`,
      postscriptName: `Face-${index}`,
      style: index % 2 ? 'Semi Bold Italic' : 'Regular',
    }))
    const catalog = normalizeInstalledFontCatalog(input)

    expect(catalog).toHaveLength(1_000)
    expect(catalog[0].family).toBe('Family 0000')
    expect(catalog.at(-1)?.family).toBe('Family 0999')
    expect(normalizeInstalledFontCatalog([...input].reverse())).toEqual(catalog)
    expect(catalog.every(validTypefaceDescriptor)).toBe(true)
  })

  it('caps large families at the shared persistence limit', () => {
    const family = Array.from({ length: MAX_FONT_FACES_PER_TYPEFACE + 1 }, (_, index) => ({
      family: 'Variable Family',
      fullName: `Variable Family Face ${String(index).padStart(3, '0')}`,
      postscriptName: `VariableFamily-${String(index).padStart(3, '0')}`,
      style: `Style ${String(index).padStart(3, '0')}`,
    }))
    const atLimit = normalizeInstalledFontCatalog(family.slice(0, MAX_FONT_FACES_PER_TYPEFACE))
    const overLimit = normalizeInstalledFontCatalog(family)

    expect(atLimit[0].faces).toHaveLength(MAX_FONT_FACES_PER_TYPEFACE)
    expect(overLimit[0].faces).toHaveLength(MAX_FONT_FACES_PER_TYPEFACE)
    expect(overLimit).toEqual(atLimit)
    expect(normalizeInstalledFontCatalog([...family].reverse())).toEqual(overLimit)
    expect(overLimit.every(validTypefaceDescriptor)).toBe(true)
  })
})
