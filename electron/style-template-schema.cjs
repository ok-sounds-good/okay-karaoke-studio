'use strict'

const { decodeStageStyle, decodeVocalStyle } = require('./video-style-schema.cjs')
const VIDEO_EXPORT_PRESETS = require('./video-export-presets.json')

const STYLE_TEMPLATE_SCHEMA_VERSION = 0
const MAX_STYLE_TEMPLATES = 100
const VIDEO_RESOLUTIONS = new Set(VIDEO_EXPORT_PRESETS.resolutions.map(({ value }) => value))
const VIDEO_FRAME_RATES = new Set(VIDEO_EXPORT_PRESETS.frameRates)

function record(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return value
}

function exactKeys(value, expected, path) {
  const allowed = new Set(expected)
  for (const key in value) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} must be an own property.`)
  }
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported.`)
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (missing) throw new TypeError(`${path}.${missing} is required.`)
}

function string(value, key, path) {
  if (typeof value[key] !== 'string') throw new TypeError(`${path}.${key} must be a string.`)
  return value[key]
}

function denseArray(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`)
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${path} must not be sparse.`)
  }
  return value
}

function decodeId(value, path) {
  const id = string(value, 'id', path)
  if (!/^[\x21-\x7e]{1,128}$/u.test(id)) {
    throw new TypeError(`${path}.id must be 1 to 128 printable non-space ASCII characters.`)
  }
  return id
}

function canonicalizeStyleTemplateName(value, path = 'styleTemplate.name') {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string.`)
  const name = value.trim().replace(/\s+/gu, ' ')
  if (name.length < 1 || name.length > 80) {
    throw new RangeError(`${path} must be 1 to 80 characters after whitespace normalization.`)
  }
  return name
}

function decodeLyricDisplay(value, path) {
  const source = record(value, path)
  exactKeys(source, ['lineCount', 'advanceMode'], path)
  if (!Number.isSafeInteger(source.lineCount)) {
    throw new TypeError(`${path}.lineCount must be a safe integer.`)
  }
  if (source.lineCount < 1 || source.lineCount > 5) {
    throw new RangeError(`${path}.lineCount must be from 1 to 5.`)
  }
  const advanceMode = string(source, 'advanceMode', path)
  if (advanceMode !== 'clear' && advanceMode !== 'scroll') {
    throw new TypeError(`${path}.advanceMode must be clear or scroll.`)
  }
  return { lineCount: source.lineCount, advanceMode }
}

function decodeVideoExportDefaults(value, path) {
  const source = record(value, path)
  exactKeys(source, ['resolution', 'fps'], path)
  if (typeof source.resolution !== 'string' || !VIDEO_RESOLUTIONS.has(source.resolution)) {
    throw new RangeError(`${path}.resolution is not a supported preset.`)
  }
  if (!VIDEO_FRAME_RATES.has(source.fps)) throw new RangeError(`${path}.fps must be 30 or 60.`)
  return { resolution: source.resolution, fps: source.fps }
}

function decodePreferences(value, path) {
  const source = record(value, path)
  exactKeys(source, ['stageStyle', 'lyricDisplay', 'vocalStyle', 'videoExportDefaults'], path)
  return {
    stageStyle: decodeStageStyle(source.stageStyle),
    lyricDisplay: decodeLyricDisplay(source.lyricDisplay, `${path}.lyricDisplay`),
    vocalStyle: decodeVocalStyle(source.vocalStyle, `${path}.vocalStyle`),
    videoExportDefaults: decodeVideoExportDefaults(
      source.videoExportDefaults,
      `${path}.videoExportDefaults`,
    ),
  }
}

function decodeTemplate(value, path) {
  const source = record(value, path)
  exactKeys(source, ['id', 'name', 'preferences'], path)
  return {
    id: decodeId(source, path),
    name: canonicalizeStyleTemplateName(source.name, `${path}.name`),
    preferences: decodePreferences(source.preferences, `${path}.preferences`),
  }
}

function decodeStyleTemplateFile(value) {
  const source = record(value, 'styleTemplates')
  exactKeys(source, ['schemaVersion', 'templates'], 'styleTemplates')
  if (source.schemaVersion !== STYLE_TEMPLATE_SCHEMA_VERSION) {
    throw new Error('Unsupported style template format. Expected schemaVersion 0.')
  }
  const templates = denseArray(source.templates, 'styleTemplates.templates')
  if (templates.length > MAX_STYLE_TEMPLATES) {
    throw new RangeError(`Style template files are limited to ${MAX_STYLE_TEMPLATES} templates.`)
  }
  const decoded = templates.map((template, index) =>
    decodeTemplate(template, `styleTemplates.templates[${index}]`),
  )
  const ids = new Set()
  const names = new Set()
  for (const template of decoded) {
    if (ids.has(template.id)) throw new Error(`Duplicate style template id: ${template.id}`)
    if (names.has(template.name)) throw new Error(`Duplicate style template name: ${template.name}`)
    ids.add(template.id)
    names.add(template.name)
  }
  return { schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION, templates: decoded }
}

function parseStyleTemplateJson(json) {
  if (typeof json !== 'string') throw new TypeError('Style template JSON must be a string.')
  let value
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new SyntaxError(
      `Invalid style template JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return decodeStyleTemplateFile(value)
}

function serializeStyleTemplateFile(value) {
  return JSON.stringify(decodeStyleTemplateFile(value))
}

module.exports = {
  MAX_STYLE_TEMPLATES,
  STYLE_TEMPLATE_SCHEMA_VERSION,
  canonicalizeStyleTemplateName,
  decodeStyleTemplateFile,
  parseStyleTemplateJson,
  serializeStyleTemplateFile,
}
