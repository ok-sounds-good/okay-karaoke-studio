'use strict'

function canceledVideoExportError() {
  const error = new Error('Video export canceled')
  error.name = 'AbortError'
  return error
}

function throwIfCanceled(signal) {
  if (signal.aborted) throw canceledVideoExportError()
}

function createVideoExportOperation({
  parseProject,
  createCommitState,
  prepareExport,
  selectDestination,
  executeExport,
  sendProgress,
}) {
  let activeExport = null

  function beginExport(ownerId) {
    let resolveFinished
    const operation = {
      ownerId,
      controller: new AbortController(),
      commitState: createCommitState(),
      finished: new Promise((resolve) => { resolveFinished = resolve }),
      resolveFinished,
    }
    activeExport = operation
    return operation
  }

  async function run({ owner, sender, request }) {
    // The injected parser owns project-format policy. Keep it synchronous and
    // first so lifecycle and I/O cannot begin before it accepts the request.
    parseProject(request.projectJson)
    if (activeExport) throw new Error('Another karaoke video export is already running')

    const operation = beginExport(sender.id)
    const abortWhenOwnerCloses = () => {
      if (operation.commitState.tryBeginCancellation()) operation.controller.abort()
    }
    let ownerListenerAttached = false

    try {
      sender.once('destroyed', abortWhenOwnerCloses)
      ownerListenerAttached = true

      const preparation = await prepareExport({
        owner, request, signal: operation.controller.signal,
      })
      if (!preparation) return null
      throwIfCanceled(operation.controller.signal)

      const destination = await selectDestination({
        owner, request, preparation, signal: operation.controller.signal,
      })
      if (!destination) return null
      throwIfCanceled(operation.controller.signal)

      const onProgress = (progress) => {
        if (!sender.isDestroyed()) sendProgress(sender, progress)
      }
      return await executeExport({ request, preparation, destination, operation, onProgress })
    } finally {
      if (ownerListenerAttached) sender.removeListener('destroyed', abortWhenOwnerCloses)
      if (activeExport === operation) activeExport = null
      operation.resolveFinished()
    }
  }

  function activeExportForOwner(ownerId) {
    return activeExport?.ownerId === ownerId ? activeExport : null
  }

  async function abortActiveExport() {
    const operation = activeExport
    if (!operation) return
    if (operation.commitState.state === 'canceling') return operation.finished
    if (!operation.commitState.tryBeginCancellation()) {
      const error = new Error('Video export promotion has already begun and cannot be canceled')
      error.code = 'VIDEO_EXPORT_NOT_CANCELLABLE'
      throw error
    }
    operation.controller.abort()
    await operation.finished
  }

  return { abortActiveExport, activeExportForOwner, hasActiveExport: () => activeExport !== null, run }
}
module.exports = { createVideoExportOperation }
