'use strict'

const nodeFileSystem = require('node:fs/promises')

const LINKED_IMAGE_FILE_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  readChunkBytes: 64 * 1024,
})

const LINKED_IMAGE_ERROR_MESSAGES = Object.freeze({
  LINKED_IMAGE_FILE_INVALID: 'The linked image file is unavailable, invalid, or changed.',
  LINKED_IMAGE_INVALID: 'The linked image must be a decodable static PNG or JPEG.',
  LINKED_IMAGE_READ_FAILED: 'The linked image file could not be read.',
})

const PATH_SNAPSHOT_LIMITATION =
  'Path binding is best-effort: Node does not expose openat/O_NOFOLLOW binding here, ' +
  'so repeated realpath/stat checks detect ordinary changes but cannot eliminate ABA, ' +
  'mutate-restore, or same-inode hybrid races, nor same-size mutation hidden by weak ' +
  'or forged dev/ino/timestamp metadata.'

const SNAPSHOT_FIELDS = Object.freeze(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'])
const linkedImageErrors = new WeakSet()

function linkedImageError(code) {
  if (!Object.hasOwn(LINKED_IMAGE_ERROR_MESSAGES, code)) {
    throw new TypeError('Unknown linked image error code')
  }
  const message = LINKED_IMAGE_ERROR_MESSAGES[code]
  const error = new Error(message)
  error.name = 'LinkedImageError'
  error.code = code
  linkedImageErrors.add(error)
  return error
}

function isLinkedImageError(error) {
  return Boolean(error && typeof error === 'object' && linkedImageErrors.has(error))
}

function fileInvalid() {
  return linkedImageError('LINKED_IMAGE_FILE_INVALID')
}

function validBigIntStat(stat) {
  return Boolean(
    stat &&
    typeof stat.isFile === 'function' &&
    SNAPSHOT_FIELDS.every((field) => typeof stat[field] === 'bigint'),
  )
}

function validateRegularBoundedFile(stat) {
  const maximum = BigInt(LINKED_IMAGE_FILE_LIMITS.maxBytes)
  if (!validBigIntStat(stat) || !stat.isFile() || stat.size < 1n || stat.size > maximum)
    throw fileInvalid()
}

function sameSnapshotState(left, right) {
  return SNAPSHOT_FIELDS.every((field) => left[field] === right[field])
}

function validatePathBindings(handleStat, selectedStat, canonicalStat) {
  for (const stat of [handleStat, selectedStat, canonicalStat]) {
    validateRegularBoundedFile(stat)
  }
  if (!sameSnapshotState(handleStat, selectedStat) || !sameSnapshotState(handleStat, canonicalStat))
    throw fileInvalid()
}

async function checkedRead(handle, buffer, offset, length, position) {
  let result
  try {
    result = await handle.read(buffer, offset, length, position)
  } catch {
    throw linkedImageError('LINKED_IMAGE_READ_FAILED')
  }
  if (
    !result ||
    !Number.isInteger(result.bytesRead) ||
    result.bytesRead < 0 ||
    result.bytesRead > length
  )
    throw linkedImageError('LINKED_IMAGE_READ_FAILED')
  return result.bytesRead
}

async function readBoundedSnapshot(handle, expectedSize) {
  const working = Buffer.alloc(expectedSize)
  let position = 0

  while (position < expectedSize) {
    const length = Math.min(LINKED_IMAGE_FILE_LIMITS.readChunkBytes, expectedSize - position)
    const bytesRead = await checkedRead(handle, working, position, length, position)
    if (bytesRead === 0) throw fileInvalid()
    position += bytesRead
  }

  const eofProbe = Buffer.alloc(1)
  const bytesPastExpectedEnd = await checkedRead(handle, eofProbe, 0, eofProbe.length, expectedSize)
  if (bytesPastExpectedEnd !== 0) throw fileInvalid()

  // Keep the FileHandle's read target private even when an injected reader retains it.
  return Buffer.from(working)
}

async function closeFileHandle(handle, operation) {
  let result
  let operationError
  try {
    result = await operation()
  } catch (cause) {
    operationError = cause
  }

  try {
    await handle.close()
  } catch {
    if (!operationError) {
      operationError = linkedImageError('LINKED_IMAGE_READ_FAILED')
    }
  }

  if (operationError) throw operationError
  return result
}

/**
 * Capture a selected pathname through one FileHandle, then validate that the
 * selected path, its resolved target, and that handle still describe the same
 * bounded regular file. See PATH_SNAPSHOT_LIMITATION for the unavoidable Node
 * pathname-binding limitation; these checks detect changes but are not a proof
 * that every possible filesystem race has been eliminated.
 */
async function snapshotLinkedImageFile(selectedPath, options = {}) {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  if (typeof selectedPath !== 'string' || selectedPath.length === 0) {
    throw fileInvalid()
  }

  try {
    const canonicalPath = await fileSystem.realpath(selectedPath)
    if (typeof canonicalPath !== 'string' || canonicalPath.length === 0) {
      throw fileInvalid()
    }

    const selectedStatBefore = await fileSystem.stat(selectedPath, { bigint: true })
    const canonicalStatBefore = await fileSystem.stat(canonicalPath, { bigint: true })
    validateRegularBoundedFile(selectedStatBefore)
    validateRegularBoundedFile(canonicalStatBefore)

    // Exactly one FileHandle owns every byte read for this snapshot.
    const handle = await fileSystem.open(canonicalPath, 'r')
    return await closeFileHandle(handle, async () => {
      const handleStatBefore = await handle.stat({ bigint: true })
      validatePathBindings(handleStatBefore, selectedStatBefore, canonicalStatBefore)

      const expectedSize = Number(handleStatBefore.size)
      const bytes = await readBoundedSnapshot(handle, expectedSize)

      const handleStatAfter = await handle.stat({ bigint: true })
      const selectedStatAfter = await fileSystem.stat(selectedPath, { bigint: true })
      const canonicalStatAfter = await fileSystem.stat(canonicalPath, { bigint: true })
      const canonicalPathAfter = await fileSystem.realpath(selectedPath)

      validatePathBindings(handleStatAfter, selectedStatAfter, canonicalStatAfter)
      if (
        canonicalPathAfter !== canonicalPath ||
        !sameSnapshotState(handleStatBefore, handleStatAfter)
      )
        throw fileInvalid()

      return bytes
    })
  } catch (cause) {
    if (isLinkedImageError(cause)) throw cause
    throw fileInvalid()
  }
}

module.exports = {
  LINKED_IMAGE_ERROR_MESSAGES,
  LINKED_IMAGE_FILE_LIMITS,
  PATH_SNAPSHOT_LIMITATION,
  isLinkedImageError,
  linkedImageError,
  snapshotLinkedImageFile,
}
