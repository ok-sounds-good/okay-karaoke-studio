'use strict'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxChunkBytes: 4 * 1024 * 1024,
  maxChunks: 1024,
  maxHeight: 4096,
  maxPixels: 4096 * 4096,
  maxWidth: 4096,
})
const KNOWN_CRITICAL_CHUNKS = new Set(['IDAT', 'IEND', 'IHDR', 'PLTE'])
const ALLOWED_DEPTHS = Object.freeze({
  0: new Set([1, 2, 4, 8, 16]),
  2: new Set([8, 16]),
  3: new Set([1, 2, 4, 8]),
  4: new Set([8, 16]),
  6: new Set([8, 16]),
})

function pngError() {
  const error = new Error('VISUAL_PNG_INVALID')
  error.code = 'VISUAL_PNG_INVALID'
  return error
}

function updateCrc(crc, bytes) {
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return crc
}

function crc32(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('crc32 requires a Buffer')
  return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0
}

function chunkCrc(type, data) {
  return (updateCrc(updateCrc(0xffffffff, type), data) ^ 0xffffffff) >>> 0
}

function validateIhdr(data) {
  if (data.length !== 13) throw pngError()
  const width = data.readUInt32BE(0)
  const height = data.readUInt32BE(4)
  const bitDepth = data[8]
  const colorType = data[9]
  if (
    width < 1 ||
    height < 1 ||
    width > PNG_LIMITS.maxWidth ||
    height > PNG_LIMITS.maxHeight ||
    width * height > PNG_LIMITS.maxPixels ||
    !ALLOWED_DEPTHS[colorType]?.has(bitDepth) ||
    data[10] !== 0 ||
    data[11] !== 0 ||
    ![0, 1].includes(data[12])
  )
    throw pngError()
  return { bitDepth, colorType, height, width }
}

function validatePalette(data, header) {
  const entries = data.length / 3
  if (
    header.colorType === 0 ||
    header.colorType === 4 ||
    data.length < 3 ||
    data.length > 768 ||
    data.length % 3 !== 0 ||
    (header.colorType === 3 && entries > 2 ** header.bitDepth)
  )
    throw pngError()
}

function validChunkType(typeBytes) {
  return (
    typeBytes.every((byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)) &&
    typeBytes[2] >= 65 &&
    typeBytes[2] <= 90
  )
}

function consumeSequence(data, animation) {
  if (data.readUInt32BE(0) !== animation.nextSequence) throw pngError()
  animation.nextSequence += 1
}

function validateFrameControl(data, header, animation, beforeIdat) {
  if (data.length !== 26) throw pngError()
  if (
    (animation.controls > 0 && !animation.currentFrameHasData) ||
    (beforeIdat && animation.beforeIdatControls > 0)
  )
    throw pngError()
  consumeSequence(data, animation)
  const width = data.readUInt32BE(4)
  const height = data.readUInt32BE(8)
  const x = data.readUInt32BE(12)
  const y = data.readUInt32BE(16)
  if (
    width < 1 ||
    height < 1 ||
    x + width > header.width ||
    y + height > header.height ||
    data[24] > 2 ||
    data[25] > 1 ||
    (animation.controls === 0 &&
      beforeIdat &&
      (width !== header.width || height !== header.height || x !== 0 || y !== 0))
  )
    throw pngError()
  if (beforeIdat) animation.beforeIdatControls += 1
  animation.currentFrameHasData = false
  animation.currentFrameUsesFdat = !beforeIdat
  animation.controls += 1
}

function finalAnimation(animation) {
  if (!animation) return null
  if (
    animation.controls !== animation.frames ||
    animation.controls < 1 ||
    !animation.currentFrameHasData
  )
    throw pngError()
  return Object.freeze({
    declaredFrames: animation.frames,
    frameControlChunks: animation.controls,
    frameDataChunks: animation.frameDataChunks,
    plays: animation.plays,
  })
}

function parseBoundedPngContainer(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 57 ||
    bytes.length > PNG_LIMITS.maxBytes ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  )
    throw pngError()

  let offset = PNG_SIGNATURE.length
  let chunks = 0
  let header = null
  let palette = false
  let sawIdat = false
  let idatEnded = false
  let sawIend = false
  let animation = null

  while (offset < bytes.length) {
    chunks += 1
    if (chunks > PNG_LIMITS.maxChunks || offset + 12 > bytes.length) throw pngError()
    const length = bytes.readUInt32BE(offset)
    if (length > PNG_LIMITS.maxChunkBytes) throw pngError()
    const end = offset + 12 + length
    if (end > bytes.length) throw pngError()
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    if (!validChunkType(typeBytes)) throw pngError()
    const type = typeBytes.toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (chunkCrc(typeBytes, data) !== bytes.readUInt32BE(offset + 8 + length)) throw pngError()
    if (!header && type !== 'IHDR') throw pngError()
    if (sawIdat && type !== 'IDAT' && type !== 'IEND') idatEnded = true

    if (type === 'IHDR') {
      if (header || offset !== PNG_SIGNATURE.length) throw pngError()
      header = validateIhdr(data)
    } else if (type === 'PLTE') {
      if (palette || sawIdat) throw pngError()
      validatePalette(data, header)
      palette = true
    } else if (type === 'IDAT') {
      if (idatEnded || (header.colorType === 3 && !palette)) throw pngError()
      sawIdat = true
      if (animation?.beforeIdatControls === 1 && !animation.currentFrameUsesFdat)
        animation.currentFrameHasData = true
    } else if (type === 'IEND') {
      if (length !== 0 || !sawIdat || end !== bytes.length) throw pngError()
      sawIend = true
    } else if (type === 'acTL') {
      if (animation || sawIdat || length !== 8 || data.readUInt32BE(0) < 1) throw pngError()
      animation = {
        beforeIdatControls: 0,
        controls: 0,
        currentFrameHasData: false,
        currentFrameUsesFdat: false,
        frameDataChunks: 0,
        frames: data.readUInt32BE(0),
        nextSequence: 0,
        plays: data.readUInt32BE(4),
      }
    } else if (type === 'fcTL') {
      if (!animation) throw pngError()
      validateFrameControl(data, header, animation, !sawIdat)
    } else if (type === 'fdAT') {
      if (!animation || !sawIdat || !animation.currentFrameUsesFdat || length < 4) throw pngError()
      consumeSequence(data, animation)
      animation.currentFrameHasData = true
      animation.frameDataChunks += 1
    } else if ((typeBytes[0] & 0x20) === 0 || KNOWN_CRITICAL_CHUNKS.has(type)) {
      throw pngError()
    }
    offset = end
  }

  if (!header || !sawIdat || !sawIend) throw pngError()
  const apng = finalAnimation(animation)
  // This validates the bounded PNG/APNG container. It intentionally does not
  // inflate, filter, color-convert, or otherwise claim to decode raster data.
  return Object.freeze({
    ancillarySemanticsValidated: false,
    animated: apng !== null,
    apng,
    height: header.height,
    rasterDecoded: false,
    width: header.width,
  })
}

module.exports = { PNG_LIMITS, crc32, parseBoundedPngContainer }
