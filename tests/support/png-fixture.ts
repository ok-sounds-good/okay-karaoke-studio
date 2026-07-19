import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const { crc32 } = require('../../electron/png-validation.cjs') as {
  crc32(bytes: Buffer): number
}

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function pngChunk(type: string, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii')
  const value = Buffer.alloc(12 + data.length)
  value.writeUInt32BE(data.length, 0)
  typeBytes.copy(value, 4)
  data.copy(value, 8)
  value.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return value
}

export function ihdr(width: number, height: number) {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8
  data[9] = 6
  return pngChunk('IHDR', data)
}

export function pngContainer(width: number, height: number, middle: Buffer[] = []) {
  return pngFromChunks([
    ihdr(width, height),
    ...middle,
    pngChunk('IDAT', Buffer.from([0])),
    pngChunk('IEND'),
  ])
}

export function pngFromChunks(chunks: Buffer[]) {
  return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

export function validPng(width: number, height: number, pixelValue = 0) {
  const row = Buffer.alloc(1 + width * 4)
  row.fill(pixelValue, 1)
  const pixels = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND'),
  ])
}
