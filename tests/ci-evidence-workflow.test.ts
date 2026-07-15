import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ACTIVE_WORKFLOW = '.circleci/config.yml'
const INACTIVE_GITHUB_WORKFLOW = '.github/workflows/ci.yml.disabled'
const INACTIVE_GITHUB_WORKFLOW_SHA256 =
  '126817fa990d8c87fd8de8e8bae94165c91c3e219f37bfbd5121f50971874e86'

async function repositoryFile(name: string) {
  return readFile(join(process.cwd(), name), 'utf8')
}

function jobBlock(workflow: string, name: 'macOS' | 'Windows') {
  const start = workflow.indexOf(`  ${name}:`)
  const endMarker = name === 'macOS' ? '  Windows:' : '\nworkflows:'
  const end = workflow.indexOf(endMarker, start + 1)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

describe('CI visual evidence contract', () => {
  it('keeps GitHub Actions inactive while preserving its exact workflow', async () => {
    await expect(repositoryFile('.github/workflows/ci.yml')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const archived = await repositoryFile(INACTIVE_GITHUB_WORKFLOW)
    const digest = createHash('sha256').update(archived).digest('hex')
    expect(digest).toBe(INACTIVE_GITHUB_WORKFLOW_SHA256)
    expect(archived).toMatch(/on:\n  push:\n  pull_request:/u)
  })

  it('defines parallel protected macOS and Windows CircleCI jobs', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    expect(workflow).toContain("  macOS:\n    macos:\n      xcode: '16.4.0'")
    expect(workflow).toContain('resource_class: m4pro.medium')
    expect(workflow).toContain(
      '  Windows:\n    machine:\n      image: windows-server-2022-gui:current',
    )
    expect(workflow).toContain('resource_class: windows.medium')
    expect(workflow).toContain('  ci:\n    jobs:\n      - macOS\n      - Windows')
    expect(workflow).not.toContain('test-node')
    expect(workflow).not.toContain('npm test')
  })

  it('pins the toolchain and preserves every project gate on both platforms', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    const requiredSteps = [
      'Install locked dependencies',
      'Check formatting in changed lines',
      'Run unit tests',
      'Smoke Electron native image decoding',
      'Build renderer',
      'Capture production-window visual evidence',
      'Package unpacked desktop app',
    ]

    for (const platform of ['macOS', 'Windows'] as const) {
      const job = jobBlock(workflow, platform)
      expect(job).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")
      expect(job).toContain('24.0.2')
      expect(job).toContain('bun@1.3.14')
      expect(job).toContain('bun install --frozen-lockfile')
      expect(job).toContain('FORMAT_BASE_SHA')
      expect(job).toContain('git merge-base origin/main HEAD')
      expect(job).toContain('bun run format:check')
      expect(job).toContain('bun run test')
      expect(job).toContain('bun run test:image')
      expect(job).toContain('bun run build')
      expect(job).toContain('bun run test:visual')
      expect(job).toContain('bunx electron-builder --dir --publish never')
      for (const step of requiredSteps) expect(job).toContain(`name: ${step}`)
    }
  })

  it('captures and stores only each attempted visual-evidence leaf', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    for (const platform of ['macOS', 'Windows'] as const) {
      const job = jobBlock(workflow, platform)
      const build = job.indexOf('name: Build renderer')
      const capture = job.indexOf('name: Capture production-window visual evidence')
      const store = job.indexOf('store_artifacts:')
      const packageStep = job.indexOf('name: Package unpacked desktop app')
      expect(build).toBeLessThan(capture)
      expect(capture).toBeLessThan(store)
      expect(store).toBeLessThan(packageStep)
      expect(job).toContain('OKS_VISUAL_EVIDENCE_DIR')
      expect(job).toContain('path: .ci-artifacts/video-style-visual')
    }

    const packageJson = JSON.parse(await repositoryFile('package.json'))
    expect(packageJson.scripts['test:visual']).toBe('node scripts/video-style-visual-smoke.cjs')
  })
})
