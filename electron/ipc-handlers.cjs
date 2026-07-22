'use strict'

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`)
  return value
}

function createIpcHandlerRegistration(dependencies) {
  const {
    assertTrustedSender,
    backgroundCapabilityState,
    backgroundImageFilters,
    channels,
    createElectronNativeImageDecoder,
    dialog,
    fs,
    isNativeCloseRequestId,
    isRecord,
    linkedImageExportFailure,
    linkedImageMedia,
    lrcFilters,
    maxLrcFileBytes,
    maxProjectFileBytes,
    makeMediaResult,
    mediaCapabilities,
    mediaScheme,
    normalizeBackgroundMutationRequest,
    normalizeExportRequest,
    normalizeMediaCapabilityReference,
    normalizeProjectRequest,
    normalizeVideoExportRequest,
    nativeCloseArbiter,
    nativeCloseRendererReadiness,
    path,
    projectOpenFilters,
    projectOpens,
    readLinkedImage,
    readUtf8FileWithinLimit,
    registerAudioResult,
    requireString,
    styleTemplateStore,
    withParsedProject,
    writeTextExport,
    videoExportOperation,
    audioExtensions,
    audioFilters,
    saveValidatedProject,
  } = dependencies

  for (const [name, value] of Object.entries({
    assertTrustedSender,
    backgroundCapabilityState,
    createElectronNativeImageDecoder,
    isNativeCloseRequestId,
    isRecord,
    linkedImageExportFailure,
    linkedImageMedia,
    makeMediaResult,
    normalizeBackgroundMutationRequest,
    normalizeExportRequest,
    normalizeMediaCapabilityReference,
    normalizeProjectRequest,
    normalizeVideoExportRequest,
    readLinkedImage,
    readUtf8FileWithinLimit,
    registerAudioResult,
    requireString,
    withParsedProject,
    writeTextExport,
    saveValidatedProject,
  })) {
    requireFunction(value, name)
  }

  return [
    [
      channels.listStyleTemplates,
      async (event) => {
        assertTrustedSender(event)
        return styleTemplateStore.list()
      },
    ],
    [
      channels.createStyleTemplate,
      async (event, value) => {
        assertTrustedSender(event)
        return styleTemplateStore.create(value)
      },
    ],
    [
      channels.renameStyleTemplate,
      async (event, value) => {
        assertTrustedSender(event)
        return styleTemplateStore.rename(value)
      },
    ],
    [
      channels.deleteStyleTemplate,
      async (event, value) => {
        assertTrustedSender(event)
        return styleTemplateStore.delete(value)
      },
    ],
    [
      channels.getPendingWindowClose,
      async (event) => {
        assertTrustedSender(event)
        nativeCloseRendererReadiness.markReady(event.sender.id)
        return nativeCloseArbiter.getPendingRequest()
      },
    ],
    [
      channels.resolveWindowClose,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value)) throw new TypeError('resolveWindowClose requires an options object')
        if (!isNativeCloseRequestId(value.requestId)) {
          throw new TypeError('resolveWindowClose.requestId must be a UUID')
        }
        if (typeof value.proceed !== 'boolean') {
          throw new TypeError('resolveWindowClose.proceed must be a boolean')
        }
        return nativeCloseArbiter.resolve(value.requestId, value.proceed)
      },
    ],
    [
      channels.openProject,
      async (event) => {
        const owner = assertTrustedSender(event)
        const ownerId = event.sender.id
        const requestId = projectOpens.beginOpen(ownerId)
        const result = await dialog.showOpenDialog(owner, {
          title: 'Open Karaoke Project',
          buttonLabel: 'Open Project',
          properties: ['openFile'],
          filters: projectOpenFilters,
        })

        if (result.canceled || result.filePaths.length === 0) return null

        const filePath = path.resolve(result.filePaths[0])
        const contents = await readUtf8FileWithinLimit(
          filePath,
          maxProjectFileBytes,
          'Project file',
        )
        return projectOpens.stageOpen(ownerId, requestId, filePath, contents)
      },
    ],
    [
      channels.settleProjectOpen,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value)) throw new TypeError('settleProjectOpen requires an options object')
        const requestId = requireString(value.requestId, 'requestId')
        if (typeof value.accepted !== 'boolean') {
          throw new TypeError('settleProjectOpen.accepted must be a boolean')
        }
        return projectOpens.settleOpen(event.sender.id, requestId, value.accepted)
      },
    ],
    [
      channels.resetProjectScope,
      async (event) => {
        assertTrustedSender(event)
        return projectOpens.resetProjectScope(event.sender.id)
      },
    ],
    [
      channels.saveProject,
      async (event, value) => {
        const owner = assertTrustedSender(event)
        const ownerId = event.sender.id
        const request = normalizeProjectRequest(value)
        return withParsedProject(request.contents, () =>
          saveValidatedProject(owner, ownerId, request),
        )
      },
    ],
    [
      channels.importAudio,
      async (event) => {
        const owner = assertTrustedSender(event)
        const ownerId = event.sender.id
        const requestSequence = mediaCapabilities.beginRequest(ownerId, 'audio')
        const result = await dialog.showOpenDialog(owner, {
          title: 'Import Audio',
          buttonLabel: 'Import Audio',
          properties: ['openFile'],
          filters: audioFilters,
        })

        if (result.canceled || result.filePaths.length === 0) {
          mediaCapabilities.finishRequest(ownerId, 'audio', requestSequence)
          return null
        }

        const filePath = path.resolve(result.filePaths[0])
        const extension = path.extname(filePath).toLowerCase()
        const fileStats = await fs.stat(filePath)
        if (!fileStats.isFile() || !audioExtensions.has(extension)) {
          mediaCapabilities.finishRequest(ownerId, 'audio', requestSequence)
          throw new TypeError('The selected file is not a supported audio file')
        }
        if (!mediaCapabilities.requestIsCurrent(ownerId, 'audio', requestSequence)) return null

        return registerAudioResult(filePath, event.sender, requestSequence)
      },
    ],
    [
      channels.resolveProjectAudio,
      async (event, value) => {
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
      },
    ],
    [
      channels.releaseAudio,
      async (event) => {
        assertTrustedSender(event)
        mediaCapabilities.resetKind(event.sender.id, 'audio')
      },
    ],
    [
      channels.getBackgroundState,
      async (event) => {
        assertTrustedSender(event)
        return backgroundCapabilityState(event.sender.id)
      },
    ],
    [
      channels.chooseBackgroundImage,
      async (event) => {
        const owner = assertTrustedSender(event)
        const ownerId = event.sender.id
        const requestSequence = mediaCapabilities.beginRequest(ownerId, 'background')
        const result = await dialog.showOpenDialog(owner, {
          title: 'Choose Video Background',
          buttonLabel: 'Choose Image',
          properties: ['openFile'],
          filters: backgroundImageFilters,
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
          if (!mediaCapabilities.requestIsCurrent(ownerId, 'background', requestSequence))
            return null
          throw error
        }
        const token = mediaCapabilities.registerBackgroundCandidate(
          ownerId,
          filePath,
          linkedImageMedia(image),
          requestSequence,
        )
        return token ? makeMediaResult(token, filePath, 'background') : null
      },
    ],
    [
      channels.resolveProjectBackground,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value))
          throw new TypeError('resolveProjectBackground requires an options object')
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
      },
    ],
    [
      channels.settleBackgroundImage,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value))
          throw new TypeError('settleBackgroundImage requires an options object')
        if (typeof value.accepted !== 'boolean') {
          throw new TypeError('settleBackgroundImage.accepted must be a boolean')
        }
        const candidate = normalizeMediaCapabilityReference(value.url, { scheme: mediaScheme })
        if (!candidate.valid || !candidate.token) return null
        return mediaCapabilities.settleBackgroundCandidate(
          event.sender.id,
          candidate.token,
          value.accepted,
        )
          ? backgroundCapabilityState(event.sender.id)
          : null
      },
    ],
    [
      channels.retainBackground,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value)) throw new TypeError('retainBackground requires an options object')
        const request = normalizeBackgroundMutationRequest(value, 'nullable', mediaScheme)
        if (!request.valid) return null
        return mediaCapabilities.retainBackground(
          event.sender.id,
          request.expectedRevision,
          request.expectedToken,
          request.targetToken,
        )
          ? backgroundCapabilityState(event.sender.id)
          : null
      },
    ],
    [
      channels.releaseBackground,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value)) throw new TypeError('releaseBackground requires an options object')
        const request = normalizeBackgroundMutationRequest(value, 'none', mediaScheme)
        if (!request.valid) return null
        return mediaCapabilities.releaseKind(
          event.sender.id,
          'background',
          request.expectedRevision,
          request.expectedToken,
        )
          ? backgroundCapabilityState(event.sender.id)
          : null
      },
    ],
    [
      channels.releaseBackgroundSnapshot,
      async (event, value) => {
        assertTrustedSender(event)
        if (!isRecord(value))
          throw new TypeError('releaseBackgroundSnapshot requires an options object')
        const request = normalizeBackgroundMutationRequest(value, 'required', mediaScheme)
        if (!request.valid || !request.targetToken) return null
        return mediaCapabilities.releaseBackgroundSnapshot(
          event.sender.id,
          request.expectedRevision,
          request.expectedToken,
          request.targetToken,
        )
          ? backgroundCapabilityState(event.sender.id)
          : null
      },
    ],
    [
      channels.importLrc,
      async (event) => {
        const owner = assertTrustedSender(event)
        const result = await dialog.showOpenDialog(owner, {
          title: 'Import LRC Lyrics',
          buttonLabel: 'Import Lyrics',
          properties: ['openFile'],
          filters: lrcFilters,
        })

        if (result.canceled || result.filePaths.length === 0) return null

        const filePath = path.resolve(result.filePaths[0])
        const contents = await readUtf8FileWithinLimit(filePath, maxLrcFileBytes, 'LRC file')
        return { path: filePath, name: path.basename(filePath), contents }
      },
    ],
    [
      channels.exportText,
      async (event, value) => {
        const owner = assertTrustedSender(event)
        const request = normalizeExportRequest(value)
        if (request.format === 'oks') {
          return withParsedProject(request.contents, () => writeTextExport(owner, request))
        }
        return writeTextExport(owner, request)
      },
    ],
    [
      channels.exportVideo,
      async (event, value) => {
        const owner = assertTrustedSender(event)
        const request = normalizeVideoExportRequest(value)
        try {
          return await videoExportOperation.run({ owner, sender: event.sender, request })
        } catch (error) {
          const failure = linkedImageExportFailure(error, request.background, mediaScheme)
          if (failure) return failure
          throw error
        }
      },
    ],
    [
      channels.cancelVideoExport,
      async (event) => {
        assertTrustedSender(event)
        const operation = videoExportOperation.activeExportForOwner(event.sender.id)
        if (!operation) return false
        if (!operation.commitState.tryBeginCancellation()) return false
        operation.controller.abort()
        await operation.finished
        return true
      },
    ],
  ]
}

function installIpcHandlerRegistration(ipcMain, handlers) {
  const installedChannels = []
  try {
    for (const [channel, handler] of handlers) {
      ipcMain.handle(channel, handler)
      installedChannels.push(channel)
    }
  } catch (error) {
    for (const channel of installedChannels.reverse()) ipcMain.removeHandler(channel)
    throw error
  }
}

module.exports = { createIpcHandlerRegistration, installIpcHandlerRegistration }
