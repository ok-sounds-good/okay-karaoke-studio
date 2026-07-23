'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
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
  createStudioProtocolHandlers,
  installStudioProtocolHandlers,
  registerStudioSchemes,
} = require('./studio-protocols.cjs')
const {
  createIpcHandlerRegistration,
  installIpcHandlerRegistration,
} = require('./ipc-handlers.cjs')
const {
  createExternalUrlOpener,
  createMainWindowOptions,
  isAllowedAppNavigation,
  secureWebContents,
} = require('./window-security.cjs')
const { prepareVisualSmokeStartup } = require('./visual-smoke-startup.cjs')

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
  resolveStyleTemplateBackground: 'studio:resolve-style-template-background',
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

const visualSmokeStartup = prepareVisualSmokeStartup({
  argv: process.argv,
  app,
  processHandle: process,
  loadVisualSmoke: () => require('./video-style-visual-smoke.cjs'),
})
const visualSmokeConfig = visualSmokeStartup.config
const visualSmokeFatalObserver = visualSmokeStartup.fatalObserver
const visualSmokeModule = visualSmokeStartup.module
const visualSmokeStartupFailed = visualSmokeStartup.startupFailed

const styleTemplateStore = createStyleTemplateStore({
  filePath: path.join(app.getPath('userData'), 'style-templates.json'),
})

registerStudioSchemes({ protocol, appScheme: APP_SCHEME, mediaScheme: MEDIA_SCHEME })

function rendererOrigin() {
  return useBuiltRenderer() ? `${APP_SCHEME}://${APP_HOST}` : new URL(DEVELOPMENT_URL).origin
}

function useBuiltRenderer() {
  return app.isPackaged || visualSmokeConfig !== null
}

const protocolHandlers = createStudioProtocolHandlers({
  appHost: APP_HOST,
  appMimeTypes: APP_MIME_TYPES,
  appScheme: APP_SCHEME,
  audioMimeTypes: AUDIO_MIME_TYPES,
  distRoot: DIST_ROOT,
  getMainWindow: () => mainWindow,
  getRendererOrigin: rendererOrigin,
  mediaCapabilities,
  mediaScheme: MEDIA_SCHEME,
  mediaTokenFromUrl,
})

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
  const handlers = createIpcHandlerRegistration({
    assertTrustedSender,
    backgroundCapabilityState,
    backgroundImageFilters: BACKGROUND_IMAGE_FILTERS,
    channels: CHANNELS,
    createElectronNativeImageDecoder,
    dialog,
    fs,
    isNativeCloseRequestId,
    isRecord,
    linkedImageExportFailure,
    linkedImageMedia,
    lrcFilters: LRC_FILTERS,
    maxLrcFileBytes: MAX_LRC_FILE_BYTES,
    maxProjectFileBytes: MAX_PROJECT_FILE_BYTES,
    makeMediaResult,
    mediaCapabilities,
    mediaScheme: MEDIA_SCHEME,
    normalizeBackgroundMutationRequest,
    normalizeExportRequest,
    normalizeMediaCapabilityReference,
    normalizeProjectRequest,
    normalizeVideoExportRequest,
    nativeCloseArbiter,
    nativeCloseRendererReadiness,
    path,
    projectOpenFilters: PROJECT_OPEN_FILTERS,
    projectOpens,
    readLinkedImage,
    readUtf8FileWithinLimit,
    registerAudioResult,
    requireString,
    styleTemplateStore,
    withParsedProject,
    writeTextExport,
    videoExportOperation,
    audioExtensions: AUDIO_EXTENSIONS,
    audioFilters: AUDIO_FILTERS,
    saveValidatedProject,
  })
  installIpcHandlerRegistration(ipcMain, handlers)
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

const openExternalUrl = createExternalUrlOpener({ openExternal: shell.openExternal.bind(shell) })

const allowedAppNavigation = (url) =>
  isAllowedAppNavigation(url, {
    appHost: APP_HOST,
    appScheme: APP_SCHEME,
    developmentUrl: DEVELOPMENT_URL,
    useBuiltRenderer,
  })

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const window = new BrowserWindow(
    createMainWindowOptions({
      appName: APP_NAME,
      preloadPath: path.join(__dirname, 'preload.cjs'),
      visualSmokeConfig,
      visualSmokeViewport: visualSmokeModule?.VIEWPORT,
    }),
  )

  mainWindow = window
  secureWebContents(window.webContents, {
    BrowserWindow,
    clearNativeCloseOwnership,
    dialog,
    isAllowedNavigation: allowedAppNavigation,
    openExternalUrl,
    releaseOwner(ownerId) {
      mediaCapabilities.releaseOwner(ownerId)
      void projectOpens.releaseOwner(ownerId)
    },
  })
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
      installStudioProtocolHandlers({
        protocol,
        handlers: protocolHandlers,
        appScheme: APP_SCHEME,
        mediaScheme: MEDIA_SCHEME,
        installApplication: useBuiltRenderer(),
      })
      registerIpcHandlers()
      installApplicationMenu()

      app.setAboutPanelOptions({
        applicationName: APP_NAME,
        applicationVersion: app.getVersion(),
      })

      installRendererPermissionPolicy()

      const window = await createMainWindow()
      if (visualSmokeConfig) {
        const outcome = await visualSmokeModule.runVisualSmoke({
          app,
          config: visualSmokeConfig,
          fatalObserver: visualSmokeFatalObserver,
          getWindows: () => BrowserWindow.getAllWindows(),
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
