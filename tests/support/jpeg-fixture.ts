export const JPEG_SOI = Buffer.from([0xff, 0xd8])
export const JPEG_EOI = Buffer.from([0xff, 0xd9])

export function jpegMarker(code: number, fillBytes = 0) {
  return Buffer.from([...Array.from({ length: fillBytes + 1 }, () => 0xff), code])
}

export function jpegSegment(code: number, payload = Buffer.alloc(0), fillBytes = 0) {
  const value = Buffer.alloc(fillBytes + 4 + payload.length, 0xff)
  value[fillBytes + 1] = code
  value.writeUInt16BE(payload.length + 2, fillBytes + 2)
  payload.copy(value, fillBytes + 4)
  return value
}

export function jpegFrame(
  options: {
    componentIds?: number[]
    height?: number
    marker?: number
    precision?: number
    samplingFactors?: Array<{ horizontal: number; vertical: number }>
    width?: number
  } = {},
) {
  const marker = options.marker ?? 0xc0
  const componentIds = options.componentIds ?? [1, 2, 3]
  const payload = Buffer.alloc(6 + componentIds.length * 3)
  payload[0] = options.precision ?? 8
  payload.writeUInt16BE(options.height ?? 720, 1)
  payload.writeUInt16BE(options.width ?? 1280, 3)
  payload[5] = componentIds.length
  componentIds.forEach((id, index) => {
    const offset = 6 + index * 3
    const sampling = options.samplingFactors?.[index] ?? { horizontal: 1, vertical: 1 }
    payload[offset] = id
    payload[offset + 1] = (sampling.horizontal << 4) | sampling.vertical
    payload[offset + 2] = index === 0 ? 0 : 1
  })
  return jpegSegment(marker, payload)
}

export function jpegScan(
  options: {
    approximation?: number
    componentIds?: number[]
    spectralEnd?: number
    spectralStart?: number
    tableSelectors?: Array<{ ac: number; dc: number }>
  } = {},
) {
  const componentIds = options.componentIds ?? [1, 2, 3]
  const payload = Buffer.alloc(4 + componentIds.length * 2)
  payload[0] = componentIds.length
  componentIds.forEach((id, index) => {
    const tables = options.tableSelectors?.[index] ?? { ac: 0, dc: 0 }
    payload[1 + index * 2] = id
    payload[2 + index * 2] = (tables.dc << 4) | tables.ac
  })
  payload[payload.length - 3] = options.spectralStart ?? 0
  payload[payload.length - 2] = options.spectralEnd ?? 63
  payload[payload.length - 1] = options.approximation ?? 0
  return jpegSegment(0xda, payload)
}

export function jpegRestartInterval(interval: number) {
  const payload = Buffer.alloc(2)
  payload.writeUInt16BE(interval)
  return jpegSegment(0xdd, payload)
}

export function jpegFromParts(parts: Buffer[], eoi = JPEG_EOI) {
  return Buffer.concat([JPEG_SOI, ...parts, eoi])
}

export function baselineJpeg(
  options: {
    beforeFrame?: Buffer[]
    beforeScan?: Buffer[]
    componentIds?: number[]
    entropy?: Buffer
    frameMarker?: number
    height?: number
    width?: number
  } = {},
) {
  const componentIds = options.componentIds ?? [1, 2, 3]
  return jpegFromParts([
    ...(options.beforeFrame ?? []),
    jpegFrame({
      componentIds,
      height: options.height,
      marker: options.frameMarker,
      width: options.width,
    }),
    ...(options.beforeScan ?? []),
    jpegScan({ componentIds }),
    options.entropy ?? Buffer.from([0x11, 0x22, 0x33]),
  ])
}
