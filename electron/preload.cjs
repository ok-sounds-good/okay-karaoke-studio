'use strict'

const { contextBridge, ipcRenderer } = require('electron')

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
const VIDEO_EXPORT_PHASES = new Set(['preparing', 'frames', 'encoding', 'complete'])

const studio = Object.freeze({
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  saveProject: (options) => ipcRenderer.invoke(CHANNELS.saveProject, options),
  importAudio: () => ipcRenderer.invoke(CHANNELS.importAudio),
  resolveAudio: (filePath) => ipcRenderer.invoke(CHANNELS.resolveAudio, filePath),
  releaseAudio: () => ipcRenderer.invoke(CHANNELS.releaseAudio),
  importLrc: () => ipcRenderer.invoke(CHANNELS.importLrc),
  exportText: (options) => ipcRenderer.invoke(CHANNELS.exportText, options),
  exportVideo: (options) => ipcRenderer.invoke(CHANNELS.exportVideo, options),
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
      ) return
      callback(Object.freeze({
        phase: progress.phase,
        completed: Math.max(0, progress.completed),
        total: Math.max(1, progress.total),
      }))
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
