import { createHash } from 'node:crypto'
import * as fileSystem from 'node:fs/promises'
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
      : results.createScenarioResultArtifacts(
          scenario,
          results.STYLE_SESSION_VIEWPORTS.map(
            ({ width, height }: { width: number; height: number }, index: number) =>
              validPng(width, height, index + 1),
          ),
        )
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

  it('accepts the exact ordered Style-session capture contract', async () => {
    const { output } = await freshResult(results.STYLE_SESSION_SCENARIO)
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).resolves.toMatchObject({
      artifacts: [
        {
          height: 720,
          name: '01-project-lyrics-1280x720.png',
          width: 1280,
        },
        {
          height: 900,
          name: '02-project-lyrics-1440x900.png',
          width: 1440,
        },
        {
          height: 720,
          name: '03-background-gradient-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '04-background-solid-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '05-background-solid-applied-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '06-title-card-destination-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '07-title-card-eyebrow-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '08-title-card-artist-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '09-title-card-applied-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '10-stage-frame-destination-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '11-stage-frame-master-off-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '12-stage-frame-clock-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '13-stage-frame-footer-hidden-draft-1280x720.png',
          width: 1280,
        },
        {
          height: 720,
          name: '14-stage-frame-applied-1280x720.png',
          width: 1280,
        },
      ],
      ok: true,
      schemaVersion: 1,
    })
  })

  it('rejects duplicate-content Style-session captures', async () => {
    const { output } = await freshResult(results.STYLE_SESSION_SCENARIO)
    const duplicate = await readFile(join(output, results.STYLE_SESSION_NAMES[0]))
    const manifest = JSON.parse(await readFile(join(output, results.RESULT_NAME), 'utf8'))
    manifest.artifacts[2] = { ...manifest.artifacts[0], name: results.STYLE_SESSION_NAMES[2] }
    await writeFile(join(output, results.STYLE_SESSION_NAMES[2]), duplicate)
    await writeFile(join(output, results.RESULT_NAME), `${JSON.stringify(manifest)}\n`)
    await expect(
      results.validateVisualResultDirectory(output, { scenario: results.STYLE_SESSION_SCENARIO }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it('rejects the retired nine-capture Style-session directory', async () => {
    const { output } = await freshResult(results.STYLE_SESSION_SCENARIO)
    const retired = results.STYLE_SESSION_NAMES.slice(9)
    await Promise.all(retired.map((name: string) => rm(join(output, name))))
    const manifest = JSON.parse(await readFile(join(output, results.RESULT_NAME), 'utf8'))
    manifest.artifacts = manifest.artifacts.slice(0, 9)
    await writeFile(join(output, results.RESULT_NAME), `${JSON.stringify(manifest)}\n`)
    await expect(
      results.validateVisualResultDirectory(output, { scenario: results.STYLE_SESSION_SCENARIO }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it('rejects cross-scenario and stale scenario artifacts', async () => {
    const baseline = await freshResult()
    await expect(
      results.validateVisualResultDirectory(baseline.output, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')

    const styleSession = await freshResult(results.STYLE_SESSION_SCENARIO)
    await expect(results.validateVisualResultDirectory(styleSession.output)).rejects.toThrow(
      'VISUAL_SMOKE_RESULT_INVALID',
    )
    await writeFile(join(styleSession.output, '01-baseline.png'), validPng(1280, 720))
    await expect(
      results.validateVisualResultDirectory(styleSession.output, {
        scenario: results.STYLE_SESSION_SCENARIO,
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

  it('rejects replacement of an earlier Style-session capture during a later read', async () => {
    const { output, root } = await freshResult(results.STYLE_SESSION_SCENARIO)
    const firstCapture = results.STYLE_SESSION_NAMES[0]
    let replaced = false
    await expect(
      results.validateVisualResultDirectory(output, {
        beforeRead: async (_claimed: string, name: string) => {
          if (replaced || name !== results.STYLE_SESSION_NAMES[1]) return
          replaced = true
          await rename(join(output, firstCapture), join(root, 'displaced-first-capture.png'))
          await writeFile(join(output, firstCapture), validPng(1, 1))
        },
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
    expect(replaced).toBe(true)
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it('rejects replacement of a revalidated Style-session capture during a later final recheck', async () => {
    const { output, root } = await freshResult(results.STYLE_SESSION_SCENARIO)
    const firstCapturePath = join(output, results.STYLE_SESSION_NAMES[0])
    const secondCapturePath = join(output, results.STYLE_SESSION_NAMES[1])
    let secondCaptureEntryChecks = 0
    let replaced = false
    const fsApi = {
      ...fileSystem,
      async lstat(filePath: string, options: { bigint: true }) {
        if (filePath === secondCapturePath) {
          secondCaptureEntryChecks += 1
          // Initial consumption checks this entry before and after reading it;
          // lookup three begins its final recheck, after earlier leaves passed.
          if (secondCaptureEntryChecks === 3) {
            replaced = true
            await rename(firstCapturePath, join(root, 'displaced-revalidated-capture.png'))
            await writeFile(firstCapturePath, validPng(1, 1))
          }
        }
        return fileSystem.lstat(filePath, options)
      },
    }

    await expect(
      results.validateVisualResultDirectory(output, {
        fsApi,
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
    expect(replaced).toBe(true)
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it('rejects same-inode mutation of a revalidated capture during a later final recheck', async () => {
    const { output } = await freshResult(results.STYLE_SESSION_SCENARIO)
    const firstCapturePath = join(output, results.STYLE_SESSION_NAMES[0])
    const secondCapturePath = join(output, results.STYLE_SESSION_NAMES[1])
    const original = await fileSystem.lstat(firstCapturePath, { bigint: true })
    const originalBytes = await readFile(firstCapturePath)
    const changedOffset = Math.floor(originalBytes.length / 2)
    let retainedIdentity = false
    let secondCaptureEntryChecks = 0
    const fsApi = {
      ...fileSystem,
      async lstat(filePath: string, options: { bigint: true }) {
        if (filePath === secondCapturePath) {
          secondCaptureEntryChecks += 1
          if (secondCaptureEntryChecks === 3) {
            const handle = await fileSystem.open(firstCapturePath, 'r+')
            try {
              const changedByte = Buffer.from([originalBytes[changedOffset] ^ 0xff])
              await handle.write(changedByte, 0, changedByte.length, changedOffset)
              await handle.sync()
            } finally {
              await handle.close()
            }
            const changed = await fileSystem.lstat(firstCapturePath, { bigint: true })
            retainedIdentity =
              changed.dev === original.dev &&
              changed.ino === original.ino &&
              changed.size === original.size
          }
        }
        return fileSystem.lstat(filePath, options)
      },
    }

    await expect(
      results.validateVisualResultDirectory(output, {
        fsApi,
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
    expect(retainedIdentity).toBe(true)
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })

  it('publishes authoritative validated bytes independently of a later source mutation', async () => {
    const { output, root } = await freshResult(results.STYLE_SESSION_SCENARIO)
    const validated = await results.validateVisualResultDirectory(output, {
      scenario: results.STYLE_SESSION_SCENARIO,
    })
    expect(validated.publishedArtifacts.map(({ name }: { name: string }) => name)).toEqual([
      ...results.STYLE_SESSION_NAMES,
      results.RESULT_NAME,
    ])
    const authoritativeFirst = Buffer.from(validated.publishedArtifacts[0].bytes)
    const published = join(root, 'published-evidence')
    await publishArtifactBuffers(published, validated.publishedArtifacts)

    await writeFile(join(output, results.STYLE_SESSION_NAMES[0]), validPng(1, 1))

    await expect(
      results.validateVisualResultDirectory(published, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).resolves.toMatchObject({ ok: true, schemaVersion: 1 })
    expect(await readFile(join(published, results.STYLE_SESSION_NAMES[0]))).toEqual(
      authoritativeFirst,
    )
    await expect(
      results.validateVisualResultDirectory(output, {
        scenario: results.STYLE_SESSION_SCENARIO,
      }),
    ).rejects.toThrow('VISUAL_SMOKE_RESULT_INVALID')
  })
})
