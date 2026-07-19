import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  ihdr,
  PNG_SIGNATURE,
  pngChunk,
  pngContainer,
  pngFromChunks,
  validPng,
} from './support/png-fixture'

const require = createRequire(import.meta.url)
const png = require('../electron/png-validation.cjs') as {
  PNG_LIMITS: {
    maxBytes: number
    maxChunkBytes: number
    maxChunks: number
    maxHeight: number
    maxPixels: number
    maxWidth: number
  }
  crc32(bytes: Buffer): number
  parseBoundedPngContainer(bytes: unknown): {
    ancillarySemanticsValidated: false
    animated: boolean
    apng: null | Record<string, number>
    height: number
    rasterDecoded: false
    width: number
  }
}

function animationControl(frames: number, plays = 0) {
  const data = Buffer.alloc(8)
  data.writeUInt32BE(frames, 0)
  data.writeUInt32BE(plays, 4)
  return pngChunk('acTL', data)
}

function frameControl(sequence: number, width = 1280, height = 720) {
  const data = Buffer.alloc(26)
  data.writeUInt32BE(sequence, 0)
  data.writeUInt32BE(width, 4)
  data.writeUInt32BE(height, 8)
  return pngChunk('fcTL', data)
}

function frameData(sequence: number) {
  const data = Buffer.alloc(5)
  data.writeUInt32BE(sequence, 0)
  data[4] = 1
  return pngChunk('fdAT', data)
}

describe('bounded PNG container validation', () => {
  it('checks an independent CRC vector and golden encoded PNG', () => {
    expect(png.crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926)
    const golden = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+' +
        'A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    expect(png.parseBoundedPngContainer(golden)).toMatchObject({ height: 1, width: 1 })
  })

  it('accepts 1280x720 without claiming raster or ancillary semantic validation', () => {
    const bytes = validPng(1280, 720)
    expect(bytes.length).toBeLessThan(png.PNG_LIMITS.maxBytes)
    expect(png.parseBoundedPngContainer(bytes)).toEqual({
      ancillarySemanticsValidated: false,
      animated: false,
      apng: null,
      height: 720,
      rasterDecoded: false,
      width: 1280,
    })

    const invalidTextKeyword = pngContainer(4, 3, [pngChunk('tEXt', Buffer.from([0]))])
    expect(png.parseBoundedPngContainer(invalidTextKeyword)).toMatchObject({
      ancillarySemanticsValidated: false,
      rasterDecoded: false,
      width: 4,
    })
  })

  it.each([
    ['non-buffer', 'not png'],
    ['bad signature', Buffer.alloc(64)],
    ['truncated chunk', pngContainer(4, 3).subarray(0, -1)],
    ['trailing data', Buffer.concat([pngContainer(4, 3), Buffer.from([0])])],
    ['missing IDAT', pngFromChunks([ihdr(4, 3), pngChunk('IEND')])],
    ['duplicate IHDR', pngContainer(4, 3, [ihdr(4, 3)])],
    ['unknown critical chunk', pngContainer(4, 3, [pngChunk('ABCD')])],
    ['invalid reserved bit', pngContainer(4, 3, [pngChunk('texT')])],
    [
      'non-consecutive IDAT',
      pngContainer(4, 3, [pngChunk('IDAT', Buffer.from([0])), pngChunk('raNd')]),
    ],
  ])('rejects %s', (_name, bytes) => {
    expect(() => png.parseBoundedPngContainer(bytes)).toThrow('VISUAL_PNG_INVALID')
  })

  it('rejects CRC corruption and invalid IHDR values', () => {
    const corrupted = Buffer.from(pngContainer(4, 3))
    corrupted[corrupted.length - 17] ^= 1
    expect(() => png.parseBoundedPngContainer(corrupted)).toThrow('VISUAL_PNG_INVALID')
    expect(() => png.parseBoundedPngContainer(pngContainer(0, 3))).toThrow('VISUAL_PNG_INVALID')
    expect(() =>
      png.parseBoundedPngContainer(pngContainer(png.PNG_LIMITS.maxWidth + 1, 1)),
    ).toThrow('VISUAL_PNG_INVALID')
  })

  it('enforces byte, chunk-size, chunk-count, and dimension boundaries', () => {
    const baseLength = pngContainer(1, 1).length
    const exactDataBytes = png.PNG_LIMITS.maxBytes - baseLength - 24
    const firstDataBytes = Math.floor(exactDataBytes / 2)
    const exactBytes = pngContainer(1, 1, [
      pngChunk('raNd', Buffer.alloc(firstDataBytes)),
      pngChunk('raNd', Buffer.alloc(exactDataBytes - firstDataBytes)),
    ])
    expect(exactBytes).toHaveLength(png.PNG_LIMITS.maxBytes)
    expect(png.parseBoundedPngContainer(exactBytes)).toMatchObject({ width: 1 })
    expect(() => png.parseBoundedPngContainer(Buffer.alloc(png.PNG_LIMITS.maxBytes + 1))).toThrow(
      'VISUAL_PNG_INVALID',
    )
    expect(
      png.parseBoundedPngContainer(
        pngContainer(1, 1, [pngChunk('raNd', Buffer.alloc(png.PNG_LIMITS.maxChunkBytes))]),
      ),
    ).toMatchObject({ width: 1 })
    expect(() =>
      png.parseBoundedPngContainer(
        pngFromChunks([
          ihdr(1, 1),
          pngChunk('raNd', Buffer.alloc(png.PNG_LIMITS.maxChunkBytes + 1)),
        ]),
      ),
    ).toThrow('VISUAL_PNG_INVALID')

    const exactChunks = Array.from({ length: png.PNG_LIMITS.maxChunks - 3 }, () => pngChunk('raNd'))
    expect(png.parseBoundedPngContainer(pngContainer(1, 1, exactChunks))).toMatchObject({
      width: 1,
    })
    expect(() =>
      png.parseBoundedPngContainer(pngContainer(1, 1, [...exactChunks, pngChunk('raNd')])),
    ).toThrow('VISUAL_PNG_INVALID')
    expect(
      png.parseBoundedPngContainer(pngContainer(png.PNG_LIMITS.maxWidth, png.PNG_LIMITS.maxHeight)),
    ).toMatchObject({ height: 4096, width: 4096 })
  })

  it('parses ordered APNG control markers and rejects malformed marker sequences', () => {
    const animated = pngFromChunks([
      ihdr(1280, 720),
      animationControl(2, 3),
      frameControl(0),
      pngChunk('IDAT', Buffer.from([0])),
      frameControl(1, 640, 360),
      frameData(2),
      pngChunk('IEND'),
    ])
    expect(png.parseBoundedPngContainer(animated)).toMatchObject({
      animated: true,
      apng: {
        declaredFrames: 2,
        frameControlChunks: 2,
        frameDataChunks: 1,
        plays: 3,
      },
    })

    const orphan = pngContainer(4, 3, [frameControl(0, 4, 3)])
    const badCount = pngFromChunks([
      ihdr(4, 3),
      animationControl(2),
      frameControl(0, 4, 3),
      pngChunk('IDAT', Buffer.from([0])),
      pngChunk('IEND'),
    ])
    const badSequence = pngFromChunks([
      ihdr(4, 3),
      animationControl(1),
      frameControl(1, 4, 3),
      pngChunk('IDAT', Buffer.from([0])),
      pngChunk('IEND'),
    ])
    const twoControlsBeforeIdat = pngFromChunks([
      ihdr(4, 3),
      animationControl(2),
      frameControl(0, 4, 3),
      frameControl(1, 4, 3),
      pngChunk('IDAT', Buffer.from([0])),
      pngChunk('IEND'),
    ])
    const controlledFrameWithoutData = pngFromChunks([
      ihdr(4, 3),
      animationControl(2),
      pngChunk('IDAT', Buffer.from([0])),
      frameControl(0, 4, 3),
      frameControl(1, 4, 3),
      pngChunk('IEND'),
    ])
    for (const bytes of [
      orphan,
      badCount,
      badSequence,
      twoControlsBeforeIdat,
      controlledFrameWithoutData,
    ]) {
      expect(() => png.parseBoundedPngContainer(bytes)).toThrow('VISUAL_PNG_INVALID')
    }
  })
})
