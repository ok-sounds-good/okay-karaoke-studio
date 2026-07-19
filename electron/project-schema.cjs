'use strict'

const { decodeStageStyle, decodeVocalStyle } = require('./video-style-schema.cjs')

const PROJECT_SCHEMA_VERSION = 0
const UNSUPPORTED_PROJECT_FORMAT_ERROR =
  'Unsupported project format. This build accepts only the current v0 format (schemaVersion 0).'
const MAX_PROJECT_DURATION_MS = 4 * 60 * 60 * 1_000
const MAX_PROJECT_TRACKS = 8
const MAX_PROJECT_LINES = 20_000
const MAX_PROJECT_WORDS = 150_000

function record(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
  return value
}

function exactKeys(value, expected, path) {
  const allowed = new Set(expected)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${path}.${unexpected} is not supported.`)
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (missing) throw new TypeError(`${path}.${missing} is required.`)
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

function number(value, key, path) {
  if (typeof value[key] !== 'number') throw new TypeError(`${path}.${key} must be a number.`)
  return value[key]
}

function nullableNumber(value, key, path) {
  if (value[key] !== null && typeof value[key] !== 'number') {
    throw new TypeError(`${path}.${key} must be a number or null.`)
  }
  return value[key]
}

function array(value, key, path) {
  const result = value[key]
  if (!Array.isArray(result)) throw new TypeError(`${path}.${key} must be an array.`)
  for (let index = 0; index < result.length; index += 1) {
    if (!Object.hasOwn(result, index)) throw new TypeError(`${path}.${key}[${index}] is required.`)
  }
  return result
}

function decodeWord(value, path) {
  const source = record(value, path)
  exactKeys(source, ['id', 'text', 'startMs', 'endMs'], path)
  return {
    id: string(source, 'id', path),
    text: string(source, 'text', path),
    startMs: nullableNumber(source, 'startMs', path),
    endMs: nullableNumber(source, 'endMs', path),
  }
}

function decodeLine(value, path, cardinality) {
  const source = record(value, path)
  exactKeys(source, ['id', 'text', 'startMs', 'endMs', 'words'], path)
  const words = array(source, 'words', path)
  cardinality.words += words.length
  if (cardinality.words > MAX_PROJECT_WORDS) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_WORDS} lyric words.`)
  }
  return {
    id: string(source, 'id', path),
    text: string(source, 'text', path),
    startMs: nullableNumber(source, 'startMs', path),
    endMs: nullableNumber(source, 'endMs', path),
    words: words.map((word, index) => decodeWord(word, `${path}.words[${index}]`)),
  }
}

function decodeTrack(value, path, cardinality) {
  const source = record(value, path)
  exactKeys(source, ['id', 'name', 'vocalStyle', 'muted', 'solo', 'lines'], path)
  const lines = array(source, 'lines', path)
  cardinality.lines += lines.length
  if (cardinality.lines > MAX_PROJECT_LINES) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_LINES} lyric lines.`)
  }
  return {
    id: string(source, 'id', path),
    name: string(source, 'name', path),
    vocalStyle: decodeVocalStyle(source.vocalStyle, `${path}.vocalStyle`),
    muted: boolean(source, 'muted', path),
    solo: boolean(source, 'solo', path),
    lines: lines.map((line, index) => decodeLine(line, `${path}.lines[${index}]`, cardinality)),
  }
}

function decodeLyricDisplay(value) {
  const source = record(value, 'project.lyricDisplay')
  exactKeys(source, ['lineCount', 'advanceMode'], 'project.lyricDisplay')
  const advanceMode = string(source, 'advanceMode', 'project.lyricDisplay')
  if (advanceMode !== 'clear' && advanceMode !== 'scroll') {
    throw new TypeError('project.lyricDisplay.advanceMode must be clear or scroll.')
  }
  return {
    lineCount: integer(source, 'lineCount', 'project.lyricDisplay'),
    advanceMode,
  }
}

function validateTiming(startMs, endMs, label) {
  if (startMs === null && endMs === null) return false
  if (startMs === null || endMs === null) {
    throw new Error(
      `Invalid karaoke project: ${label} must have both a start and end time, or neither.`,
    )
  }
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
    throw new Error(`Invalid karaoke project: ${label} timings must be safe integer milliseconds.`)
  }
  if (startMs < 0 || endMs < 0) {
    throw new Error(`Invalid karaoke project: ${label} timings cannot be negative.`)
  }
  if (startMs > MAX_PROJECT_DURATION_MS || endMs > MAX_PROJECT_DURATION_MS) {
    throw new Error(`Invalid karaoke project: ${label} timings cannot exceed four hours.`)
  }
  if (endMs <= startMs) {
    throw new Error(`Invalid karaoke project: ${label} must end after it starts.`)
  }
  return true
}

function validateProject(project) {
  const ids = new Set()
  const id = (value) => {
    if (!value.trim()) throw new Error('Invalid karaoke project: IDs cannot be empty.')
    if (ids.has(value)) throw new Error(`Invalid karaoke project: Duplicate ID: ${value}`)
    ids.add(value)
  }
  id(project.id)
  if (project.lyricDisplay.lineCount < 1 || project.lyricDisplay.lineCount > 5) {
    throw new Error(
      'Invalid karaoke project: Lyric display line count must be an integer from 1 to 5.',
    )
  }
  if (
    project.durationMs !== null &&
    (!Number.isSafeInteger(project.durationMs) ||
      project.durationMs < 0 ||
      project.durationMs > MAX_PROJECT_DURATION_MS)
  ) {
    throw new Error(
      'Invalid karaoke project: Project duration must be a safe integer between zero and four hours.',
    )
  }
  if (
    !Number.isSafeInteger(project.offsetMs) ||
    Math.abs(project.offsetMs) > MAX_PROJECT_DURATION_MS
  ) {
    throw new Error(
      'Invalid karaoke project: Project offset must be a safe integer between negative and positive four hours.',
    )
  }

  project.tracks.forEach((track) => {
    id(track.id)
    let priorLine
    let priorWord
    track.lines.forEach((line) => {
      id(line.id)
      const lineTimed = validateTiming(line.startMs, line.endMs, 'Line')
      if (
        lineTimed &&
        project.durationMs !== null &&
        line.endMs + project.offsetMs > project.durationMs
      ) {
        throw new Error('Invalid karaoke project: Line ends after the project duration.')
      }
      if (lineTimed && line.endMs + project.offsetMs > MAX_PROJECT_DURATION_MS) {
        throw new Error(
          'Invalid karaoke project: Offset-adjusted line timing cannot exceed four hours.',
        )
      }
      if (lineTimed && priorLine && line.startMs < priorLine.startMs) {
        throw new Error('Invalid karaoke project: Timed lines must be ordered by start time.')
      }
      if (lineTimed) priorLine = line

      line.words.forEach((word) => {
        id(word.id)
        const wordTimed = validateTiming(word.startMs, word.endMs, 'Word')
        if (wordTimed && lineTimed && (word.startMs < line.startMs || word.endMs > line.endMs)) {
          throw new Error('Invalid karaoke project: Word timing must stay within its line timing.')
        }
        if (
          wordTimed &&
          project.durationMs !== null &&
          word.endMs + project.offsetMs > project.durationMs
        ) {
          throw new Error('Invalid karaoke project: Word ends after the project duration.')
        }
        if (wordTimed && word.endMs + project.offsetMs > MAX_PROJECT_DURATION_MS) {
          throw new Error(
            'Invalid karaoke project: Offset-adjusted word timing cannot exceed four hours.',
          )
        }
        if (wordTimed && priorWord && word.startMs < priorWord.startMs) {
          throw new Error('Invalid karaoke project: Timed words must be ordered by start time.')
        }
        if (wordTimed) priorWord = word
      })
    })
  })
  return project
}

function decodeProject(value) {
  const source = record(value, 'Project data')
  if (source.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(UNSUPPORTED_PROJECT_FORMAT_ERROR)
  }
  exactKeys(
    source,
    [
      'schemaVersion',
      'id',
      'title',
      'artist',
      'audioPath',
      'durationMs',
      'offsetMs',
      'createdAt',
      'updatedAt',
      'lyricDisplay',
      'stageStyle',
      'tracks',
    ],
    'project',
  )
  const tracks = array(source, 'tracks', 'project')
  if (tracks.length > MAX_PROJECT_TRACKS) {
    throw new RangeError(`Projects are limited to ${MAX_PROJECT_TRACKS} vocal tracks.`)
  }
  if (source.audioPath !== null && typeof source.audioPath !== 'string') {
    throw new TypeError('project.audioPath must be a string or null.')
  }
  const cardinality = { lines: 0, words: 0 }
  return validateProject({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: string(source, 'id', 'project'),
    title: string(source, 'title', 'project'),
    artist: string(source, 'artist', 'project'),
    audioPath: source.audioPath,
    durationMs: nullableNumber(source, 'durationMs', 'project'),
    offsetMs: number(source, 'offsetMs', 'project'),
    createdAt: string(source, 'createdAt', 'project'),
    updatedAt: string(source, 'updatedAt', 'project'),
    lyricDisplay: decodeLyricDisplay(source.lyricDisplay),
    stageStyle: decodeStageStyle(source.stageStyle),
    tracks: tracks.map((track, index) =>
      decodeTrack(track, `project.tracks[${index}]`, cardinality),
    ),
  })
}

function parseProjectJson(json) {
  if (typeof json !== 'string') throw new TypeError('Project JSON must be a string.')
  let value
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new SyntaxError(
      `Invalid project JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return decodeProject(value)
}

function withParsedProject(json, operation) {
  return operation(parseProjectJson(json))
}

module.exports = {
  PROJECT_SCHEMA_VERSION,
  decodeProject,
  parseProjectJson,
  withParsedProject,
}
