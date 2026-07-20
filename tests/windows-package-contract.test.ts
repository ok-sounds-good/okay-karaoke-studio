import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

type PackageEvidenceModule = {
  PE_X64_MACHINE: number
  assertOwnedPath(root: string, candidate: string, label: string): string
  parseInstallerPayloads(output: string): Array<{ name: string; architecture: string }>
  readPeMachine(file: string): Promise<number>
  validateArchiveInventory(files: string[]): string[]
}

const require = createRequire(import.meta.url)
const evidence = require('../scripts/windows-package-evidence.cjs') as PackageEvidenceModule
const root = path.resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

async function repositoryFile(name: string) {
  return readFile(path.join(root, name), 'utf8')
}

async function temporaryFile(bytes: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'oks-windows-package-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, 'application.exe')
  await writeFile(file, bytes)
  return file
}

function peFile(machine = evidence.PE_X64_MACHINE) {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.write('PE\0\0', 64, 'binary')
  bytes.writeUInt16LE(machine, 68)
  return bytes
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('Windows x64 package contract', () => {
  it('declares only the unsigned x64 NSIS target with deterministic naming', async () => {
    const manifest = JSON.parse(await repositoryFile('package.json'))

    expect(manifest.build).toMatchObject({
      appId: 'studio.okay.karaoke',
      productName: 'Okay Karaoke Studio',
      asar: true,
      win: {
        icon: 'build/icon.png',
        artifactName: 'Okay-Karaoke-Studio-${version}-${arch}-setup.${ext}',
        forceCodeSigning: false,
        target: [{ target: 'nsis', arch: ['x64'] }],
      },
      nsis: { oneClick: true },
      mac: { target: ['dmg', 'zip'] },
    })
    expect(manifest.scripts['dist:win']).toBe(
      'bun run build && electron-builder --win nsis --x64 --publish never',
    )
    expect(manifest.build).not.toHaveProperty('linux')
    expect(manifest.build).not.toHaveProperty('publish')
    expect(manifest.build.win).not.toHaveProperty('sign')
    expect(manifest.build.win).not.toHaveProperty('signAndEditExecutable')
    expect(manifest.build.win.target.map(({ target }: { target: string }) => target)).toEqual([
      'nsis',
    ])
    expect(manifest.build.files).toEqual([
      'dist/**/*',
      'electron/**/*',
      'scripts/visual-result-validation.cjs',
      'package.json',
    ])
  })

  it('rejects artifact paths that are not owned by the repository', () => {
    expect(evidence.assertOwnedPath('/workspace/repo', '/workspace/repo/release', 'release')).toBe(
      path.resolve('/workspace/repo/release'),
    )
    expect(() => evidence.assertOwnedPath('/workspace/repo', '/workspace/repo', 'release')).toThrow(
      'inside the repository root',
    )
    expect(() =>
      evidence.assertOwnedPath('/workspace/repo', '/workspace/elsewhere', 'release'),
    ).toThrow('inside the repository root')
  })

  it('reads the actual PE machine and fails closed for malformed executables', async () => {
    await expect(evidence.readPeMachine(await temporaryFile(peFile()))).resolves.toBe(0x8664)
    await expect(evidence.readPeMachine(await temporaryFile(peFile(0x14c)))).resolves.toBe(0x14c)
    await expect(
      evidence.readPeMachine(await temporaryFile(Buffer.from('not PE'))),
    ).rejects.toThrow('not a PE executable')
  })

  it('requires one x64 payload in the actual NSIS inventory', () => {
    expect(evidence.parseInstallerPayloads('Path = $PLUGINSDIR\\app-64.7z\nSize = 123')).toEqual([
      {
        name: 'app-64.7z',
        architecture: 'x64',
      },
    ])
    expect(
      evidence.parseInstallerPayloads('app-64.7z\napp-32.7z\napp-arm64.7z\narchive-x64.nsis.7z'),
    ).toEqual([
      { name: 'app-64.7z', architecture: 'x64' },
      { name: 'app-32.7z', architecture: 'ia32' },
      { name: 'app-arm64.7z', architecture: 'arm64' },
      { name: 'archive-x64.nsis.7z', architecture: 'x64' },
    ])
  })

  it('requires renderer/main resources and rejects source or local artifacts from app.asar', () => {
    const required = ['/package.json', '/dist/index.html', '/electron/main.cjs']
    expect(evidence.validateArchiveInventory(required)).toEqual(required)
    for (const prohibited of [
      '/tests/export.test.ts',
      '/release/old.exe',
      '/.worktrees/task/file',
      '/local-song.oks',
      '/debug.log',
      '/media/song.mp3',
      '/.env.production',
      '/credentials.json',
    ]) {
      expect(() => evidence.validateArchiveInventory([...required, prohibited])).toThrow(
        'contains prohibited files',
      )
    }
    expect(() => evidence.validateArchiveInventory(['/package.json'])).toThrow(
      'missing /dist/index.html',
    )
  })
})
