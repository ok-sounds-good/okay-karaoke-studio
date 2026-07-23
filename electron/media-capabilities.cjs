'use strict'

const { randomUUID } = require('node:crypto')
const path = require('node:path')

const MEDIA_KINDS = Object.freeze(['audio', 'background'])
const MEDIA_KIND_SET = new Set(MEDIA_KINDS)
const MEDIA_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WINDOWS_DRIVE_PATH = /^[a-z]:[\\/]/i
const WINDOWS_UNC_PATH = /^(?:\\\\|\/\/)(?![?.](?:[\\/]|$))[^\\/]+[\\/][^\\/]+(?:[\\/].*)?$/

function assertKind(kind) {
  if (!MEDIA_KIND_SET.has(kind)) throw new TypeError('Unknown media capability kind')
}

function mediaTokenFromUrl(rawUrl, scheme = 'studio-media') {
  if (typeof rawUrl !== 'string') return null
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${scheme}:` || url.hostname !== 'asset') return null
    const token = url.pathname.split('/').filter(Boolean)[0]
    return token && MEDIA_TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  }
}

function normalizeMediaCapabilityReference(value, { allowNull = false, scheme } = {}) {
  if (value === null) return Object.freeze({ token: null, valid: allowNull })
  const token = mediaTokenFromUrl(value, scheme)
  return Object.freeze({ token, valid: Boolean(token) })
}

function normalizeBackgroundCapabilityState(value, scheme = 'studio-media') {
  const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const active = normalizeMediaCapabilityReference(state.activeUrl, { allowNull: true, scheme })
  const revision = typeof state.revision === 'string' ? state.revision : null
  return Object.freeze({
    activeToken: active.token,
    revision,
    valid: active.valid && revision !== null && MEDIA_TOKEN_PATTERN.test(revision),
  })
}

function normalizeBackgroundMutationRequest(value, targetMode = 'none', scheme = 'studio-media') {
  const request = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const expected = normalizeBackgroundCapabilityState(request.expected, scheme)
  const target = normalizeMediaCapabilityReference(request.url, {
    allowNull: targetMode === 'nullable',
    scheme,
  })
  const targetValid = targetMode === 'none' || target.valid
  return Object.freeze({
    expectedRevision: expected.revision,
    expectedToken: expected.activeToken,
    targetToken: target.token,
    valid: expected.valid && targetValid,
  })
}

function classifyBackgroundPath(value, platform = process.platform) {
  let syntax = 'relative'
  if (typeof value === 'string' && WINDOWS_UNC_PATH.test(value)) syntax = 'windows-unc'
  else if (typeof value === 'string' && WINDOWS_DRIVE_PATH.test(value)) syntax = 'windows-drive'
  else if (typeof value === 'string' && path.posix.isAbsolute(value)) syntax = 'posix'

  const windowsNative = platform === 'win32' && syntax.startsWith('windows-')
  const posixNative = platform !== 'win32' && syntax === 'posix'
  const nativePath = windowsNative
    ? path.win32.normalize(value)
    : posixNative
      ? path.posix.normalize(value)
      : null
  return Object.freeze({ nativePath, syntax })
}

function prepareProjectMedia(projectPath, project, audioExtensions, platform = process.platform) {
  let audioPath = null
  if (project.audioPath) {
    const candidate = path.isAbsolute(project.audioPath)
      ? path.resolve(project.audioPath)
      : path.resolve(path.dirname(projectPath), project.audioPath)
    if (audioExtensions.has(path.extname(candidate).toLowerCase())) audioPath = candidate
  }
  const background = project.stageStyle.background
  const backgroundPath =
    background.mode === 'image' && background.imagePath
      ? classifyBackgroundPath(background.imagePath, platform).nativePath
      : null
  return Object.freeze({ projectPath: path.resolve(projectPath), audioPath, backgroundPath })
}

function createMediaCapabilityRegistry({
  createRevision = randomUUID,
  createToken = randomUUID,
} = {}) {
  if (typeof createRevision !== 'function') throw new TypeError('createRevision must be a function')
  if (typeof createToken !== 'function') throw new TypeError('createToken must be a function')

  const entries = new Map()
  const tokensByScope = new Map()
  const activeByScope = new Map()
  const candidateByScope = new Map()
  const pendingByScope = new Map()
  const requestSequenceByScope = new Map()
  const restorationByScope = new Map()
  const revisionByScope = new Map()
  const issuedRevisions = new Set()

  const scopeKey = (ownerId, kind) => {
    assertKind(kind)
    return `${ownerId}:${kind}`
  }
  const currentSequence = (ownerId, kind) =>
    requestSequenceByScope.get(scopeKey(ownerId, kind)) ?? 0
  const advanceSequence = (ownerId, kind) => {
    const key = scopeKey(ownerId, kind)
    const sequence = currentSequence(ownerId, kind) + 1
    requestSequenceByScope.set(key, sequence)
    return sequence
  }
  const activeToken = (ownerId, kind) => activeByScope.get(scopeKey(ownerId, kind)) ?? null
  const nextRevision = () => {
    const revision = createRevision()
    if (
      typeof revision !== 'string' ||
      !MEDIA_TOKEN_PATTERN.test(revision) ||
      issuedRevisions.has(revision)
    )
      throw new TypeError('createRevision must return a unique UUID')
    issuedRevisions.add(revision)
    return revision
  }
  const backgroundState = (ownerId) => {
    const key = scopeKey(ownerId, 'background')
    if (!revisionByScope.has(key)) revisionByScope.set(key, nextRevision())
    return Object.freeze({
      activeToken: activeToken(ownerId, 'background'),
      revision: revisionByScope.get(key),
    })
  }
  const rotateBackgroundRevision = (ownerId) => {
    revisionByScope.set(scopeKey(ownerId, 'background'), nextRevision())
    return backgroundState(ownerId)
  }
  const backgroundStateMatches = (ownerId, revision, expectedActiveToken) => {
    if (
      typeof revision !== 'string' ||
      (expectedActiveToken !== null && typeof expectedActiveToken !== 'string')
    )
      return false
    const state = backgroundState(ownerId)
    return state.revision === revision && state.activeToken === expectedActiveToken
  }

  const deleteToken = (token) => {
    const entry = entries.get(token)
    if (!entry) return false
    entries.delete(token)
    const key = scopeKey(entry.ownerId, entry.kind)
    const tokens = tokensByScope.get(key)
    tokens?.delete(token)
    if (tokens?.size === 0) tokensByScope.delete(key)
    if (activeByScope.get(key) === token) activeByScope.delete(key)
    if (candidateByScope.get(key) === token) candidateByScope.delete(key)
    return true
  }

  const deleteCandidate = (ownerId, kind) => {
    const token = candidateByScope.get(scopeKey(ownerId, kind))
    if (token) deleteToken(token)
  }

  const deleteKind = (ownerId, kind) => {
    const key = scopeKey(ownerId, kind)
    const tokens = tokensByScope.get(key)
    if (tokens) {
      for (const token of [...tokens]) deleteToken(token)
    }
    activeByScope.delete(key)
    candidateByScope.delete(key)
  }

  const addEntry = (entry) => {
    const token = createToken()
    if (typeof token !== 'string' || !token || entries.has(token)) {
      throw new TypeError('createToken must return a unique non-empty string')
    }
    const key = scopeKey(entry.ownerId, entry.kind)
    entries.set(token, { ...entry, token })
    const tokens = tokensByScope.get(key) ?? new Set()
    tokens.add(token)
    tokensByScope.set(key, tokens)
    return token
  }

  const requestIsCurrent = (ownerId, kind, sequence) =>
    Number.isSafeInteger(sequence) && currentSequence(ownerId, kind) === sequence

  const beginRequest = (ownerId, kind) => {
    const key = scopeKey(ownerId, kind)
    const sequence = advanceSequence(ownerId, kind)
    pendingByScope.set(key, sequence)
    return sequence
  }

  const resetKind = (ownerId, kind) => {
    const key = scopeKey(ownerId, kind)
    advanceSequence(ownerId, kind)
    deleteKind(ownerId, kind)
    pendingByScope.delete(key)
    restorationByScope.delete(key)
    if (kind === 'background') rotateBackgroundRevision(ownerId)
  }

  const registerAudio = (ownerId, filePath, sequence) => {
    if (!requestIsCurrent(ownerId, 'audio', sequence)) return null
    pendingByScope.delete(scopeKey(ownerId, 'audio'))
    deleteKind(ownerId, 'audio')
    const token = addEntry({
      filePath: path.resolve(filePath),
      kind: 'audio',
      ownerId,
      state: 'retained',
    })
    activeByScope.set(scopeKey(ownerId, 'audio'), token)
    restorationByScope.delete(scopeKey(ownerId, 'audio'))
    return token
  }

  const registerBackground = (ownerId, linkedPath, image, sequence, state) => {
    if (!requestIsCurrent(ownerId, 'background', sequence)) return null
    if (
      !image ||
      !Buffer.isBuffer(image.bytes) ||
      (image.mime !== 'image/png' && image.mime !== 'image/jpeg')
    ) {
      throw new TypeError('A validated PNG or JPEG snapshot is required')
    }
    const token = addEntry({
      bytes: Buffer.from(image.bytes),
      filePath: path.resolve(linkedPath),
      kind: 'background',
      mime: image.mime,
      ownerId,
      sequence,
      state,
    })
    const key = scopeKey(ownerId, 'background')
    pendingByScope.delete(key)
    if (state === 'candidate') {
      const replaced = candidateByScope.get(key)
      candidateByScope.set(key, token)
      if (replaced && replaced !== token) deleteToken(replaced)
    } else {
      activeByScope.set(key, token)
    }
    return token
  }

  return Object.freeze({
    activeToken,
    backgroundPathIsAuthorized(ownerId, linkedPath) {
      if (typeof linkedPath !== 'string') return false
      const filePath = path.resolve(linkedPath)
      const key = scopeKey(ownerId, 'background')
      const restoration = restorationByScope.get(key)
      if (restoration?.filePath === filePath) return true
      const tokens = tokensByScope.get(key)
      if (!tokens) return false
      for (const token of tokens) {
        const entry = entries.get(token)
        if (
          entry?.kind === 'background' &&
          entry.ownerId === ownerId &&
          (entry.state === 'candidate' || entry.state === 'retained') &&
          entry.filePath === filePath
        )
          return true
      }
      return false
    },
    backgroundExportSnapshot(ownerId, expectedRevision, expectedActiveToken, linkedPath) {
      if (
        !expectedActiveToken ||
        typeof linkedPath !== 'string' ||
        !backgroundStateMatches(ownerId, expectedRevision, expectedActiveToken)
      )
        return null
      const key = scopeKey(ownerId, 'background')
      const entry = entries.get(expectedActiveToken)
      if (
        pendingByScope.has(key) ||
        candidateByScope.has(key) ||
        !entry ||
        entry.ownerId !== ownerId ||
        entry.kind !== 'background' ||
        entry.state !== 'retained' ||
        entry.filePath !== path.resolve(linkedPath)
      )
        return null
      return Object.freeze({
        bytes: Buffer.from(entry.bytes),
        filePath: entry.filePath,
        mime: entry.mime,
      })
    },
    backgroundState,
    beginRequest,
    beginRestore(ownerId, kind, projectPath) {
      const key = scopeKey(ownerId, kind)
      const authorization = restorationByScope.get(key)
      if (!authorization || authorization.projectPath !== path.resolve(projectPath)) {
        return Object.freeze({ authorized: false, filePath: null, sequence: null })
      }
      if (kind !== 'background') restorationByScope.delete(key)
      deleteCandidate(ownerId, kind)
      const sequence = advanceSequence(ownerId, kind)
      pendingByScope.set(key, sequence)
      return Object.freeze({
        authorized: true,
        filePath: authorization.filePath,
        sequence,
      })
    },
    finishRequest(ownerId, kind, sequence) {
      const key = scopeKey(ownerId, kind)
      if (!requestIsCurrent(ownerId, kind, sequence)) return false
      if (pendingByScope.get(key) === sequence) pendingByScope.delete(key)
      return true
    },
    get(token) {
      const entry = entries.get(token)
      if (!entry) return null
      return Object.freeze({
        ...(entry.kind === 'background'
          ? { bytes: Buffer.from(entry.bytes), mime: entry.mime }
          : {}),
        filePath: entry.filePath,
        kind: entry.kind,
        ownerId: entry.ownerId,
        state: entry.state,
      })
    },
    registerAudio,
    registerBackgroundCandidate(ownerId, linkedPath, image, sequence) {
      return registerBackground(ownerId, linkedPath, image, sequence, 'candidate')
    },
    registerRestoredBackground(ownerId, linkedPath, image, sequence) {
      const key = scopeKey(ownerId, 'background')
      const authorization = restorationByScope.get(key)
      if (
        !authorization ||
        !authorization.filePath ||
        authorization.filePath !== path.resolve(linkedPath)
      )
        return null
      const token = registerBackground(ownerId, linkedPath, image, sequence, 'retained')
      if (token && restorationByScope.get(key) === authorization) {
        restorationByScope.delete(key)
        rotateBackgroundRevision(ownerId)
      }
      return token
    },
    revokeToken(token) {
      const entry = entries.get(token)
      const deleted = deleteToken(token)
      if (deleted && entry.kind === 'background' && entry.state === 'retained') {
        rotateBackgroundRevision(entry.ownerId)
      }
      return deleted
    },
    releaseKind(ownerId, kind, expectedRevision, expectedActiveToken) {
      const key = scopeKey(ownerId, kind)
      if (
        kind !== 'background' ||
        !backgroundStateMatches(ownerId, expectedRevision, expectedActiveToken) ||
        pendingByScope.has(key) ||
        candidateByScope.has(key)
      )
        return false
      resetKind(ownerId, kind)
      return true
    },
    releaseBackgroundSnapshot(ownerId, expectedRevision, expectedActiveToken, token) {
      const entry = entries.get(token)
      const key = scopeKey(ownerId, 'background')
      if (
        !backgroundStateMatches(ownerId, expectedRevision, expectedActiveToken) ||
        !entry ||
        entry.ownerId !== ownerId ||
        entry.kind !== 'background' ||
        entry.state !== 'retained' ||
        activeByScope.get(key) === token ||
        candidateByScope.get(key) === token
      )
        return false
      deleteToken(token)
      rotateBackgroundRevision(ownerId)
      return true
    },
    releaseOwner(ownerId) {
      for (const kind of MEDIA_KINDS) resetKind(ownerId, kind)
    },
    replaceProjectScope(ownerId, projectPath, paths) {
      const resolvedProjectPath = path.resolve(projectPath)
      for (const kind of MEDIA_KINDS) {
        resetKind(ownerId, kind)
        restorationByScope.set(scopeKey(ownerId, kind), {
          filePath: paths?.[kind] ? path.resolve(paths[kind]) : null,
          projectPath: resolvedProjectPath,
        })
      }
      return true
    },
    requestIsCurrent,
    resetKind,
    retainBackground(ownerId, expectedRevision, expectedActiveToken, retainedToken) {
      const key = scopeKey(ownerId, 'background')
      if (
        (expectedActiveToken !== null && typeof expectedActiveToken !== 'string') ||
        (retainedToken !== null && typeof retainedToken !== 'string')
      )
        return false
      if (
        !backgroundStateMatches(ownerId, expectedRevision, expectedActiveToken) ||
        pendingByScope.has(key) ||
        candidateByScope.has(key) ||
        restorationByScope.has(key)
      )
        return false
      if (retainedToken === null) {
        advanceSequence(ownerId, 'background')
        activeByScope.delete(key)
        rotateBackgroundRevision(ownerId)
        return true
      }
      const retained = entries.get(retainedToken)
      if (
        !retained ||
        retained.ownerId !== ownerId ||
        retained.kind !== 'background' ||
        retained.state !== 'retained'
      )
        return false
      advanceSequence(ownerId, 'background')
      activeByScope.set(key, retainedToken)
      rotateBackgroundRevision(ownerId)
      return true
    },
    settleBackgroundCandidate(ownerId, candidateToken, accepted) {
      if (typeof accepted !== 'boolean') throw new TypeError('accepted must be a boolean')
      const candidate = entries.get(candidateToken)
      const key = scopeKey(ownerId, 'background')
      if (
        !candidate ||
        candidate.ownerId !== ownerId ||
        candidate.kind !== 'background' ||
        candidate.state !== 'candidate' ||
        candidateByScope.get(key) !== candidateToken ||
        pendingByScope.has(key)
      )
        return false
      candidateByScope.delete(key)
      if (!accepted) {
        deleteToken(candidateToken)
        return true
      }
      candidate.state = 'retained'
      activeByScope.set(scopeKey(ownerId, 'background'), candidateToken)
      restorationByScope.delete(scopeKey(ownerId, 'background'))
      advanceSequence(ownerId, 'background')
      rotateBackgroundRevision(ownerId)
      return true
    },
  })
}

module.exports = {
  MEDIA_KINDS,
  classifyBackgroundPath,
  createMediaCapabilityRegistry,
  mediaTokenFromUrl,
  normalizeBackgroundCapabilityState,
  normalizeBackgroundMutationRequest,
  normalizeMediaCapabilityReference,
  prepareProjectMedia,
}
