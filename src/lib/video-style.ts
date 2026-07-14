export const LOGICAL_STAGE_WIDTH = 1920
export const LOGICAL_STAGE_HEIGHT = 1080
export const DEFAULT_PREVIEW_MS = 3_000
export const DEFAULT_SYNC_AID_MIN_MS = 2_000
export const DEFAULT_SYNC_AID_MAX_MS = 3_000

export const FONT_SIZE_OPTIONS = Object.freeze([
  8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 25, 27, 28, 32, 36, 40, 42,
  48, 56, 64, 72, 82, 96, 104, 120, 144, 180, 240, 320, 400,
] as const)

export type FontSizePx = (typeof FONT_SIZE_OPTIONS)[number]
export type BackgroundMode = 'solid' | 'gradient' | 'image'
export type VocalAlignment = 'left' | 'center' | 'right'
export type SystemFontKind = 'system-ui' | 'system-monospace'
export type FontSlant = 'normal' | 'italic' | 'oblique'

export {
  createFontAliasBatch,
  deterministicFontFamily,
  escapeCssString,
  fontFaceKey,
  fontSlantFromStyle,
  fontStyleFromDescriptor,
  fontTypefaceKey,
  fontWeightFromStyle,
  isValidPostScriptName,
  localFontSource,
} from './font-identity'

const FONT_SIZE_SET = new Set<number>(FONT_SIZE_OPTIONS)

export function isFontSizePx(value: unknown): value is FontSizePx {
  return typeof value === 'number' && FONT_SIZE_SET.has(value)
}

/** A named face descriptor only. Font bytes are never persisted, copied, or embedded. */
export interface FontFaceDescriptor {
  fullName: string
  style: string
  postscriptName: string | null
  weight: number
  slant: FontSlant
}

/** A persisted family and its enumerated faces; it never contains font bytes. */
export interface FontTypefaceDescriptor {
  kind: SystemFontKind | 'local'
  family: string
  faces: FontFaceDescriptor[]
}

export interface FontSizeStyle {
  typeface: FontTypefaceDescriptor
  fontStyle: FontFaceDescriptor
  sizePx: FontSizePx
}

export interface TextStyle extends FontSizeStyle {
  color: string
}

export interface LyricTextStyle extends FontSizeStyle {
  unsungColor: string
  sungColor: string
}

export interface VisibleTextStyle extends TextStyle {
  visible: boolean
}

export interface BackgroundStyle {
  mode: BackgroundMode
  solidColor: string
  gradientStartColor: string
  gradientEndColor: string
  imagePath: string | null
}

export interface BackgroundReadiness {
  ready: boolean
  reason: string | null
}

export interface StageFrameStyle {
  enabled: boolean
  lineColor: string
  lineWidthPx: number
  brand: VisibleTextStyle
  clock: VisibleTextStyle
  footer: VisibleTextStyle
}

export interface StageStyle {
  background: BackgroundStyle
  lyrics: LyricTextStyle
  titleCard: {
    eyebrow: VisibleTextStyle
    title: VisibleTextStyle
    artist: VisibleTextStyle
  }
  stageFrame: StageFrameStyle
}

/** Null means the project lyric value is inherited independently for that field. */
export interface VocalStyle {
  typeface: FontTypefaceDescriptor | null
  fontStyle: FontFaceDescriptor | null
  sizePx: FontSizePx | null
  unsungColor: string | null
  sungColor: string | null
  alignment: VocalAlignment
  previewMs: number
  syncAid: {
    enabled: boolean
    minLeadMs: number
    maxLeadMs: number
  }
}

export interface ResolvedVocalStyle {
  typeface: FontTypefaceDescriptor
  fontStyle: FontFaceDescriptor
  sizePx: FontSizePx
  unsungColor: string
  sungColor: string
  alignment: VocalAlignment
  previewMs: number
  syncAid: VocalStyle['syncAid']
}

function genericFace(
  family: string,
  style: string,
  weight: number,
  slant: FontSlant = 'normal',
) {
  return Object.freeze({
    fullName: `${family} ${style}`,
    style,
    postscriptName: null,
    weight,
    slant,
  }) as FontFaceDescriptor
}

function genericFaces(family: string): FontFaceDescriptor[] {
  return [
    genericFace(family, 'Regular', 400),
    genericFace(family, 'Italic', 400, 'italic'),
    genericFace(family, 'Semi Bold', 600),
    genericFace(family, 'Bold', 700),
    genericFace(family, 'Extra Bold', 800),
  ]
}

export const SYSTEM_UI_TYPEFACE: FontTypefaceDescriptor = Object.freeze({
  kind: 'system-ui',
  family: 'System UI',
  faces: Object.freeze(genericFaces('System UI')),
}) as FontTypefaceDescriptor

export const SYSTEM_MONOSPACE_TYPEFACE: FontTypefaceDescriptor = Object.freeze({
  kind: 'system-monospace',
  family: 'System Monospace',
  faces: Object.freeze(genericFaces('System Monospace')),
}) as FontTypefaceDescriptor

export function genericFontFace(
  typeface: FontTypefaceDescriptor,
  style: string,
): FontFaceDescriptor {
  const face = typeface.faces.find((candidate) => candidate.style === style)
  if (!face) throw new Error(`${typeface.family} does not define ${style}`)
  return face
}

function textStyle(
  typeface: FontTypefaceDescriptor,
  style: string,
  sizePx: FontSizePx,
  color: string,
): TextStyle {
  return {
    typeface,
    fontStyle: genericFontFace(typeface, style),
    sizePx,
    color,
  }
}

/** Canonical saved media colors shared by defaults, Preview, persistence, and export. */
export const DEFAULT_STAGE_COLORS = Object.freeze({
  backgroundSolid: '#21182D',
  backgroundGradientStart: '#322242',
  backgroundGradientEnd: '#1E1629',
  lyricsUnsung: '#72687D',
  lyricsSung: '#FF8A2B',
  titleEyebrow: '#FFAD69',
  title: '#FBF9FD',
  titleArtist: '#B4ACBD',
  frameLine: '#473C54',
  frameBrand: '#C1BBC7',
  frameClock: '#BBB7C0',
  frameFooter: '#B2AEB8',
})

export const DEFAULT_STAGE_STYLE: StageStyle = Object.freeze({
  background: Object.freeze({
    mode: 'gradient',
    solidColor: DEFAULT_STAGE_COLORS.backgroundSolid,
    gradientStartColor: DEFAULT_STAGE_COLORS.backgroundGradientStart,
    gradientEndColor: DEFAULT_STAGE_COLORS.backgroundGradientEnd,
    imagePath: null,
  }),
  lyrics: Object.freeze({
    typeface: SYSTEM_UI_TYPEFACE,
    fontStyle: genericFontFace(SYSTEM_UI_TYPEFACE, 'Extra Bold'),
    sizePx: 82,
    unsungColor: DEFAULT_STAGE_COLORS.lyricsUnsung,
    sungColor: DEFAULT_STAGE_COLORS.lyricsSung,
  }),
  titleCard: Object.freeze({
    eyebrow: Object.freeze({
      ...textStyle(SYSTEM_UI_TYPEFACE, 'Extra Bold', 25, DEFAULT_STAGE_COLORS.titleEyebrow),
      visible: true,
    }),
    title: Object.freeze({
      ...textStyle(SYSTEM_UI_TYPEFACE, 'Extra Bold', 104, DEFAULT_STAGE_COLORS.title),
      visible: true,
    }),
    artist: Object.freeze({
      ...textStyle(SYSTEM_UI_TYPEFACE, 'Semi Bold', 42, DEFAULT_STAGE_COLORS.titleArtist),
      visible: true,
    }),
  }),
  stageFrame: Object.freeze({
    enabled: true,
    lineColor: DEFAULT_STAGE_COLORS.frameLine,
    lineWidthPx: 2,
    brand: Object.freeze({
      ...textStyle(SYSTEM_MONOSPACE_TYPEFACE, 'Bold', 25, DEFAULT_STAGE_COLORS.frameBrand),
      visible: true,
    }),
    clock: Object.freeze({
      ...textStyle(SYSTEM_MONOSPACE_TYPEFACE, 'Semi Bold', 27, DEFAULT_STAGE_COLORS.frameClock),
      visible: true,
    }),
    footer: Object.freeze({
      ...textStyle(SYSTEM_UI_TYPEFACE, 'Bold', 24, DEFAULT_STAGE_COLORS.frameFooter),
      visible: true,
    }),
  }),
}) as StageStyle

export const DEFAULT_VOCAL_STYLE: VocalStyle = Object.freeze({
  typeface: null,
  fontStyle: null,
  sizePx: null,
  unsungColor: null,
  sungColor: null,
  alignment: 'center',
  previewMs: DEFAULT_PREVIEW_MS,
  syncAid: Object.freeze({
    enabled: false,
    minLeadMs: DEFAULT_SYNC_AID_MIN_MS,
    maxLeadMs: DEFAULT_SYNC_AID_MAX_MS,
  }),
}) as VocalStyle

export function cloneFontFace(face: FontFaceDescriptor): FontFaceDescriptor {
  return { ...face }
}

export function cloneTypeface(typeface: FontTypefaceDescriptor): FontTypefaceDescriptor {
  return { ...typeface, faces: typeface.faces.map(cloneFontFace) }
}

function cloneFontSizeStyle<T extends FontSizeStyle>(style: T): T {
  return {
    ...style,
    typeface: cloneTypeface(style.typeface),
    fontStyle: cloneFontFace(style.fontStyle),
  }
}

export function cloneStageStyle(style: StageStyle = DEFAULT_STAGE_STYLE): StageStyle {
  return {
    background: { ...style.background },
    lyrics: cloneFontSizeStyle(style.lyrics),
    titleCard: {
      eyebrow: cloneFontSizeStyle(style.titleCard.eyebrow),
      title: cloneFontSizeStyle(style.titleCard.title),
      artist: cloneFontSizeStyle(style.titleCard.artist),
    },
    stageFrame: {
      ...style.stageFrame,
      brand: cloneFontSizeStyle(style.stageFrame.brand),
      clock: cloneFontSizeStyle(style.stageFrame.clock),
      footer: cloneFontSizeStyle(style.stageFrame.footer),
    },
  }
}

export function cloneVocalStyle(style: VocalStyle = DEFAULT_VOCAL_STYLE): VocalStyle {
  return {
    ...style,
    typeface: style.typeface ? cloneTypeface(style.typeface) : null,
    fontStyle: style.fontStyle ? cloneFontFace(style.fontStyle) : null,
    syncAid: { ...style.syncAid },
  }
}

export function resolveVocalStyle(
  projectLyrics: LyricTextStyle,
  vocal: VocalStyle,
): ResolvedVocalStyle {
  const typeface = cloneTypeface(vocal.typeface ?? projectLyrics.typeface)
  const requestedStyle = vocal.fontStyle ?? projectLyrics.fontStyle
  return {
    typeface,
    fontStyle: resolveFontFace(typeface, requestedStyle),
    sizePx: vocal.sizePx ?? projectLyrics.sizePx,
    unsungColor: vocal.unsungColor ?? projectLyrics.unsungColor,
    sungColor: vocal.sungColor ?? projectLyrics.sungColor,
    alignment: vocal.alignment,
    previewMs: vocal.previewMs,
    syncAid: { ...vocal.syncAid },
  }
}

export function resolveVocalSungColor(stage: StageStyle, vocal: VocalStyle): string {
  return vocal.sungColor ?? stage.lyrics.sungColor
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareFontFaces(left: FontFaceDescriptor, right: FontFaceDescriptor): number {
  return compareOrdinal(left.style, right.style) ||
    compareOrdinal(left.fullName, right.fullName) ||
    compareOrdinal(String(left.postscriptName), String(right.postscriptName))
}

export function resolveFontFace(
  typeface: FontTypefaceDescriptor,
  requested: FontFaceDescriptor,
): FontFaceDescriptor {
  const exactPostscript = requested.postscriptName
    ? typeface.faces.find((face) => face.postscriptName === requested.postscriptName)
    : null
  if (exactPostscript) return cloneFontFace(exactPostscript)
  const exactStyle = typeface.faces.filter((face) => (
    face.style.toLowerCase() === requested.style.toLowerCase() &&
    face.weight === requested.weight &&
    face.slant === requested.slant
  )).sort(compareFontFaces)[0]
  if (exactStyle) return cloneFontFace(exactStyle)
  const ranked = [...typeface.faces].sort((left, right) => {
    const score = (face: FontFaceDescriptor) => (
      Math.abs(face.weight - requested.weight) +
      (face.slant === requested.slant ? 0 : 1_000)
    )
    return score(left) - score(right) || compareFontFaces(left, right)
  })
  return cloneFontFace(ranked[0] ?? genericFontFace(SYSTEM_UI_TYPEFACE, 'Regular'))
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/iu.test(value)
}

export function backgroundReadiness(
  background: BackgroundStyle,
  resolvedUrl: string | null,
  resolutionError: string | null = null,
): BackgroundReadiness {
  if (background.mode !== 'image') return { ready: true, reason: null }
  if (!background.imagePath) {
    return { ready: false, reason: 'Choose a linked background image before exporting video.' }
  }
  if (resolutionError) return { ready: false, reason: resolutionError }
  if (!resolvedUrl) {
    return {
      ready: false,
      reason: `Linked background image is missing or unreadable: ${background.imagePath}`,
    }
  }
  return { ready: true, reason: null }
}

export function normalizeStyleInteger(
  value: string | number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return minimum
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)))
}

export function isValidSyncAid(style: VocalStyle): boolean {
  const { previewMs, syncAid } = style
  return typeof syncAid.enabled === 'boolean' &&
    Number.isSafeInteger(previewMs) &&
    Number.isSafeInteger(syncAid.minLeadMs) &&
    Number.isSafeInteger(syncAid.maxLeadMs) &&
    previewMs >= 0 &&
    syncAid.minLeadMs >= 0 &&
    syncAid.minLeadMs <= syncAid.maxLeadMs &&
    syncAid.maxLeadMs <= previewMs &&
    previewMs <= 60_000
}
