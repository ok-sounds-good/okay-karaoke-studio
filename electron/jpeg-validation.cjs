'use strict'

const JPEG_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxHeight: 4096,
  maxMarkers: 1024,
  maxPixels: 16_777_216,
  maxRestartMarkers: 262_144,
  maxScans: 128,
  maxSegmentBytes: 65_533,
  maxSegments: 1024,
  maxWidth: 4096,
})

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])
const SUPPORTED_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2])

function jpegError() {
  const error = new Error('VISUAL_JPEG_INVALID')
  error.code = 'VISUAL_JPEG_INVALID'
  return error
}

function recordStructuralMarker(state) {
  state.markerCount += 1
  if (state.markerCount > JPEG_LIMITS.maxMarkers) throw jpegError()
}

function readMarker(bytes, offset) {
  if (bytes[offset] !== 0xff) throw jpegError()
  let codeOffset = offset + 1
  while (codeOffset < bytes.length && bytes[codeOffset] === 0xff) codeOffset += 1
  if (codeOffset >= bytes.length || bytes[codeOffset] === 0x00) throw jpegError()
  return { code: bytes[codeOffset], nextOffset: codeOffset + 1 }
}

function isLengthBearingMarker(code) {
  return (
    SOF_MARKERS.has(code) ||
    code === 0xc4 ||
    code === 0xda ||
    code === 0xdb ||
    code === 0xdd ||
    (code >= 0xe0 && code <= 0xef) ||
    code === 0xfe
  )
}

function readSegment(bytes, offset, state) {
  state.segmentCount += 1
  if (state.segmentCount > JPEG_LIMITS.maxSegments || offset + 2 > bytes.length) {
    throw jpegError()
  }
  const declaredLength = bytes.readUInt16BE(offset)
  const payloadLength = declaredLength - 2
  if (declaredLength < 2 || payloadLength > JPEG_LIMITS.maxSegmentBytes) throw jpegError()
  const endOffset = offset + declaredLength
  if (endOffset > bytes.length) throw jpegError()
  return {
    endOffset,
    payload: bytes.subarray(offset + 2, endOffset),
  }
}

function parseFrame(payload, marker) {
  if (payload.length < 6) throw jpegError()
  const precision = payload[0]
  const height = payload.readUInt16BE(1)
  const width = payload.readUInt16BE(3)
  const componentCount = payload[5]
  if (
    (marker === 0xc0 ? precision !== 8 : ![8, 12].includes(precision)) ||
    componentCount < 1 ||
    componentCount > 4 ||
    payload.length !== 6 + componentCount * 3 ||
    width < 1 ||
    height < 1 ||
    width > JPEG_LIMITS.maxWidth ||
    height > JPEG_LIMITS.maxHeight ||
    width * height > JPEG_LIMITS.maxPixels
  )
    throw jpegError()

  const components = []
  for (let index = 0; index < componentCount; index += 1) {
    const offset = 6 + index * 3
    const id = payload[offset]
    const sampling = payload[offset + 1]
    const horizontalSampling = sampling >>> 4
    const verticalSampling = sampling & 0x0f
    if (
      components.some((component) => component.id === id) ||
      horizontalSampling < 1 ||
      horizontalSampling > 4 ||
      verticalSampling < 1 ||
      verticalSampling > 4 ||
      payload[offset + 2] > 3
    )
      throw jpegError()
    components.push({ horizontalSampling, id, verticalSampling })
  }
  return {
    components,
    height,
    marker,
    progressive: marker === 0xc2,
    width,
  }
}

function validateScan(payload, frame) {
  if (payload.length < 6) throw jpegError()
  const componentCount = payload[0]
  if (
    componentCount < 1 ||
    componentCount > frame.components.length ||
    payload.length !== 4 + componentCount * 2
  )
    throw jpegError()

  const maxTableSelector = frame.marker === 0xc0 ? 1 : 3
  let previousFrameIndex = -1
  let samplingUnits = 0
  for (let index = 0; index < componentCount; index += 1) {
    const offset = 1 + index * 2
    const id = payload[offset]
    const tables = payload[offset + 1]
    const frameIndex = frame.components.findIndex((component) => component.id === id)
    if (
      frameIndex <= previousFrameIndex ||
      tables >>> 4 > maxTableSelector ||
      (tables & 0x0f) > maxTableSelector
    )
      throw jpegError()
    const component = frame.components[frameIndex]
    samplingUnits += component.horizontalSampling * component.verticalSampling
    previousFrameIndex = frameIndex
  }
  if (componentCount > 1 && samplingUnits > 10) throw jpegError()

  const spectralStart = payload[payload.length - 3]
  const spectralEnd = payload[payload.length - 2]
  const approximation = payload[payload.length - 1]
  if (!frame.progressive) {
    if (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0) throw jpegError()
    return
  }
  const highApproximation = approximation >>> 4
  const lowApproximation = approximation & 0x0f
  if (
    spectralStart > spectralEnd ||
    spectralEnd > 63 ||
    (spectralStart === 0 && spectralEnd !== 0) ||
    (spectralStart > 0 && componentCount !== 1) ||
    highApproximation > 13 ||
    lowApproximation > 13
  )
    throw jpegError()
}

function consumeEntropy(bytes, offset, state, restartInterval) {
  let expectedRestart = 0
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    let codeOffset = offset + 1
    while (codeOffset < bytes.length && bytes[codeOffset] === 0xff) codeOffset += 1
    if (codeOffset >= bytes.length) throw jpegError()
    const code = bytes[codeOffset]
    if (code === 0x00) {
      if (codeOffset !== offset + 1) throw jpegError()
      offset = codeOffset + 1
      continue
    }
    if (code < 0xd0 || code > 0xd7) return offset

    state.restartMarkerCount += 1
    if (
      state.restartMarkerCount > JPEG_LIMITS.maxRestartMarkers ||
      restartInterval === 0 ||
      code !== 0xd0 + expectedRestart
    )
      throw jpegError()
    expectedRestart = (expectedRestart + 1) & 7
    offset = codeOffset + 1
  }
  throw jpegError()
}

function metadata(frame, state) {
  return Object.freeze({
    format: 'jpeg',
    height: frame.height,
    markerCount: state.markerCount,
    progressive: frame.progressive,
    rasterDecoded: false,
    restartMarkerCount: state.restartMarkerCount,
    scanCount: state.scanCount,
    scanSemanticsValidated: false,
    segmentCount: state.segmentCount,
    width: frame.width,
  })
}

function parseBoundedJpegContainer(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 4 ||
    bytes.length > JPEG_LIMITS.maxBytes ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  )
    throw jpegError()

  const state = {
    markerCount: 1,
    restartMarkerCount: 0,
    scanCount: 0,
    segmentCount: 0,
  }
  let frame = null
  let offset = 2
  let restartInterval = 0

  while (offset < bytes.length) {
    const marker = readMarker(bytes, offset)
    // Structural markers include SOI/EOI and every length-bearing marker.
    // Entropy restart markers have their own independent work counter.
    recordStructuralMarker(state)
    offset = marker.nextOffset

    if (marker.code === 0xd9) {
      if (!frame || state.scanCount < 1 || offset !== bytes.length) throw jpegError()
      return metadata(frame, state)
    }
    if (marker.code === 0xd8 || (marker.code >= 0xd0 && marker.code <= 0xd7)) {
      throw jpegError()
    }
    if (!isLengthBearingMarker(marker.code)) throw jpegError()

    const segment = readSegment(bytes, offset, state)
    if (SOF_MARKERS.has(marker.code)) {
      if (!SUPPORTED_SOF_MARKERS.has(marker.code) || frame || state.scanCount > 0) {
        throw jpegError()
      }
      frame = parseFrame(segment.payload, marker.code)
    } else if (marker.code === 0xda) {
      if (!frame) throw jpegError()
      state.scanCount += 1
      if (state.scanCount > JPEG_LIMITS.maxScans) throw jpegError()
      validateScan(segment.payload, frame)
      offset = consumeEntropy(bytes, segment.endOffset, state, restartInterval)
      continue
    } else if (marker.code === 0xdd) {
      if (segment.payload.length !== 2) throw jpegError()
      restartInterval = segment.payload.readUInt16BE(0)
    } else if (
      marker.code === 0xe2 &&
      segment.payload.length >= 4 &&
      segment.payload.subarray(0, 4).equals(Buffer.from('MPF\0', 'ascii'))
    ) {
      throw jpegError()
    }
    offset = segment.endOffset
  }
  throw jpegError()
}

module.exports = { JPEG_LIMITS, parseBoundedJpegContainer }
