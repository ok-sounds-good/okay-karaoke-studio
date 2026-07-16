import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const visualResults = require('../scripts/visual-result-validation.cjs') as {
  STYLE_SESSION_SCENARIO: string
  expectedFilesForScenario: (scenario: string) => readonly string[]
}
const ACTIVE_WORKFLOW = '.circleci/config.yml'
const INACTIVE_GITHUB_WORKFLOW = '.github/workflows/ci.yml.disabled'
const INACTIVE_GITHUB_WORKFLOW_SHA256 =
  '126817fa990d8c87fd8de8e8bae94165c91c3e219f37bfbd5121f50971874e86'
const MAIN_PUSH_CLAUSE = '(pipeline.event.name == "push" and pipeline.git.branch == "main")'
const MAIN_PULL_REQUEST_CLAUSE =
  '(pipeline.event.name == "pull_request" and ' +
  'pipeline.event.github.pull_request.base.ref == "main")'
const BASELINE_EVIDENCE_PATH = '.ci-artifacts/video-style-visual'
const STYLE_SESSION_EVIDENCE_PATH = '.ci-artifacts/style-session-visual'
const STYLE_SESSION_EVIDENCE_LEAVES = [
  '01-project-lyrics-1280x720.png',
  '02-project-lyrics-1440x900.png',
  '03-background-gradient-draft-1280x720.png',
  '04-background-solid-draft-1280x720.png',
  '05-background-solid-applied-1280x720.png',
  'result.json',
]
const VISUAL_TEST_INVOCATIONS = [
  'bun run test:visual',
  'bun run test:visual -- --scenario=style-session',
]

interface PipelineEvent {
  branch?: string
  name: string
  pullRequestBase?: string
}

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

function workflowWhenExpression(workflow: string) {
  const workflowStart = workflow.indexOf('workflows:\n  ci:')
  const whenMarker = '    when:'
  const whenStart = workflow.indexOf(whenMarker, workflowStart)
  const jobsStart = workflow.indexOf('    jobs:', whenStart)
  expect(workflowStart).toBeGreaterThan(0)
  expect(whenStart).toBeGreaterThan(workflowStart)
  expect(jobsStart).toBeGreaterThan(whenStart)

  return workflow
    .slice(whenStart + whenMarker.length, jobsStart)
    .trim()
    .replace(/^(?:>|\|)[+-]?\s*/u, '')
    .replace(/\s+/gu, ' ')
}

function trimmedLines(value: string, predicate: (line: string) => boolean) {
  return value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(predicate)
}

function pipelineValue(event: PipelineEvent, name: string) {
  switch (name) {
    case 'pipeline.event.name':
      return event.name
    case 'pipeline.git.branch':
      return event.branch ?? ''
    case 'pipeline.event.github.pull_request.base.ref':
      if (event.pullRequestBase === undefined) {
        throw new Error('PR-only base ref was evaluated for a non-PR pipeline')
      }
      return event.pullRequestBase
    default:
      throw new Error(`Unexpected pipeline value in workflow guard: ${name}`)
  }
}

function evaluateWorkflowWhen(expression: string, event: PipelineEvent) {
  return expression.split(' or ').some((clause) => {
    if (!clause.startsWith('(') || !clause.endsWith(')')) {
      throw new Error(`Unexpected workflow clause: ${clause}`)
    }

    return clause
      .slice(1, -1)
      .split(' and ')
      .every((comparison) => {
        const match = comparison.match(/^([a-z._]+) == "([^"]+)"$/u)
        if (!match) throw new Error(`Unexpected workflow comparison: ${comparison}`)
        return pipelineValue(event, match[1]) === match[2]
      })
  })
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
    expect(workflow).toContain('    jobs:\n      - macOS\n      - Windows')
    expect(workflow).not.toContain('test-node')
    expect(workflow).not.toContain('npm test')
  })

  it('runs the workflow only for main pushes and pull requests targeting main', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    const expression = workflowWhenExpression(workflow)
    expect(expression).toBe(`${MAIN_PUSH_CLAUSE} or ${MAIN_PULL_REQUEST_CLAUSE}`)

    const cases: Array<{ event: PipelineEvent; expected: boolean; name: string }> = [
      {
        name: 'push to main',
        event: { name: 'push', branch: 'main' },
        expected: true,
      },
      {
        name: 'pull request from a feature branch targeting main',
        event: { name: 'pull_request', branch: 'feature/video-style', pullRequestBase: 'main' },
        expected: true,
      },
      {
        name: 'ordinary feature-branch push',
        event: { name: 'push', branch: 'feature/video-style' },
        expected: false,
      },
      {
        name: 'tag push',
        event: { name: 'push' },
        expected: false,
      },
      {
        name: 'pull request targeting a non-main branch',
        event: {
          name: 'pull_request',
          branch: 'feature/video-style',
          pullRequestBase: 'release',
        },
        expected: false,
      },
      {
        name: 'manual or API pipeline on main',
        event: { name: 'api', branch: 'main' },
        expected: false,
      },
    ]

    for (const scenario of cases) {
      expect(evaluateWorkflowWhen(expression, scenario.event), scenario.name).toBe(
        scenario.expected,
      )
    }
    expect(expression).not.toContain('pipeline.git.tag')
    expect(expression).not.toContain('pipeline.event.github.pull_request.head.ref')
    expect(expression).not.toMatch(/"(?:api|schedule|custom_webhook)"/u)
  })

  it('runs repository formatting once while preserving every platform product gate', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    const sharedSteps = [
      'Install locked dependencies',
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
      expect(job).toContain('bun run test:image')
      expect(job).toContain('bun run build')
      expect(job).toContain('bun run test:visual')
      expect(job).toContain('bunx electron-builder --dir --publish never')
      for (const step of sharedSteps) expect(job).toContain(`name: ${step}`)
    }

    const macOS = jobBlock(workflow, 'macOS')
    expect(macOS).toContain('FORMAT_DEFAULT_BRANCH: main')
    expect(macOS).toContain('name: Check formatting in changed lines')
    expect(macOS).toContain('FORMAT_BASE_SHA')
    expect(macOS).toContain('git merge-base origin/main HEAD')
    expect(macOS).toContain('bun run format:check')
    expect(macOS).toContain('name: Run unit tests\n          command: bun run test')
    expect(macOS).not.toContain('--exclude')

    const windows = jobBlock(workflow, 'Windows')
    expect(windows).toContain('name: Run unit tests except formatter integration')
    expect(windows).toContain('bun run test -- --exclude tests/format-diff.test.ts')
    expect(windows.match(/--exclude\s+\S+/gu) ?? []).toEqual([
      '--exclude tests/format-diff.test.ts',
    ])
    expect(windows).not.toContain('FORMAT_DEFAULT_BRANCH')
    expect(windows).not.toContain('FORMAT_BASE_SHA')
    expect(windows).not.toContain('FORMAT_BRANCH')
    expect(windows).not.toContain('git fetch --no-tags')
    expect(windows).not.toContain('git merge-base')
    expect(windows).not.toContain('name: Check formatting in changed lines')
    expect(windows).not.toContain('bun run format:check')

    const packageJson = JSON.parse(await repositoryFile('package.json'))
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(await repositoryFile('tests/format-diff-core.test.ts')).toContain(
      "describe('range-formatting algorithm'",
    )
    expect(await repositoryFile('vite.config.ts')).not.toContain('format-diff-core.test.ts')
  })

  it('captures and separately stores baseline and Style-session evidence', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    for (const platform of ['macOS', 'Windows'] as const) {
      const job = jobBlock(workflow, platform)
      const build = job.indexOf('name: Build renderer')
      const baselineCapture = job.indexOf('name: Capture production-window visual evidence')
      const baselineStore = job.indexOf(`path: ${BASELINE_EVIDENCE_PATH}`)
      const styleSessionCapture = job.indexOf('name: Capture style-session visual evidence')
      const styleSessionStore = job.indexOf(`path: ${STYLE_SESSION_EVIDENCE_PATH}`)
      const packageStep = job.indexOf('name: Package unpacked desktop app')
      expect(build).toBeGreaterThan(-1)
      expect(build).toBeLessThan(baselineCapture)
      expect(baselineCapture).toBeLessThan(baselineStore)
      expect(baselineStore).toBeLessThan(styleSessionCapture)
      expect(styleSessionCapture).toBeLessThan(styleSessionStore)
      expect(styleSessionStore).toBeLessThan(packageStep)

      expect(trimmedLines(job, (line) => line.startsWith('bun run test:visual'))).toEqual(
        VISUAL_TEST_INVOCATIONS,
      )
      expect(trimmedLines(job, (line) => line.includes('OKS_VISUAL_EVIDENCE_DIR'))).toEqual(
        platform === 'macOS'
          ? [
              'export OKS_VISUAL_EVIDENCE_DIR="$evidence_root/video-style-visual"',
              'export OKS_VISUAL_EVIDENCE_DIR="$evidence_root/style-session-visual"',
            ]
          : [
              '$env:OKS_VISUAL_EVIDENCE_DIR = Join-Path $evidenceRoot "video-style-visual"',
              '$env:OKS_VISUAL_EVIDENCE_DIR = Join-Path $evidenceRoot "style-session-visual"',
            ],
      )
      expect(trimmedLines(job, (line) => line.startsWith('path: .ci-artifacts/'))).toEqual([
        `path: ${BASELINE_EVIDENCE_PATH}`,
        `path: ${STYLE_SESSION_EVIDENCE_PATH}`,
      ])
      expect(trimmedLines(job, (line) => line.startsWith('destination:'))).toEqual([
        `destination: video-style-visual-${platform}`,
        `destination: style-session-visual-${platform}`,
      ])
    }

    const packageJson = JSON.parse(await repositoryFile('package.json'))
    expect(packageJson.scripts['test:visual']).toBe('node scripts/video-style-visual-smoke.cjs')
    expect(visualResults.expectedFilesForScenario(visualResults.STYLE_SESSION_SCENARIO)).toEqual(
      STYLE_SESSION_EVIDENCE_LEAVES,
    )
  })
})
