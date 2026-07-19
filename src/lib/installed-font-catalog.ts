import {
  MAX_FONT_FACES_PER_TYPEFACE,
  fontSlantFromStyle,
  fontWeightFromStyle,
  isValidPostScriptName,
} from './font-identity'
import type { FontFaceDescriptor, FontTypefaceDescriptor } from './video-style'

const MAX_FAMILY_LENGTH = 300
const MAX_FULL_NAME_LENGTH = 300
const MAX_STYLE_LENGTH = 120

function compareOrdinal(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedName(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

interface NormalizedFace {
  family: string
  face: FontFaceDescriptor
}

function normalizeFace(value: unknown): NormalizedFace | null {
  const source = record(value)
  if (!source) return null
  const family = boundedName(source.family, MAX_FAMILY_LENGTH)
  const fullName = boundedName(source.fullName, MAX_FULL_NAME_LENGTH)
  const style = boundedName(source.style, MAX_STYLE_LENGTH)
  const postscriptName = source.postscriptName
  if (!family || !fullName || !style || !isValidPostScriptName(postscriptName)) return null
  return {
    family,
    face: {
      fullName,
      style,
      postscriptName,
      weight: fontWeightFromStyle(style),
      slant: fontSlantFromStyle(style),
    },
  }
}

function compareNormalizedFaces(left: NormalizedFace, right: NormalizedFace) {
  return (
    compareOrdinal(left.family, right.family) ||
    compareOrdinal(left.face.style, right.face.style) ||
    compareOrdinal(left.face.fullName, right.face.fullName) ||
    compareOrdinal(left.face.postscriptName ?? '', right.face.postscriptName ?? '')
  )
}

/** Converts browser font metadata into deterministic local descriptors; never font bytes or paths. */
export function normalizeInstalledFontCatalog(
  values: readonly unknown[],
): FontTypefaceDescriptor[] {
  const normalized = values
    .flatMap((value) => {
      const face = normalizeFace(value)
      return face ? [face] : []
    })
    .sort(compareNormalizedFaces)
  const seenPostScriptNames = new Set<string>()
  const families = new Map<string, FontFaceDescriptor[]>()

  normalized.forEach(({ family, face }) => {
    const postscriptName = face.postscriptName as string
    if (seenPostScriptNames.has(postscriptName)) return
    const faces = families.get(family) ?? []
    if (faces.length >= MAX_FONT_FACES_PER_TYPEFACE) return
    seenPostScriptNames.add(postscriptName)
    faces.push(face)
    families.set(family, faces)
  })

  return [...families].map(([family, faces]) => ({
    kind: 'local',
    family,
    faces,
  }))
}
