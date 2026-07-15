'use strict'

const NATIVE_CLOSE_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isNativeCloseRequestId(value) {
  return typeof value === 'string' && value.length === 36 && NATIVE_CLOSE_REQUEST_ID.test(value)
}

function createNativeCloseRendererReadiness() {
  let readyOwnerId = null
  return Object.freeze({
    markReady(ownerId) {
      readyOwnerId = ownerId
    },
    isReady: (ownerId) => readyOwnerId === ownerId,
    clear(ownerId) {
      if (ownerId !== undefined && ownerId !== readyOwnerId) return false
      readyOwnerId = null
      return true
    },
  })
}

function createNativeCloseArbiter({
  createRequestId,
  hasActiveExport,
  requestExportCancellation,
  sendRequest,
  closeWindow,
  quitApp,
  onError = () => {},
}) {
  let pending = null
  let exportOwner = null
  let approval = null

  const strongerAction = (left, right) => (left === 'app' || right === 'app' ? 'app' : 'window')

  const authorize = (action) => {
    approval = action === 'app' ? 'app-quit' : 'window-close'
    if (action === 'app') quitApp()
    else closeWindow()
  }

  const sendRendererRequest = (action) => {
    if (approval) return null
    if (pending?.action === action) {
      try {
        if (sendRequest(pending) === false) pending = null
      } catch (error) {
        pending = null
        onError(error)
      }
      return pending
    }
    if (pending && strongerAction(pending.action, action) === pending.action) return pending

    const requestId = createRequestId()
    if (!isNativeCloseRequestId(requestId)) {
      throw new TypeError('Native close request IDs must be UUIDs')
    }
    const request = Object.freeze({ requestId, action })
    pending = request
    try {
      if (sendRequest(request) === false) pending = null
    } catch (error) {
      pending = null
      onError(error)
    }
    return pending
  }

  const beginExportCancellation = (action, rendererAuthorizedAction = null) => {
    if (approval) return
    if (exportOwner) {
      exportOwner.action = strongerAction(exportOwner.action, action)
      exportOwner.rendererAuthorizedAction ||= rendererAuthorizedAction
    } else {
      exportOwner = { action, rendererAuthorizedAction }
    }
    const owned = exportOwner
    let result
    try {
      result = requestExportCancellation(action)
    } catch (error) {
      if (exportOwner === owned) exportOwner = null
      onError(error)
      return
    }
    void Promise.resolve(result).then(
      (accepted) => {
        if (!accepted && exportOwner === owned) exportOwner = null
      },
      (error) => {
        if (exportOwner === owned) exportOwner = null
        onError(error)
      },
    )
  }

  const request = (action) => {
    if (action !== 'window' && action !== 'app') {
      throw new TypeError('Native close action must be window or app')
    }
    if (approval) return null
    if (hasActiveExport()) {
      beginExportCancellation(action)
      return null
    }
    return sendRendererRequest(action)
  }

  const resolve = (requestId, proceed) => {
    if (!isNativeCloseRequestId(requestId) || typeof proceed !== 'boolean') return false
    if (!pending || pending.requestId !== requestId || approval) return false
    const action = pending.action
    pending = null
    if (!proceed) return true
    if (hasActiveExport()) {
      beginExportCancellation(action, action)
      return true
    }
    authorize(action)
    return true
  }

  const resumeAfterExport = (action) => {
    if ((action !== 'window' && action !== 'app') || !exportOwner || approval) return false
    const owned = exportOwner
    const resumedAction = strongerAction(owned.action, action)
    exportOwner = null
    if (hasActiveExport()) {
      beginExportCancellation(resumedAction, owned.rendererAuthorizedAction)
      return false
    }
    if (owned.rendererAuthorizedAction === resumedAction) authorize(resumedAction)
    else sendRendererRequest(resumedAction)
    return true
  }

  const clear = () => {
    pending = null
    exportOwner = null
    approval = null
  }

  return Object.freeze({
    requestWindowClose: () => request('window'),
    requestAppQuit: () => request('app'),
    getPendingRequest: () => pending,
    resolve,
    resumeAfterExport,
    consumeWindowCloseApproval: () => {
      if (approval !== 'window-close' && approval !== 'app-window-close') return false
      approval = null
      return true
    },
    consumeAppQuitApproval: () => {
      if (approval === 'app-quit') approval = 'app-window-close'
      return approval === 'app-window-close'
    },
    clear,
  })
}

module.exports = {
  createNativeCloseArbiter,
  createNativeCloseRendererReadiness,
  isNativeCloseRequestId,
}
