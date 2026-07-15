'use strict'

const VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS = Object.freeze({
  type: 'warning',
  buttons: Object.freeze(['Keep Exporting', 'Cancel Export']),
  defaultId: 0,
  cancelId: 0,
  noLink: true,
  title: 'Video export in progress',
  message: 'Cancel the video export?',
  detail: 'The encoder will stop. Any partial MP4 will remain beside the destination you chose.',
})

function createVideoExportLifecycleGuard({
  confirmCancellation,
  abortActiveExport,
  closeWindow,
  quitApp,
  onError = () => {},
}) {
  let pendingAction = null
  let inFlight = null
  let generationClosed = false
  let queued = null

  const strongerAction = (left, right) => (left === 'app' || right === 'app' ? 'app' : 'window')

  const queueNextGeneration = (action) => {
    if (queued) {
      queued.action = strongerAction(queued.action, action)
      return queued.promise
    }
    let resolve
    const promise = new Promise((accept) => {
      resolve = accept
    })
    queued = { action, promise, resolve }
    return promise
  }

  const start = (action) => {
    pendingAction = action
    generationClosed = false
    inFlight = Promise.resolve()
      .then(confirmCancellation)
      .then(async (confirmed) => {
        if (!confirmed) {
          pendingAction = null
          generationClosed = true
          return false
        }
        await abortActiveExport()
        const acceptedAction = pendingAction
        pendingAction = null
        generationClosed = true
        if (acceptedAction === 'app') quitApp()
        else if (acceptedAction === 'window') closeWindow()
        return true
      })
      .catch((error) => {
        pendingAction = null
        generationClosed = true
        onError(error)
        return false
      })
      .finally(() => {
        inFlight = null
        const next = queued
        queued = null
        if (next) void start(next.action).then(next.resolve)
      })
    return inFlight
  }

  const request = (action) => {
    if (action !== 'window' && action !== 'app') {
      return Promise.reject(new TypeError('Video export lifecycle action must be window or app'))
    }
    if (!inFlight) return start(action)
    if (generationClosed) return queueNextGeneration(action)
    pendingAction = strongerAction(pendingAction, action)
    return inFlight
  }

  return {
    requestAppQuit: () => request('app'),
    requestWindowClose: () => request('window'),
  }
}

module.exports = {
  VIDEO_EXPORT_CANCEL_DIALOG_OPTIONS,
  createVideoExportLifecycleGuard,
}
