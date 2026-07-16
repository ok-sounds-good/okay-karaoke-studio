import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validPng } from './support/png-fixture'

const require = createRequire(import.meta.url)
const results = require('../scripts/visual-result-validation.cjs')
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

async function freshResult(scenario = results.BASELINE_SCENARIO) {
  const root = await mkdtemp(join(tmpdir(), 'oks-visual-result-'))
  roots.push(root)
  const output = join(root, 'evidence')
  const created =
    scenario === results.BASELINE_SCENARIO
      ? results.createResultArtifacts(validPng(1280, 720))
      : results.createScenarioResultArtifacts(scenario, [validPng(1280, 720), validPng(1440, 900)])
  await publishArtifactBuffers(output, created.artifacts)
  return { output, root }
}

describe('visual result validation', () => {
  it('constructs exact native workflow paths without depending on the host platform', () => {
    const posixRoot = '/Users/runner/work/_temp'
    const windowsRoot = String.raw`D:\a\_temp`
    expect(results.workflowEvidencePath(posixRoot, posix)).toBe(
      `${posixRoot}/okay-karaoke-studio-video-style-visual`,
    )
    expect(results.workflowEvidencePath(windowsRoot, win32)).toBe(
      String.raw`D:\a\_temp\okay-karaoke-studio-video-style-visual`,
    )
    expect(results.workflowEvidencePath(windowsRoot, win32)).not.toContain('/')
    expect(() => results.workflowEvidencePath(String.raw`D:\a\_temp/`, win32)).toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
  })

  it('writes the exact validated workflow path as one GitHub step output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oks-visual-workflow-'))
    roots.push(root)
    const githubOutput = join(root, 'github-output')
    await writeFile(githubOutput, '')
    const output = await results.writeWorkflowEvidencePath({
      GITHUB_OUTPUT: githubOutput,
      RUNNER_TEMP: root,
    })
    expect(await readFile(githubOutput, 'utf8')).toBe(`path=${output}\n`)
    expect(output).toBe(join(root, 'okay-karaoke-studio-video-style-visual'))
  })

  it('accepts only the exact hashed 1280 by 720 baseline contract', async () => {
    const { output } = await freshResult()
    await expect(results.validateVisualResultDirectory(output)).resolves.toMatchObject({
      artifacts: [{ height: 720, name: '01-baseline.png', width: 1280 }],
      ok: true,
      schemaVersion: 1,
    })
  })

  it('accepts the exact ordered project typography capture contract', async () => {
    const { output } = await freshResult(results.PROJECT_TYPOGRAPHY_SCENARIO)
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.PROJECT_TYPOGRAPHY_SCENARIO,
      }),
    ).resolves.toMatchObject({
      artifacts: [
        {
          height: 720,
          name: '01-project-typography-1280x720.png',
          width: 1280,
        },
        {
          height: 900,
          name: '02-project-typography-1440x900.png',
          width: 1440,
        },
      ],
      ok: true,
      schemaVersion: 1,
    })
  })

  it('rejects cross-scenario and stale scenario artifacts', async () => {
    const baseline = await freshResult()
    await expect(
      results.validateVisualResultDirectory(baseline.output, {
        scenario: results.PROJECT_TYPOGRAPHY_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')

    const typography = await freshResult(results.PROJECT_TYPOGRAPHY_SCENARIO)
    await expect(results.validateVisualResultDirectory(typography.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
    await writeFile(join(typography.output, '01-baseline.png'), validPng(1280, 720))
    await expect(
      results.validateVisualResultDirectory(typography.output, {
        scenario: results.PROJECT_TYPOGRAPHY_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it.each(['hash', 'dimensions'])('rejects a manifest-valid %s mismatch', async (kind) => {
    const { output } = await freshResult()
    const png = kind === 'dimensions' ? validPng(1, 1) : validPng(1280, 720)
    const manifest = {
      artifacts: [
        {
          bytes: png.length,
          height: 720,
          name: '01-baseline.png',
          sha256: kind === 'hash' ? '0'.repeat(64) : createHash('sha256').update(png).digest('hex'),
          width: 1280,
        },
      ],
      ok: true,
      schemaVersion: 1,
    }
    await writeFile(join(output, '01-baseline.png'), png)
    await writeFile(join(output, 'result.json'), results.serializeManifest(manifest))
    await expect(results.validateVisualResultDirectory(output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
  })

  it('rejects extra, symlinked, and nonregular evidence leaves', async () => {
    const extra = await freshResult()
    await writeFile(join(extra.output, 'secret.txt'), 'must not upload')
    await expect(results.validateVisualResultDirectory(extra.output)).rejects.toThrow()

    const linked = await freshResult()
    const displaced = join(linked.root, 'baseline.png')
    await rename(join(linked.output, '01-baseline.png'), displaced)
    await symlink(displaced, join(linked.output, '01-baseline.png'))
    await expect(results.validateVisualResultDirectory(linked.output)).rejects.toThrow()

    const nonregular = await freshResult()
    await rm(join(nonregular.output, '01-baseline.png'))
    await mkdir(join(nonregular.output, '01-baseline.png'))
    await expect(results.validateVisualResultDirectory(nonregular.output)).rejects.toThrow()
  })

  it('rejects a directory identity swap during consumption', async () => {
    const { output, root } = await freshResult()
    await expect(
      results.validateVisualResultDirectory(output, {
        beforeRead: async (_claimed: string, name: string) => {
          if (name !== 'result.json') return
          await rename(output, join(root, 'displaced'))
          await mkdir(output)
        },
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it('rejects replacement of an earlier typography capture during a later read', async () => {
    const { output, root } = await freshResult(results.PROJECT_TYPOGRAPHY_SCENARIO)
    const firstCapture = results.PROJECT_TYPOGRAPHY_NAMES[0]
    let replaced = false
    await expect(
      results.validateVisualResultDirectory(output, {
        beforeRead: async (_claimed: string, name: string) => {
          if (replaced || name !== results.PROJECT_TYPOGRAPHY_NAMES[1]) return
          replaced = true
          await rename(join(output, firstCapture), join(root, 'displaced-first-capture.png'))
          await writeFile(join(output, firstCapture), validPng(1, 1))
        },
        scenario: results.PROJECT_TYPOGRAPHY_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
    expect(replaced).toBe(true)
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.PROJECT_TYPOGRAPHY_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })
})
