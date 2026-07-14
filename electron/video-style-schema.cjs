'use strict'

// This contract is for JSON-shaped data; proxy/getter evaluation counts are not an API.
const FONT_SIZE_OPTIONS = Object.freeze([
  8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 25, 27, 28, 32, 36, 40, 42,
  48, 56, 64, 72, 82, 96, 104, 120, 144, 180, 240, 320, 400,
])
const FONT_SIZE_SET = new Set(FONT_SIZE_OPTIONS)
const FACE_KEYS = ['fullName', 'style', 'postscriptName', 'weight', 'slant']
const TYPEFACE_KEYS = ['kind', 'family', 'faces']
const FORBIDDEN_POSTSCRIPT_CHARACTERS = new Set('[](){}<>/%')

function genericFace(family, style, weight, slant = 'normal') {
  return {
    fullName: `${family} ${style}`,
    style,
    postscriptName: null,
    weight,
    slant,
  }
}

function genericFaces(family) {
  return [
    genericFace(family, 'Regular', 400),
    genericFace(family, 'Italic', 400, 'italic'),
    genericFace(family, 'Semi Bold', 600),
    genericFace(family, 'Bold', 700),
    genericFace(family, 'Extra Bold', 800),
  ]
}

const SYSTEM_UI_TYPEFACE = {
  kind: 'system-ui',
  family: 'System UI',
  faces: genericFaces('System UI'),
}
const SYSTEM_MONOSPACE_TYPEFACE = {
  kind: 'system-monospace',
  family: 'System Monospace',
  faces: genericFaces('System Monospace'),
}

function isAbsoluteLinkedPath(value) {
  if (value.includes('\0')) return false
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

function exactKeys(value, expected, path) {
  const allowed = new Set(expected)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported.`)
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (missing) throw new TypeError(`${path}.${missing} is required.`)
}

function record(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return value
}

function string(value, key, path) {
  if (typeof value[key] !== 'string') throw new TypeError(`${path}.${key} must be a string.`)
  return value[key]
}

function boolean(value, key, path) {
  if (typeof value[key] !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean.`)
  return value[key]
}

function integer(value, key, path) {
  if (!Number.isSafeInteger(value[key])) {
    throw new TypeError(`${path}.${key} must be a safe integer.`)
  }
  return value[key]
}

function boundedInteger(value, key, path, minimum, maximum) {
  const result = integer(value, key, path)
  if (result < minimum || result > maximum) {
    throw new RangeError(`${path}.${key} must be from ${minimum} to ${maximum}.`)
  }
  return result
}

function isFontSizePx(value) {
  return typeof value === 'number' && FONT_SIZE_SET.has(value)
}

function fontSize(value, key, path) {
  const result = value[key]
  if (!isFontSizePx(result)) {
    throw new RangeError(
      `${path}.${key} must be one of the supported sizes: ${FONT_SIZE_OPTIONS.join(', ')}.`,
    )
  }
  return result
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value)
}

function color(value, key, path) {
  const result = string(value, key, path)
  if (!isHexColor(result)) throw new TypeError(`${path}.${key} must be a six-digit hex color.`)
  return result
}

function isValidPostScriptName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 63) return false
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0
    if (
      codePoint < 0x21 ||
      codePoint > 0x7e ||
      FORBIDDEN_POSTSCRIPT_CHARACTERS.has(character)
    ) return false
  }
  return true
}

function validFontFaceDescriptor(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!hasExactKeys(value, FACE_KEYS)) return false
  return typeof value.fullName === 'string' && Boolean(value.fullName.trim()) &&
    value.fullName.length <= 300 &&
    typeof value.style === 'string' && Boolean(value.style.trim()) && value.style.length <= 120 &&
    (value.postscriptName === null || isValidPostScriptName(value.postscriptName)) &&
    Number.isSafeInteger(value.weight) && value.weight >= 100 && value.weight <= 900 &&
    ['normal', 'italic', 'oblique'].includes(String(value.slant))
}

function sameFace(left, right) {
  return left.fullName === right.fullName &&
    left.style === right.style &&
    left.postscriptName === right.postscriptName &&
    left.weight === right.weight &&
    left.slant === right.slant
}

function sameTypeface(candidate, canonical) {
  return candidate.kind === canonical.kind &&
    candidate.family === canonical.family &&
    candidate.faces.length === canonical.faces.length &&
    candidate.faces.every((face, index) => sameFace(face, canonical.faces[index]))
}

function validTypefaceDescriptor(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!hasExactKeys(value, TYPEFACE_KEYS)) return false
  if (!['system-ui', 'system-monospace', 'local'].includes(String(value.kind))) return false
  if (typeof value.family !== 'string' || !value.family.trim() || value.family.length > 300) {
    return false
  }
  if (!Array.isArray(value.faces) || value.faces.length < 1 || value.faces.length > 100) {
    return false
  }
  for (let index = 0; index < value.faces.length; index += 1) {
    if (!Object.hasOwn(value.faces, index)) return false
  }
  if (!value.faces.every(validFontFaceDescriptor)) return false
  if (value.kind === 'system-ui') return sameTypeface(value, SYSTEM_UI_TYPEFACE)
  if (value.kind === 'system-monospace') return sameTypeface(value, SYSTEM_MONOSPACE_TYPEFACE)
  const postscriptNames = value.faces.map((face) => face.postscriptName)
  return postscriptNames.every((name) => name !== null) &&
    new Set(postscriptNames).size === postscriptNames.length
}

function validTextStyle(value, withVisibility = false) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = withVisibility
    ? ['typeface', 'fontStyle', 'sizePx', 'color', 'visible']
    : ['typeface', 'fontStyle', 'sizePx', 'color']
  return hasExactKeys(value, keys) &&
    validTypefaceDescriptor(value.typeface) &&
    validFontFaceDescriptor(value.fontStyle) &&
    isFontSizePx(value.sizePx) &&
    isHexColor(value.color) &&
    (!withVisibility || typeof value.visible === 'boolean')
}

function decodeFontFace(value, path) {
  const source = record(value, path)
  exactKeys(source, FACE_KEYS, path)
  const face = {
    fullName: string(source, 'fullName', path),
    style: string(source, 'style', path),
    postscriptName: source.postscriptName,
    weight: integer(source, 'weight', path),
    slant: string(source, 'slant', path),
  }
  if (!validFontFaceDescriptor(face)) throw new TypeError(`${path} is not a valid font face.`)
  return face
}

function decodeTypeface(value, path) {
  const source = record(value, path)
  exactKeys(source, TYPEFACE_KEYS, path)
  const typeface = {
    kind: string(source, 'kind', path),
    family: string(source, 'family', path),
    faces: Array.isArray(source.faces)
      ? source.faces.map((face, index) => decodeFontFace(face, `${path}.faces[${index}]`))
      : source.faces,
  }
  if (!validTypefaceDescriptor(typeface)) {
    throw new TypeError(`${path} is not a valid typeface descriptor.`)
  }
  return typeface
}

function decodeTextStyle(value, path, withVisibility = false) {
  const source = record(value, path)
  exactKeys(
    source,
    withVisibility
      ? ['typeface', 'fontStyle', 'sizePx', 'color', 'visible']
      : ['typeface', 'fontStyle', 'sizePx', 'color'],
    path,
  )
  const decoded = {
    typeface: decodeTypeface(source.typeface, `${path}.typeface`),
    fontStyle: decodeFontFace(source.fontStyle, `${path}.fontStyle`),
    sizePx: fontSize(source, 'sizePx', path),
    color: color(source, 'color', path),
    ...(withVisibility ? { visible: boolean(source, 'visible', path) } : {}),
  }
  if (!validTextStyle(decoded, withVisibility)) {
    throw new TypeError(`${path} is not a valid text style.`)
  }
  return decoded
}

function decodeStageStyle(value) {
  const source = record(value, 'project.stageStyle')
  exactKeys(source, ['background', 'lyrics', 'titleCard', 'stageFrame'], 'project.stageStyle')
  const background = record(source.background, 'project.stageStyle.background')
  exactKeys(
    background,
    ['mode', 'solidColor', 'gradientStartColor', 'gradientEndColor', 'imagePath'],
    'project.stageStyle.background',
  )
  const mode = string(background, 'mode', 'project.stageStyle.background')
  if (mode !== 'solid' && mode !== 'gradient' && mode !== 'image') {
    throw new TypeError('project.stageStyle.background.mode must be solid, gradient, or image.')
  }
  if (background.imagePath !== null && typeof background.imagePath !== 'string') {
    throw new TypeError('project.stageStyle.background.imagePath must be a string or null.')
  }
  if (
    typeof background.imagePath === 'string' &&
    (!background.imagePath || !isAbsoluteLinkedPath(background.imagePath))
  ) {
    throw new TypeError('project.stageStyle.background.imagePath must be an absolute path or null.')
  }
  if (typeof background.imagePath === 'string' && background.imagePath.length > 8_192) {
    throw new RangeError('project.stageStyle.background.imagePath is too long.')
  }
  if (mode === 'image' && background.imagePath === null) {
    throw new TypeError('project.stageStyle.background.imagePath is required in image mode.')
  }

  const lyrics = record(source.lyrics, 'project.stageStyle.lyrics')
  const title = record(source.titleCard, 'project.stageStyle.titleCard')
  const frame = record(source.stageFrame, 'project.stageStyle.stageFrame')
  exactKeys(
    lyrics,
    ['typeface', 'fontStyle', 'sizePx', 'unsungColor', 'sungColor'],
    'project.stageStyle.lyrics',
  )
  exactKeys(title, ['eyebrow', 'title', 'artist'], 'project.stageStyle.titleCard')
  exactKeys(
    frame,
    ['enabled', 'lineColor', 'lineWidthPx', 'brand', 'clock', 'footer'],
    'project.stageStyle.stageFrame',
  )

  return {
    background: {
      mode,
      solidColor: color(background, 'solidColor', 'project.stageStyle.background'),
      gradientStartColor: color(background, 'gradientStartColor', 'project.stageStyle.background'),
      gradientEndColor: color(background, 'gradientEndColor', 'project.stageStyle.background'),
      imagePath: background.imagePath,
    },
    lyrics: {
      typeface: decodeTypeface(lyrics.typeface, 'project.stageStyle.lyrics.typeface'),
      fontStyle: decodeFontFace(lyrics.fontStyle, 'project.stageStyle.lyrics.fontStyle'),
      sizePx: fontSize(lyrics, 'sizePx', 'project.stageStyle.lyrics'),
      unsungColor: color(lyrics, 'unsungColor', 'project.stageStyle.lyrics'),
      sungColor: color(lyrics, 'sungColor', 'project.stageStyle.lyrics'),
    },
    titleCard: {
      eyebrow: decodeTextStyle(
        title.eyebrow,
        'project.stageStyle.titleCard.eyebrow',
        true,
      ),
      title: decodeTextStyle(title.title, 'project.stageStyle.titleCard.title', true),
      artist: decodeTextStyle(title.artist, 'project.stageStyle.titleCard.artist', true),
    },
    stageFrame: {
      enabled: boolean(frame, 'enabled', 'project.stageStyle.stageFrame'),
      lineColor: color(frame, 'lineColor', 'project.stageStyle.stageFrame'),
      lineWidthPx: boundedInteger(frame, 'lineWidthPx', 'project.stageStyle.stageFrame', 0, 32),
      brand: decodeTextStyle(frame.brand, 'project.stageStyle.stageFrame.brand', true),
      clock: decodeTextStyle(frame.clock, 'project.stageStyle.stageFrame.clock', true),
      footer: decodeTextStyle(frame.footer, 'project.stageStyle.stageFrame.footer', true),
    },
  }
}

function isValidSyncAid(style) {
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

function decodeVocalStyle(value, path) {
  const source = record(value, path)
  exactKeys(
    source,
    [
      'typeface',
      'fontStyle',
      'sizePx',
      'unsungColor',
      'sungColor',
      'alignment',
      'previewMs',
      'syncAid',
    ],
    path,
  )
  const nullableColor = (key) => {
    if (source[key] !== null && typeof source[key] !== 'string') {
      throw new TypeError(`${path}.${key} must be a string or null.`)
    }
    if (typeof source[key] === 'string' && !isHexColor(source[key])) {
      throw new TypeError(`${path}.${key} must be a six-digit hex color or null.`)
    }
    return source[key]
  }
  if (source.sizePx !== null && !isFontSizePx(source.sizePx)) {
    throw new RangeError(`${path}.sizePx must be a supported font size or null.`)
  }
  const alignment = string(source, 'alignment', path)
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') {
    throw new TypeError(`${path}.alignment must be left, center, or right.`)
  }
  const syncAid = record(source.syncAid, `${path}.syncAid`)
  exactKeys(syncAid, ['enabled', 'minLeadMs', 'maxLeadMs'], `${path}.syncAid`)
  const style = {
    typeface: source.typeface === null
      ? null
      : decodeTypeface(source.typeface, `${path}.typeface`),
    fontStyle: source.fontStyle === null
      ? null
      : decodeFontFace(source.fontStyle, `${path}.fontStyle`),
    sizePx: source.sizePx,
    unsungColor: nullableColor('unsungColor'),
    sungColor: nullableColor('sungColor'),
    alignment,
    previewMs: integer(source, 'previewMs', path),
    syncAid: {
      enabled: boolean(syncAid, 'enabled', `${path}.syncAid`),
      minLeadMs: integer(syncAid, 'minLeadMs', `${path}.syncAid`),
      maxLeadMs: integer(syncAid, 'maxLeadMs', `${path}.syncAid`),
    },
  }
  if (!isValidSyncAid(style)) throw new TypeError(`${path} has invalid sync-aid timing.`)
  return style
}

const normalizeStageStyle = decodeStageStyle
const normalizeVocalStyle = decodeVocalStyle

module.exports = {
  decodeStageStyle,
  decodeVocalStyle,
  normalizeStageStyle,
  normalizeVocalStyle,
}
