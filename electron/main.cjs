'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron')
const { randomUUID } = require('node:crypto')
const { createReadStream } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const { exportKaraokeVideo, MAX_VIDEO_DURATION_MS } = require('./video-export.cjs')

const APP_NAME = 'Okay Karaoke Studio'
const APP_SCHEME = 'studio-app'
const APP_HOST = 'app'
const MEDIA_SCHEME = 'studio-media'
const DEVELOPMENT_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const DIST_INDEX = path.resolve(__dirname, '..', 'dist', 'index.html')
const DIST_ROOT = path.dirname(DIST_INDEX)
const PACKAGED_APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`
const MAX_PROJECT_FILE_BYTES = 32 * 1024 * 1024
const MAX_LRC_FILE_BYTES = 8 * 1024 * 1024

const CHANNELS = Object.freeze({
  openProject: 'studio:open-project',
  saveProject: 'studio:save-project',
  importAudio: 'studio:import-audio',
  resolveAudio: 'studio:resolve-audio',
  releaseAudio: 'studio:release-audio',
  importLrc: 'studio:import-lrc',
  exportText: 'studio:export-text',
  exportVideo: 'studio:export-video',
  videoExportProgress: 'studio:video-export-progress',
  menuAction: 'studio:menu-action',
})

const MENU_ACTIONS = new Set([
  'new',
  'open',
  'save',
  'save-as',
  'import-audio',
  'import-lrc',
  'export',
  'play-toggle',
  'undo',
  'redo',
])

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.aif',
  '.aiff',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
])

const AUDIO_MIME_TYPES = new Map([
  ['.aac', 'audio/aac'],
  ['.aif', 'audio/aiff'],
  ['.aiff', 'audio/aiff'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav'],
])

const APP_MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const PROJECT_FILTERS = [
  { name: 'Okay Karaoke Studio Project', extensions: ['oks', 'okstudio', 'json'] },
  { name: 'All Files', extensions: ['*'] },
]

const AUDIO_FILTERS = [
  {
    name: 'Audio',
    extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)),
  },
  { name: 'All Files', extensions: ['*'] },
]

const LRC_FILTERS = [
  { name: 'LRC Lyrics', extensions: ['lrc'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
]

const EXPORT_FILTERS = Object.freeze({
  lrc: [{ name: 'LRC Lyrics', extensions: ['lrc'] }],
  ass: [{ name: 'Advanced SubStation Alpha', extensions: ['ass'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
})
const VIDEO_FILTERS = [{ name: 'MPEG-4 Karaoke Video', extensions: ['mp4'] }]

const mediaFiles = new Map()
const mediaTokensByOwner = new Map()
const writableProjectPaths = new Set()
const projectSaveQueues = new Map()

let mainWindow = null
let videoExportInProgress = false

app.setName(APP_NAME)

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

function textResponse(message, status, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function rendererOrigin() {
  return app.isPackaged
    ? `${APP_SCHEME}://${APP_HOST}`
    : new URL(DEVELOPMENT_URL).origin
}

function appFilePathFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (
      url.protocol !== `${APP_SCHEME}:` ||
      url.hostname !== APP_HOST ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null
    }

    const decodedPath = decodeURIComponent(url.pathname)
    if (decodedPath.includes('\0')) return null
    const relativePath = decodedPath === '/' || decodedPath === ''
      ? 'index.html'
      : decodedPath.replace(/^\/+/, '')
    const filePath = path.resolve(DIST_ROOT, relativePath)
    const pathWithinDist = path.relative(DIST_ROOT, filePath)
    if (
      pathWithinDist === '..' ||
      pathWithinDist.startsWith(`..${path.sep}`) ||
      path.isAbsolute(pathWithinDist)
    ) {
      return null
    }
    return filePath
  } catch {
    return null
  }
}

function installApplicationProtocol() {
  let canonicalDistRoot
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, { Allow: 'GET, HEAD' })
    }

    const requestedFilePath = appFilePathFromUrl(request.url)
    if (!requestedFilePath) return textResponse('Not found', 404)

    let filePath
    let fileStats
    try {
      canonicalDistRoot ||= fs.realpath(DIST_ROOT)
      const [distRoot, canonicalFilePath] = await Promise.all([
        canonicalDistRoot,
        fs.realpath(requestedFilePath),
      ])
      const pathWithinDist = path.relative(distRoot, canonicalFilePath)
      if (
        pathWithinDist === '..' ||
        pathWithinDist.startsWith(`..${path.sep}`) ||
        path.isAbsolute(pathWithinDist)
      ) {
        return textResponse('Not found', 404)
      }
      filePath = canonicalFilePath
      fileStats = await fs.stat(filePath)
    } catch {
      return textResponse('Not found', 404)
    }
    if (!fileStats.isFile()) return textResponse('Not found', 404)

    const relativePath = path.relative(DIST_ROOT, filePath)
    const headers = {
      'Cache-Control': relativePath.startsWith(`assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'Content-Length': String(fileStats.size),
      'Content-Type': APP_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    }

    if (request.method === 'HEAD' || fileStats.size === 0) {
      return new Response(null, { status: 200, headers })
    }

    return new Response(Readable.toWeb(createReadStream(filePath)), {
      status: 200,
      headers,
    })
  })
}

function mediaResponseHeaders() {
  return {
    'Access-Control-Allow-Origin': rendererOrigin(),
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Cache-Control': 'no-store',
  }
}

function parseByteRange(value, size) {
  if (!value) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size === 0 || (!match[1] && !match[2])) return false

  let start
  let end

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false
    if (start >= size || end < start) return false
    end = Math.min(end, size - 1)
  }

  return { start, end }
}

function tokenFromMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'asset') return null

    const token = url.pathname.split('/').filter(Boolean)[0]
    return token && /^[0-9a-f-]{36}$/i.test(token) ? token : null
  } catch {
    return null
  }
}

function installMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, {
        ...mediaResponseHeaders(),
        Allow: 'GET, HEAD',
      })
    }

    const token = tokenFromMediaUrl(request.url)
    const mediaFile = token ? mediaFiles.get(token) : null
    const hasActiveOwner = Boolean(
      mediaFile &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed() &&
      mainWindow.webContents.id === mediaFile.ownerId,
    )
    if (token && mediaFile && !hasActiveOwner) revokeMediaToken(token)
    const filePath = hasActiveOwner ? mediaFile.filePath : null
    if (!filePath) return textResponse('Media not found', 404, mediaResponseHeaders())

    let fileStats
    try {
      fileStats = await fs.stat(filePath)
    } catch {
      if (token) revokeMediaToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }

    if (!fileStats.isFile()) {
      if (token) revokeMediaToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }

    const range = parseByteRange(request.headers.get('range'), fileStats.size)
    if (range === false) {
      return textResponse('Requested range not satisfiable', 416, {
        ...mediaResponseHeaders(),
        'Content-Range': `bytes */${fileStats.size}`,
      })
    }

    const extension = path.extname(filePath).toLowerCase()
    const headers = {
      ...mediaResponseHeaders(),
      'Accept-Ranges': 'bytes',
      'Content-Type': AUDIO_MIME_TYPES.get(extension) || 'application/octet-stream',
    }

    const start = range ? range.start : 0
    const end = range ? range.end : Math.max(0, fileStats.size - 1)
    headers['Content-Length'] = String(range ? end - start + 1 : fileStats.size)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${fileStats.size}`

    if (request.method === 'HEAD' || fileStats.size === 0) {
      return new Response(null, { status: range ? 206 : 200, headers })
    }

    const stream = createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream), {
      status: range ? 206 : 200,
      headers,
    })
  })
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be a string`)
  return value
}

function optionalString(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, fieldName)
}

function safeFileName(value, fallback) {
  const rawName = typeof value === 'string' ? value.replaceAll('\0', '').trim() : ''
  const name = path.basename(rawName)
  return name && name !== '.' && name !== '..' ? name : fallback
}

function ensureProjectExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  return ['.oks', '.okstudio', '.json'].includes(extension) ? fileName : `${fileName}.oks`
}

function ensureExportExtension(fileName, format) {
  const currentExtension = path.extname(fileName).toLowerCase()
  if (currentExtension === `.${format}`) return fileName

  const knownExtensions = new Set(['.lrc', '.ass', '.json', '.mp4', '.txt'])
  if (!knownExtensions.has(currentExtension)) return `${fileName}.${format}`

  const stem = path.basename(fileName, currentExtension)
  return `${stem || 'lyrics'}.${format}`
}

function documentsPath(fileName) {
  return path.join(app.getPath('documents'), fileName)
}

function isErrnoException(error, code) {
  return error !== null && typeof error === 'object' && error.code === code
}

function requireStringWithinBytes(value, fieldName, maxBytes) {
  const text = requireString(value, fieldName)
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new RangeError(`${fieldName} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`)
  }
  return text
}

async function readUtf8FileWithinLimit(filePath, maxBytes, label) {
  const handle = await fs.open(filePath, 'r')
  try {
    const fileStats = await handle.stat()
    if (!fileStats.isFile()) throw new TypeError(`${label} must be a regular file`)
    if (fileStats.size > maxBytes) {
      throw new RangeError(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`)
    }

    const chunks = []
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1))
    let totalBytes = 0
    while (totalBytes <= maxBytes) {
      const readLength = Math.min(buffer.length, maxBytes + 1 - totalBytes)
      const { bytesRead } = await handle.read(buffer, 0, readLength, null)
      if (bytesRead === 0) break
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      totalBytes += bytesRead
    }

    if (totalBytes > maxBytes) {
      throw new RangeError(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`)
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function existingFileMode(filePath) {
  try {
    return (await fs.stat(filePath)).mode & 0o777
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return 0o666
    throw error
  }
}

async function syncDirectoryBestEffort(directoryPath) {
  let handle
  try {
    handle = await fs.open(directoryPath, 'r')
    await handle.sync()
  } catch {
    // Some platforms/filesystems do not support fsync on directory handles.
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function writeUtf8FileAtomically(filePath, contents) {
  const directoryPath = path.dirname(filePath)
  const temporaryPath = path.join(
    directoryPath,
    `.okay-karaoke-save-${process.pid}-${randomUUID()}.tmp`,
  )
  const mode = await existingFileMode(filePath)
  let handle
  let temporaryFileCreated = false

  try {
    handle = await fs.open(temporaryPath, 'wx', mode)
    temporaryFileCreated = true
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(temporaryPath, filePath)
    temporaryFileCreated = false
    await syncDirectoryBestEffort(directoryPath)
  } catch (error) {
    await handle?.close().catch(() => {})
    if (temporaryFileCreated) await fs.unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function queueProjectWrite(filePath, contents) {
  const previousWrite = projectSaveQueues.get(filePath) || Promise.resolve()
  const pendingWrite = previousWrite
    .catch(() => {})
    .then(() => writeUtf8FileAtomically(filePath, contents))
  projectSaveQueues.set(filePath, pendingWrite)

  try {
    await pendingWrite
  } finally {
    if (projectSaveQueues.get(filePath) === pendingWrite) {
      projectSaveQueues.delete(filePath)
    }
  }
}

function revokeMediaToken(token) {
  const mediaFile = mediaFiles.get(token)
  if (!mediaFile) return
  mediaFiles.delete(token)

  const ownerTokens = mediaTokensByOwner.get(mediaFile.ownerId)
  ownerTokens?.delete(token)
  if (ownerTokens?.size === 0) mediaTokensByOwner.delete(mediaFile.ownerId)
}

function revokeMediaForOwner(ownerId) {
  const ownerTokens = mediaTokensByOwner.get(ownerId)
  if (!ownerTokens) return
  for (const token of [...ownerTokens]) revokeMediaToken(token)
}

function assertTrustedSender(event) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const isMainFrame = event.senderFrame && event.senderFrame === event.sender.mainFrame
  if (!mainWindow || owner !== mainWindow || !isMainFrame) {
    throw new Error('Rejected IPC request from an untrusted renderer')
  }
  return owner
}

function normalizeProjectRequest(value) {
  if (!isRecord(value)) throw new TypeError('saveProject requires an options object')

  return {
    path: optionalString(value.path, 'path'),
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
    contents: requireStringWithinBytes(
      value.contents,
      'contents',
      MAX_PROJECT_FILE_BYTES,
    ),
  }
}

function normalizeExportRequest(value) {
  if (!isRecord(value)) throw new TypeError('exportText requires an options object')

  const format = requireString(value.format, 'format').toLowerCase()
  if (!Object.hasOwn(EXPORT_FILTERS, format)) {
    throw new TypeError('format must be lrc, ass, or json')
  }

  return {
    format,
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
    contents: requireString(value.contents, 'contents'),
  }
}

function normalizeVideoExportRequest(value) {
  if (!isRecord(value)) throw new TypeError('exportVideo requires an options object')
  const durationMs = value.durationMs
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1_000 ||
    durationMs > MAX_VIDEO_DURATION_MS
  ) {
    throw new RangeError('durationMs must be an integer between one second and four hours')
  }
  const audioPath = path.resolve(requireString(value.audioPath, 'audioPath'))
  if (!AUDIO_EXTENSIONS.has(path.extname(audioPath).toLowerCase())) {
    throw new TypeError('audioPath must reference a supported audio file')
  }

  return {
    audioPath,
    durationMs,
    projectJson: requireStringWithinBytes(
      value.projectJson,
      'projectJson',
      MAX_PROJECT_FILE_BYTES,
    ),
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
  }
}

function makeMediaResult(filePath, ownerContents) {
  if (!ownerContents || ownerContents.isDestroyed()) {
    throw new Error('Cannot create a media URL for a destroyed renderer')
  }

  const ownerId = ownerContents.id
  revokeMediaForOwner(ownerId)
  const token = randomUUID()
  mediaFiles.set(token, { filePath, ownerId })
  mediaTokensByOwner.set(ownerId, new Set([token]))

  return {
    path: filePath,
    name: path.basename(filePath),
    url: `${MEDIA_SCHEME}://asset/${token}/${encodeURIComponent(path.basename(filePath))}`,
  }
}

function registerIpcHandlers() {
  ipcMain.handle(CHANNELS.openProject, async (event) => {
    const owner = assertTrustedSender(event)
    const result = await dialog.showOpenDialog(owner, {
      title: 'Open Karaoke Project',
      buttonLabel: 'Open Project',
      properties: ['openFile'],
      filters: PROJECT_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const contents = await readUtf8FileWithinLimit(
      filePath,
      MAX_PROJECT_FILE_BYTES,
      'Project file',
    )
    writableProjectPaths.add(filePath)
    return { path: filePath, contents }
  })

  ipcMain.handle(CHANNELS.saveProject, async (event, value) => {
    const owner = assertTrustedSender(event)
    const request = normalizeProjectRequest(value)
    const requestedPath = request.path ? path.resolve(request.path) : null

    let filePath = requestedPath && writableProjectPaths.has(requestedPath)
      ? requestedPath
      : null

    if (!filePath) {
      const defaultName = ensureProjectExtension(safeFileName(
        request.suggestedName || requestedPath,
        'Untitled Karaoke Project.oks',
      ))
      const result = await dialog.showSaveDialog(owner, {
        title: 'Save Karaoke Project',
        buttonLabel: 'Save Project',
        defaultPath: documentsPath(defaultName),
        filters: PROJECT_FILTERS.slice(0, 1),
      })

      if (result.canceled || !result.filePath) return null
      filePath = path.resolve(result.filePath)
    }

    await queueProjectWrite(filePath, request.contents)
    writableProjectPaths.add(filePath)
    return { path: filePath }
  })

  ipcMain.handle(CHANNELS.importAudio, async (event) => {
    const owner = assertTrustedSender(event)
    const result = await dialog.showOpenDialog(owner, {
      title: 'Import Audio',
      buttonLabel: 'Import Audio',
      properties: ['openFile'],
      filters: AUDIO_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const extension = path.extname(filePath).toLowerCase()
    const fileStats = await fs.stat(filePath)
    if (!fileStats.isFile() || !AUDIO_EXTENSIONS.has(extension)) {
      throw new TypeError('The selected file is not a supported audio file')
    }

    return makeMediaResult(filePath, event.sender)
  })

  ipcMain.handle(CHANNELS.resolveAudio, async (event, value) => {
    assertTrustedSender(event)
    const filePath = path.resolve(requireString(value, 'path'))
    const extension = path.extname(filePath).toLowerCase()
    if (!AUDIO_EXTENSIONS.has(extension)) return null
    try {
      const fileStats = await fs.stat(filePath)
      return fileStats.isFile() ? makeMediaResult(filePath, event.sender) : null
    } catch {
      return null
    }
  })

  ipcMain.handle(CHANNELS.releaseAudio, async (event) => {
    assertTrustedSender(event)
    revokeMediaForOwner(event.sender.id)
  })

  ipcMain.handle(CHANNELS.importLrc, async (event) => {
    const owner = assertTrustedSender(event)
    const result = await dialog.showOpenDialog(owner, {
      title: 'Import LRC Lyrics',
      buttonLabel: 'Import Lyrics',
      properties: ['openFile'],
      filters: LRC_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const contents = await readUtf8FileWithinLimit(
      filePath,
      MAX_LRC_FILE_BYTES,
      'LRC file',
    )
    return { path: filePath, name: path.basename(filePath), contents }
  })

  ipcMain.handle(CHANNELS.exportText, async (event, value) => {
    const owner = assertTrustedSender(event)
    const request = normalizeExportRequest(value)
    const defaultName = ensureExportExtension(
      safeFileName(request.suggestedName, `lyrics.${request.format}`),
      request.format,
    )
    const result = await dialog.showSaveDialog(owner, {
      title: `Export ${request.format.toUpperCase()}`,
      buttonLabel: 'Export',
      defaultPath: documentsPath(defaultName),
      filters: EXPORT_FILTERS[request.format],
    })

    if (result.canceled || !result.filePath) return null

    const filePath = path.resolve(result.filePath)
    await writeUtf8FileAtomically(filePath, request.contents)
    return { path: filePath }
  })

  ipcMain.handle(CHANNELS.exportVideo, async (event, value) => {
    const owner = assertTrustedSender(event)
    if (videoExportInProgress) throw new Error('Another karaoke video export is already running')
    const request = normalizeVideoExportRequest(value)
    videoExportInProgress = true

    try {
      const defaultName = ensureExportExtension(
        safeFileName(request.suggestedName, 'karaoke-video.mp4'),
        'mp4',
      )
      const result = await dialog.showSaveDialog(owner, {
        title: 'Export Karaoke Video',
        buttonLabel: 'Render Video',
        defaultPath: documentsPath(defaultName),
        filters: VIDEO_FILTERS,
      })
      if (result.canceled || !result.filePath) return null

      const sendProgress = (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(CHANNELS.videoExportProgress, progress)
        }
      }
      return await exportKaraokeVideo({
        BrowserWindow,
        projectJson: request.projectJson,
        durationMs: request.durationMs,
        audioPath: request.audioPath,
        outputPath: path.resolve(result.filePath),
        onProgress: sendProgress,
      })
    } finally {
      videoExportInProgress = false
    }
  })
}

function sendMenuAction(action) {
  if (!MENU_ACTIONS.has(action) || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(CHANNELS.menuAction, action)
}

function applicationMenuTemplate() {
  const macAppMenu = process.platform === 'darwin'
    ? [{
        label: APP_NAME,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }]
    : []

  return [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CommandOrControl+N', click: () => sendMenuAction('new') },
        { label: 'Open Project…', accelerator: 'CommandOrControl+O', click: () => sendMenuAction('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CommandOrControl+S', click: () => sendMenuAction('save') },
        { label: 'Save As…', accelerator: 'CommandOrControl+Shift+S', click: () => sendMenuAction('save-as') },
        { type: 'separator' },
        { label: 'Import Audio…', accelerator: 'CommandOrControl+Shift+A', click: () => sendMenuAction('import-audio') },
        { label: 'Import LRC…', accelerator: 'CommandOrControl+Shift+L', click: () => sendMenuAction('import-lrc') },
        { label: 'Export Lyrics…', accelerator: 'CommandOrControl+Shift+E', click: () => sendMenuAction('export') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: () => sendMenuAction('undo') },
        { label: 'Redo', accelerator: 'Shift+CommandOrControl+Z', click: () => sendMenuAction('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play/Pause',
          accelerator: 'Space',
          registerAccelerator: false,
          click: () => sendMenuAction('play-toggle'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ]
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()))
}

function isAllowedAppNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl)

    if (!app.isPackaged) {
      return url.origin === new URL(DEVELOPMENT_URL).origin
    }

    return (
      url.protocol === `${APP_SCHEME}:` &&
      url.hostname === APP_HOST &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '/index.html')
    )
  } catch {
    return false
  }
}

async function openExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return
    await shell.openExternal(url.toString())
  } catch (error) {
    console.error('Unable to open external URL:', error)
  }
}

function secureWebContents(contents) {
  const ownerId = contents.id
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    void openExternalUrl(url)
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('will-prevent-unload', (event) => {
    const owner = BrowserWindow.fromWebContents(contents)
    const options = {
      type: 'warning',
      buttons: ['Discard Changes', 'Keep Editing'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Unsaved karaoke project',
      message: 'Discard the unsaved changes?',
      detail: 'Your latest lyric and timing edits have not been saved.',
    }
    const choice = owner
      ? dialog.showMessageBoxSync(owner, options)
      : dialog.showMessageBoxSync(options)
    // Electron prevents the unload by default. Preventing this event allows
    // the renderer-requested unload to continue after explicit confirmation.
    if (choice === 0) event.preventDefault()
  })
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) revokeMediaForOwner(ownerId)
  })
  contents.once('destroyed', () => revokeMediaForOwner(ownerId))
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#101217',
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: true,
    },
  })

  mainWindow = window
  secureWebContents(window.webContents)

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (app.isPackaged) {
    await window.loadURL(PACKAGED_APP_URL)
  } else {
    await window.loadURL(DEVELOPMENT_URL)
  }

  return window
}

function focusMainWindow() {
  if (!app.isReady()) {
    app.once('ready', focusMainWindow)
    return
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow().catch((error) => console.error('Unable to create the main window:', error))
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  app.whenReady().then(async () => {
    if (app.isPackaged) installApplicationProtocol()
    installMediaProtocol()
    registerIpcHandlers()
    installApplicationMenu()

    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
    })

    session.defaultSession.setPermissionCheckHandler(() => false)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))

    await createMainWindow()
  }).catch((error) => {
    console.error('Failed to start Okay Karaoke Studio:', error)
    dialog.showErrorBox('Unable to start Okay Karaoke Studio', String(error?.message || error))
    app.quit()
  })

  app.on('activate', focusMainWindow)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
