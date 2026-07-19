'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron')
const { randomUUID } = require('node:crypto')
const { createReadStream } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const {
  queueProjectWrite,
  readUtf8FileWithinLimit,
  writeUtf8FileAtomically,
} = require('./project-files.cjs')
const { parseProjectJson, withParsedProject } = require('./project-schema.cjs')
const {
  createVideoExportCommitState,
  exportKaraokeVideo,
  MAX_VIDEO_DURATION_MS,
  normalizeVideoSettings,
} = require('./video-export.cjs')
const { ensureFfmpegForExport } = require('./ffmpeg-setup.cjs')
const {
  VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS,
  createVideoExportLifecycleGuard,
} = require('./video-export-lifecycle.cjs')
const { createVideoExportOperation } = require('./video-export-operation.cjs')
const {
  EXPORT_FILTERS,
  ensureExportExtension,
  normalizeExportFormat,
} = require('./text-export.cjs')
const {
  PROJECT_OPEN_FILTERS,
  PROJECT_SAVE_FILTERS,
  canonicalSavePath,
  isCanonicalSavePath,
  showCanonicalSaveDialog,
} = require('./save-paths.cjs')
const { createLocalFontPermissionPolicy } = require('./local-font-access.cjs')
const { readLinkedImage } = require('./linked-image-decoder.cjs')
const { createElectronNativeImageDecoder } = require('./native-image-adapter.cjs')
const {
  createMediaCapabilityRegistry,
  mediaTokenFromUrl,
  normalizeBackgroundCapabilityState,
  normalizeBackgroundMutationRequest,
  normalizeMediaCapabilityReference,
  prepareProjectMedia,
} = require('./media-capabilities.cjs')
const {
  createVideoExportAuthorizer,
  linkedImageExportFailure,
} = require('./video-export-authorization.cjs')
const { createProjectOpenCoordinator } = require('./project-open.cjs')
const { createStyleTemplateStore } = require('./style-template-store.cjs')
const {
  createNativeCloseArbiter,
  createNativeCloseOwnershipCleanup,
  createNativeCloseRendererReadiness,
  isNativeCloseRequestId,
} = require('./native-close-arbiter.cjs')
const {
  VIEWPORT: VISUAL_SMOKE_VIEWPORT,
  configureVisualSmokeBeforeReady,
  installVisualSmokeFatalObserver,
  parseVisualSmokeArguments,
  runVisualSmoke,
} = require('./video-style-visual-smoke.cjs')

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
  settleProjectOpen: 'studio:settle-project-open',
  resetProjectScope: 'studio:reset-project-scope',
  saveProject: 'studio:save-project',
  importAudio: 'studio:import-audio',
  resolveProjectAudio: 'studio:resolve-project-audio',
  releaseAudio: 'studio:release-audio',
  chooseBackgroundImage: 'studio:choose-background-image',
  resolveProjectBackground: 'studio:resolve-project-background',
  settleBackgroundImage: 'studio:settle-background-image',
  retainBackground: 'studio:retain-background',
  releaseBackground: 'studio:release-background',
  releaseBackgroundSnapshot: 'studio:release-background-snapshot',
  getBackgroundState: 'studio:get-background-state',
  importLrc: 'studio:import-lrc',
  exportText: 'studio:export-text',
  exportVideo: 'studio:export-video',
  cancelVideoExport: 'studio:cancel-video-export',
  videoExportProgress: 'studio:video-export-progress',
  menuAction: 'studio:menu-action',
  windowCloseRequest: 'studio:window-close-request',
  getPendingWindowClose: 'studio:get-pending-window-close',
  resolveWindowClose: 'studio:resolve-window-close',
  listStyleTemplates: 'studio:list-style-templates',
  createStyleTemplate: 'studio:create-style-template',
  renameStyleTemplate: 'studio:rename-style-template',
  deleteStyleTemplate: 'studio:delete-style-template',
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
  'select-all',
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

const AUDIO_FILTERS = [
  {
    name: 'Audio',
    extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)),
  },
  { name: 'All Files', extensions: ['*'] },
]

const BACKGROUND_IMAGE_FILTERS = [{ name: 'PNG or JPEG Image', extensions: ['png', 'jpg', 'jpeg'] }]

const LRC_FILTERS = [
  { name: 'LRC Lyrics', extensions: ['lrc'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
]

const VIDEO_FILTERS = [{ name: 'MPEG-4 Karaoke Video', extensions: ['mp4'] }]

const mediaCapabilities = createMediaCapabilityRegistry()
const projectOpens = createProjectOpenCoordinator({
  prepareScope(_ownerId, scope) {
    return prepareProjectMedia(scope.path, scope.project, AUDIO_EXTENSIONS)
  },
  async validateScope(_ownerId, scope) {
    try {
      const currentContents = await readUtf8FileWithinLimit(
        scope.path,
        MAX_PROJECT_FILE_BYTES,
        'Project file',
      )
      return currentContents === scope.contents
    } catch {
      return false
    }
  },
  commitScope(ownerId, scope) {
    return mediaCapabilities.replaceProjectScope(ownerId, scope.projectPath, {
      audio: scope.audioPath,
      background: scope.backgroundPath,
    })
  },
  resetScope(ownerId) {
    mediaCapabilities.releaseOwner(ownerId)
    return true
  },
})

let mainWindow = null

app.setName(APP_NAME)

const styleTemplateStore = createStyleTemplateStore({
  filePath: path.join(app.getPath('userData'), 'style-templates.json'),
})

let visualSmokeConfig = null
let visualSmokeFatalObserver = null
let visualSmokeStartupFailed = false
try {
  visualSmokeConfig = configureVisualSmokeBeforeReady(app, parseVisualSmokeArguments(process.argv))
  if (visualSmokeConfig) visualSmokeFatalObserver = installVisualSmokeFatalObserver(process)
} catch {
  visualSmokeStartupFailed = true
}

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
  return useBuiltRenderer() ? `${APP_SCHEME}://${APP_HOST}` : new URL(DEVELOPMENT_URL).origin
}

function useBuiltRenderer() {
  return app.isPackaged || visualSmokeConfig !== null
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
    const relativePath =
      decodedPath === '/' || decodedPath === '' ? 'index.html' : decodedPath.replace(/^\/+/, '')
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
      'Content-Type':
        APP_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
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
    'X-Content-Type-Options': 'nosniff',
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

function installMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed', 405, {
        ...mediaResponseHeaders(),
        Allow: 'GET, HEAD',
      })
    }

    const token = mediaTokenFromUrl(request.url, MEDIA_SCHEME)
    const mediaFile = token ? mediaCapabilities.get(token) : null
    const hasActiveOwner = Boolean(
      mediaFile &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed() &&
      mainWindow.webContents.id === mediaFile.ownerId,
    )
    if (token && mediaFile && !hasActiveOwner) mediaCapabilities.revokeToken(token)
    if (!hasActiveOwner) return textResponse('Media not found', 404, mediaResponseHeaders())

    if (mediaFile.kind === 'background') {
      const size = mediaFile.bytes.length
      const range = parseByteRange(request.headers.get('range'), size)
      if (range === false) {
        return textResponse('Requested range not satisfiable', 416, {
          ...mediaResponseHeaders(),
          'Content-Range': `bytes */${size}`,
        })
      }
      const start = range ? range.start : 0
      const end = range ? range.end : size - 1
      const headers = {
        ...mediaResponseHeaders(),
        'Accept-Ranges': 'bytes',
        'Content-Length': String(range ? end - start + 1 : size),
        'Content-Type': mediaFile.mime,
      }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      const body =
        request.method === 'HEAD' ? null : Buffer.from(mediaFile.bytes.subarray(start, end + 1))
      return new Response(body, { status: range ? 206 : 200, headers })
    }

    const filePath = mediaFile.filePath

    let fileStats
    try {
      fileStats = await fs.stat(filePath)
    } catch {
      if (token) mediaCapabilities.revokeToken(token)
      return textResponse('Media not found', 404, mediaResponseHeaders())
    }

    if (!fileStats.isFile()) {
      if (token) mediaCapabilities.revokeToken(token)
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

function documentsPath(fileName) {
  return path.join(app.getPath('documents'), fileName)
}

function requireStringWithinBytes(value, fieldName, maxBytes) {
  const text = requireString(value, fieldName)
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new RangeError(
      `${fieldName} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`,
    )
  }
  return text
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
    contents: requireStringWithinBytes(value.contents, 'contents', MAX_PROJECT_FILE_BYTES),
  }
}

function normalizeExportRequest(value) {
  if (!isRecord(value)) throw new TypeError('exportText requires an options object')

  const format = normalizeExportFormat(value.format)

  return {
    format,
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
    contents: requireString(value.contents, 'contents'),
  }
}

async function writeTextExport(owner, request) {
  const defaultName = ensureExportExtension(
    safeFileName(request.suggestedName, `lyrics.${request.format}`),
    request.format,
  )
  const filePath = await showCanonicalSaveDialog(
    dialog.showSaveDialog.bind(dialog),
    owner,
    {
      title: `Export ${request.format.toUpperCase()}`,
      buttonLabel: 'Export',
      defaultPath: documentsPath(defaultName),
      filters: EXPORT_FILTERS[request.format],
    },
    request.format,
  )

  if (!filePath) return null
  await writeUtf8FileAtomically(filePath, request.contents)
  return { path: filePath }
}

function normalizeVideoExportRequest(value) {
  if (!isRecord(value)) throw new TypeError('exportVideo requires an options object')
  const videoSettings = normalizeVideoSettings({
    resolution: value.resolution,
    fps: value.fps,
  })
  const durationMs = value.durationMs
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1_000 ||
    durationMs > MAX_VIDEO_DURATION_MS
  ) {
    throw new RangeError('durationMs must be an integer between one second and thirty minutes')
  }
  const audioPath = path.resolve(requireString(value.audioPath, 'audioPath'))
  if (!AUDIO_EXTENSIONS.has(path.extname(audioPath).toLowerCase())) {
    throw new TypeError('audioPath must reference a supported audio file')
  }

  return {
    audioPath,
    durationMs,
    projectJson: requireStringWithinBytes(value.projectJson, 'projectJson', MAX_PROJECT_FILE_BYTES),
    resolution: videoSettings.resolution,
    fps: videoSettings.fps,
    suggestedName: optionalString(value.suggestedName, 'suggestedName'),
    background: normalizeBackgroundCapabilityState(value.background, MEDIA_SCHEME),
  }
}

function makeMediaResult(token, filePath, kind) {
  const suffix = kind === 'audio' ? `/${encodeURIComponent(path.basename(filePath))}` : ''
  return {
    path: filePath,
    name: path.basename(filePath),
    url: `${MEDIA_SCHEME}://asset/${token}${suffix}`,
  }
}

function backgroundCapabilityState(ownerId) {
  const state = mediaCapabilities.backgroundState(ownerId)
  return Object.freeze({
    activeUrl: state.activeToken ? `${MEDIA_SCHEME}://asset/${state.activeToken}` : null,
    revision: state.revision,
  })
}

function registerAudioResult(filePath, ownerContents, requestSequence) {
  if (!ownerContents || ownerContents.isDestroyed()) {
    throw new Error('Cannot create a media URL for a destroyed renderer')
  }
  const ownerId = ownerContents.id
  const token = mediaCapabilities.registerAudio(ownerId, filePath, requestSequence)
  return token ? makeMediaResult(token, filePath, 'audio') : null
}

function linkedImageMedia(image) {
  return {
    bytes: image.bytes,
    mime: image.format === 'png' ? 'image/png' : 'image/jpeg',
  }
}

function prepareVideoExport({ owner, signal }) {
  return ensureFfmpegForExport({
    openExternal: openExternalUrl,
    showMessageBox: (options) => dialog.showMessageBox(owner, options),
    signal,
  })
}

function selectVideoExportDestination({ owner, request }) {
  const defaultName = ensureExportExtension(
    safeFileName(request.suggestedName, 'karaoke-video.mp4'),
    'mp4',
  )
  return showCanonicalSaveDialog(
    dialog.showSaveDialog.bind(dialog),
    owner,
    {
      title: 'Export Karaoke Video',
      buttonLabel: 'Render Video',
      defaultPath: documentsPath(defaultName),
      filters: VIDEO_FILTERS,
    },
    'mp4',
  )
}

function executeVideoExport({
  authorization,
  request,
  preparation,
  destination,
  operation,
  onProgress,
}) {
  return exportKaraokeVideo({
    BrowserWindow,
    projectJson: request.projectJson,
    durationMs: request.durationMs,
    audioPath: request.audioPath,
    outputPath: path.resolve(destination),
    ffmpegPath: preparation,
    backgroundImage: authorization.backgroundImage,
    resolution: request.resolution,
    fps: request.fps,
    onProgress,
    onPromotionStart: () => operation.commitState.beginPromotion(),
    onPromotionComplete: () => operation.commitState.finishPromotion(),
    signal: operation.controller.signal,
  })
}

function parseVideoExportProject(projectJson) {
  return parseProjectJson(projectJson)
}
const authorizeVideoExport = createVideoExportAuthorizer({
  mediaCapabilities,
  readLinkedImage: (imagePath) =>
    readLinkedImage(imagePath, { decode: createElectronNativeImageDecoder() }),
})
const videoExportOperation = createVideoExportOperation({
  parseProject: parseVideoExportProject,
  authorizeExport: ({ project, request, sender, signal }) =>
    authorizeVideoExport({
      ownerId: sender.id,
      project,
      expectedBackground: request.background,
      signal,
    }),
  createCommitState: createVideoExportCommitState,
  prepareExport: prepareVideoExport,
  selectDestination: selectVideoExportDestination,
  executeExport: executeVideoExport,
  sendProgress: (sender, progress) => sender.send(CHANNELS.videoExportProgress, progress),
})

let videoExportLifecycleGuard
const nativeCloseRendererReadiness = createNativeCloseRendererReadiness()

const nativeCloseArbiter = createNativeCloseArbiter({
  createRequestId: randomUUID,
  hasActiveExport: videoExportOperation.hasActiveExport,
  requestExportCancellation: (action) =>
    action === 'app'
      ? videoExportLifecycleGuard.requestAppQuit()
      : videoExportLifecycleGuard.requestWindowClose(),
  sendRequest: (request) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed() ||
      !nativeCloseRendererReadiness.isReady(mainWindow.webContents.id)
    )
      return false
    mainWindow.webContents.send(CHANNELS.windowCloseRequest, request)
    return true
  },
  closeWindow: () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  },
  quitApp: () => app.quit(),
  onError: (error) => console.error('Unable to arbitrate native close:', error),
})

function clearNativeCloseOwnership(ownerId) {
  if (nativeCloseRendererReadiness.clear(ownerId)) nativeCloseArbiter.clear()
}

async function confirmLifecycleVideoExportCancellation() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const options = {
    ...VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS,
    buttons: [...VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS.buttons],
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

videoExportLifecycleGuard = createVideoExportLifecycleGuard({
  confirmCancellation: confirmLifecycleVideoExportCancellation,
  abortActiveExport: videoExportOperation.abortActiveExport,
  closeWindow: () => nativeCloseArbiter.resumeAfterExport('window'),
  quitApp: () => nativeCloseArbiter.resumeAfterExport('app'),
  onError: (error) => {
    if (error?.code !== 'VIDEO_EXPORT_NOT_CANCELLABLE') {
      console.error('Unable to confirm video export cancellation:', error)
    }
  },
})

async function saveValidatedProject(owner, ownerId, request) {
  const writeGrant = projectOpens.captureWriteGrant(ownerId)
  const requestedPath = request.path ? path.resolve(request.path) : null
  const requestedPathIsWritable = requestedPath
    ? projectOpens.canWrite(ownerId, requestedPath)
    : false

  let filePath =
    requestedPath && isCanonicalSavePath(requestedPath, 'oks') && requestedPathIsWritable
      ? requestedPath
      : null

  if (!filePath) {
    const defaultName = ensureExportExtension(
      safeFileName(request.suggestedName, 'Untitled Karaoke Project.oks'),
      'oks',
    )
    const defaultPath =
      requestedPath && requestedPathIsWritable
        ? canonicalSavePath(requestedPath, 'oks')
        : documentsPath(defaultName)
    filePath = await showCanonicalSaveDialog(
      dialog.showSaveDialog.bind(dialog),
      owner,
      {
        title: 'Save Karaoke Project',
        buttonLabel: 'Save Project',
        defaultPath,
        filters: PROJECT_SAVE_FILTERS,
      },
      'oks',
    )
    if (!filePath) return null
  }

  await queueProjectWrite(filePath, request.contents, () =>
    projectOpens.acquireWritePromotion(ownerId, writeGrant),
  )
  const promoted = projectOpens.writeGrantIsCurrent(ownerId, writeGrant)
  projectOpens.grantWrite(ownerId, filePath, writeGrant)
  return promoted ? { path: filePath } : null
}

function registerIpcHandlers() {
  ipcMain.handle(CHANNELS.listStyleTemplates, async (event) => {
    assertTrustedSender(event)
    return styleTemplateStore.list()
  })

  ipcMain.handle(CHANNELS.createStyleTemplate, async (event, value) => {
    assertTrustedSender(event)
    return styleTemplateStore.create(value)
  })

  ipcMain.handle(CHANNELS.renameStyleTemplate, async (event, value) => {
    assertTrustedSender(event)
    return styleTemplateStore.rename(value)
  })

  ipcMain.handle(CHANNELS.deleteStyleTemplate, async (event, value) => {
    assertTrustedSender(event)
    return styleTemplateStore.delete(value)
  })

  ipcMain.handle(CHANNELS.getPendingWindowClose, async (event) => {
    assertTrustedSender(event)
    nativeCloseRendererReadiness.markReady(event.sender.id)
    return nativeCloseArbiter.getPendingRequest()
  })

  ipcMain.handle(CHANNELS.resolveWindowClose, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('resolveWindowClose requires an options object')
    if (!isNativeCloseRequestId(value.requestId)) {
      throw new TypeError('resolveWindowClose.requestId must be a UUID')
    }
    if (typeof value.proceed !== 'boolean') {
      throw new TypeError('resolveWindowClose.proceed must be a boolean')
    }
    return nativeCloseArbiter.resolve(value.requestId, value.proceed)
  })

  ipcMain.handle(CHANNELS.openProject, async (event) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const requestId = projectOpens.beginOpen(ownerId)
    const result = await dialog.showOpenDialog(owner, {
      title: 'Open Karaoke Project',
      buttonLabel: 'Open Project',
      properties: ['openFile'],
      filters: PROJECT_OPEN_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = path.resolve(result.filePaths[0])
    const contents = await readUtf8FileWithinLimit(filePath, MAX_PROJECT_FILE_BYTES, 'Project file')
    return projectOpens.stageOpen(ownerId, requestId, filePath, contents)
  })

  ipcMain.handle(CHANNELS.settleProjectOpen, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('settleProjectOpen requires an options object')
    const requestId = requireString(value.requestId, 'requestId')
    if (typeof value.accepted !== 'boolean') {
      throw new TypeError('settleProjectOpen.accepted must be a boolean')
    }
    return projectOpens.settleOpen(event.sender.id, requestId, value.accepted)
  })

  ipcMain.handle(CHANNELS.resetProjectScope, async (event) => {
    assertTrustedSender(event)
    return projectOpens.resetProjectScope(event.sender.id)
  })

  ipcMain.handle(CHANNELS.saveProject, async (event, value) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const request = normalizeProjectRequest(value)
    return withParsedProject(request.contents, () => saveValidatedProject(owner, ownerId, request))
  })

  ipcMain.handle(CHANNELS.importAudio, async (event) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const requestSequence = mediaCapabilities.beginRequest(ownerId, 'audio')
    const result = await dialog.showOpenDialog(owner, {
      title: 'Import Audio',
      buttonLabel: 'Import Audio',
      properties: ['openFile'],
      filters: AUDIO_FILTERS,
    })

    if (result.canceled || result.filePaths.length === 0) {
      mediaCapabilities.finishRequest(ownerId, 'audio', requestSequence)
      return null
    }

    const filePath = path.resolve(result.filePaths[0])
    const extension = path.extname(filePath).toLowerCase()
    const fileStats = await fs.stat(filePath)
    if (!fileStats.isFile() || !AUDIO_EXTENSIONS.has(extension)) {
      mediaCapabilities.finishRequest(ownerId, 'audio', requestSequence)
      throw new TypeError('The selected file is not a supported audio file')
    }
    if (!mediaCapabilities.requestIsCurrent(ownerId, 'audio', requestSequence)) return null

    return registerAudioResult(filePath, event.sender, requestSequence)
  })

  ipcMain.handle(CHANNELS.resolveProjectAudio, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('resolveProjectAudio requires an options object')
    const ownerId = event.sender.id
    const projectPath = path.resolve(requireString(value.projectPath, 'projectPath'))
    const restoration = mediaCapabilities.beginRestore(ownerId, 'audio', projectPath)
    if (!restoration.authorized) return null
    if (!restoration.filePath) {
      mediaCapabilities.finishRequest(ownerId, 'audio', restoration.sequence)
      return null
    }
    try {
      const fileStats = await fs.stat(restoration.filePath)
      if (
        !fileStats.isFile() ||
        !mediaCapabilities.requestIsCurrent(ownerId, 'audio', restoration.sequence)
      )
        return null
      return registerAudioResult(restoration.filePath, event.sender, restoration.sequence)
    } catch {
      mediaCapabilities.finishRequest(ownerId, 'audio', restoration.sequence)
      return null
    }
  })

  ipcMain.handle(CHANNELS.releaseAudio, async (event) => {
    assertTrustedSender(event)
    mediaCapabilities.resetKind(event.sender.id, 'audio')
  })

  ipcMain.handle(CHANNELS.getBackgroundState, async (event) => {
    assertTrustedSender(event)
    return backgroundCapabilityState(event.sender.id)
  })

  ipcMain.handle(CHANNELS.chooseBackgroundImage, async (event) => {
    const owner = assertTrustedSender(event)
    const ownerId = event.sender.id
    const requestSequence = mediaCapabilities.beginRequest(ownerId, 'background')
    const result = await dialog.showOpenDialog(owner, {
      title: 'Choose Video Background',
      buttonLabel: 'Choose Image',
      properties: ['openFile'],
      filters: BACKGROUND_IMAGE_FILTERS,
    })
    if (result.canceled || result.filePaths.length === 0) {
      mediaCapabilities.finishRequest(ownerId, 'background', requestSequence)
      return null
    }

    const filePath = path.resolve(result.filePaths[0])
    let image
    try {
      image = await readLinkedImage(filePath, {
        decode: createElectronNativeImageDecoder(),
      })
    } catch (error) {
      mediaCapabilities.finishRequest(ownerId, 'background', requestSequence)
      if (!mediaCapabilities.requestIsCurrent(ownerId, 'background', requestSequence)) return null
      throw error
    }
    const token = mediaCapabilities.registerBackgroundCandidate(
      ownerId,
      filePath,
      linkedImageMedia(image),
      requestSequence,
    )
    return token ? makeMediaResult(token, filePath, 'background') : null
  })

  ipcMain.handle(CHANNELS.resolveProjectBackground, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('resolveProjectBackground requires an options object')
    const ownerId = event.sender.id
    const projectPath = path.resolve(requireString(value.projectPath, 'projectPath'))
    const restoration = mediaCapabilities.beginRestore(ownerId, 'background', projectPath)
    if (!restoration.authorized) return { status: 'stale' }
    if (!restoration.filePath) {
      mediaCapabilities.finishRequest(ownerId, 'background', restoration.sequence)
      return { status: 'missing', state: backgroundCapabilityState(ownerId) }
    }

    try {
      const image = await readLinkedImage(restoration.filePath, {
        decode: createElectronNativeImageDecoder(),
      })
      const token = mediaCapabilities.registerRestoredBackground(
        ownerId,
        restoration.filePath,
        linkedImageMedia(image),
        restoration.sequence,
      )
      return token
        ? {
            status: 'success',
            media: makeMediaResult(token, restoration.filePath, 'background'),
            state: backgroundCapabilityState(ownerId),
          }
        : { status: 'stale' }
    } catch {
      return mediaCapabilities.finishRequest(ownerId, 'background', restoration.sequence)
        ? { status: 'missing', state: backgroundCapabilityState(ownerId) }
        : { status: 'stale' }
    }
  })

  ipcMain.handle(CHANNELS.settleBackgroundImage, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('settleBackgroundImage requires an options object')
    if (typeof value.accepted !== 'boolean') {
      throw new TypeError('settleBackgroundImage.accepted must be a boolean')
    }
    const candidate = normalizeMediaCapabilityReference(value.url, { scheme: MEDIA_SCHEME })
    if (!candidate.valid || !candidate.token) return null
    return mediaCapabilities.settleBackgroundCandidate(
      event.sender.id,
      candidate.token,
      value.accepted,
    )
      ? backgroundCapabilityState(event.sender.id)
      : null
  })

  ipcMain.handle(CHANNELS.retainBackground, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('retainBackground requires an options object')
    const request = normalizeBackgroundMutationRequest(value, 'nullable', MEDIA_SCHEME)
    if (!request.valid) return null
    return mediaCapabilities.retainBackground(
      event.sender.id,
      request.expectedRevision,
      request.expectedToken,
      request.targetToken,
    )
      ? backgroundCapabilityState(event.sender.id)
      : null
  })

  ipcMain.handle(CHANNELS.releaseBackground, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value)) throw new TypeError('releaseBackground requires an options object')
    const request = normalizeBackgroundMutationRequest(value, 'none', MEDIA_SCHEME)
    if (!request.valid) return null
    return mediaCapabilities.releaseKind(
      event.sender.id,
      'background',
      request.expectedRevision,
      request.expectedToken,
    )
      ? backgroundCapabilityState(event.sender.id)
      : null
  })

  ipcMain.handle(CHANNELS.releaseBackgroundSnapshot, async (event, value) => {
    assertTrustedSender(event)
    if (!isRecord(value))
      throw new TypeError('releaseBackgroundSnapshot requires an options object')
    const request = normalizeBackgroundMutationRequest(value, 'required', MEDIA_SCHEME)
    if (!request.valid || !request.targetToken) return null
    return mediaCapabilities.releaseBackgroundSnapshot(
      event.sender.id,
      request.expectedRevision,
      request.expectedToken,
      request.targetToken,
    )
      ? backgroundCapabilityState(event.sender.id)
      : null
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
    const contents = await readUtf8FileWithinLimit(filePath, MAX_LRC_FILE_BYTES, 'LRC file')
    return { path: filePath, name: path.basename(filePath), contents }
  })

  ipcMain.handle(CHANNELS.exportText, async (event, value) => {
    const owner = assertTrustedSender(event)
    const request = normalizeExportRequest(value)
    if (request.format === 'oks') {
      return withParsedProject(request.contents, () => writeTextExport(owner, request))
    }
    return writeTextExport(owner, request)
  })

  ipcMain.handle(CHANNELS.exportVideo, async (event, value) => {
    const owner = assertTrustedSender(event)
    const request = normalizeVideoExportRequest(value)
    try {
      return await videoExportOperation.run({ owner, sender: event.sender, request })
    } catch (error) {
      const failure = linkedImageExportFailure(error, request.background, MEDIA_SCHEME)
      if (failure) return failure
      throw error
    }
  })

  ipcMain.handle(CHANNELS.cancelVideoExport, async (event) => {
    assertTrustedSender(event)
    const operation = videoExportOperation.activeExportForOwner(event.sender.id)
    if (!operation) return false
    if (!operation.commitState.tryBeginCancellation()) return false
    operation.controller.abort()
    await operation.finished
    return true
  })
}

function sendMenuAction(action) {
  if (!MENU_ACTIONS.has(action) || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(CHANNELS.menuAction, action)
}

function applicationMenuTemplate() {
  const macAppMenu =
    process.platform === 'darwin'
      ? [
          {
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
          },
        ]
      : []

  return [
    ...macAppMenu,
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CommandOrControl+N',
          click: () => sendMenuAction('new'),
        },
        {
          label: 'Open Project…',
          accelerator: 'CommandOrControl+O',
          click: () => sendMenuAction('open'),
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CommandOrControl+S', click: () => sendMenuAction('save') },
        {
          label: 'Save As…',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => sendMenuAction('save-as'),
        },
        { type: 'separator' },
        {
          label: 'Import Audio…',
          accelerator: 'CommandOrControl+Shift+A',
          click: () => sendMenuAction('import-audio'),
        },
        {
          label: 'Import LRC…',
          accelerator: 'CommandOrControl+Shift+L',
          click: () => sendMenuAction('import-lrc'),
        },
        {
          label: 'Export Lyrics…',
          accelerator: 'CommandOrControl+Shift+E',
          click: () => sendMenuAction('export'),
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: () => sendMenuAction('undo') },
        {
          label: 'Redo',
          accelerator: 'Shift+CommandOrControl+Z',
          click: () => sendMenuAction('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        {
          label: 'Select All',
          accelerator: 'CommandOrControl+A',
          click: () => sendMenuAction('select-all'),
        },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play/Pause',
          accelerator: 'Shift+Space',
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
        ...(useBuiltRenderer() ? [] : [{ role: 'toggleDevTools' }]),
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

    if (!useBuiltRenderer()) {
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
  const releaseRendererScope = () => {
    mediaCapabilities.releaseOwner(ownerId)
    void projectOpens.releaseOwner(ownerId)
  }
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
    if (isMainFrame && !isInPlace) {
      clearNativeCloseOwnership(ownerId)
      releaseRendererScope()
    }
  })
  let terminalScopeReleased = false
  const releaseTerminalScope = () => {
    if (terminalScopeReleased) return
    terminalScopeReleased = true
    clearNativeCloseOwnership(ownerId)
    releaseRendererScope()
  }
  contents.once('render-process-gone', releaseTerminalScope)
  contents.once('destroyed', () => {
    releaseTerminalScope()
  })
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const contentSize = visualSmokeConfig ? VISUAL_SMOKE_VIEWPORT : { height: 900, width: 1440 }

  const window = new BrowserWindow({
    title: APP_NAME,
    width: contentSize.width,
    height: contentSize.height,
    minWidth: 1080,
    minHeight: 680,
    enableLargerThanScreen: visualSmokeConfig !== null,
    show: false,
    backgroundColor: '#f8f6fb',
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
  if (visualSmokeConfig) visualSmokeFatalObserver.observeRenderer(window.webContents)
  const clearNativeCloseOwnershipAfterWindowClosed = createNativeCloseOwnershipCleanup(
    window.webContents,
    clearNativeCloseOwnership,
  )

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
  window.on('close', (event) => {
    if (nativeCloseArbiter.consumeWindowCloseApproval()) return
    if (
      window.webContents.isDestroyed() ||
      !nativeCloseRendererReadiness.isReady(window.webContents.id)
    )
      return
    event.preventDefault()
    nativeCloseArbiter.requestWindowClose()
  })
  window.on('closed', () => {
    clearNativeCloseOwnershipAfterWindowClosed()
    if (mainWindow === window) mainWindow = null
  })

  if (useBuiltRenderer()) {
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
    void createMainWindow().catch((error) =>
      console.error('Unable to create the main window:', error),
    )
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function installRendererPermissionPolicy() {
  const localFonts = createLocalFontPermissionPolicy({
    getMainWindow: () => mainWindow,
    trustedOrigin: rendererOrigin(),
  })
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      localFonts.check(webContents, permission, requestingOrigin, details),
  )
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(localFonts.request(webContents, permission, details)),
  )
}

const hasSingleInstanceLock = !visualSmokeStartupFailed && app.requestSingleInstanceLock()

if (visualSmokeStartupFailed) {
  app.exit(1)
} else if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  app.on('before-quit', (event) => {
    if (nativeCloseArbiter.consumeAppQuitApproval()) return
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed() ||
      !nativeCloseRendererReadiness.isReady(mainWindow.webContents.id)
    )
      return
    event.preventDefault()
    nativeCloseArbiter.requestAppQuit()
  })

  app
    .whenReady()
    .then(async () => {
      if (useBuiltRenderer()) installApplicationProtocol()
      installMediaProtocol()
      registerIpcHandlers()
      installApplicationMenu()

      app.setAboutPanelOptions({
        applicationName: APP_NAME,
        applicationVersion: app.getVersion(),
      })

      installRendererPermissionPolicy()

      const window = await createMainWindow()
      if (visualSmokeConfig) {
        const outcome = await runVisualSmoke({
          app,
          config: visualSmokeConfig,
          fatalObserver: visualSmokeFatalObserver,
          window,
        })
        visualSmokeFatalObserver.dispose()
        app.exit(outcome.ok && !visualSmokeFatalObserver.hasFatal() ? 0 : 1)
      }
    })
    .catch((error) => {
      if (visualSmokeConfig) {
        app.exit(1)
        return
      }
      console.error('Failed to start Okay Karaoke Studio:', error)
      dialog.showErrorBox('Unable to start Okay Karaoke Studio', String(error?.message || error))
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
      app.quit()
    })

  if (!visualSmokeConfig) app.on('activate', focusMainWindow)

  app.on('window-all-closed', () => {
    if (!visualSmokeConfig && process.platform !== 'darwin') app.quit()
  })
}
