'use strict'

const { randomUUID } = require('node:crypto')
const fsSync = require('node:fs')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const OWNER_FILE = '.oks-smoke-owner.json'

function profileError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function statIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

function encodeProfileIdentity(identity) {
  return Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')
}

function decodeProfileIdentity(rawIdentity, code) {
  try {
    if (typeof rawIdentity !== 'string' || !rawIdentity) throw new Error('missing')
    const parsed = JSON.parse(Buffer.from(rawIdentity, 'base64url').toString('utf8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof parsed.dev !== 'string' ||
      !/^\d+$/u.test(parsed.dev) ||
      typeof parsed.ino !== 'string' ||
      !/^\d+$/u.test(parsed.ino) ||
      typeof parsed.realPath !== 'string' ||
      !path.isAbsolute(parsed.realPath) ||
      typeof parsed.token !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(parsed.token) ||
      Object.keys(parsed).sort().join(',') !== 'dev,ino,realPath,token'
    )
      throw new Error('shape')
    return parsed
  } catch {
    throw profileError(code)
  }
}

function canonicalPathSync(filePath) {
  try {
    return fsSync.realpathSync.native(filePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return path.join(fsSync.realpathSync.native(path.dirname(filePath)), path.basename(filePath))
  }
}

function pathIsOutside(base, candidate, pathApi) {
  const relative = pathApi.relative(base, candidate)
  return Boolean(
    relative &&
    (pathApi.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${pathApi.sep}`)),
  )
}

function pathsAreSeparate(left, right, pathApi = path) {
  return pathIsOutside(left, right, pathApi) && pathIsOutside(right, left, pathApi)
}

function readOwnerSync(profilePath, code) {
  const ownerPath = path.join(profilePath, OWNER_FILE)
  const ownerStats = fsSync.lstatSync(ownerPath, { bigint: true })
  if (!ownerStats.isFile() || ownerStats.isSymbolicLink()) throw profileError(code)
  try {
    const value = JSON.parse(fsSync.readFileSync(ownerPath, 'utf8'))
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.token !== 'string' ||
      Object.keys(value).join(',') !== 'token'
    )
      throw new Error('shape')
    return value.token
  } catch {
    throw profileError(code)
  }
}

function validateOwnedSmokeProfile(rawPath, defaultUserDataPath, rawIdentity, code) {
  if (typeof rawPath !== 'string' || !rawPath || !path.isAbsolute(rawPath)) {
    throw profileError(code)
  }
  const profilePath = path.resolve(rawPath)
  if (profilePath === path.parse(profilePath).root) throw profileError(code)
  const expected = decodeProfileIdentity(rawIdentity, code)
  try {
    const stats = fsSync.lstatSync(profilePath, { bigint: true })
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw profileError(code)
    const realPath = fsSync.realpathSync.native(profilePath)
    const entries = fsSync.readdirSync(profilePath)
    const defaultPath = canonicalPathSync(path.resolve(defaultUserDataPath))
    if (
      realPath !== expected.realPath ||
      !sameIdentity(statIdentity(stats), expected) ||
      entries.length !== 1 ||
      entries[0] !== OWNER_FILE ||
      readOwnerSync(profilePath, code) !== expected.token ||
      !pathsAreSeparate(realPath, defaultPath)
    )
      throw profileError(code)
    return profilePath
  } catch (error) {
    if (error?.code === code) throw error
    throw profileError(code)
  }
}

async function createOwnedSmokeProfile(prefix, options = {}) {
  const fsApi = options.fsApi || fs
  const temporaryRoot = options.temporaryRoot || os.tmpdir()
  const profilePath = await fsApi.mkdtemp(path.join(temporaryRoot, prefix))
  const stats = await fsApi.lstat(profilePath, { bigint: true })
  const realPath = await fsApi.realpath(profilePath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw profileError('SMOKE_PROFILE_CREATE_FAILED')
  }
  const identity = {
    ...statIdentity(stats),
    realPath,
    token: randomUUID(),
  }
  await fsApi.writeFile(
    path.join(profilePath, OWNER_FILE),
    `${JSON.stringify({ token: identity.token })}\n`,
    { flag: 'wx' },
  )
  return {
    identity,
    path: profilePath,
    serializedIdentity: encodeProfileIdentity(identity),
  }
}

async function ownedProfileStillMatches(profile, fsApi) {
  try {
    const stats = await fsApi.lstat(profile.path, { bigint: true })
    if (!stats.isDirectory() || stats.isSymbolicLink()) return false
    if (!sameIdentity(statIdentity(stats), profile.identity)) return false
    if ((await fsApi.realpath(profile.path)) !== profile.identity.realPath) return false
    const ownerPath = path.join(profile.path, OWNER_FILE)
    const ownerStats = await fsApi.lstat(ownerPath, { bigint: true })
    if (!ownerStats.isFile() || ownerStats.isSymbolicLink()) return false
    const owner = JSON.parse(await fsApi.readFile(ownerPath, 'utf8'))
    return owner?.token === profile.identity.token
  } catch {
    return false
  }
}

async function verifyRetainedSmokeProfile(profile, options = {}) {
  const fsApi = options.fsApi || fs
  await options.beforeIdentityCheck?.(profile)
  if (!(await ownedProfileStillMatches(profile, fsApi))) {
    throw profileError('SMOKE_PROFILE_IDENTITY_MISMATCH')
  }
  // Node has no cross-platform openat-style recursive removal API. A path can
  // be replaced after any lstat/realpath check and before fs.rm follows it, so
  // recursive cleanup could delete a racer-owned directory or junction. Smoke
  // profiles live under the OS temporary root and CI runners are ephemeral;
  // retaining the verified directory is the only fail-closed portable choice.
  return { retained: true }
}

module.exports = {
  OWNER_FILE,
  createOwnedSmokeProfile,
  decodeProfileIdentity,
  encodeProfileIdentity,
  ownedProfileStillMatches,
  pathsAreSeparate,
  validateOwnedSmokeProfile,
  verifyRetainedSmokeProfile,
}
