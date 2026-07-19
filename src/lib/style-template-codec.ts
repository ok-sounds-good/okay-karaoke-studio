import { decodeStageStyle, decodeVocalStyle } from './video-style-codec'
import { isVideoFps, isVideoResolution, type VideoExportDefaults } from './video-export-settings'
import type { StageStyle, VocalStyle } from './video-style'

export const STYLE_TEMPLATE_SCHEMA_VERSION = 0
export const MAX_STYLE_TEMPLATES = 100

export interface StyleTemplatePreferences {
  stageStyle: StageStyle
  lyricDisplay: {
    lineCount: number
    advanceMode: 'clear' | 'scroll'
  }
  vocalStyle: VocalStyle
  videoExportDefaults: VideoExportDefaults
}

export interface StyleTemplate {
  id: string
  name: string
  preferences: StyleTemplatePreferences
}

export interface StyleTemplateFile {
  schemaVersion: 0
  templates: StyleTemplate[]
}

type RecordValue = Record<string, unknown>

function record(value: unknown, path: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return value as RecordValue
}

function exactKeys(value: RecordValue, expected: readonly string[], path: string): void {
  const allowed = new Set(expected)
  for (const key in value) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} must be an own property.`)
  }
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported.`)
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (missing) throw new TypeError(`${path}.${missing} is required.`)
}

function string(value: RecordValue, key: string, path: string): string {
  if (typeof value[key] !== 'string') throw new TypeError(`${path}.${key} must be a string.`)
  return value[key]
}

function denseArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`)
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`${path} must not be sparse.`)
  }
  return value
}

function decodeId(value: RecordValue, path: string): string {
  const id = string(value, 'id', path)
  if (!/^[\x21-\x7e]{1,128}$/u.test(id)) {
    throw new TypeError(`${path}.id must be 1 to 128 printable non-space ASCII characters.`)
  }
  return id
}

export function canonicalizeStyleTemplateName(value: unknown, path = 'styleTemplate.name'): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string.`)
  const name = value.trim().replace(/\s+/gu, ' ')
  if (name.length < 1 || name.length > 80) {
    throw new RangeError(`${path} must be 1 to 80 characters after whitespace normalization.`)
  }
  return name
}

function decodeLyricDisplay(
  value: unknown,
  path: string,
): StyleTemplatePreferences['lyricDisplay'] {
  const source = record(value, path)
  exactKeys(source, ['lineCount', 'advanceMode'], path)
  if (!Number.isSafeInteger(source.lineCount)) {
    throw new TypeError(`${path}.lineCount must be a safe integer.`)
  }
  if (Number(source.lineCount) < 1 || Number(source.lineCount) > 5) {
    throw new RangeError(`${path}.lineCount must be from 1 to 5.`)
  }
  const advanceMode = string(source, 'advanceMode', path)
  if (advanceMode !== 'clear' && advanceMode !== 'scroll') {
    throw new TypeError(`${path}.advanceMode must be clear or scroll.`)
  }
  return { lineCount: Number(source.lineCount), advanceMode }
}

function decodeVideoExportDefaults(value: unknown, path: string): VideoExportDefaults {
  const source = record(value, path)
  exactKeys(source, ['resolution', 'fps'], path)
  if (!isVideoResolution(source.resolution)) {
    throw new RangeError(`${path}.resolution is not a supported preset.`)
  }
  if (!isVideoFps(source.fps)) throw new RangeError(`${path}.fps must be 30 or 60.`)
  return { resolution: source.resolution, fps: source.fps }
}

function decodePreferences(value: unknown, path: string): StyleTemplatePreferences {
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

function decodeTemplate(value: unknown, path: string): StyleTemplate {
  const source = record(value, path)
  exactKeys(source, ['id', 'name', 'preferences'], path)
  return {
    id: decodeId(source, path),
    name: canonicalizeStyleTemplateName(source.name, `${path}.name`),
    preferences: decodePreferences(source.preferences, `${path}.preferences`),
  }
}

export function captureStyleTemplate(value: unknown): StyleTemplate {
  return decodeTemplate(value, 'styleTemplate')
}

export function decodeStyleTemplateFile(value: unknown): StyleTemplateFile {
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
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const template of decoded) {
    if (ids.has(template.id)) throw new Error(`Duplicate style template id: ${template.id}`)
    if (names.has(template.name)) {
      throw new Error(`Duplicate style template name: ${template.name}`)
    }
    ids.add(template.id)
    names.add(template.name)
  }
  return { schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION, templates: decoded }
}

export function parseStyleTemplateJson(json: string): StyleTemplateFile {
  if (typeof json !== 'string') throw new TypeError('Style template JSON must be a string.')
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new SyntaxError(
      `Invalid style template JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return decodeStyleTemplateFile(value)
}

export function serializeStyleTemplateFile(value: unknown): string {
  return JSON.stringify(decodeStyleTemplateFile(value))
}
