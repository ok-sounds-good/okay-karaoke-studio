'use strict'

const path = require('node:path')

const EXPORT_FILTERS = Object.freeze({
  lrc: Object.freeze([{ name: 'LRC Lyrics', extensions: ['lrc'] }]),
  ass: Object.freeze([{ name: 'Advanced SubStation Alpha', extensions: ['ass'] }]),
  oks: Object.freeze([{ name: 'Okay Karaoke Studio Project', extensions: ['oks'] }]),
})

const KNOWN_EXPORT_EXTENSIONS = new Set([
  '.ass',
  '.json',
  '.lrc',
  '.mp4',
  '.oks',
  '.okstudio',
  '.txt',
])
const OUTPUT_FORMATS = new Set([...Object.keys(EXPORT_FILTERS), 'mp4'])

function normalizeExportFormat(value) {
  if (typeof value !== 'string') throw new TypeError('format must be a string')
  const format = value.toLowerCase()
  if (!Object.hasOwn(EXPORT_FILTERS, format)) {
    throw new TypeError('format must be lrc, ass, or oks')
  }
  return format
}

function ensureExportExtension(fileName, format) {
  if (typeof format !== 'string') throw new TypeError('format must be a string')
  const normalizedFormat = format.toLowerCase()
  if (!OUTPUT_FORMATS.has(normalizedFormat)) {
    throw new TypeError('unsupported export filename format')
  }
  const desiredExtension = `.${normalizedFormat}`
  const rawExtension = path.extname(fileName)
  const currentExtension = rawExtension.toLowerCase()
  const baseName = path.basename(fileName)
  const stem = rawExtension ? baseName.slice(0, -rawExtension.length) : baseName
  if (currentExtension === desiredExtension) {
    return rawExtension === desiredExtension
      ? fileName
      : `${stem || (normalizedFormat === 'oks' ? 'project' : 'lyrics')}${desiredExtension}`
  }

  if (!KNOWN_EXPORT_EXTENSIONS.has(currentExtension)) {
    return `${fileName}${desiredExtension}`
  }

  return `${stem || (normalizedFormat === 'oks' ? 'project' : 'lyrics')}${desiredExtension}`
}

function normalizeExportPath(filePath, format) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new TypeError('filePath must be a non-empty string')
  }
  return path.join(path.dirname(filePath), ensureExportExtension(path.basename(filePath), format))
}

module.exports = {
  EXPORT_FILTERS,
  ensureExportExtension,
  normalizeExportFormat,
  normalizeExportPath,
}
