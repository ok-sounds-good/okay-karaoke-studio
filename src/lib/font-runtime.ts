import { createFontAliasBatch, deterministicFontFamily, localFontSource } from './font-identity'
import {
  resolveFontFace,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
} from './video-style'
const aliases = createFontAliasBatch()
const loadedFonts = new Map<string, Promise<string | null>>()
export async function loadLocalFont(
  typeface: FontTypefaceDescriptor,
  requestedStyle: FontFaceDescriptor,
  retry = false,
): Promise<string | null> {
  const face = resolveFontFace(typeface, requestedStyle)
  if (typeface.kind !== 'local' || !face.postscriptName || typeof FontFace === 'undefined') {
    return null
  }
  const key = face.postscriptName
  if (retry) loadedFonts.delete(key)
  const cached = loadedFonts.get(key)
  if (cached) return cached
  const pending = (async () => {
    try {
      const alias = aliases.aliasFor(key)
      const loaded = await new FontFace(alias, localFontSource(key), {
        display: 'block',
        style: face.slant,
        weight: String(face.weight),
      }).load()
      document.fonts.add(loaded)
      return alias
    } catch {
      return null
    }
  })()
  loadedFonts.set(key, pending)
  void pending.then((alias) => {
    if (!alias && loadedFonts.get(key) === pending) loadedFonts.delete(key)
  })
  return pending
}
export function fontFamilyFor(typeface: FontTypefaceDescriptor, alias: string | null): string {
  return deterministicFontFamily(typeface, alias ?? undefined)
}
