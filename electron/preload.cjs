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

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  for (const key in value) if (!Object.hasOwn(value, key)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

const FONT_SIZES = new Set([
  8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 25, 27, 28, 32, 36, 40, 42, 48, 56, 64, 72, 82, 96, 104,
  120, 144, 180, 240, 320, 400,
])
const VIDEO_RESOLUTIONS = new Set(['240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'])

const validColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value)

function validFace(value) {
  if (!exactRecord(value, ['fullName', 'style', 'postscriptName', 'weight', 'slant'])) return false
  if (
    typeof value.fullName !== 'string' ||
    !value.fullName.trim() ||
    value.fullName.length > 300 ||
    typeof value.style !== 'string' ||
    !value.style.trim() ||
    value.style.length > 120 ||
    !Number.isSafeInteger(value.weight) ||
    value.weight < 100 ||
    value.weight > 900 ||
    !['normal', 'italic', 'oblique'].includes(value.slant)
  ) {
    return false
  }
  return (
    value.postscriptName === null ||
    (typeof value.postscriptName === 'string' &&
      /^[\x21-\x7e]{1,63}$/u.test(value.postscriptName) &&
      !/[\[\](){}<>/%]/u.test(value.postscriptName))
  )
}

function validTypeface(value) {
  if (!exactRecord(value, ['kind', 'family', 'faces'])) return false
  if (
    !['system-ui', 'system-monospace', 'local'].includes(value.kind) ||
    typeof value.family !== 'string' ||
    !value.family.trim() ||
    value.family.length > 300 ||
    !Array.isArray(value.faces) ||
    value.faces.length < 1 ||
    value.faces.length > 100
  ) {
    return false
  }
  for (let index = 0; index < value.faces.length; index += 1) {
    if (!Object.hasOwn(value.faces, index) || !validFace(value.faces[index])) return false
  }
  if (value.kind === 'local') {
    const names = value.faces.map((face) => face.postscriptName)
    return names.every((name) => name !== null) && new Set(names).size === names.length
  }
  const family = value.kind === 'system-ui' ? 'System UI' : 'System Monospace'
  const expected = [
    ['Regular', 400, 'normal'],
    ['Italic', 400, 'italic'],
    ['Semi Bold', 600, 'normal'],
    ['Bold', 700, 'normal'],
    ['Extra Bold', 800, 'normal'],
  ]
  return (
    value.family === family &&
    value.faces.length === expected.length &&
    value.faces.every(
      (face, index) =>
        face.fullName === `${family} ${expected[index][0]}` &&
        face.style === expected[index][0] &&
        face.postscriptName === null &&
        face.weight === expected[index][1] &&
        face.slant === expected[index][2],
    )
  )
}

function validTextStyle(value, visibility = false) {
  const keys = visibility
    ? ['typeface', 'fontStyle', 'sizePx', 'color', 'visible']
    : ['typeface', 'fontStyle', 'sizePx', 'color']
  return (
    exactRecord(value, keys) &&
    validTypeface(value.typeface) &&
    validFace(value.fontStyle) &&
    FONT_SIZES.has(value.sizePx) &&
    validColor(value.color) &&
    (!visibility || typeof value.visible === 'boolean')
  )
}

function validStageStyle(value) {
  if (!exactRecord(value, ['background', 'lyrics', 'titleCard', 'stageFrame'])) return false
  const { background, lyrics, titleCard, stageFrame } = value
  const validPath =
    background?.imagePath === null ||
    (typeof background?.imagePath === 'string' &&
      background.imagePath.length <= 8_192 &&
      !background.imagePath.includes('\0') &&
      (background.imagePath.startsWith('/') ||
        /^[A-Za-z]:[\\/]/u.test(background.imagePath) ||
        background.imagePath.startsWith('\\\\')))
  return (
    exactRecord(background, [
      'mode',
      'solidColor',
      'gradientStartColor',
      'gradientEndColor',
      'imagePath',
    ]) &&
    ['solid', 'gradient', 'image'].includes(background.mode) &&
    validColor(background.solidColor) &&
    validColor(background.gradientStartColor) &&
    validColor(background.gradientEndColor) &&
    validPath &&
    (background.mode !== 'image' || background.imagePath !== null) &&
    exactRecord(lyrics, ['typeface', 'fontStyle', 'sizePx', 'unsungColor', 'sungColor']) &&
    validTypeface(lyrics.typeface) &&
    validFace(lyrics.fontStyle) &&
    FONT_SIZES.has(lyrics.sizePx) &&
    validColor(lyrics.unsungColor) &&
    validColor(lyrics.sungColor) &&
    exactRecord(titleCard, ['eyebrow', 'title', 'artist']) &&
    ['eyebrow', 'title', 'artist'].every((key) => validTextStyle(titleCard[key], true)) &&
    exactRecord(stageFrame, ['enabled', 'lineColor', 'lineWidthPx', 'brand', 'clock', 'footer']) &&
    typeof stageFrame.enabled === 'boolean' &&
    validColor(stageFrame.lineColor) &&
    Number.isSafeInteger(stageFrame.lineWidthPx) &&
    stageFrame.lineWidthPx >= 0 &&
    stageFrame.lineWidthPx <= 32 &&
    ['brand', 'clock', 'footer'].every((key) => validTextStyle(stageFrame[key], true))
  )
}

function validVocalStyle(value) {
  if (
    !exactRecord(value, [
      'typeface',
      'fontStyle',
      'sizePx',
      'unsungColor',
      'sungColor',
      'alignment',
      'previewMs',
      'syncAid',
    ])
  ) {
    return false
  }
  const nullableColor = (candidate) => candidate === null || validColor(candidate)
  return (
    (value.typeface === null || validTypeface(value.typeface)) &&
    (value.fontStyle === null || validFace(value.fontStyle)) &&
    (value.sizePx === null || FONT_SIZES.has(value.sizePx)) &&
    nullableColor(value.unsungColor) &&
    nullableColor(value.sungColor) &&
    ['left', 'center', 'right'].includes(value.alignment) &&
    Number.isSafeInteger(value.previewMs) &&
    value.previewMs >= 0 &&
    value.previewMs <= 60_000 &&
    exactRecord(value.syncAid, ['enabled', 'minLeadMs', 'maxLeadMs']) &&
    typeof value.syncAid.enabled === 'boolean' &&
    Number.isSafeInteger(value.syncAid.minLeadMs) &&
    Number.isSafeInteger(value.syncAid.maxLeadMs) &&
    value.syncAid.minLeadMs >= 0 &&
    value.syncAid.minLeadMs <= value.syncAid.maxLeadMs &&
    value.syncAid.maxLeadMs <= value.previewMs
  )
}

function validPreferences(value) {
  if (!exactRecord(value, ['stageStyle', 'lyricDisplay', 'vocalStyle', 'videoExportDefaults'])) {
    return false
  }
  return (
    validStageStyle(value.stageStyle) &&
    exactRecord(value.lyricDisplay, ['lineCount', 'advanceMode']) &&
    Number.isSafeInteger(value.lyricDisplay.lineCount) &&
    value.lyricDisplay.lineCount >= 1 &&
    value.lyricDisplay.lineCount <= 5 &&
    ['clear', 'scroll'].includes(value.lyricDisplay.advanceMode) &&
    validVocalStyle(value.vocalStyle) &&
    exactRecord(value.videoExportDefaults, ['resolution', 'fps']) &&
    VIDEO_RESOLUTIONS.has(value.videoExportDefaults.resolution) &&
    (value.videoExportDefaults.fps === 30 || value.videoExportDefaults.fps === 60)
  )
}

function normalizeStyleTemplate(value) {
  if (!exactRecord(value, ['id', 'name', 'preferences'])) return null
  if (typeof value.id !== 'string' || !/^[\x21-\x7e]{1,128}$/u.test(value.id)) return null
  if (
    typeof value.name !== 'string' ||
    value.name.length < 1 ||
    value.name.length > 80 ||
    value.name !== value.name.trim().replace(/\s+/gu, ' ')
  ) {
    return null
  }
  if (!validPreferences(value.preferences)) return null
  return value
}

function requireStyleTemplate(value, operation) {
  const template = normalizeStyleTemplate(value)
  if (!template) throw new TypeError(`${operation} returned an invalid style template.`)
  return template
}

function requireStyleTemplateList(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError('listStyleTemplates returned an invalid style template list.')
  }
  return value.map((template) => requireStyleTemplate(template, 'listStyleTemplates'))
}

function requireStyleTemplateCreateRequest(value) {
  if (
    !exactRecord(value, ['name', 'preferences']) ||
    typeof value.name !== 'string' ||
    !validPreferences(value.preferences)
  ) {
    throw new TypeError('createStyleTemplate requires valid name and preferences values.')
  }
  return { name: value.name, preferences: value.preferences }
}

function requireStyleTemplateId(value, operation) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,128}$/u.test(value)) {
    throw new TypeError(`${operation} requires a valid style template id.`)
  }
  return value
}

function requireStyleTemplateName(value, operation) {
  if (typeof value !== 'string') {
    throw new TypeError(`${operation} requires a style template name.`)
  }
  return value
}

function validLinkedImagePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8_192 &&
    !value.includes('\0') &&
    (value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
  )
}

function validBackgroundMedia(value) {
  return (
    exactRecord(value, ['path', 'name', 'url']) &&
    validLinkedImagePath(value.path) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= 300 &&
    typeof value.url === 'string' &&
    /^studio-media:\/\/asset\/[0-9a-f-]{36}(?:\/|$)/iu.test(value.url)
  )
}

function requireStyleTemplateBackgroundResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('resolveStyleTemplateBackground returned an invalid result.')
  }
  if (value.status === 'success' && exactRecord(value, ['status', 'media'])) {
    if (validBackgroundMedia(value.media)) return value
  } else if (value.status === 'missing' && exactRecord(value, ['status', 'path'])) {
    if (validLinkedImagePath(value.path)) return value
  } else if (value.status === 'stale' && exactRecord(value, ['status'])) {
    return value
  }
  throw new TypeError('resolveStyleTemplateBackground returned an invalid result.')
}

const studio = Object.freeze({
  listStyleTemplates: async () =>
    requireStyleTemplateList(await ipcRenderer.invoke(CHANNELS.listStyleTemplates)),
  createStyleTemplate: async (options) =>
    requireStyleTemplate(
      await ipcRenderer.invoke(
        CHANNELS.createStyleTemplate,
        requireStyleTemplateCreateRequest(options),
      ),
      'createStyleTemplate',
    ),
  renameStyleTemplate: async (id, name) =>
    requireStyleTemplate(
      await ipcRenderer.invoke(CHANNELS.renameStyleTemplate, {
        id: requireStyleTemplateId(id, 'renameStyleTemplate'),
        name: requireStyleTemplateName(name, 'renameStyleTemplate'),
      }),
      'renameStyleTemplate',
    ),
  deleteStyleTemplate: async (id) => {
    const deleted = await ipcRenderer.invoke(CHANNELS.deleteStyleTemplate, {
      id: requireStyleTemplateId(id, 'deleteStyleTemplate'),
    })
    if (deleted !== true) throw new TypeError('deleteStyleTemplate returned an invalid result.')
    return true
  },
  resolveStyleTemplateBackground: async (id) =>
    requireStyleTemplateBackgroundResult(
      await ipcRenderer.invoke(CHANNELS.resolveStyleTemplateBackground, {
        id: requireStyleTemplateId(id, 'resolveStyleTemplateBackground'),
      }),
    ),
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  settleProjectOpen: async (requestId, accepted) =>
    (await ipcRenderer.invoke(CHANNELS.settleProjectOpen, { requestId, accepted })) === true,
  resetProjectScope: async () => (await ipcRenderer.invoke(CHANNELS.resetProjectScope)) === true,
  saveProject: (options) => ipcRenderer.invoke(CHANNELS.saveProject, options),
  importAudio: () => ipcRenderer.invoke(CHANNELS.importAudio),
  resolveProjectAudio: (projectPath) =>
    ipcRenderer.invoke(CHANNELS.resolveProjectAudio, { projectPath }),
  releaseAudio: () => ipcRenderer.invoke(CHANNELS.releaseAudio),
  getBackgroundState: () => ipcRenderer.invoke(CHANNELS.getBackgroundState),
  chooseBackgroundImage: () => ipcRenderer.invoke(CHANNELS.chooseBackgroundImage),
  resolveProjectBackground: (projectPath) =>
    ipcRenderer.invoke(CHANNELS.resolveProjectBackground, { projectPath }),
  settleBackgroundImage: (url, accepted) =>
    ipcRenderer.invoke(CHANNELS.settleBackgroundImage, { url, accepted }),
  retainBackground: (expected, url) =>
    ipcRenderer.invoke(CHANNELS.retainBackground, { expected, url }),
  releaseBackground: (expected) => ipcRenderer.invoke(CHANNELS.releaseBackground, { expected }),
  releaseBackgroundSnapshot: (expected, url) =>
    ipcRenderer.invoke(CHANNELS.releaseBackgroundSnapshot, { expected, url }),
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
