import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const ffmpegSetup = require('../electron/ffmpeg-setup.cjs') as {
  detectFfmpeg(options?: Record<string, unknown>): Promise<Record<string, unknown>>
  discoverInstallPlan(options?: Record<string, unknown>): Promise<Record<string, unknown> | null>
  ensureFfmpegForExport(options: Record<string, unknown>): Promise<string | null>
  ffmpegExecutableCandidates(options?: Record<string, unknown>): string[]
  installArguments(platform: string): string[] | null
  parseEncoderNames(output: string): Set<string>
  runCommand(
    executable: string,
    args: string[],
    options?: Record<string, unknown>,
  ): Promise<{ code: number; stdout: string; stderr: string }>
}

const VERSION_OUTPUT = 'ffmpeg version 8.1.2 Copyright (c) the FFmpeg developers\n'
const ENCODER_OUTPUT = [
  'Encoders:',
  ' V....D libx264              libx264 H.264 encoder',
  ' A....D aac                  AAC encoder',
].join('\n')

function missingExecutable(): NodeJS.ErrnoException {
  const error = new Error('not found') as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}

describe('guided FFmpeg setup', () => {
  it('detects Homebrew and WinGet locations without depending on a refreshed GUI PATH', () => {
    expect(
      ffmpegSetup.ffmpegExecutableCandidates({
        platform: 'darwin',
        env: {},
      }),
    ).toEqual(['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'])

    expect(
      ffmpegSetup.ffmpegExecutableCandidates({
        platform: 'win32',
        env: {
          LOCALAPPDATA: 'C:\\Users\\Singer\\AppData\\Local',
          ProgramFiles: 'C:\\Program Files',
        },
      }),
    ).toEqual([
      'ffmpeg',
      'C:\\Users\\Singer\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
      'C:\\Program Files\\WinGet\\Links\\ffmpeg.exe',
    ])
  })

  it('requires both libx264 and AAC from the exact executable it finds', async () => {
    const run = vi.fn(async (_executable: string, args: string[]) => ({
      code: 0,
      stderr: '',
      stdout: args.includes('-encoders')
        ? ' V....D libx264 libx264 H.264 encoder\n'
        : VERSION_OUTPUT,
    }))

    await expect(
      ffmpegSetup.detectFfmpeg({ platform: 'linux', env: {}, run }),
    ).resolves.toMatchObject({
      available: true,
      exportCapable: false,
      missingEncoders: ['aac'],
      path: 'ffmpeg',
    })
    expect(ffmpegSetup.parseEncoderNames(ENCODER_OUTPUT)).toEqual(new Set(['libx264', 'aac']))
  })

  it('builds fixed package-manager commands with no renderer-controlled arguments', async () => {
    const run = vi.fn(async (executable: string) => {
      if (executable === 'winget') return { code: 0, stderr: '', stdout: 'v1.12.350' }
      throw missingExecutable()
    })
    const plan = await ffmpegSetup.discoverInstallPlan({ platform: 'win32', env: {}, run })

    expect(plan).toEqual(
      expect.objectContaining({
        executable: 'winget',
        method: 'winget',
        packageName: 'Gyan FFmpeg',
      }),
    )
    expect(plan?.args).toEqual([
      'install',
      '--id',
      'Gyan.FFmpeg',
      '--exact',
      '--source',
      'winget',
      '--accept-source-agreements',
      '--disable-interactivity',
    ])
    expect(ffmpegSetup.installArguments('darwin')).toEqual(['install', 'ffmpeg'])
    expect(ffmpegSetup.installArguments('linux')).toBeNull()
    expect(plan?.args).not.toContain('--accept-package-agreements')
  })

  it('skips prompts and package managers when an export-capable FFmpeg already exists', async () => {
    const run = vi.fn(async (_executable: string, args: string[]) => ({
      code: 0,
      stderr: '',
      stdout: args.includes('-encoders') ? ENCODER_OUTPUT : VERSION_OUTPUT,
    }))
    const showMessageBox = vi.fn()
    const openExternal = vi.fn()

    await expect(
      ffmpegSetup.ensureFfmpegForExport({
        platform: 'darwin',
        env: {},
        run,
        showMessageBox,
        openExternal,
      }),
    ).resolves.toBe('ffmpeg')
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens official instructions and makes no system change when no provider exists', async () => {
    const run = vi.fn(async () => {
      throw missingExecutable()
    })
    const showMessageBox = vi.fn(async () => ({ response: 0 }))
    const openExternal = vi.fn(async () => undefined)

    await expect(
      ffmpegSetup.ensureFfmpegForExport({
        platform: 'linux',
        env: {},
        run,
        showMessageBox,
        openExternal,
      }),
    ).resolves.toBeNull()
    expect(openExternal).toHaveBeenCalledWith('https://ffmpeg.org/download.html#build-linux')
  })

  it('re-detects the absolute WinGet link after explicit installation consent', async () => {
    const localAppData = 'C:\\Users\\Singer\\AppData\\Local'
    const installedPath = `${localAppData}\\Microsoft\\WinGet\\Links\\ffmpeg.exe`
    let installed = false
    const run = vi.fn(async (executable: string, args: string[]) => {
      if (executable === 'winget' && args[0] === '--version') {
        return { code: 0, stderr: '', stdout: 'v1.12.350' }
      }
      if (executable === 'winget' && args[0] === 'install') {
        installed = true
        return { code: 0, stderr: '', stdout: 'Successfully installed' }
      }
      if (installed && executable === installedPath) {
        return {
          code: 0,
          stderr: '',
          stdout: args.includes('-encoders') ? ENCODER_OUTPUT : VERSION_OUTPUT,
        }
      }
      throw missingExecutable()
    })

    await expect(
      ffmpegSetup.ensureFfmpegForExport({
        platform: 'win32',
        env: { LOCALAPPDATA: localAppData },
        run,
        verifyWaits: [0],
        showMessageBox: vi.fn(async () => ({ response: 0 })),
        openExternal: vi.fn(),
      }),
    ).resolves.toBe(installedPath)
    expect(run).toHaveBeenCalledWith('winget', ffmpegSetup.installArguments('win32'), {
      signal: undefined,
    })
  })

  it('does not treat a successful package-manager exit as a successful installation', async () => {
    const run = vi.fn(async (executable: string, args: string[]) => {
      if (executable === 'winget' && args[0] === '--version') {
        return { code: 0, stderr: '', stdout: 'v1.12.350' }
      }
      if (executable === 'winget' && args[0] === 'install') {
        return { code: 0, stderr: '', stdout: 'Successfully installed' }
      }
      throw missingExecutable()
    })

    await expect(
      ffmpegSetup.ensureFfmpegForExport({
        platform: 'win32',
        env: {},
        run,
        verifyWaits: [0],
        showMessageBox: vi.fn(async () => ({ response: 0 })),
        openExternal: vi.fn(),
      }),
    ).rejects.toThrow('did not produce an FFmpeg installation')
  })

  it('spawns fixed argv without a shell', async () => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      stdout: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    })
    const spawnImpl = vi.fn(() => child)
    const resultPromise = ffmpegSetup.runCommand('winget', ['--version'], { spawnImpl })
    child.stdout.end('v1.12.350')
    child.stderr.end()
    child.emit('close', 0, null)

    await expect(resultPromise).resolves.toMatchObject({ code: 0, stdout: 'v1.12.350' })
    expect(spawnImpl).toHaveBeenCalledWith('winget', ['--version'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  })
})
