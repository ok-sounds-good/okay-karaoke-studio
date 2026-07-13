'use strict'

const path = require('node:path')
const { ensureExportExtension } = require('./text-export.cjs')

const PROJECT_OPEN_FILTERS = Object.freeze([
  Object.freeze({
    name: 'Okay Karaoke Studio Project',
    extensions: Object.freeze(['oks', 'okstudio', 'json']),
  }),
  Object.freeze({ name: 'All Files', extensions: Object.freeze(['*']) }),
])

const PROJECT_SAVE_FILTERS = Object.freeze([
  Object.freeze({
    name: 'Okay Karaoke Studio Project',
    extensions: Object.freeze(['oks']),
  }),
])

function canonicalSavePath(filePath, format, pathApi = path) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new TypeError('filePath must be a non-empty string')
  }
  return pathApi.join(
    pathApi.dirname(filePath),
    ensureExportExtension(pathApi.basename(filePath), format),
  )
}

function isCanonicalSavePath(filePath, format, pathApi = path) {
  return filePath === canonicalSavePath(filePath, format, pathApi)
}

async function showCanonicalSaveDialog(
  showSaveDialog,
  owner,
  options,
  format,
  pathApi = path,
) {
  if (typeof showSaveDialog !== 'function') {
    throw new TypeError('showSaveDialog must be a function')
  }

  let defaultPath = canonicalSavePath(options.defaultPath, format, pathApi)
  for (;;) {
    const result = await showSaveDialog(owner, { ...options, defaultPath })
    if (result.canceled || !result.filePath) return null

    const selectedPath = pathApi.resolve(result.filePath)
    const canonicalPath = canonicalSavePath(selectedPath, format, pathApi)
    if (selectedPath === canonicalPath) return selectedPath

    // Reopen the native dialog at the canonical destination. This makes the OS,
    // rather than application code after the dialog closes, confirm any overwrite.
    defaultPath = canonicalPath
  }
}

module.exports = {
  PROJECT_OPEN_FILTERS,
  PROJECT_SAVE_FILTERS,
  canonicalSavePath,
  isCanonicalSavePath,
  showCanonicalSaveDialog,
}
