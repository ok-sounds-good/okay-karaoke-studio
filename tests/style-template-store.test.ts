import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneStageStyle, cloneVocalStyle } from '../src/lib/video-style'
import type { StyleTemplatePreferences } from '../src/lib/style-template-codec'

const require = createRequire(import.meta.url)
const { createStyleTemplateStore, MAX_STYLE_TEMPLATE_FILE_BYTES } =
  require('../electron/style-template-store.cjs') as {
    MAX_STYLE_TEMPLATE_FILE_BYTES: number
    createStyleTemplateStore(options: {
      filePath: string
      createId?: () => string
      readFile?: (path: string, limit: number, label: string) => Promise<string>
      writeFile?: (path: string, contents: string) => Promise<void>
    }): {
      list(): Promise<Array<{ id: string; name: string; preferences: StyleTemplatePreferences }>>
      create(value: { name: string; preferences: StyleTemplatePreferences }): Promise<{
        id: string
        name: string
        preferences: StyleTemplatePreferences
      }>
      rename(value: { id: string; name: string }): Promise<{ id: string; name: string }>
      delete(value: { id: string }): Promise<true>
    }
  }
const { writeUtf8FileAtomically } = require('../electron/project-files.cjs') as {
  writeUtf8FileAtomically(
    path: string,
    contents: string,
    dependencies?: Record<string, unknown>,
  ): Promise<void>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function storePath() {
  const directory = await mkdtemp(join(tmpdir(), 'okay-karaoke-style-templates-'))
  temporaryDirectories.push(directory)
  return { directory, filePath: join(directory, 'style-templates.json') }
}

function preferences(imagePath = '/linked/background.png'): StyleTemplatePreferences {
  const stageStyle = cloneStageStyle()
  stageStyle.background.mode = 'image'
  stageStyle.background.imagePath = imagePath
  const vocalStyle = cloneVocalStyle()
  return {
    stageStyle,
    lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
    vocalStyle,
    videoExportDefaults: { resolution: '1080p', fps: 30 },
  }
}

describe('main-process style template store', () => {
  it('treats an absent file as empty and persists FIFO CRUD with stable IDs', async () => {
    const { filePath } = await storePath()
    const ids = ['stable-a', 'stable-b']
    const store = createStyleTemplateStore({ filePath, createId: () => ids.shift()! })

    expect(await store.list()).toEqual([])
    const first = await store.create({ name: '  Warm\tStage ', preferences: preferences() })
    const second = await store.create({
      name: 'Cool Stage',
      preferences: preferences('/other.png'),
    })
    expect(first).toMatchObject({ id: 'stable-a', name: 'Warm Stage' })
    expect(second).toMatchObject({ id: 'stable-b', name: 'Cool Stage' })
    expect((await stat(filePath)).mode & 0o777).toBe(0o666 & ~process.umask())

    const renamed = await store.rename({ id: first.id, name: 'Amber Stage' })
    expect(renamed).toMatchObject({ id: 'stable-a', name: 'Amber Stage' })
    expect((await store.list()).map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'stable-a', name: 'Amber Stage' },
      { id: 'stable-b', name: 'Cool Stage' },
    ])
    expect(await store.delete({ id: first.id })).toBe(true)
    expect((await store.list()).map(({ id }) => id)).toEqual(['stable-b'])
    const reopened = createStyleTemplateStore({ filePath })
    expect((await reopened.list()).map(({ id }) => id)).toEqual(['stable-b'])
  })

  it('rejects duplicate canonical names, invalid request shapes, and missing IDs', async () => {
    const { filePath } = await storePath()
    const store = createStyleTemplateStore({ filePath, createId: () => 'stable-id' })
    await store.create({ name: 'Warm Stage', preferences: preferences() })

    await expect(
      store.create({ name: '\tWarm   Stage\n', preferences: preferences('/new.png') }),
    ).rejects.toThrow('Duplicate style template name: Warm Stage')
    await expect(store.rename({ id: 'missing', name: 'New Name' })).rejects.toThrow(
      'Style template not found.',
    )
    await expect(store.delete({ id: 'missing' })).rejects.toThrow('Style template not found.')
    await expect(
      store.rename({ id: 'stable-id', name: 'New Name', extra: true } as never),
    ).rejects.toThrow('invalid shape')
    const inherited = Object.assign(Object.create({ extra: true }), {
      id: 'stable-id',
      name: 'New Name',
    })
    await expect(store.rename(inherited)).rejects.toThrow('must be an own property')
  })

  it('rejects generated ID collisions without changing the persisted collection', async () => {
    const { filePath } = await storePath()
    const store = createStyleTemplateStore({ filePath, createId: () => 'same-id' })
    await store.create({ name: 'First', preferences: preferences() })

    await expect(store.create({ name: 'Second', preferences: preferences() })).rejects.toThrow(
      'Duplicate style template id: same-id',
    )
    await expect(store.list()).resolves.toMatchObject([{ id: 'same-id', name: 'First' }])
  })

  it('returns fresh deep values that cannot mutate persisted templates', async () => {
    const { filePath } = await storePath()
    const input = preferences()
    const store = createStyleTemplateStore({ filePath, createId: () => 'stable-id' })
    const created = await store.create({ name: 'Original', preferences: input })

    input.lyricDisplay.lineCount = 1
    created.preferences.lyricDisplay.lineCount = 2
    const listed = await store.list()
    listed[0].preferences.lyricDisplay.lineCount = 4

    await expect(store.list()).resolves.toMatchObject([
      { id: 'stable-id', name: 'Original', preferences: { lyricDisplay: { lineCount: 3 } } },
    ])
  })

  it('preserves and rejects corrupt, unsupported, oversized, and unreadable stores', async () => {
    for (const [name, contents] of [
      ['corrupt', '{not-json'],
      ['unsupported', '{"schemaVersion":1,"templates":[]}'],
      ['oversized', 'x'.repeat(MAX_STYLE_TEMPLATE_FILE_BYTES + 1)],
    ] as const) {
      const { filePath } = await storePath()
      await writeFile(filePath, contents)
      const store = createStyleTemplateStore({ filePath })
      await expect(store.list()).rejects.toThrow()
      expect(await readFile(filePath, 'utf8')).toBe(contents)
      expect(name).toBeTruthy()
    }

    const { filePath } = await storePath()
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const store = createStyleTemplateStore({
      filePath,
      readFile: async () => Promise.reject(denied),
    })
    await expect(store.list()).rejects.toBe(denied)
  })

  it('rejects invalid UTF-8 for every operation without changing the original bytes', async () => {
    const { filePath } = await storePath()
    const seed = createStyleTemplateStore({ filePath, createId: () => 'stable-id' })
    await seed.create({ name: 'Warm', preferences: preferences() })
    const bytes = await readFile(filePath)
    const nameOffset = bytes.indexOf(Buffer.from('Warm'))
    expect(nameOffset).toBeGreaterThan(0)
    bytes[nameOffset] = 0xff
    await writeFile(filePath, bytes)

    const store = createStyleTemplateStore({ filePath, createId: () => 'new-id' })
    for (const operation of [
      () => store.list(),
      () => store.create({ name: 'New', preferences: preferences() }),
      () => store.rename({ id: 'stable-id', name: 'Renamed' }),
      () => store.delete({ id: 'stable-id' }),
    ]) {
      await expect(operation()).rejects.toThrow('valid UTF-8')
      expect(await readFile(filePath)).toEqual(bytes)
    }
  })

  it.each(['open', 'write', 'flush', 'close', 'rename'])(
    'preserves the destination and cleans its temporary file after %s failure',
    async (failure) => {
      const { directory, filePath } = await storePath()
      const prior = '{"schemaVersion":0,"templates":[]}'
      await writeFile(filePath, prior)
      const injected = Object.assign(new Error(`${failure} failed`), { code: 'EIO' })
      let temporaryCloseAttempts = 0

      const store = createStyleTemplateStore({
        filePath,
        createId: () => 'stable-id',
        writeFile: (destination, contents) =>
          writeUtf8FileAtomically(destination, contents, {
            createId: () => 'failure-case',
            openFile: async (target: string, flags: string, mode?: number) => {
              if (flags === 'wx' && failure === 'open') throw injected
              const handle = await open(target, flags, mode)
              if (flags !== 'wx') return handle
              return {
                writeFile: async (...args: Parameters<typeof handle.writeFile>) => {
                  if (failure === 'write') throw injected
                  return handle.writeFile(...args)
                },
                sync: async () => {
                  if (failure === 'flush') throw injected
                  return handle.sync()
                },
                close: async () => {
                  temporaryCloseAttempts += 1
                  if (failure === 'close' && temporaryCloseAttempts === 1) throw injected
                  return handle.close()
                },
              }
            },
            renameFile: async (source: string, destinationPath: string) => {
              if (failure === 'rename') throw injected
              const { rename } = await import('node:fs/promises')
              return rename(source, destinationPath)
            },
          }),
      })

      await expect(store.create({ name: 'Warm Stage', preferences: preferences() })).rejects.toBe(
        injected,
      )
      expect(await readFile(filePath, 'utf8')).toBe(prior)
      expect(await readdir(directory)).toEqual(['style-templates.json'])
    },
  )

  it('serializes concurrent mutations and recovers its queue after a rejected write', async () => {
    const { filePath } = await storePath()
    let writeCount = 0
    const ids = ['failed-id', 'saved-id']
    const store = createStyleTemplateStore({
      filePath,
      createId: () => ids.shift()!,
      writeFile: async (destination, contents) => {
        writeCount += 1
        if (writeCount === 1) throw new Error('injected first write failure')
        await writeUtf8FileAtomically(destination, contents)
      },
    })

    const failed = store.create({ name: 'First', preferences: preferences() })
    const saved = store.create({ name: 'Second', preferences: preferences() })
    const savedExpectation = expect(saved).resolves.toMatchObject({
      id: 'saved-id',
      name: 'Second',
    })
    await expect(failed).rejects.toThrow('injected first write failure')
    await savedExpectation
    await expect(store.list()).resolves.toMatchObject([{ id: 'saved-id', name: 'Second' }])
  })
})
