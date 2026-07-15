import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const smoke = require('../electron/video-style-visual-smoke.cjs') as { FATAL_DIAGNOSTIC: string }
const MAX_CAPTURE_BYTES = 64 * 1024
const PROBE_RENDERER_MESSAGE = 'renderer-fatal-probe'
const roots: string[] = []

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        force: true,
        recursive: true,
      }),
    ),
  ),
)

function runElectronProbe(args: string[]) {
  return new Promise<{
    code: number | null
    fatalDiagnostic: boolean
    leakedRendererMessage: boolean
    overflow: boolean
    signal: NodeJS.Signals | null
  }>((resolve, reject) => {
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(electronExecutable, args, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let capturedBytes = 0
    let overflow = false
    const capture = (chunk: Buffer) => {
      capturedBytes += chunk.length
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        overflow = true
        return
      }
      chunks.push(Buffer.from(chunk))
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 20_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) {
        reject(new Error('RENDERER_FATAL_PROBE_TIMEOUT'))
        return
      }
      const captured = Buffer.concat(chunks).toString('utf8')
      resolve({
        code,
        fatalDiagnostic: captured.includes(smoke.FATAL_DIAGNOSTIC.trim()),
        leakedRendererMessage: captured.includes(PROBE_RENDERER_MESSAGE),
        overflow,
        signal,
      })
    })
  })
}

describe('live Electron renderer fatal observation', () => {
  it('fails after an asynchronous post-root throw without publishing success and cleans up safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oks-renderer-fatal-probe-'))
    roots.push(root)
    const output = join(root, 'evidence')
    const status = join(root, 'status.json')
    const userData = join(root, 'user-data')
    const sessionData = join(root, 'session-data')
    await Promise.all([mkdir(userData), mkdir(sessionData)])

    const outcome = await runElectronProbe([
      join(process.cwd(), 'tests/support/visual-smoke-renderer-fatal-probe.cjs'),
      `--output=${output}`,
      `--status=${status}`,
      `--user-data=${userData}`,
      `--session-data=${sessionData}`,
    ])

    expect(outcome).toEqual({
      code: 1,
      fatalDiagnostic: true,
      leakedRendererMessage: false,
      overflow: false,
      signal: null,
    })
    expect(JSON.parse(await readFile(status, 'utf8'))).toEqual({
      destroyed: true,
      disposed: true,
      fatal: true,
      fatalBeforeCapture: true,
      ok: false,
    })
    expect(await readdir(output)).toEqual(['failure.json'])
    expect(JSON.parse(await readFile(join(output, 'failure.json'), 'utf8'))).toEqual({
      code: 'VISUAL_SMOKE_FAILED',
      ok: false,
    })
  }, 30_000)
})
