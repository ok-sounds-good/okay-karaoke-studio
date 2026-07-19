export type FontIdentitySlant = 'normal' | 'italic' | 'oblique'

export const MAX_FONT_FACES_PER_TYPEFACE = 100

export interface FontFaceIdentity {
  readonly fullName: string
  readonly style: string
  readonly postscriptName: string | null
  readonly weight: number
  readonly slant: FontIdentitySlant
}

export interface FontTypefaceIdentity {
  readonly kind: 'system-ui' | 'system-monospace' | 'local'
  readonly family: string
  readonly faces: readonly FontFaceIdentity[]
}

export const SYSTEM_UI_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const SYSTEM_MONOSPACE_FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const FORBIDDEN_POSTSCRIPT_CHARACTERS = new Set('[](){}<>/%')
const SAFE_FONT_ALIAS = /^[A-Za-z0-9]+$/u

/** The exact Local Font Access PostScript-name grammar. */
export function isValidPostScriptName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 63) return false
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x21 || codePoint > 0x7e || FORBIDDEN_POSTSCRIPT_CHARACTERS.has(character))
      return false
  }
  return true
}

export function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function localFontSource(postscriptName: string): string {
  if (!isValidPostScriptName(postscriptName)) {
    throw new TypeError('PostScript name is not valid for local font access.')
  }
  return `local("${escapeCssString(postscriptName)}")`
}

export interface FontAliasBatch {
  readonly aliasFor: (postscriptName: string) => string
}

/** Allocates opaque aliases; no user- or font-controlled text enters a CSS family name. */
export function createFontAliasBatch(): FontAliasBatch {
  const aliases = new Map<string, string>()
  let sequence = 0
  return {
    aliasFor(postscriptName) {
      if (!isValidPostScriptName(postscriptName)) {
        throw new TypeError('Cannot alias an invalid PostScript name.')
      }
      const existing = aliases.get(postscriptName)
      if (existing) return existing
      const alias = `OKSLocalFont${sequence.toString(36)}`
      sequence += 1
      aliases.set(postscriptName, alias)
      return alias
    },
  }
}

export function fontWeightFromStyle(style: string): number {
  const normalized = style.toLowerCase().replace(/[\s_-]+/gu, '')
  if (normalized.includes('thin')) return 100
  if (normalized.includes('extralight') || normalized.includes('ultralight')) return 200
  if (normalized.includes('light')) return 300
  if (normalized.includes('medium')) return 500
  if (normalized.includes('semibold') || normalized.includes('demibold')) return 600
  if (normalized.includes('extrabold') || normalized.includes('ultrabold')) return 800
  if (normalized.includes('black') || normalized.includes('heavy')) return 900
  if (normalized.includes('bold')) return 700
  return 400
}

export function fontSlantFromStyle(style: string): FontIdentitySlant {
  const normalized = style.toLowerCase()
  if (normalized.includes('italic')) return 'italic'
  if (normalized.includes('oblique')) return 'oblique'
  return 'normal'
}

export function fontStyleFromDescriptor(font: FontFaceIdentity): FontIdentitySlant {
  return font.slant
}

export function deterministicFontFamily(typeface: FontTypefaceIdentity, alias?: string): string {
  if (typeface.kind === 'system-monospace') return SYSTEM_MONOSPACE_FONT_STACK
  if (typeface.kind === 'system-ui') return SYSTEM_UI_FONT_STACK
  return alias && SAFE_FONT_ALIAS.test(alias)
    ? `"${alias}", ${SYSTEM_UI_FONT_STACK}`
    : SYSTEM_UI_FONT_STACK
}

function faceIdentityTuple(face: FontFaceIdentity) {
  return [face.postscriptName, face.fullName, face.style, face.weight, face.slant] as const
}

export function fontFaceKey(face: FontFaceIdentity): string {
  return JSON.stringify(faceIdentityTuple(face))
}

export function fontTypefaceKey(typeface: FontTypefaceIdentity): string {
  const faces = typeface.faces.map(faceIdentityTuple).sort((left, right) => {
    const leftKey = JSON.stringify(left)
    const rightKey = JSON.stringify(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  return JSON.stringify([typeface.kind, typeface.family, faces])
}
