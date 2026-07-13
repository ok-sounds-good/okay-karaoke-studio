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

  const request = (action) => {
    if (action !== 'window' && action !== 'app') {
      return Promise.reject(new TypeError('Video export lifecycle action must be window or app'))
    }
    if (action === 'app' || pendingAction === null) pendingAction = action
    if (inFlight) return inFlight

    inFlight = Promise.resolve()
      .then(confirmCancellation)
      .then(async (confirmed) => {
        if (!confirmed) {
          pendingAction = null
          return false
        }
        await abortActiveExport()
        const acceptedAction = pendingAction
        pendingAction = null
        if (acceptedAction === 'app') quitApp()
        else if (acceptedAction === 'window') closeWindow()
        return true
      })
      .catch((error) => {
        pendingAction = null
        onError(error)
        return false
      })
      .finally(() => {
        inFlight = null
      })

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
