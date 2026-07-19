'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { app } = require('electron')
const {
  readLinkedImage,
  validateLinkedImageSnapshot,
} = require('../electron/linked-image-decoder.cjs')
const { createElectronNativeImageDecoder } = require('../electron/native-image-adapter.cjs')
const { crc32 } = require('../electron/png-validation.cjs')

// Synthetic 1x1 white raster fixtures. The JPEG was encoded with cjpeg; neither
// fixture contains copyrighted media or user data.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+' +
    'A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH' +
    'BwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQME' +
    'BAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
    'FBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA' +
    'AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh' +
    'MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6' +
    'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZ' +
    'mqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx' +
    '8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
    'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV' +
    'YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp' +
    'anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE' +
    'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9' +
    'U6KKKAP/2Q==',
  'base64',
)

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

function decoderInvalidPng() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.from([0])),
    pngChunk('IEND'),
  ])
}

async function runSmoke() {
  await app.whenReady()
  const directory = await mkdtemp(join(tmpdir(), 'oks-image-decoder-'))
  try {
    const pngPath = join(directory, 'synthetic-png.jpg')
    const jpegPath = join(directory, 'synthetic-jpeg.png')
    const corruptPath = join(directory, 'decoder-invalid.png')
    await Promise.all([
      writeFile(pngPath, PNG),
      writeFile(jpegPath, JPEG),
      writeFile(corruptPath, decoderInvalidPng()),
    ])

    const decode = createElectronNativeImageDecoder()
    const png = await readLinkedImage(pngPath, { decode })
    const jpeg = await readLinkedImage(jpegPath, { decode })
    assert.deepEqual(
      { format: png.format, height: png.height, width: png.width },
      { format: 'png', height: 1, width: 1 },
    )
    assert.deepEqual(
      { format: jpeg.format, height: jpeg.height, width: jpeg.width },
      { format: 'jpeg', height: 1, width: 1 },
    )

    await assert.rejects(
      readLinkedImage(corruptPath, { decode }),
      (error) => error?.code === 'LINKED_IMAGE_INVALID',
    )
    assert.throws(
      () =>
        validateLinkedImageSnapshot(PNG, {
          decode(bytes, format) {
            const decoded = decode(bytes, format)
            return decoded && { ...decoded, width: decoded.width + 1 }
          },
        }),
      (error) => error?.code === 'LINKED_IMAGE_INVALID',
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

runSmoke().then(
  () => app.exit(0),
  (error) => {
    console.error(`Image decoder smoke failed: ${error?.message ?? 'unknown failure'}`)
    app.exit(1)
  },
)
