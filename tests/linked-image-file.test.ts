import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const linkedFile = require('../electron/linked-image-file.cjs') as {
  LINKED_IMAGE_ERROR_MESSAGES: Readonly<Record<string, string>>
  LINKED_IMAGE_FILE_LIMITS: Readonly<{ maxBytes: number; readChunkBytes: number }>
  PATH_SNAPSHOT_LIMITATION: string
  snapshotLinkedImageFile(
    selectedPath: string,
    options?: { fileSystem?: FakeFileSystem },
  ): Promise<Buffer>
}

type BigIntStat = {
  ctimeNs: bigint
  dev: bigint
  ino: bigint
  isFile(): boolean
  mtimeNs: bigint
  size: bigint
}

type ReadCall = {
  buffer: Buffer
  length: number
  offset: number
  position: number
}

type FakeFileSystem = {
  open(path: string, flags: string): Promise<FakeHandle>
  readFile?(path: string): Promise<Buffer>
  realpath(path: string): Promise<string>
  stat(path: string, options: { bigint: true }): Promise<BigIntStat>
}

type FakeHandle = {
  close(): Promise<void>
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ buffer: Buffer; bytesRead: number }>
  stat(options: { bigint: true }): Promise<BigIntStat>
}

function makeStat(overrides: Partial<BigIntStat> = {}): BigIntStat {
  const regular = overrides.isFile?.() ?? true
  return {
    ctimeNs: 6n,
    dev: 2n,
    ino: 3n,
    mtimeNs: 5n,
    size: 4n,
    ...overrides,
    isFile: () => regular,
  }
}

function changed(stat: BigIntStat, overrides: Partial<BigIntStat>) {
  return makeStat({ ...stat, ...overrides })
}

function createHarness(
  options: {
    bytes?: Buffer
    growthAtEof?: boolean
    handleStats?: BigIntStat[]
    partialReadBytes?: number
    pathStats?: BigIntStat[]
    readErrorAt?: number
    realpaths?: string[]
    reportedSize?: bigint
    zeroAt?: number
  } = {},
) {
  const bytes = options.bytes ?? Buffer.from([1, 2, 3, 4])
  const selectedPath = '/chosen/background-link.png'
  const canonicalPath = '/media/background.png'
  const base = makeStat({ size: options.reportedSize ?? BigInt(bytes.length) })
  const pathStats = options.pathStats ?? [base, base, base, base]
  const handleStats = options.handleStats ?? [base, base]
  const realpaths = options.realpaths ?? [canonicalPath, canonicalPath]
  const calls = {
    close: 0,
    handleStatOptions: [] as Array<{ bigint: true }>,
    open: [] as Array<{ flags: string; path: string }>,
    read: [] as ReadCall[],
    readFile: 0,
    realpath: [] as string[],
    stat: [] as Array<{ options: { bigint: true }; path: string }>,
  }
  let pathStatIndex = 0
  let handleStatIndex = 0
  let realpathIndex = 0

  const handle: FakeHandle = {
    async close() {
      calls.close += 1
    },
    async read(buffer, offset, length, position) {
      calls.read.push({ buffer, length, offset, position })
      if (options.readErrorAt === position) {
        throw new Error(`read failed for ${selectedPath}`)
      }
      if (options.zeroAt === position) return { buffer, bytesRead: 0 }
      if (options.growthAtEof && position === Number(base.size)) {
        buffer[offset] = 0xee
        return { buffer, bytesRead: 1 }
      }
      const available = Math.max(0, bytes.length - position)
      const bytesRead = Math.min(length, available, options.partialReadBytes ?? length)
      if (bytesRead > 0) bytes.copy(buffer, offset, position, position + bytesRead)
      return { buffer, bytesRead }
    },
    async stat(statOptions) {
      calls.handleStatOptions.push(statOptions)
      return handleStats[Math.min(handleStatIndex++, handleStats.length - 1)]
    },
  }

  const fileSystem: FakeFileSystem = {
    async open(path, flags) {
      calls.open.push({ flags, path })
      return handle
    },
    async readFile() {
      calls.readFile += 1
      throw new Error('Path reread is forbidden')
    },
    async realpath(path) {
      calls.realpath.push(path)
      return realpaths[Math.min(realpathIndex++, realpaths.length - 1)]
    },
    async stat(path, statOptions) {
      calls.stat.push({ options: statOptions, path })
      return pathStats[Math.min(pathStatIndex++, pathStats.length - 1)]
    },
  }

  return { base, bytes, calls, canonicalPath, fileSystem, selectedPath }
}

async function rejected(operation: Promise<unknown>) {
  try {
    await operation
  } catch (error) {
    return error as Error & { cause?: Error; code?: string }
  }
  throw new Error('Operation was unexpectedly accepted')
}

describe('linked image FileHandle snapshots', () => {
  it('follows a canonical target once and loops over explicit-position partial reads', async () => {
    const bytes = Buffer.alloc(linkedFile.LINKED_IMAGE_FILE_LIMITS.readChunkBytes * 2 + 17)
    bytes.forEach((_byte, index) => {
      bytes[index] = index & 0xff
    })
    const harness = createHarness({ bytes, partialReadBytes: 7001 })

    const result = await linkedFile.snapshotLinkedImageFile(harness.selectedPath, {
      fileSystem: harness.fileSystem,
    })

    expect(result).toEqual(bytes)
    expect(harness.calls.open).toEqual([{ flags: 'r', path: harness.canonicalPath }])
    expect(harness.calls.readFile).toBe(0)
    expect(harness.calls.realpath).toEqual([harness.selectedPath, harness.selectedPath])
    expect(harness.calls.stat.map(({ path }) => path)).toEqual([
      harness.selectedPath,
      harness.canonicalPath,
      harness.selectedPath,
      harness.canonicalPath,
    ])
    expect(harness.calls.stat.every(({ options }) => options.bigint === true)).toBe(true)
    expect(harness.calls.handleStatOptions).toEqual([{ bigint: true }, { bigint: true }])
    expect(harness.calls.close).toBe(1)

    const dataReads = harness.calls.read.slice(0, -1)
    expect(dataReads.length).toBeGreaterThan(2)
    expect(
      dataReads.every(({ length }) => length <= linkedFile.LINKED_IMAGE_FILE_LIMITS.readChunkBytes),
    ).toBe(true)
    expect(dataReads.every(({ offset, position }) => offset === position)).toBe(true)
    expect(harness.calls.read.at(-1)).toMatchObject({
      length: 1,
      offset: 0,
      position: bytes.length,
    })
  })

  it.each([1, linkedFile.LINKED_IMAGE_FILE_LIMITS.maxBytes])(
    'accepts the exact %i-byte file boundary',
    async (size) => {
      const harness = createHarness({ bytes: Buffer.alloc(size, 0x5a) })
      const result = await linkedFile.snapshotLinkedImageFile(harness.selectedPath, {
        fileSystem: harness.fileSystem,
      })
      expect(result).toHaveLength(size)
      expect(result[0]).toBe(0x5a)
      expect(harness.calls.open).toHaveLength(1)
    },
  )

  it.each([0n, BigInt(linkedFile.LINKED_IMAGE_FILE_LIMITS.maxBytes) + 1n])(
    'rejects the out-of-range %s-byte stat before opening',
    async (size) => {
      const harness = createHarness({ reportedSize: size })
      const error = await rejected(
        linkedFile.snapshotLinkedImageFile(harness.selectedPath, {
          fileSystem: harness.fileSystem,
        }),
      )
      expect(error).toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })
      expect(harness.calls.open).toHaveLength(0)
    },
  )

  it('requires regular files and real bigint stats before and after reading', async () => {
    const preDirectory = createHarness({
      pathStats: [makeStat({ isFile: () => false })],
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(preDirectory.selectedPath, {
        fileSystem: preDirectory.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })

    const invalidStat = makeStat()
    invalidStat.mtimeNs = 5 as unknown as bigint
    const nonBigint = createHarness({ pathStats: [invalidStat] })
    await expect(
      linkedFile.snapshotLinkedImageFile(nonBigint.selectedPath, {
        fileSystem: nonBigint.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })

    const postDirectory = createHarness()
    const notFile = changed(postDirectory.base, { isFile: () => false })
    postDirectory.fileSystem.stat = async (path, options) => {
      postDirectory.calls.stat.push({ options, path })
      return postDirectory.calls.stat.length === 3 ? notFile : postDirectory.base
    }
    await expect(
      linkedFile.snapshotLinkedImageFile(postDirectory.selectedPath, {
        fileSystem: postDirectory.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })
    expect(postDirectory.calls.close).toBe(1)
  })

  it.each([
    ['device', 'dev', 20n],
    ['inode', 'ino', 30n],
    ['size', 'size', 5n],
    ['modification time', 'mtimeNs', 50n],
    ['change time', 'ctimeNs', 60n],
  ] as const)('detects open-handle %s changes', async (_name, field, value) => {
    const harness = createHarness()
    const after = changed(harness.base, { [field]: value })
    const mutation = createHarness({
      bytes: harness.bytes,
      handleStats: [harness.base, after],
      pathStats: [harness.base, harness.base, after, after],
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(mutation.selectedPath, {
        fileSystem: mutation.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })
    expect(mutation.calls.close).toBe(1)
  })

  it('detects selected-path, canonical-path, and symlink-target substitutions', async () => {
    const selectedChanged = createHarness()
    const replacement = changed(selectedChanged.base, { ino: 99n })
    const selectedPathMutation = createHarness({
      pathStats: [selectedChanged.base, selectedChanged.base, replacement, selectedChanged.base],
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(selectedPathMutation.selectedPath, {
        fileSystem: selectedPathMutation.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })

    const canonicalMismatch = createHarness({
      pathStats: [selectedChanged.base, replacement],
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(canonicalMismatch.selectedPath, {
        fileSystem: canonicalMismatch.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })

    const targetChanged = createHarness({
      realpaths: ['/media/background.png', '/media/replacement.png'],
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(targetChanged.selectedPath, {
        fileSystem: targetChanged.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })
  })

  it('detects truncation, zero progress, and growth at the expected EOF', async () => {
    const truncated = createHarness({
      bytes: Buffer.from([1, 2, 3]),
      reportedSize: 4n,
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(truncated.selectedPath, {
        fileSystem: truncated.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })

    const stalled = createHarness({
      bytes: Buffer.alloc(linkedFile.LINKED_IMAGE_FILE_LIMITS.readChunkBytes + 1),
      zeroAt: linkedFile.LINKED_IMAGE_FILE_LIMITS.readChunkBytes,
    })
    await expect(
      linkedFile.snapshotLinkedImageFile(stalled.selectedPath, {
        fileSystem: stalled.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })

    const grown = createHarness({ growthAtEof: true })
    await expect(
      linkedFile.snapshotLinkedImageFile(grown.selectedPath, {
        fileSystem: grown.fileSystem,
      }),
    ).rejects.toMatchObject({ code: 'LINKED_IMAGE_FILE_INVALID' })
    expect(grown.calls.close).toBe(1)
  })

  it('maps read and filesystem failures to fixed messages without exposing paths', async () => {
    const readFailure = createHarness({ readErrorAt: 0 })
    const readError = await rejected(
      linkedFile.snapshotLinkedImageFile(readFailure.selectedPath, {
        fileSystem: readFailure.fileSystem,
      }),
    )
    expect(readError).toMatchObject({
      code: 'LINKED_IMAGE_READ_FAILED',
      message: linkedFile.LINKED_IMAGE_ERROR_MESSAGES.LINKED_IMAGE_READ_FAILED,
    })
    expect(readError.message).not.toContain(readFailure.selectedPath)
    expect(readError).not.toHaveProperty('cause')
    expect(readError).not.toHaveProperty('path')
    expect(readFailure.calls.close).toBe(1)

    const selectedPath = '/private/user/secret.png'
    const cause = new Error(`ENOENT: no such file, realpath '${selectedPath}'`)
    const fileSystem = {
      async realpath() {
        throw cause
      },
    } as unknown as FakeFileSystem
    const pathError = await rejected(
      linkedFile.snapshotLinkedImageFile(selectedPath, {
        fileSystem,
      }),
    )
    expect(pathError).toMatchObject({
      code: 'LINKED_IMAGE_FILE_INVALID',
      message: linkedFile.LINKED_IMAGE_ERROR_MESSAGES.LINKED_IMAGE_FILE_INVALID,
    })
    expect(pathError.message).not.toContain(selectedPath)
    expect(pathError).not.toHaveProperty('cause')
    expect(pathError).not.toHaveProperty('path')
  })

  it('rejects an invalid selected path before making any filesystem call', async () => {
    let calls = 0
    const fileSystem = new Proxy(
      {},
      {
        get() {
          calls += 1
          throw new Error('filesystem must not be touched')
        },
      },
    ) as FakeFileSystem
    const error = await rejected(linkedFile.snapshotLinkedImageFile('', { fileSystem }))
    expect(error).toMatchObject({
      code: 'LINKED_IMAGE_FILE_INVALID',
      message: linkedFile.LINKED_IMAGE_ERROR_MESSAGES.LINKED_IMAGE_FILE_INVALID,
    })
    expect(calls).toBe(0)
  })

  it('returns caller-owned bytes detached from source and retained read buffers', async () => {
    const harness = createHarness({ bytes: Buffer.from([9, 8, 7, 6]) })
    const result = await linkedFile.snapshotLinkedImageFile(harness.selectedPath, {
      fileSystem: harness.fileSystem,
    })
    const expected = Buffer.from(result)
    harness.bytes.fill(0)
    for (const call of harness.calls.read) call.buffer.fill(0)
    expect(result).toEqual(expected)
    expect(result.buffer).not.toBe(harness.calls.read[0].buffer.buffer)
  })

  it('documents the best-effort pathname checks without overstating race safety', () => {
    expect(linkedFile.PATH_SNAPSHOT_LIMITATION).toContain('best-effort')
    expect(linkedFile.PATH_SNAPSHOT_LIMITATION).toContain('cannot eliminate ABA')
    expect(linkedFile.PATH_SNAPSHOT_LIMITATION).toContain('mutate-restore')
    expect(linkedFile.PATH_SNAPSHOT_LIMITATION).toContain('same-inode hybrid')
    expect(linkedFile.PATH_SNAPSHOT_LIMITATION).toContain('same-size mutation')
    expect(linkedFile.PATH_SNAPSHOT_LIMITATION).toContain('dev/ino/timestamp metadata')
  })
})
