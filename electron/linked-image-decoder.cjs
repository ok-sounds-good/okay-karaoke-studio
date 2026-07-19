'use strict'

const { parseBoundedJpegContainer } = require('./jpeg-validation.cjs')
const {
  isLinkedImageError,
  linkedImageError,
  snapshotLinkedImageFile,
} = require('./linked-image-file.cjs')
const { parseBoundedPngContainer } = require('./png-validation.cjs')

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function invalidImage() {
  return linkedImageError('LINKED_IMAGE_INVALID')
}

function sniffLinkedImageFormat(bytes) {
  if (!Buffer.isBuffer(bytes)) throw invalidImage()
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  )
    return 'png'
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  throw invalidImage()
}

function parsedContainer(bytes, format) {
  const metadata =
    format === 'png' ? parseBoundedPngContainer(bytes) : parseBoundedJpegContainer(bytes)
  if (format === 'png' && metadata.animated !== false) throw invalidImage()
  return metadata
}

function validDecodedRaster(decoded, metadata) {
  return Boolean(
    decoded &&
    decoded.empty === false &&
    Number.isInteger(decoded.width) &&
    Number.isInteger(decoded.height) &&
    decoded.width > 0 &&
    decoded.height > 0 &&
    decoded.width === metadata.width &&
    decoded.height === metadata.height,
  )
}

function validateLinkedImageSnapshot(snapshotBytes, options = {}) {
  try {
    if (!Buffer.isBuffer(snapshotBytes) || typeof options.decode !== 'function') {
      throw invalidImage()
    }

    // Parsing and native decoding both receive the captured content, never a path.
    // Separate copies prevent either the caller or decoder from mutating the bytes
    // subsequently returned to the caller.
    const captured = Buffer.from(snapshotBytes)
    const format = sniffLinkedImageFormat(captured)
    const metadata = parsedContainer(captured, format)
    const decoded = options.decode(Buffer.from(captured), format)
    if (decoded && typeof decoded.then === 'function') throw invalidImage()
    if (!validDecodedRaster(decoded, metadata)) throw invalidImage()

    return Object.freeze({
      bytes: Buffer.from(captured),
      format,
      height: metadata.height,
      width: metadata.width,
    })
  } catch (cause) {
    if (isLinkedImageError(cause)) throw cause
    throw invalidImage()
  }
}

async function readLinkedImage(selectedPath, options = {}) {
  const bytes = await snapshotLinkedImageFile(selectedPath, {
    fileSystem: options.fileSystem,
  })
  return validateLinkedImageSnapshot(bytes, { decode: options.decode })
}

module.exports = {
  readLinkedImage,
  sniffLinkedImageFormat,
  validateLinkedImageSnapshot,
}
