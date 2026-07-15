'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = Object.freeze({
  openProject: 'studio:open-project',
  settleProjectOpen: 'studio:settle-project-open',
  resetProjectScope: 'studio:reset-project-scope',
  saveProject: 'studio:save-project',
  importAudio: 'studio:import-audio',
  resolveProjectAudio: 'studio:resolve-project-audio',
  releaseAudio: 'studio:release-audio',
  importLrc: 'studio:import-lrc',
  exportText: 'studio:export-text',
  exportVideo: 'studio:export-video',
  cancelVideoExport: 'studio:cancel-video-export',
  videoExportProgress: 'studio:video-export-progress',
  menuAction: 'studio:menu-action',
  windowCloseRequest: 'studio:window-close-request',
  getPendingWindowClose: 'studio:get-pending-window-close',
  resolveWindowClose: 'studio:resolve-window-close',
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
const VIDEO_EXPORT_PHASES = new Set(['preparing', 'frames', 'encoding', 'complete'])
const WINDOW_CLOSE_ACTIONS = new Set(['window', 'app'])
const WINDOW_CLOSE_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isWindowCloseRequestId(value) {
  return typeof value === 'string' && value.length === 36 && WINDOW_CLOSE_REQUEST_ID.test(value)
}

function normalizeWindowCloseRequest(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !isWindowCloseRequestId(value.requestId) ||
    !WINDOW_CLOSE_ACTIONS.has(value.action)
  ) {
    return null
  }
  return Object.freeze({ requestId: value.requestId, action: value.action })
}

const studio = Object.freeze({
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  settleProjectOpen: async (requestId, accepted) =>
    (await ipcRenderer.invoke(CHANNELS.settleProjectOpen, { requestId, accepted })) === true,
  resetProjectScope: async () => (await ipcRenderer.invoke(CHANNELS.resetProjectScope)) === true,
  saveProject: (options) => ipcRenderer.invoke(CHANNELS.saveProject, options),
  importAudio: () => ipcRenderer.invoke(CHANNELS.importAudio),
  resolveProjectAudio: (projectPath) =>
    ipcRenderer.invoke(CHANNELS.resolveProjectAudio, { projectPath }),
  releaseAudio: () => ipcRenderer.invoke(CHANNELS.releaseAudio),
  importLrc: () => ipcRenderer.invoke(CHANNELS.importLrc),
  exportText: (options) => ipcRenderer.invoke(CHANNELS.exportText, options),
  exportVideo: (options) => ipcRenderer.invoke(CHANNELS.exportVideo, options),
  cancelVideoExport: () => ipcRenderer.invoke(CHANNELS.cancelVideoExport),
  getPendingWindowClose: async () =>
    normalizeWindowCloseRequest(await ipcRenderer.invoke(CHANNELS.getPendingWindowClose)),
  resolveWindowClose: async (requestId, proceed) => {
    if (!isWindowCloseRequestId(requestId)) {
      throw new TypeError('resolveWindowClose requires a UUID requestId')
    }
    if (typeof proceed !== 'boolean') {
      throw new TypeError('resolveWindowClose requires a boolean decision')
    }
    return (await ipcRenderer.invoke(CHANNELS.resolveWindowClose, { requestId, proceed })) === true
  },
  onWindowCloseRequest: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onWindowCloseRequest requires a callback function')
    }
    const listener = (_event, value) => {
      const request = normalizeWindowCloseRequest(value)
      if (request) callback(request)
    }
    ipcRenderer.on(CHANNELS.windowCloseRequest, listener)
    return () => ipcRenderer.removeListener(CHANNELS.windowCloseRequest, listener)
  },
  onVideoExportProgress: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onVideoExportProgress requires a callback function')
    }

    const listener = (_event, progress) => {
      if (
        !progress ||
        typeof progress !== 'object' ||
        !VIDEO_EXPORT_PHASES.has(progress.phase) ||
        !Number.isFinite(progress.completed) ||
        !Number.isFinite(progress.total)
      )
        return
      callback(
        Object.freeze({
          phase: progress.phase,
          completed: Math.max(0, progress.completed),
          total: Math.max(1, progress.total),
        }),
      )
    }

    ipcRenderer.on(CHANNELS.videoExportProgress, listener)
    return () => ipcRenderer.removeListener(CHANNELS.videoExportProgress, listener)
  },
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('onMenuAction requires a callback function')
    }

    const listener = (_event, action) => {
      if (MENU_ACTIONS.has(action)) callback(action)
    }

    ipcRenderer.on(CHANNELS.menuAction, listener)
    return () => ipcRenderer.removeListener(CHANNELS.menuAction, listener)
  },
})

contextBridge.exposeInMainWorld('studio', studio)
