import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  baselineJpeg,
  JPEG_EOI,
  JPEG_SOI,
  jpegFrame,
  jpegFromParts,
  jpegMarker,
  jpegRestartInterval,
  jpegScan,
  jpegSegment,
} from './support/jpeg-fixture'

const require = createRequire(import.meta.url)
const jpeg = require('../electron/jpeg-validation.cjs') as {
  JPEG_LIMITS: Readonly<{
    maxBytes: number
    maxHeight: number
    maxMarkers: number
    maxPixels: number
    maxRestartMarkers: number
    maxScans: number
    maxSegmentBytes: number
    maxSegments: number
    maxWidth: number
  }>
  parseBoundedJpegContainer(bytes: unknown): Readonly<{
    format: 'jpeg'
    height: number
    markerCount: number
    progressive: boolean
    rasterDecoded: false
    restartMarkerCount: number
    scanCount: number
    scanSemanticsValidated: false
    segmentCount: number
    width: number
  }>
}

function expectInvalid(bytes: unknown) {
  try {
    jpeg.parseBoundedJpegContainer(bytes)
    throw new Error('JPEG was unexpectedly accepted')
  } catch (error) {
    expect(error).toMatchObject({
      code: 'VISUAL_JPEG_INVALID',
      message: 'VISUAL_JPEG_INVALID',
    })
  }
}

function withByte(bytes: Buffer, offset: number, value: number) {
  const changed = Buffer.from(bytes)
  changed[offset] = value
  return changed
}

function restartEntropy(count: number) {
  const entropy = Buffer.alloc(count * 3 + 1, 0x11)
  for (let index = 0; index < count; index += 1) {
    entropy[index * 3 + 1] = 0xff
    entropy[index * 3 + 2] = 0xd0 + (index & 7)
  }
  return entropy
}

describe('bounded JPEG container validation', () => {
  it('accepts an independently encoded golden JPEG and returns frozen metadata', () => {
    // A fixed 1x1 white baseline JPEG encoded by libjpeg-turbo's cjpeg.
    const golden = Buffer.from(
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
    const result = jpeg.parseBoundedJpegContainer(golden)
    expect(result).toMatchObject({
      format: 'jpeg',
      height: 1,
      progressive: false,
      rasterDecoded: false,
      width: 1,
    })
    expect(result.scanSemanticsValidated).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(jpeg.JPEG_LIMITS)).toBe(true)
  })

  it('reports stable baseline counts without claiming entropy or raster validation', () => {
    expect(jpeg.parseBoundedJpegContainer(baselineJpeg())).toEqual({
      format: 'jpeg',
      height: 720,
      markerCount: 4,
      progressive: false,
      rasterDecoded: false,
      restartMarkerCount: 0,
      scanCount: 1,
      scanSemanticsValidated: false,
      segmentCount: 2,
      width: 1280,
    })
    expect(jpeg.parseBoundedJpegContainer(baselineJpeg({ frameMarker: 0xc1 }))).toMatchObject({
      progressive: false,
    })
  })

  it('accepts progressive multi-scan framing and treats stuffed marker bytes as entropy', () => {
    const table = Buffer.alloc(65, 1)
    table[0] = 0
    const bytes = jpegFromParts([
      jpegFrame({ marker: 0xc2 }),
      jpegScan({ spectralEnd: 0 }),
      Buffer.from([0x12, 0xff, 0x00, 0xd9, 0xda, 0x34]),
      jpegSegment(0xe1, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      jpegSegment(0xdb, table),
      jpegSegment(0xfe, Buffer.from('between scans')),
      jpegScan({ componentIds: [1], spectralEnd: 5, spectralStart: 1 }),
      Buffer.from([0x56, 0xff, 0x00, 0xda]),
    ])
    expect(jpeg.parseBoundedJpegContainer(bytes)).toMatchObject({
      markerCount: 8,
      progressive: true,
      restartMarkerCount: 0,
      scanCount: 2,
      segmentCount: 6,
    })
  })

  it('handles FF fill before real markers but rejects malformed stuffing and dangling fill', () => {
    const filledEoi = jpegFromParts(
      [jpegFrame(), Buffer.concat([Buffer.from([0xff]), jpegScan()]), Buffer.from([0x11])],
      jpegMarker(0xd9, 2),
    )
    expect(jpeg.parseBoundedJpegContainer(filledEoi)).toMatchObject({ markerCount: 4 })

    expectInvalid(baselineJpeg({ entropy: Buffer.from([0x11, 0xff, 0xff, 0x00]) }))
    expectInvalid(Buffer.concat([JPEG_SOI, jpegFrame(), jpegScan(), Buffer.from([0x11, 0xff])]))
  })

  it('accepts ordered DRI restarts, marker fill, and restart reset for each scan', () => {
    const bytes = jpegFromParts([
      jpegFrame({ componentIds: [1], marker: 0xc2 }),
      jpegRestartInterval(1),
      jpegScan({ componentIds: [1], spectralEnd: 0 }),
      Buffer.from([0x11, 0xff, 0xd0, 0x22, 0xff, 0xff, 0xd1, 0x33]),
      jpegScan({ componentIds: [1], spectralEnd: 5, spectralStart: 1 }),
      Buffer.from([0x44, 0xff, 0xd0, 0x55]),
    ])
    expect(jpeg.parseBoundedJpegContainer(bytes)).toMatchObject({
      markerCount: 6,
      restartMarkerCount: 3,
      scanCount: 2,
    })
  })

  it('rejects restarts without an active DRI or out of modulo order', () => {
    const frame = jpegFrame({ componentIds: [1] })
    const scan = jpegScan({ componentIds: [1] })
    for (const bytes of [
      jpegFromParts([frame, scan, Buffer.from([0x11, 0xff, 0xd0, 0x22])]),
      jpegFromParts([frame, jpegRestartInterval(0), scan, Buffer.from([0xff, 0xd0])]),
      jpegFromParts([frame, jpegRestartInterval(1), scan, Buffer.from([0xff, 0xd1])]),
      jpegFromParts([
        frame,
        jpegRestartInterval(1),
        scan,
        Buffer.from([0xff, 0xd0, 0x11, 0xff, 0xd2]),
      ]),
      jpegFromParts([frame, jpegMarker(0xd0), scan, Buffer.from([0x11])]),
    ])
      expectInvalid(bytes)
  })

  it('rejects malformed framing, ordering, lengths, and terminal bytes', () => {
    const valid = baselineJpeg()
    const scan = jpegScan()
    for (const bytes of [
      'not a buffer',
      Buffer.alloc(32),
      Buffer.concat([Buffer.from([0]), valid]),
      jpegFromParts([JPEG_SOI, jpegFrame(), scan, Buffer.from([1])]),
      jpegFromParts([scan, Buffer.from([1]), jpegFrame()]),
      jpegFromParts([jpegFrame(), jpegFrame(), scan, Buffer.from([1])]),
      jpegFromParts([jpegFrame(), scan, Buffer.from([1]), jpegFrame(), scan, Buffer.from([1])]),
      jpegFromParts([jpegFrame()]),
      valid.subarray(0, -2),
      Buffer.concat([valid, Buffer.from([0])]),
      Buffer.concat([valid, valid]),
      Buffer.concat([JPEG_SOI, Buffer.from([0xff, 0xe0, 0x00])]),
      Buffer.concat([JPEG_SOI, Buffer.from([0xff, 0xe0, 0x00, 0x01])]),
      Buffer.concat([JPEG_SOI, Buffer.from([0xff, 0xe0, 0x00, 0x08, 1, 2])]),
      Buffer.concat([JPEG_SOI, Buffer.from([0x12]), JPEG_EOI]),
      Buffer.concat([JPEG_SOI, Buffer.from([0xff, 0x00]), JPEG_EOI]),
    ])
      expectInvalid(bytes)
  })

  it('allows atomic APP payload bytes and rejects only APP2 beginning with MPF NUL', () => {
    const embeddedMarkers = Buffer.concat([
      Buffer.from([1, 0xff, 0xd8, 0xff, 0xd9, 2]),
      Buffer.from('MPF\0'),
    ])
    expect(
      jpeg.parseBoundedJpegContainer(
        baselineJpeg({
          beforeFrame: [
            jpegSegment(0xe1, embeddedMarkers),
            jpegSegment(0xe2, Buffer.from('xMPF\0')),
            jpegSegment(0xe2, Buffer.from('ICC_PROFILE\0')),
          ],
        }),
      ),
    ).toMatchObject({ width: 1280 })
    expectInvalid(
      baselineJpeg({
        beforeFrame: [jpegSegment(0xe2, Buffer.from('MPF\0payload'))],
      }),
    )
  })

  it('rejects unsupported frame modes and standalone or hierarchical controls', () => {
    for (const marker of [0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
      expectInvalid(baselineJpeg({ frameMarker: marker }))
    expectInvalid(baselineJpeg({ beforeFrame: [jpegMarker(0x01)] }))
    for (const marker of [0xcc, 0xdc, 0xde, 0xdf, 0xf0]) {
      expectInvalid(baselineJpeg({ beforeFrame: [jpegSegment(marker)] }))
    }
  })

  it('validates exact SOF shape, component identity, sampling, and dimensions', () => {
    const oneComponent = jpegFrame({ componentIds: [1] })
    const threeComponents = jpegFrame()
    const invalidFrames = [
      jpegSegment(0xc0, Buffer.alloc(5)),
      withByte(oneComponent, 4, 12),
      withByte(oneComponent, 9, 2),
      jpegFrame({ componentIds: [1, 2, 3, 4, 5] }),
      withByte(threeComponents, 13, 1),
      withByte(oneComponent, 11, 0),
      withByte(oneComponent, 11, 0x51),
      withByte(oneComponent, 12, 4),
    ]
    for (const frame of invalidFrames) {
      expectInvalid(jpegFromParts([frame, jpegScan({ componentIds: [1] }), Buffer.from([1])]))
    }
    for (const [width, height] of [
      [0, 1],
      [1, 0],
      [jpeg.JPEG_LIMITS.maxWidth + 1, 1],
      [1, jpeg.JPEG_LIMITS.maxHeight + 1],
    ])
      expectInvalid(baselineJpeg({ height, width }))

    expect(
      jpeg.parseBoundedJpegContainer(
        baselineJpeg({
          height: jpeg.JPEG_LIMITS.maxHeight,
          width: jpeg.JPEG_LIMITS.maxWidth,
        }),
      ),
    ).toMatchObject({ height: 4096, width: 4096 })
  })

  it('validates exact SOS shape, selectors, and sequential/progressive parameters', () => {
    const oneScan = jpegScan({ componentIds: [1] })
    const twoScan = jpegScan({ componentIds: [1, 2] })
    const invalidSequentialScans = [
      jpegSegment(0xda, Buffer.alloc(5)),
      withByte(oneScan, 4, 0),
      withByte(oneScan, 5, 9),
      withByte(oneScan, 6, 0x40),
      withByte(twoScan, 7, 1),
      withByte(oneScan, 8, 0),
    ]
    for (const scan of invalidSequentialScans) {
      expectInvalid(jpegFromParts([jpegFrame({ componentIds: [1, 2] }), scan, Buffer.from([1])]))
    }

    const progressiveFrame = jpegFrame({ componentIds: [1, 2], marker: 0xc2 })
    for (const scan of [
      jpegScan({ componentIds: [1, 2], spectralEnd: 5, spectralStart: 1 }),
      jpegScan({ componentIds: [1], spectralEnd: 1 }),
      jpegScan({ componentIds: [1], spectralEnd: 4, spectralStart: 5 }),
      jpegScan({ approximation: 0xee, componentIds: [1], spectralEnd: 0 }),
    ])
      expectInvalid(jpegFromParts([progressiveFrame, scan, Buffer.from([1])]))
  })

  it('enforces scan profile selectors, frame order, and interleaved sampling limits', () => {
    expectInvalid(
      jpegFromParts([
        jpegFrame({ componentIds: [1] }),
        jpegScan({
          componentIds: [1],
          tableSelectors: [{ ac: 2, dc: 2 }],
        }),
        Buffer.from([1]),
      ]),
    )
    expectInvalid(
      jpegFromParts([
        jpegFrame({ componentIds: [1, 2, 3] }),
        jpegScan({ componentIds: [3, 2, 1] }),
        Buffer.from([1]),
      ]),
    )
    expectInvalid(
      jpegFromParts([
        jpegFrame({
          componentIds: [1, 2, 3],
          samplingFactors: [
            { horizontal: 2, vertical: 2 },
            { horizontal: 2, vertical: 2 },
            { horizontal: 2, vertical: 2 },
          ],
        }),
        jpegScan({ componentIds: [1, 2, 3] }),
        Buffer.from([1]),
      ]),
    )

    const asciiIds = [...Buffer.from('RGB', 'ascii')]
    expect(
      jpeg.parseBoundedJpegContainer(
        jpegFromParts([
          jpegFrame({
            componentIds: asciiIds,
            samplingFactors: [
              { horizontal: 2, vertical: 2 },
              { horizontal: 2, vertical: 2 },
              { horizontal: 1, vertical: 2 },
            ],
          }),
          jpegScan({ componentIds: asciiIds }),
          Buffer.from([1]),
        ]),
      ),
    ).toMatchObject({ width: 1280 })

    const selectorThree = [{ ac: 3, dc: 3 }]
    expect(
      jpeg.parseBoundedJpegContainer(
        jpegFromParts([
          jpegFrame({ componentIds: [0x52], marker: 0xc1 }),
          jpegScan({ componentIds: [0x52], tableSelectors: selectorThree }),
          Buffer.from([1]),
        ]),
      ),
    ).toMatchObject({ progressive: false })
    expect(
      jpeg.parseBoundedJpegContainer(
        jpegFromParts([
          jpegFrame({ componentIds: [0x52], marker: 0xc2 }),
          jpegScan({
            componentIds: [0x52],
            spectralEnd: 0,
            tableSelectors: selectorThree,
          }),
          Buffer.from([1]),
        ]),
      ),
    ).toMatchObject({ progressive: true })
  })

  it('enforces exact byte, segment-size, structural-marker, scan, and restart caps', () => {
    const empty = baselineJpeg({ entropy: Buffer.alloc(0) })
    const exactBytes = baselineJpeg({
      entropy: Buffer.alloc(jpeg.JPEG_LIMITS.maxBytes - empty.length, 0x11),
    })
    expect(exactBytes).toHaveLength(jpeg.JPEG_LIMITS.maxBytes)
    expect(jpeg.parseBoundedJpegContainer(exactBytes)).toMatchObject({ width: 1280 })
    expectInvalid(
      baselineJpeg({
        entropy: Buffer.alloc(jpeg.JPEG_LIMITS.maxBytes - empty.length + 1, 0x11),
      }),
    )

    expect(
      jpeg.parseBoundedJpegContainer(
        baselineJpeg({
          beforeFrame: [jpegSegment(0xe1, Buffer.alloc(jpeg.JPEG_LIMITS.maxSegmentBytes))],
        }),
      ),
    ).toMatchObject({ width: 1280 })

    const markerFillers = Array.from({ length: jpeg.JPEG_LIMITS.maxMarkers - 4 }, () =>
      jpegSegment(0xe1),
    )
    expect(
      jpeg.parseBoundedJpegContainer(baselineJpeg({ beforeFrame: markerFillers })),
    ).toMatchObject({ markerCount: jpeg.JPEG_LIMITS.maxMarkers })
    expectInvalid(baselineJpeg({ beforeFrame: [...markerFillers, jpegSegment(0xe1)] }))

    const scans = Array.from({ length: jpeg.JPEG_LIMITS.maxScans }, () => [
      jpegScan({ componentIds: [1] }),
      Buffer.from([0x11]),
    ]).flat()
    expect(
      jpeg.parseBoundedJpegContainer(
        jpegFromParts([jpegFrame({ componentIds: [1], marker: 0xc1 }), ...scans]),
      ),
    ).toMatchObject({ scanCount: jpeg.JPEG_LIMITS.maxScans })
    expectInvalid(
      jpegFromParts([
        jpegFrame({ componentIds: [1], marker: 0xc1 }),
        ...scans,
        jpegScan({ componentIds: [1] }),
        Buffer.from([0x11]),
      ]),
    )

    const restartPrefix = [
      jpegFrame({ componentIds: [1] }),
      jpegRestartInterval(1),
      jpegScan({ componentIds: [1] }),
    ]
    expect(
      jpeg.parseBoundedJpegContainer(
        jpegFromParts([...restartPrefix, restartEntropy(jpeg.JPEG_LIMITS.maxRestartMarkers)]),
      ),
    ).toMatchObject({
      markerCount: 5,
      restartMarkerCount: jpeg.JPEG_LIMITS.maxRestartMarkers,
    })
    expectInvalid(
      jpegFromParts([...restartPrefix, restartEntropy(jpeg.JPEG_LIMITS.maxRestartMarkers + 1)]),
    )
  })
})
