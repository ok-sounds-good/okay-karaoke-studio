import { createRequire } from 'node:module'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const launcher = require('../scripts/video-style-visual-smoke.cjs')
const smoke = require('../electron/video-style-visual-smoke.cjs')
const smokeProfiles = require('../electron/smoke-profile.cjs')
const visualResults = require('../scripts/visual-result-validation.cjs')
const { publishArtifactBuffers } = require('../electron/smoke-artifacts.cjs')
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

async function ownedRawClaim() {
  const parent = await mkdtemp(join(tmpdir(), 'oks-visual-owned-raw-'))
  roots.push(parent)
  return smokeProfiles.createOwnedSmokeProfile('claim-', { temporaryRoot: parent })
}

function profile(prefix: string) {
  return { path: `/profiles/${prefix}`, serializedIdentity: `${prefix}-identity` }
}

function validatedArtifacts() {
  return [
    { bytes: Buffer.from('png:01-baseline.png'), name: visualResults.BASELINE_NAME },
    { bytes: Buffer.from('{"ok":true}\n'), name: visualResults.RESULT_NAME },
  ]
}

function baselinePublishingChild() {
  return vi.fn(async ({ args }: { args: string[] }) => {
    const rawArgument = args.find((argument) => argument.startsWith(smoke.OPTIONS.output))
    if (!rawArgument) throw new Error('missing raw output argument')
    const rawOutput = rawArgument.slice(smoke.OPTIONS.output.length)
    const artifacts = visualResults.createResultArtifacts(validPng(1280, 720)).artifacts
    await publishArtifactBuffers(rawOutput, artifacts)
    return {
      code: 0,
      diagnostics: { fatal: false, overflow: false },
      signal: null,
    }
  })
}

async function replaceOwnedRawRoot(claim: { path: string }, kind = 'directory') {
  const displaced = join(dirname(claim.path), 'displaced-owned-root')
  await rename(claim.path, displaced)
  if (kind === 'link') {
    await symlink(displaced, claim.path, process.platform === 'win32' ? 'junction' : 'dir')
  } else {
    await mkdir(claim.path)
    await writeFile(join(claim.path, 'replacement-sentinel'), 'preserve replacement')
  }
  return displaced
}

describe('visual smoke launcher raw-root retention', () => {
  it('withholds success and preserves a replacement made after validation', async () => {
    const output = await outputPath()
    const rawClaim = await ownedRawClaim()
    const created = [profile('user'), profile('session')]
    const publish = vi.fn()
    let displaced = ''

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi.fn(async () => created.shift()),
          createRawRoot: vi.fn(async () => rawClaim),
          publish,
          runChild: baselinePublishingChild(),
          verifyProfile: vi.fn(async () => ({ retained: true })),
          verifyRawRoot: (claim: { path: string }) =>
            smokeProfiles.verifyRetainedSmokeProfile(claim, {
              beforeIdentityCheck: async () => {
                displaced = await replaceOwnedRawRoot(claim)
              },
            }),
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_OUTPUT_INVALID', ok: false })
    expect(publish).not.toHaveBeenCalled()
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(rawClaim.path, 'replacement-sentinel'), 'utf8')).toBe(
      'preserve replacement',
    )
    expect(await readFile(join(displaced, smokeProfiles.OWNER_FILE), 'utf8')).toContain(
      rawClaim.identity.token,
    )
    expect((await lstat(join(displaced, 'evidence', 'result.json'))).isFile()).toBe(true)
  })

  it.each([
    ['child failure', { code: 9, signal: null }],
    ['termination-unconfirmed child', { code: null, signal: null, terminationUnconfirmed: true }],
  ])('withholds %s output when ownership drifts', async (_label, childOutcome) => {
    const output = await outputPath()
    const rawClaim = await ownedRawClaim()
    const created = [profile('user'), profile('session')]
    const publish = vi.fn()
    const validateResult = vi.fn()
    const writeFailure = vi.fn()
    let displaced = ''

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi.fn(async () => created.shift()),
          createRawRoot: vi.fn(async () => rawClaim),
          publish,
          runChild: vi.fn(async () => childOutcome),
          validateResult,
          verifyProfile: vi.fn(async () => ({ retained: true })),
          verifyRawRoot: (claim: { path: string }) =>
            smokeProfiles.verifyRetainedSmokeProfile(claim, {
              beforeIdentityCheck: async () => {
                displaced = await replaceOwnedRawRoot(claim)
              },
            }),
          writeFailure,
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_OUTPUT_INVALID', ok: false })
    expect(validateResult).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(writeFailure).not.toHaveBeenCalled()
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(rawClaim.path, 'replacement-sentinel'), 'utf8')).toBe(
      'preserve replacement',
    )
    expect(await readFile(join(displaced, smokeProfiles.OWNER_FILE), 'utf8')).toContain(
      rawClaim.identity.token,
    )
  })

  it('withholds publication and preserves a symlink or junction replacement', async () => {
    const output = await outputPath()
    const rawClaim = await ownedRawClaim()
    const created = [profile('user'), profile('session')]
    const publish = vi.fn()
    let displaced = ''

    await expect(
      launcher.runLauncher(
        { argv: [output], executable: '/electron' },
        {
          createProfile: vi.fn(async () => created.shift()),
          createRawRoot: vi.fn(async () => rawClaim),
          publish,
          runChild: vi.fn(async () => ({
            code: 0,
            diagnostics: { fatal: false, overflow: false },
            signal: null,
          })),
          validateResult: vi.fn(async () => ({ publishedArtifacts: validatedArtifacts() })),
          verifyProfile: vi.fn(async () => ({ retained: true })),
          verifyRawRoot: (claim: { path: string }) =>
            smokeProfiles.verifyRetainedSmokeProfile(claim, {
              beforeIdentityCheck: async () => {
                displaced = await replaceOwnedRawRoot(claim, 'link')
              },
            }),
        },
      ),
    ).resolves.toEqual({ code: 'VISUAL_SMOKE_OUTPUT_INVALID', ok: false })
    expect(publish).not.toHaveBeenCalled()
    await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(rawClaim.path)).isSymbolicLink()).toBe(true)
    expect(await readFile(join(rawClaim.path, smokeProfiles.OWNER_FILE), 'utf8')).toContain(
      rawClaim.identity.token,
    )
    expect(await readFile(join(displaced, smokeProfiles.OWNER_FILE), 'utf8')).toContain(
      rawClaim.identity.token,
    )
  })
})
