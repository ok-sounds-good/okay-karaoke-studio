import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const launcher = require('../scripts/video-style-visual-smoke.cjs')
const smoke = require('../electron/video-style-visual-smoke.cjs')
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

async function outputPath() {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-launcher-'))
  roots.push(root)
  return join(root, 'evidence')
}

function profile(prefix: string) {
  return { path: `/profiles/${prefix}`, serializedIdentity: `${prefix}-identity` }
}

describe('visual smoke launcher', () => {
  it('passes only the fixed production-smoke arguments to a bounded child', async () => {
    const output = await outputPath()
    const runChild = vi.fn(async () => ({
      code: 0,
      diagnostics: { fatal: false, overflow: false },
      signal: null,
    }))
    const validateResult = vi.fn(async () => ({ ok: true }))
    const created = [profile('user'), profile('session')]
    const outcome = await launcher.runLauncher(
      {
        environment: { OKS_VISUAL_EVIDENCE_DIR: output },
        executable: '/electron',
      },
      {
        createProfile: vi.fn(async () => created.shift()),
        outputState: vi.fn(async () => ({ output, state: 'absent' })),
        runChild,
        validateResult,
        verifyProfile: vi.fn(async () => ({ retained: true })),
      },
    )
    expect(outcome).toEqual({ ok: true })
    expect(runChild).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: '/electron',
        spawnOptions: {
          cwd: launcher.REPOSITORY_ROOT,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      }),
    )
    expect(runChild.mock.calls[0][0].captureOutput.maxBytesPerStream).toBe(
      launcher.MAX_DIAGNOSTIC_BYTES,
    )
    const args = runChild.mock.calls[0][0].args
    expect(args).toEqual([
      launcher.REPOSITORY_ROOT,
      smoke.TRIGGER,
      `${smoke.OPTIONS.output}${output}`,
      `${smoke.OPTIONS.scenario}${smoke.BASELINE_SCENARIO}`,
      `${smoke.OPTIONS.userData}/profiles/user`,
      `${smoke.OPTIONS.userIdentity}user-identity`,
      `${smoke.OPTIONS.sessionData}/profiles/session`,
      `${smoke.OPTIONS.sessionIdentity}session-identity`,
    ])
    expect(validateResult).toHaveBeenCalledWith(output, { scenario: smoke.BASELINE_SCENARIO })
  })

  it('allowlists the project typography scenario before creating profiles or a child', async () => {
    const output = await outputPath()
    const runChild = vi.fn(async () => ({
      code: 0,
      diagnostics: { fatal: false, overflow: false },
      signal: null,
    }))
    const validateResult = vi.fn(async () => ({ ok: true }))
    const created = [profile('user'), profile('session')]
    await expect(
      launcher.runLauncher(
        {
          argv: [`${launcher.SCENARIO_ARGUMENT}${smoke.PROJECT_TYPOGRAPHY_SCENARIO}`, output],
          executable: '/electron',
        },
        {
          createProfile: vi.fn(async () => created.shift()),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          runChild,
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
        },
      ),
    ).resolves.toEqual({ ok: true })
    expect(runChild.mock.calls[0][0].args).toContain(
      `${smoke.OPTIONS.scenario}${smoke.PROJECT_TYPOGRAPHY_SCENARIO}`,
    )
    expect(validateResult).toHaveBeenCalledWith(output, {
      scenario: smoke.PROJECT_TYPOGRAPHY_SCENARIO,
    })
  })

  it.each([
    '--scenario',
    '--scenario=',
    '--scenario=baseline',
    '--scenario=unknown',
    '--scenario-project-typography',
  ])(
    'rejects malformed or unallowlisted scenario argument %s before side effects',
    async (flag) => {
      const output = await outputPath()
      const createProfile = vi.fn()
      const outputState = vi.fn()
      const runChild = vi.fn()
      await expect(
        launcher.runLauncher(
          { argv: [flag, output] },
          {
            createProfile,
            outputState,
            runChild,
          },
        ),
      ).resolves.toEqual({ code: 'VISUAL_SMOKE_SCENARIO_INVALID', ok: false })
      expect(createProfile).not.toHaveBeenCalled()
      expect(outputState).not.toHaveBeenCalled()
      expect(runChild).not.toHaveBeenCalled()
    },
  )

  it('rejects duplicate allowlisted scenario arguments before side effects', async () => {
    const output = await outputPath()
    const scenario = `${launcher.SCENARIO_ARGUMENT}${smoke.PROJECT_TYPOGRAPHY_SCENARIO}`
    const createProfile = vi.fn()
    const runChild = vi.fn()
    await expect(
      launcher.runLauncher({ argv: [scenario, scenario, output] }, { createProfile, runChild }),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_SCENARIO_INVALID', ok: false })
    expect(createProfile).not.toHaveBeenCalled()
    expect(runChild).not.toHaveBeenCalled()
  })

  it('maps child failures to one sanitized fresh failure artifact', async () => {
    const output = await outputPath()
    const writeFailure = vi.fn(async () => 'created')
    const outcome = await launcher.runLauncher(
      {
        argv: [output],
        executable: '/private/electron',
      },
      {
        createProfile: vi
          .fn()
          .mockResolvedValueOnce(profile('user'))
          .mockResolvedValueOnce(profile('session')),
        outputState: vi.fn(async () => ({ output, state: 'absent' })),
        runChild: vi.fn(async () => ({ code: 9, signal: null })),
        verifyProfile: vi.fn(async () => ({ retained: true })),
        writeFailure,
      },
    )
    expect(outcome).toEqual({ code: 'VISUAL_SMOKE_CHILD_FAILED', ok: false })
    expect(writeFailure).toHaveBeenCalledWith(output, {
      code: 'VISUAL_SMOKE_CHILD_FAILED',
      ok: false,
    })
    expect(JSON.stringify(writeFailure.mock.calls)).not.toContain('/private/electron')
  })

  it.each([
    'TypeError: Object has been destroyed at /private/project/main.cjs:1',
    'Uncaught TypeError: renderer failure at /private/project/renderer.js:1',
    'Uncaught (in promise) TypeError: renderer rejection at /private/project/renderer.js:2',
  ])(
    'rejects a zero-exit child with captured fatal diagnostics without leaking %s',
    async (secret) => {
      const output = await outputPath()
      const writeFailure = vi.fn(async () => 'created')
      const validateResult = vi.fn()
      const outcome = await launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi
            .fn()
            .mockResolvedValueOnce(profile('user'))
            .mockResolvedValueOnce(profile('session')),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          runChild: vi.fn(async ({ captureOutput }) => ({
            code: 0,
            diagnostics: {
              fatal: captureOutput.classify(Buffer.alloc(0), Buffer.from(secret)),
              overflow: false,
            },
            signal: null,
          })),
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
          writeFailure,
        },
      )
      expect(outcome).toEqual({ code: 'VISUAL_SMOKE_CHILD_FAILED', ok: false })
      expect(validateResult).not.toHaveBeenCalled()
      expect(JSON.stringify(writeFailure.mock.calls)).not.toContain(secret)
    },
  )

  it('rejects capture overflow even when the child otherwise exits cleanly', async () => {
    const output = await outputPath()
    const validateResult = vi.fn()
    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi
            .fn()
            .mockResolvedValueOnce(profile('user'))
            .mockResolvedValueOnce(profile('session')),
          outputState: vi.fn(async () => ({ output, state: 'absent' })),
          runChild: vi.fn(async () => ({
            code: 0,
            diagnostics: { fatal: false, overflow: true },
            signal: null,
          })),
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
          writeFailure: vi.fn(async () => 'created'),
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_CHILD_FAILED', ok: false })
    expect(validateResult).not.toHaveBeenCalled()
  })

  it('rejects an existing output before creating profiles or starting Electron', async () => {
    const output = await outputPath()
    const createProfile = vi.fn()
    const runChild = vi.fn()
    await expect(
      launcher.runLauncher(
        { argv: [output] },
        {
          createProfile,
          outputState: vi.fn(async () => ({ output, state: 'marker-present' })),
          runChild,
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_OUTPUT_EXISTS', ok: false })
    expect(createProfile).not.toHaveBeenCalled()
    expect(runChild).not.toHaveBeenCalled()
  })
})
