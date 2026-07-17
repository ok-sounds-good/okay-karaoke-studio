'use strict'

const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const COMPLETION_MARKERS = new Set(['failure.json', 'result.json'])
const ARTIFACT_LIMITS = Object.freeze({
  maxArtifactBytes: 8 * 1024 * 1024,
  maxArtifacts: 16,
  maxNameLength: 100,
  maxTotalBytes: 32 * 1024 * 1024,
})
const LAUNCHER_FAILURE_CODES = Object.freeze([
  'VISUAL_SMOKE_CHILD_FAILED',
  'VISUAL_SMOKE_CHILD_SIGNAL',
  'VISUAL_SMOKE_FAILED',
  'VISUAL_SMOKE_LAUNCHER_FAILED',
  'VISUAL_SMOKE_OUTPUT_EXISTS',
  'VISUAL_SMOKE_OUTPUT_INVALID',
  'VISUAL_SMOKE_PROFILE_FAILED',
  'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED',
  'VISUAL_SMOKE_RESULT_INVALID',
  'VISUAL_SMOKE_START_FAILED',
  'VISUAL_SMOKE_TERMINATION_UNCONFIRMED',
  'VISUAL_SMOKE_TIMEOUT',
])
const FAILURE_CODES = new Set(LAUNCHER_FAILURE_CODES)
const ARTIFACT_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/u
const WINDOWS_DEVICE = /^(?:AUX|CLOCK\$|COM[1-9]|CON|CONIN\$|CONOUT\$|LPT[1-9]|NUL|PRN)$/u
const WINDOWS_ILLEGAL_LEAF = /[\u0000-\u001f<>:"/\\|?*]/u

function artifactError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function windowsNamespacePath(rawPath) {
  const value = rawPath.normalize('NFKC').replaceAll('/', '\\').toUpperCase()
  return value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\') ||
    value.startsWith('\\??\\') || value.startsWith('\\\\??\\') ||
    value.startsWith('\\DEVICE\\') || value.startsWith('\\GLOBAL??\\') ||
    value.startsWith('\\\\GLOBAL??\\')
}

function windowsReservedLeaf(rawLeaf) {
  const leaf = rawLeaf.normalize('NFKC')
  const stem = leaf.split('.')[0].replace(/[ .]+$/u, '').toUpperCase()
  return WINDOWS_DEVICE.test(stem)
}

function invalidWindowsComponent(component) {
  const value = component.normalize('NFKC')
  return !value || value.endsWith('.') || value.endsWith(' ') ||
    WINDOWS_ILLEGAL_LEAF.test(value) || windowsReservedLeaf(value)
}

function invalidWindowsPath(rawPath) {
  const value = rawPath.normalize('NFKC').replaceAll('/', '\\')
  const driveAbsolute = /^[A-Za-z]:\\/u.test(value)
  const uncAbsolute = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/u.test(value)
  const invalidColon = driveAbsolute ? value.indexOf(':', 2) !== -1 : value.includes(':')
  const components = driveAbsolute
    ? value.slice(3).split('\\')
    : uncAbsolute ? value.slice(2).split('\\') : []
  return windowsNamespacePath(rawPath) || invalidColon ||
    (!driveAbsolute && !uncAbsolute) || components.some(invalidWindowsComponent)
}

function validateFreshOutputPath(rawPath, pathApi = path) {
  try {
    if (typeof rawPath !== 'string' || !rawPath || !pathApi.isAbsolute(rawPath)) {
      throw artifactError('VISUAL_OUTPUT_INVALID')
    }
    const resolved = pathApi.resolve(rawPath)
    const leaf = pathApi.basename(resolved)
    const windowsPath = pathApi === path.win32 || pathApi.sep === '\\'
    if (
      rawPath.includes('\0') || resolved !== rawPath ||
      resolved === pathApi.parse(resolved).root || leaf === '.' || leaf === '..' ||
      leaf.normalize('NFKC').endsWith('.') || leaf.normalize('NFKC').endsWith(' ') ||
      windowsReservedLeaf(leaf) || (windowsPath && invalidWindowsPath(rawPath))
    ) throw artifactError('VISUAL_OUTPUT_INVALID')
    return resolved
  } catch (error) {
    if (error?.code === 'VISUAL_OUTPUT_INVALID') throw error
    throw artifactError('VISUAL_OUTPUT_INVALID')
  }
}

function statIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

async function lstatOrNull(filePath, fsApi = fs) {
  try {
    return await fsApi.lstat(filePath, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function outputState(rawOutput, fsApi = fs) {
  const output = validateFreshOutputPath(rawOutput)
  const stats = await lstatOrNull(output, fsApi)
  if (!stats) return { output, state: 'absent' }
  if (!stats.isDirectory() || stats.isSymbolicLink()) return { output, state: 'unknown' }
  for (const marker of COMPLETION_MARKERS) {
    const markerStats = await lstatOrNull(path.join(output, marker), fsApi)
    if (markerStats?.isFile() && !markerStats.isSymbolicLink()) {
      // Presence is not provenance or schema validation. Result consumers must
      // validate the exact manifest and artifacts before treating it as complete.
      return { output, state: 'marker-present' }
    }
  }
  return { output, state: 'unknown' }
}

function validateArtifactName(name) {
  return Boolean(
    typeof name === 'string' && name.length <= ARTIFACT_LIMITS.maxNameLength &&
    ARTIFACT_NAME.test(name) && !windowsReservedLeaf(name) &&
    path.basename(name) === name && !name.includes('/') && !name.includes('\\'),
  )
}

function artifactFields(value) {
  try {
    if (
      !value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== 'bytes,name'
    ) throw artifactError('VISUAL_ARTIFACTS_INVALID')
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (!('value' in descriptors.bytes) || !('value' in descriptors.name)) {
      throw artifactError('VISUAL_ARTIFACTS_INVALID')
    }
    return { bytes: descriptors.bytes.value, name: descriptors.name.value }
  } catch (error) {
    if (error?.code === 'VISUAL_ARTIFACTS_INVALID') throw error
    throw artifactError('VISUAL_ARTIFACTS_INVALID')
  }
}

function normalizeArtifactBuffers(artifacts) {
  if (
    !Array.isArray(artifacts) || artifacts.length < 1 ||
    artifacts.length > ARTIFACT_LIMITS.maxArtifacts
  ) throw artifactError('VISUAL_ARTIFACTS_INVALID')

  const names = new Set()
  let totalBytes = 0
  const checked = []
  for (const artifact of artifacts) {
    const fields = artifactFields(artifact)
    if (
      !validateArtifactName(fields.name) || names.has(fields.name) ||
      !Buffer.isBuffer(fields.bytes) || fields.bytes.length < 1 ||
      fields.bytes.length > ARTIFACT_LIMITS.maxArtifactBytes
    ) throw artifactError('VISUAL_ARTIFACTS_INVALID')
    checked.push(fields)
    names.add(fields.name)
    totalBytes += fields.bytes.length
    if (totalBytes > ARTIFACT_LIMITS.maxTotalBytes) {
      throw artifactError('VISUAL_ARTIFACTS_INVALID')
    }
  }
  const markers = checked.filter((artifact) => COMPLETION_MARKERS.has(artifact.name))
  if (markers.length !== 1 || checked.at(-1).name !== markers[0].name) {
    throw artifactError('VISUAL_ARTIFACTS_INVALID')
  }
  return checked.map((artifact) => ({
    bytes: Buffer.from(artifact.bytes),
    name: artifact.name,
  }))
}

function normalizeLauncherFailure(failure) {
  try {
    if (
      !failure || typeof failure !== 'object' || Array.isArray(failure) ||
      Object.getPrototypeOf(failure) !== Object.prototype ||
      Object.keys(failure).sort().join(',') !== 'code,ok'
    ) throw artifactError('VISUAL_FAILURE_INVALID')
    const descriptors = Object.getOwnPropertyDescriptors(failure)
    if (
      !('value' in descriptors.code) || !('value' in descriptors.ok) ||
      descriptors.ok.value !== false || !FAILURE_CODES.has(descriptors.code.value)
    ) throw artifactError('VISUAL_FAILURE_INVALID')
    return Object.freeze({ code: descriptors.code.value, ok: false })
  } catch (error) {
    if (error?.code === 'VISUAL_FAILURE_INVALID') throw error
    throw artifactError('VISUAL_FAILURE_INVALID')
  }
}

async function assertClaimedDirectory(claim, fsApi) {
  try {
    const stats = await fsApi.lstat(claim.output, { bigint: true })
    const realPath = await fsApi.realpath(claim.output)
    if (
      !stats.isDirectory() || stats.isSymbolicLink() ||
      !sameIdentity(statIdentity(stats), claim) || realPath !== claim.realPath
    ) throw artifactError('VISUAL_OUTPUT_RACE')
  } catch (error) {
    if (error?.code === 'VISUAL_OUTPUT_RACE') throw error
    throw artifactError('VISUAL_OUTPUT_RACE')
  }
}

async function assertOwnedRegularFile(filePath, identity, fsApi) {
  try {
    const stats = await fsApi.lstat(filePath, { bigint: true })
    if (
      !stats.isFile() || stats.isSymbolicLink() ||
      !sameIdentity(statIdentity(stats), identity)
    ) throw artifactError('VISUAL_OUTPUT_RACE')
    return stats
  } catch (error) {
    if (error?.code === 'VISUAL_OUTPUT_RACE') throw error
    throw artifactError('VISUAL_OUTPUT_RACE')
  }
}

async function claimOutputDirectory(rawOutput, options = {}) {
  const fsApi = options.fsApi || fs
  const { output, state } = await outputState(rawOutput, fsApi)
  if (state !== 'absent') throw artifactError('VISUAL_OUTPUT_EXISTS')
  await options.beforeClaim?.(output)
  try {
    await fsApi.mkdir(output, { mode: 0o700, recursive: false })
  } catch (error) {
    if (error?.code === 'EEXIST') throw artifactError('VISUAL_OUTPUT_EXISTS')
    throw error
  }
  try {
    const stats = await fsApi.lstat(output, { bigint: true })
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw artifactError('VISUAL_OUTPUT_RACE')
    }
    const claim = {
      ...statIdentity(stats),
      output,
      realPath: await fsApi.realpath(output),
    }
    await assertClaimedDirectory(claim, fsApi)
    return claim
  } catch (error) {
    if (error?.code === 'VISUAL_OUTPUT_RACE') throw error
    throw artifactError('VISUAL_OUTPUT_RACE')
  }
}

async function writeExclusiveArtifact(claim, artifact, options, fsApi) {
  await options.beforeWrite?.(claim.output, artifact.name)
  await assertClaimedDirectory(claim, fsApi)
  const filePath = path.join(claim.output, artifact.name)
  let handle
  let handleIdentity
  try {
    handle = await fsApi.open(filePath, 'wx', 0o600)
    await handle.writeFile(artifact.bytes)
    await handle.sync()
    const stats = await handle.stat({ bigint: true })
    if (!stats.isFile()) throw artifactError('VISUAL_OUTPUT_RACE')
    handleIdentity = statIdentity(stats)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw artifactError('VISUAL_OUTPUT_RACE')
    }
    throw error
  } finally {
    await handle?.close()
  }

  await options.afterWrite?.(claim.output, artifact.name)
  await assertClaimedDirectory(claim, fsApi)
  const linkedStats = await lstatOrNull(filePath, fsApi)
  if (
    !linkedStats || !linkedStats.isFile() || linkedStats.isSymbolicLink() ||
    !sameIdentity(statIdentity(linkedStats), handleIdentity)
  ) throw artifactError('VISUAL_OUTPUT_RACE')
  await assertClaimedDirectory(claim, fsApi)
}

async function unlinkOwnedTemporary(claim, tempPath, identity, fsApi) {
  try {
    await assertClaimedDirectory(claim, fsApi)
    await assertOwnedRegularFile(tempPath, identity, fsApi)
    // Node has no portable identity-conditional unlink. The fresh directory is
    // mode 0700 and the unpredictable leaf is checked immediately before the
    // path-based unlink. Any observed mismatch is retained rather than removed.
    await fsApi.unlink(tempPath)
    await assertClaimedDirectory(claim, fsApi)
    return await lstatOrNull(tempPath, fsApi) === null
  } catch {
    return false
  }
}

async function writeCompletionMarker(claim, artifact, options, fsApi) {
  await options.beforeWrite?.(claim.output, artifact.name)
  await assertClaimedDirectory(claim, fsApi)
  const markerPath = path.join(claim.output, artifact.name)
  const tempName = `.oks-marker-${randomUUID()}.tmp`
  const tempPath = path.join(claim.output, tempName)
  let tempIdentity = null

  try {
    let handle
    try {
      handle = await fsApi.open(tempPath, 'wx', 0o600)
      const createdStats = await handle.stat({ bigint: true })
      if (!createdStats.isFile()) throw artifactError('VISUAL_OUTPUT_RACE')
      tempIdentity = statIdentity(createdStats)
      await options.beforeMarkerWrite?.(claim.output, tempName, artifact.name)
      await handle.writeFile(artifact.bytes)
      await handle.sync()
      const syncedStats = await handle.stat({ bigint: true })
      if (!syncedStats.isFile() || !sameIdentity(statIdentity(syncedStats), tempIdentity)) {
        throw artifactError('VISUAL_OUTPUT_RACE')
      }
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
        throw artifactError('VISUAL_OUTPUT_RACE')
      }
      throw error
    } finally {
      await handle?.close()
    }

    await assertClaimedDirectory(claim, fsApi)
    await assertOwnedRegularFile(tempPath, tempIdentity, fsApi)
    await options.beforeMarkerPublish?.(claim.output, tempName, artifact.name)
    await assertClaimedDirectory(claim, fsApi)
    await assertOwnedRegularFile(tempPath, tempIdentity, fsApi)
    try {
      // Same-directory hard linking publishes the fully closed marker without
      // replacing a raced destination. The private link is removed afterward.
      await fsApi.link(tempPath, markerPath)
    } catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
        throw artifactError('VISUAL_OUTPUT_RACE')
      }
      throw error
    }

    await options.afterWrite?.(claim.output, artifact.name)
    await assertClaimedDirectory(claim, fsApi)
    await assertOwnedRegularFile(tempPath, tempIdentity, fsApi)
    await assertOwnedRegularFile(markerPath, tempIdentity, fsApi)
    await options.beforeMarkerCleanup?.(claim.output, tempName, artifact.name)
    if (!await unlinkOwnedTemporary(claim, tempPath, tempIdentity, fsApi)) {
      throw artifactError('VISUAL_OUTPUT_RACE')
    }
    await assertClaimedDirectory(claim, fsApi)
    await assertOwnedRegularFile(markerPath, tempIdentity, fsApi)
  } catch (error) {
    if (tempIdentity) await unlinkOwnedTemporary(claim, tempPath, tempIdentity, fsApi)
    throw error
  }
}

async function publishArtifactBuffers(rawOutput, artifacts, options = {}) {
  const fsApi = options.fsApi || fs
  const normalized = normalizeArtifactBuffers(artifacts)
  const claim = await claimOutputDirectory(rawOutput, options)
  // Node exposes no portable openat-style API. These identity checks detect
  // path swaps around each exclusive write, but do not claim path APIs are atomic.
  for (const artifact of normalized) {
    if (COMPLETION_MARKERS.has(artifact.name)) {
      await writeCompletionMarker(claim, artifact, options, fsApi)
    } else {
      await writeExclusiveArtifact(claim, artifact, options, fsApi)
    }
  }
  await assertClaimedDirectory(claim, fsApi)
  return claim.output
}

async function writeFreshLauncherFailure(rawOutput, failure, options = {}) {
  const safeFailure = normalizeLauncherFailure(failure)
  const fsApi = options.fsApi || fs
  const { output, state } = await outputState(rawOutput, fsApi)
  if (state !== 'absent') throw artifactError('VISUAL_OUTPUT_EXISTS')
  await publishArtifactBuffers(output, [{
    bytes: Buffer.from(`${JSON.stringify(safeFailure)}\n`, 'utf8'),
    name: 'failure.json',
  }], options)
  return 'created'
}

module.exports = {
  ARTIFACT_LIMITS,
  LAUNCHER_FAILURE_CODES,
  artifactError,
  normalizeArtifactBuffers,
  normalizeLauncherFailure,
  outputState,
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
}
