'use strict'

const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const projectSaveQueues = new Map()

function isErrnoException(error, code) {
  return error !== null && typeof error === 'object' && error.code === code
}

async function readUtf8FileWithinLimit(filePath, maxBytes, label) {
  const handle = await fs.open(filePath, 'r')
  try {
    const fileStats = await handle.stat()
    if (!fileStats.isFile()) throw new TypeError(`${label} must be a regular file`)
    if (fileStats.size > maxBytes) {
      throw new RangeError(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`)
    }

    const chunks = []
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1))
    let totalBytes = 0
    while (totalBytes <= maxBytes) {
      const readLength = Math.min(buffer.length, maxBytes + 1 - totalBytes)
      const { bytesRead } = await handle.read(buffer, 0, readLength, null)
      if (bytesRead === 0) break
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
      totalBytes += bytesRead
    }

    if (totalBytes > maxBytes) {
      throw new RangeError(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit`)
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function existingFileMode(filePath) {
  try {
    return (await fs.stat(filePath)).mode & 0o777
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) return 0o666
    throw error
  }
}

async function syncDirectoryBestEffort(directoryPath) {
  let handle
  try {
    handle = await fs.open(directoryPath, 'r')
    await handle.sync()
  } catch {
    // Some platforms/filesystems do not support fsync on directory handles.
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function writeUtf8FileAtomically(filePath, contents) {
  const directoryPath = path.dirname(filePath)
  const temporaryPath = path.join(
    directoryPath,
    `.okay-karaoke-save-${process.pid}-${randomUUID()}.tmp`,
  )
  const mode = await existingFileMode(filePath)
  let handle
  let temporaryFileCreated = false

  try {
    handle = await fs.open(temporaryPath, 'wx', mode)
    temporaryFileCreated = true
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(temporaryPath, filePath)
    temporaryFileCreated = false
    await syncDirectoryBestEffort(directoryPath)
  } catch (error) {
    await handle?.close().catch(() => {})
    if (temporaryFileCreated) await fs.unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function queueProjectWrite(filePath, contents) {
  const previousWrite = projectSaveQueues.get(filePath) || Promise.resolve()
  const pendingWrite = previousWrite
    .catch(() => {})
    .then(() => writeUtf8FileAtomically(filePath, contents))
  projectSaveQueues.set(filePath, pendingWrite)

  try {
    await pendingWrite
  } finally {
    if (projectSaveQueues.get(filePath) === pendingWrite) {
      projectSaveQueues.delete(filePath)
    }
  }
}

module.exports = {
  queueProjectWrite,
  readUtf8FileWithinLimit,
  writeUtf8FileAtomically,
}
