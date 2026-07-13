import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256Text(bytes: Buffer) {
  return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n')))
}

async function readPngMetadata(filePath: string) {
  const bytes = await readFile(filePath)
  expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const colorType = bytes[25]
  expect(bytes[24]).toBe(8)
  expect(bytes[28]).toBe(0)

  const chunks: Buffer[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const scanlines = inflateSync(Buffer.concat(chunks))
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  let previous = Buffer.alloc(stride)
  let cursor = 0
  let cornerAlpha = -1
  let centerAlpha = -1

  const paeth = (left: number, up: number, upperLeft: number) => {
    const estimate = left + up - upperLeft
    const leftDistance = Math.abs(estimate - left)
    const upDistance = Math.abs(estimate - up)
    const upperLeftDistance = Math.abs(estimate - upperLeft)
    return leftDistance <= upDistance && leftDistance <= upperLeftDistance
      ? left
      : upDistance <= upperLeftDistance ? up : upperLeft
  }

  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[cursor]
    if (filter > 4) throw new Error(`Unsupported PNG filter ${filter}.`)
    cursor += 1
    const row = Buffer.allocUnsafe(stride)
    for (let index = 0; index < stride; index += 1) {
      const raw = scanlines[cursor + index]
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
      const up = previous[index]
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft)
      row[index] = (raw + predictor) & 0xff
    }
    cursor += stride
    if (y === 0) cornerAlpha = row[3]
    if (y === Math.floor(height / 2)) {
      centerAlpha = row[Math.floor(width / 2) * bytesPerPixel + 3]
    }
    previous = row
  }

  return {
    width,
    height,
    colorType,
    cornerAlpha,
    centerAlpha,
  }
}

describe('generated app icon assets', () => {
  it('keeps one canonical source and transparent, purpose-sized derivatives', async () => {
    const root = path.resolve(import.meta.dirname, '..')
    const source = path.join(root, 'build', 'icon-source.png')
    const generator = path.join(root, 'scripts', 'generate-icon-assets.cjs')
    const packaged = path.join(root, 'build', 'icon.png')
    const renderer = path.join(root, 'public', 'app-icon.png')
    const manifest = JSON.parse(await readFile(path.join(root, 'build', 'icon-assets.json'), 'utf8'))

    expect(manifest).toMatchObject({
      version: 1,
      source: { path: 'build/icon-source.png', sha256: sha256(await readFile(source)) },
      generator: {
        path: 'scripts/generate-icon-assets.cjs',
        sha256: sha256Text(await readFile(generator)),
      },
      configuration: { sourceInsetRatio: 104 / 1254, cornerRadiusRatio: 0.23 },
      generated: [
        { path: 'build/icon.png', size: 1024, sha256: sha256(await readFile(packaged)) },
        { path: 'public/app-icon.png', size: 128, sha256: sha256(await readFile(renderer)) },
      ],
    })

    await expect(readPngMetadata(packaged)).resolves.toEqual({
      width: 1024,
      height: 1024,
      colorType: 6,
      cornerAlpha: 0,
      centerAlpha: 255,
    })
    await expect(readPngMetadata(renderer)).resolves.toEqual({
      width: 128,
      height: 128,
      colorType: 6,
      cornerAlpha: 0,
      centerAlpha: 255,
    })
    await expect(stat(renderer).then(({ size }) => size)).resolves.toBeLessThan(150_000)
  })
})
