import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const packageSmoke = require('../scripts/windows-package-smoke.cjs')
const smokeArtifacts = require('../electron/smoke-artifacts.cjs')
const visualResults = require('../scripts/visual-result-validation.cjs')
const roots: string[] = []

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))),
)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oks-windows-package-smoke-'))
  roots.push(root)
  await mkdir(join(root, 'release', 'win-unpacked', 'resources'), { recursive: true })
  await writeFile(join(root, ...packageSmoke.EXECUTABLE_RELATIVE_PATH.split('/')), 'packaged-exe')
  await writeFile(join(root, ...packageSmoke.RESOURCE_RELATIVE_PATH.split('/')), 'packaged-asar')
  return {
    output: join(root, ...packageSmoke.OUTPUT_RELATIVE_PATH.split('/')),
    root,
  }
}

function runSmoke(
  value: { output: string; root: string },
  supplied: Record<string, any> = {},
  options = {},
) {
  return packageSmoke.runWindowsPackageSmoke(
    { output: value.output, record: vi.fn(), root: value.root, ...options },
    supplied,
  )
}

function validate(value: { output: string; root: string }, options = {}) {
  return packageSmoke.validateWindowsPackageSmokeDirectory(value.output, {
    root: value.root,
    ...options,
  })
}

function cleanOutcome() {
  return {
    code: 0,
    diagnostics: { fatal: false, overflow: false },
    signal: null,
    terminationConfirmed: true,
    timedOut: false,
  }
}

function visualStub() {
  return vi.fn(
    async (options: { argv: string[]; executable: string }, supplied: Record<string, any>) => {
      const scenario = options.argv[0].startsWith('--scenario=')
        ? options.argv[0].slice('--scenario='.length)
        : visualResults.BASELINE_SCENARIO
      const output = options.argv.at(-1)!
      await supplied.runChild({
        args: ['--smoke'],
        executable: options.executable,
        spawnOptions: { cwd: dirname(options.executable) },
      })
      const exactPngs = visualResults
        .scenarioContract(scenario)
        .map(({ width, height }: { width: number; height: number }, index: number) =>
          validPng(width, height, index + 1),
        )
      await smokeArtifacts.publishArtifactBuffers(
        output,
        visualResults.createScenarioResultArtifacts(scenario, exactPngs).artifacts,
      )
      return { ok: true }
    },
  )
}

async function successfulRun(value: { output: string; root: string }) {
  const records: unknown[] = []
  const runChild = vi.fn(async () => cleanOutcome())
  const runVisual = visualStub()
  const result = await packageSmoke.runWindowsPackageSmoke(
    { output: value.output, record: (record: unknown) => records.push(record), root: value.root },
    { runChild, runVisual },
  )
  expect(result.ok).toBe(true)
  return { records, result, runChild, runVisual }
}

async function rejectsBeforeLaunch(value: { output: string; root: string }, options = {}) {
  const runVisual = vi.fn()
  await expect(runSmoke(value, { runVisual }, options)).resolves.toEqual(packageSmoke.FAILURE)
  expect(runVisual).not.toHaveBeenCalled()
}

describe('Windows packaged application smoke', () => {
  it('records the fixed executable before two packaged production-window launches', async () => {
    const { output, root } = await fixture()
    const { records, result, runChild, runVisual } = await successfulRun({ output, root })

    expect(records[0]).toEqual({
      event: 'windows-package-smoke-executable',
      ...result.manifest.executable,
    })
    expect(records).toHaveLength(1)
    expect(runVisual).toHaveBeenCalledTimes(2)
    const executable = join(root, ...packageSmoke.EXECUTABLE_RELATIVE_PATH.split('/'))
    for (const [options] of runVisual.mock.calls)
      expect(options).toMatchObject({ executable, packaged: true })
    const childOptions = runChild.mock.calls[0][0]
    expect(childOptions.executable).toMatch(/powershell\.exe$/iu)
    expect(
      JSON.parse(Buffer.from(childOptions.args.at(-1), 'base64').toString('utf8')),
    ).toMatchObject({
      executable,
      executableSha256: result.manifest.executable.sha256,
    })
    expect(result.manifest).toMatchObject({
      launches: [{ scenario: 'baseline' }, { scenario: 'style-session' }],
      runtime: { bridgeFrozen: true, ipcRoundTrip: 'getPendingWindowClose', windows: 1 },
    })
    expect(result.manifest.launches[1].artifacts).toHaveLength(16)
    expect(await readFile(join(output, 'launch.log'), 'utf8')).not.toContain(root)
  }, 20000)

  it.each([
    ['nonzero exit', { ...cleanOutcome(), code: 9 }],
    ['signal', { ...cleanOutcome(), signal: 'SIGTERM' }],
    ['timeout', { ...cleanOutcome(), timedOut: true }],
    ['unconfirmed termination', { ...cleanOutcome(), terminationConfirmed: false }],
    ['start failure', { ...cleanOutcome(), startFailed: true }],
    ['post-spawn error', { ...cleanOutcome(), postSpawnError: true }],
    ['forwarded cancellation', { ...cleanOutcome(), forwardedSignal: 'SIGTERM' }],
    ['termination attempt', { ...cleanOutcome(), terminationAttempted: true }],
    ['failed kill', { ...cleanOutcome(), killFailed: true }],
    ['fatal output', { ...cleanOutcome(), diagnostics: { fatal: true, overflow: false } }],
    ['overflow output', { ...cleanOutcome(), diagnostics: { fatal: false, overflow: true } }],
  ])('fails closed on a %s without publishing a root success result', async (_name, child) => {
    const { output, root } = await fixture()
    const result = await runSmoke(
      { output, root },
      {
        runChild: vi.fn(async () => child),
        runVisual: visualStub(),
      },
    )
    expect(result).toEqual(packageSmoke.FAILURE)
    await expect(readFile(join(output, 'result.json'))).rejects.toThrow()
    await expect(readFile(join(output, 'failure.json'), 'utf8')).resolves.toBe(
      '{"code":"WINDOWS_PACKAGE_SMOKE_FAILED","ok":false}\n',
    )
  })

  it('rejects a missing resource and a linked executable before starting a child', async () => {
    const missing = await fixture()
    await rm(join(missing.root, ...packageSmoke.RESOURCE_RELATIVE_PATH.split('/')))
    await rejectsBeforeLaunch(missing)

    const linked = await fixture()
    const executable = join(linked.root, ...packageSmoke.EXECUTABLE_RELATIVE_PATH.split('/'))
    const external = join(linked.root, 'external.exe')
    await writeFile(external, 'external')
    await rm(executable)
    await symlink(external, executable)
    await rejectsBeforeLaunch(linked)
  })

  it('rejects executable path substitution between inspection and open', async () => {
    const { output, root } = await fixture()
    const executable = join(root, ...packageSmoke.EXECUTABLE_RELATIVE_PATH.split('/'))
    const fsApi = {
      ...fs,
      open: async (file: string, flags: string) => {
        if (file === executable) {
          await fs.rename(file, `${file}.original`)
          await fs.writeFile(file, 'replacement')
        }
        return fs.open(file, flags)
      },
    }
    await rejectsBeforeLaunch({ output, root }, { fsApi })
  })

  it('detects package mutation after launch and leaves only fixed failure evidence', async () => {
    const { output, root } = await fixture()
    const executable = join(root, ...packageSmoke.EXECUTABLE_RELATIVE_PATH.split('/'))
    let launches = 0
    const runVisual = visualStub()
    const mutatingVisual = vi.fn(async (...args: Parameters<typeof runVisual>) => {
      const result = await runVisual(...args)
      launches += 1
      if (launches === 2) await writeFile(executable, 'mutated-package')
      return result
    })
    const result = await runSmoke(
      { output, root },
      { runChild: vi.fn(async () => cleanOutcome()), runVisual: mutatingVisual },
    )
    expect(result).toEqual(packageSmoke.FAILURE)
    await expect(readFile(join(output, 'result.json'))).rejects.toThrow()
    await expect(readFile(join(output, 'failure.json'))).resolves.toBeDefined()
  })

  it('rejects an output ancestor changed to a reparse point while claiming evidence', async () => {
    const { output, root } = await fixture()
    const release = join(root, 'release')
    let claimed = false
    const fsApi = {
      ...fs,
      lstat: async (file: string, options: any) => {
        const stats = await fs.lstat(file, options)
        return claimed && file === release
          ? Object.assign(Object.create(stats), { isSymbolicLink: () => true })
          : stats
      },
      mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
        const result = await fs.mkdir(...args)
        claimed = true
        return result
      },
    }
    await rejectsBeforeLaunch({ output, root }, { fsApi })
  })

  it('rejects unexpected, tampered, and stale output without replacing evidence', async () => {
    for (const [name, contents] of [
      ['unexpected.txt', 'unexpected'],
      ['launch.log', 'tampered'],
    ]) {
      const value = await fixture()
      await successfulRun(value)
      await writeFile(join(value.output, name), contents)
      await expect(validate(value)).rejects.toThrow('WINDOWS_PACKAGE_SMOKE_FAILED')
    }

    const raced = await fixture()
    await successfulRun(raced)
    let scenarios = 0
    await expect(
      validate(raced, {
        validateVisual: async (...args: any[]) => {
          const visual = await visualResults.validateVisualResultDirectory(...args)
          if (++scenarios === 2) await writeFile(join(raced.output, 'result.json'), 'replaced late')
          return visual
        },
      }),
    ).rejects.toThrow('WINDOWS_PACKAGE_SMOKE_FAILED')

    const stale = await fixture()
    await mkdir(stale.output)
    await writeFile(join(stale.output, 'keep.txt'), 'keep')
    await rejectsBeforeLaunch(stale)
    await expect(readFile(join(stale.output, 'keep.txt'), 'utf8')).resolves.toBe('keep')
    await expect(readFile(join(stale.output, 'failure.json'))).rejects.toThrow()
  })
})
