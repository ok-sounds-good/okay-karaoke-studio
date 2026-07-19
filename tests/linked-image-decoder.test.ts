import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baselineJpeg, jpegSegment } from './support/jpeg-fixture'
import { ihdr, pngChunk, pngFromChunks, validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const linked = require('../electron/linked-image-decoder.cjs') as {
  readLinkedImage(
    path: string,
    options: { decode: Decoder; fileSystem?: unknown },
  ): Promise<LinkedResult>
  sniffLinkedImageFormat(bytes: Buffer): 'jpeg' | 'png'
  validateLinkedImageSnapshot(bytes: Buffer, options: { decode: Decoder }): LinkedResult
}
const adapter = require('../electron/native-image-adapter.cjs') as {
  createNativeImageDecoder(nativeImage: { createFromBuffer(bytes: Buffer): unknown }): Decoder
}

type DecodeResult =
  | false
  | {
      empty: boolean
      height: number
      width: number
    }
type Decoder = (bytes: Buffer, format: 'jpeg' | 'png') => DecodeResult
type LinkedResult = {
  bytes: Buffer
  format: 'jpeg' | 'png'
  height: number
  width: number
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

function dimensions(width: number, height: number): DecodeResult {
  return { empty: false, height, width }
}

function animationControl(frames: number) {
  const data = Buffer.alloc(8)
  data.writeUInt32BE(frames, 0)
  return pngChunk('acTL', data)
}

function frameControl(sequence: number, width: number, height: number) {
  const data = Buffer.alloc(26)
  data.writeUInt32BE(sequence, 0)
  data.writeUInt32BE(width, 4)
  data.writeUInt32BE(height, 8)
  return pngChunk('fcTL', data)
}

function validApng() {
  return pngFromChunks([
    ihdr(2, 3),
    animationControl(1),
    frameControl(0, 2, 3),
    pngChunk('IDAT', Buffer.from([0])),
    pngChunk('IEND'),
  ])
}

function thrown(operation: () => unknown) {
  try {
    operation()
  } catch (error) {
    return error as Error & { cause?: Error; code?: string }
  }
  throw new Error('Image was unexpectedly accepted')
}

function injectedSnapshot(bytes: Buffer) {
  const calls = { close: 0, open: 0 }
  const stat = {
    ctimeNs: 5n,
    dev: 1n,
    ino: 2n,
    isFile: () => true,
    mtimeNs: 4n,
    size: BigInt(bytes.length),
  }
  const handle = {
    async close() {
      calls.close += 1
    },
    async read(target: Buffer, offset: number, length: number, position: number) {
      const bytesRead = Math.min(length, Math.max(0, bytes.length - position))
      bytes.copy(target, offset, position, position + bytesRead)
      return { buffer: target, bytesRead }
    },
    async stat() {
      return stat
    },
  }
  return {
    calls,
    fileSystem: {
      async open() {
        calls.open += 1
        return handle
      },
      async realpath() {
        return '/canonical/background'
      },
      async stat() {
        return stat
      },
    },
  }
}

describe('linked image container and native decoder validation', () => {
  it('sniffs PNG and JPEG from captured bytes and returns isolated ownership', () => {
    const cases = [
      { bytes: validPng(2, 3), format: 'png' as const, height: 3, width: 2 },
      {
        bytes: baselineJpeg({ height: 5, width: 4 }),
        format: 'jpeg' as const,
        height: 5,
        width: 4,
      },
    ]

    for (const item of cases) {
      const original = Buffer.from(item.bytes)
      let decoderBytes: Buffer | undefined
      const result = linked.validateLinkedImageSnapshot(item.bytes, {
        decode(bytes, format) {
          expect(format).toBe(item.format)
          decoderBytes = bytes
          return dimensions(item.width, item.height)
        },
      })
      expect(linked.sniffLinkedImageFormat(item.bytes)).toBe(item.format)
      expect(result).toMatchObject({
        format: item.format,
        height: item.height,
        width: item.width,
      })
      expect(result.bytes).toEqual(original)
      expect(result.bytes).not.toBe(item.bytes)
      expect(decoderBytes).toEqual(original)
      expect(decoderBytes).not.toBe(item.bytes)
      item.bytes.fill(0)
      decoderBytes?.fill(1)
      expect(result.bytes).toEqual(original)
    }
  })

  it('uses file content despite misleading PNG and JPEG extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oks-linked-image-'))
    temporaryDirectories.push(directory)
    const cases = [
      {
        bytes: validPng(2, 3),
        file: 'actually-png.jpg',
        format: 'png' as const,
        height: 3,
        width: 2,
      },
      {
        bytes: baselineJpeg({ height: 5, width: 4 }),
        file: 'actually-jpeg.png',
        format: 'jpeg' as const,
        height: 5,
        width: 4,
      },
    ]

    for (const item of cases) {
      const file = join(directory, item.file)
      await writeFile(file, item.bytes)
      const result = await linked.readLinkedImage(file, {
        decode: (_bytes, format) => {
          expect(format).toBe(item.format)
          return dimensions(item.width, item.height)
        },
      })
      expect(result).toMatchObject({ format: item.format })
    }
  })

  it('rejects APNG and MPF before invoking the decoder', () => {
    let decoderCalls = 0
    const decoder = () => {
      decoderCalls += 1
      return dimensions(1, 1)
    }
    const mpf = baselineJpeg({
      beforeFrame: [jpegSegment(0xe2, Buffer.from('MPF\0payload'))],
    })
    for (const bytes of [validApng(), mpf]) {
      const error = thrown(() => linked.validateLinkedImageSnapshot(bytes, { decode: decoder }))
      expect(error).toMatchObject({ code: 'LINKED_IMAGE_INVALID' })
    }
    expect(decoderCalls).toBe(0)
  })

  it('closes the sole snapshot handle before parser and decoder failures escape', async () => {
    const parserFailure = injectedSnapshot(Buffer.from('not an image'))
    let parserDecoderCalls = 0
    await expect(
      linked.readLinkedImage('/selected/image', {
        decode: () => {
          parserDecoderCalls += 1
          return dimensions(1, 1)
        },
        fileSystem: parserFailure.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_INVALID' })
    expect(parserFailure.calls).toEqual({ close: 1, open: 1 })
    expect(parserDecoderCalls).toBe(0)

    const decoderFailure = injectedSnapshot(validPng(1, 1))
    let decoderCalls = 0
    await expect(
      linked.readLinkedImage('/selected/image', {
        decode: () => {
          decoderCalls += 1
          return false
        },
        fileSystem: decoderFailure.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_INVALID' })
    expect(decoderFailure.calls).toEqual({ close: 1, open: 1 })
    expect(decoderCalls).toBe(1)
  })

  it.each([
    ['unknown bytes', Buffer.from('not an image')],
    ['WebP', Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary')],
    ['malformed PNG', Buffer.concat([validPng(1, 1), Buffer.from([0])])],
    ['malformed JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
  ])('rejects %s with one fixed public image error', (_name, bytes) => {
    const error = thrown(() =>
      linked.validateLinkedImageSnapshot(bytes, {
        decode: () => dimensions(1, 1),
      }),
    )
    expect(error).toMatchObject({
      code: 'LINKED_IMAGE_INVALID',
      message: 'The linked image must be a decodable static PNG or JPEG.',
    })
  })

  it.each([
    ['false', () => false],
    ['empty', () => ({ empty: true, height: 0, width: 0 })],
    ['zero dimensions', () => ({ empty: false, height: 1, width: 0 })],
    ['fractional dimensions', () => ({ empty: false, height: 1.5, width: 2 })],
    ['infinite dimensions', () => ({ empty: false, height: 3, width: Infinity })],
    ['width mismatch', () => dimensions(1, 3)],
    ['height mismatch', () => dimensions(2, 1)],
  ] as Array<[string, Decoder]>)('rejects decoder %s results', (_name, decode) => {
    expect(() => linked.validateLinkedImageSnapshot(validPng(2, 3), { decode })).toThrow(
      'The linked image must be a decodable static PNG or JPEG.',
    )
  })

  it('hides forged decoder errors and paths behind the fixed public contract', () => {
    const secretPath = '/Users/example/private/background.png'
    const cause = new Error(`native decoder failed for ${secretPath}`) as Error & {
      cause?: Error
      code?: string
      path?: string
    }
    cause.code = 'LINKED_IMAGE_INVALID'
    cause.message = 'The linked image must be a decodable static PNG or JPEG.'
    cause.path = secretPath
    cause.cause = new Error(`nested failure for ${secretPath}`)
    const error = thrown(() =>
      linked.validateLinkedImageSnapshot(validPng(1, 1), {
        decode: () => {
          throw cause
        },
      }),
    )
    expect(error).toMatchObject({
      code: 'LINKED_IMAGE_INVALID',
      message: 'The linked image must be a decodable static PNG or JPEG.',
    })
    expect(error).not.toBe(cause)
    expect(error.message).not.toContain(secretPath)
    expect(error).not.toHaveProperty('cause')
    expect(error).not.toHaveProperty('path')
  })

  it('adapts an injected nativeImage without importing Electron in unit tests', () => {
    const input = Buffer.from([1, 2, 3])
    let received: Buffer | undefined
    let bufferCalls = 0
    let pathCalls = 0
    const nativeImage = {
      createFromBuffer(bytes: Buffer) {
        bufferCalls += 1
        received = bytes
        return {
          getSize: () => ({ height: 7, width: 6 }),
          isEmpty: () => false,
        }
      },
      createFromPath() {
        pathCalls += 1
        throw new Error('path decoder must not run')
      },
    }
    const decode = adapter.createNativeImageDecoder(nativeImage)
    expect(decode(input, 'png')).toEqual({ empty: false, height: 7, width: 6 })
    expect(received).toBe(input)
    expect(bufferCalls).toBe(1)
    expect(pathCalls).toBe(0)

    const empty = adapter.createNativeImageDecoder({
      createFromBuffer: () => ({ getSize: () => ({ height: 0, width: 0 }), isEmpty: () => true }),
    })
    expect(empty(input, 'png')).toEqual({ empty: true, height: 0, width: 0 })
    const unsupported = adapter.createNativeImageDecoder({ createFromBuffer: () => false })
    expect(unsupported(input, 'png')).toBe(false)
  })
})
