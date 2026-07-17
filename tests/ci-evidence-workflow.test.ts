import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ACTIVE_WORKFLOW = '.circleci/config.yml'
const INACTIVE_GITHUB_WORKFLOW = '.github/workflows/ci.yml.disabled'
const INACTIVE_GITHUB_WORKFLOW_SHA256 =
  '126817fa990d8c87fd8de8e8bae94165c91c3e219f37bfbd5121f50971874e86'
const MAIN_PUSH_CLAUSE = '(pipeline.event.name == "push" and pipeline.git.branch == "main")'
const MAIN_PULL_REQUEST_CLAUSE =
  '(pipeline.event.name == "pull_request" and ' +
  'pipeline.event.github.pull_request.base.ref == "main")'
const LIVE_ELECTRON_TEST = 'tests/visual-smoke-renderer-fatal-live.test.ts'

interface PipelineEvent {
  branch?: string
  name: string
  pullRequestBase?: string
}

async function repositoryFile(name: string) {
  return readFile(join(process.cwd(), name), 'utf8')
}

function jobBlock(workflow: string, name: 'unit-tests' | 'macOS' | 'Windows') {
  const start = workflow.indexOf(`  ${name}:`)
  const endMarker =
    name === 'unit-tests' ? '  macOS:' : name === 'macOS' ? '  Windows:' : '\nworkflows:'
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

describe('hosted CI contract', () => {
  it('keeps GitHub Actions inactive while preserving its exact workflow', async () => {
    await expect(repositoryFile('.github/workflows/ci.yml')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const archived = await repositoryFile(INACTIVE_GITHUB_WORKFLOW)
    const digest = createHash('sha256').update(archived).digest('hex')
    expect(digest).toBe(INACTIVE_GITHUB_WORKFLOW_SHA256)
    expect(archived).toMatch(/on:\n  push:\n  pull_request:/u)
  })

  it('defines one portable gate followed by protected native compatibility jobs', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    expect(workflow).toContain('  unit-tests:\n    docker:\n      - image: cimg/node:24.0.2')
    expect(workflow).toContain('  unit-tests:\n    docker:')
    expect(workflow).toContain("  macOS:\n    macos:\n      xcode: '16.4.0'")
    expect(workflow).toContain('resource_class: m4pro.medium')
    expect(workflow).toContain(
      '  Windows:\n    machine:\n      image: windows-server-2022-gui:current',
    )
    expect(workflow).toContain('resource_class: windows.medium')
    expect(workflow).toContain('      - unit-tests:\n          name: unit tests')
    for (const platform of ['macOS', 'Windows']) {
      expect(workflow).toContain(
        `      - ${platform}:\n          requires:\n            - unit tests`,
      )
    }
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

  it('runs formatting, portable tests, and the renderer build once on Linux', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    const portable = jobBlock(workflow, 'unit-tests')
    expect(portable).toContain('resource_class: medium')
    expect(portable).toContain('npm install --global --prefix "$HOME/.local" bun@1.3.14')
    expect(portable).toContain('export PATH="$HOME/.local/bin:$PATH"')
    expect(portable).not.toContain('sudo npm')
    expect(portable).toContain('FORMAT_DEFAULT_BRANCH: main')
    expect(portable).toContain('name: Check formatting in changed lines')
    expect(portable).toContain('FORMAT_BASE_SHA')
    expect(portable).toContain('git merge-base origin/main HEAD')
    expect(portable).toContain('bun run format:check')
    expect(portable).toContain('name: Run portable test suite')
    expect(portable).toContain(`--exclude ${LIVE_ELECTRON_TEST}`)
    expect(portable.match(/--exclude\s+\S+/gu) ?? []).toEqual([`--exclude ${LIVE_ELECTRON_TEST}`])
    expect(portable).toContain('name: Build renderer\n          command: bun run build')
    expect(portable).not.toContain('bun run test:image')
    expect(portable).not.toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")

    const packageJson = JSON.parse(await repositoryFile('package.json'))
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(await repositoryFile('tests/format-diff-core.test.ts')).toContain(
      "describe('range-formatting algorithm'",
    )
    expect(await repositoryFile('vite.config.ts')).not.toContain('format-diff-core.test.ts')
  })

  it('limits native jobs to image decoding and one live Electron lifecycle smoke', async () => {
    const workflow = await repositoryFile(ACTIVE_WORKFLOW)
    for (const platform of ['macOS', 'Windows'] as const) {
      const job = jobBlock(workflow, platform)
      expect(job).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")
      expect(job).toContain('24.0.2')
      expect(job).toContain('bun@1.3.14')
      expect(job).toContain('bun install --frozen-lockfile')
      expect(job).toContain('name: Smoke Electron native image decoding')
      expect(job).toContain('bun run test:image')
      expect(job).toContain('name: Smoke native Electron lifecycle')
      expect(job).toContain(`bun run test -- ${LIVE_ELECTRON_TEST}`)
      expect(job).not.toContain('FORMAT_DEFAULT_BRANCH')
      expect(job).not.toContain('bun run format:check')
      expect(job).not.toContain('bun run build')
      expect(job).not.toContain('bun run test:visual')
      expect(job).not.toContain('electron-builder')
      expect(job).not.toContain('store_artifacts')
    }

    const packageJson = JSON.parse(await repositoryFile('package.json'))
    expect(packageJson.scripts['test:visual']).toBe('node scripts/video-style-visual-smoke.cjs')
    expect(packageJson.scripts['dist:dir']).toBe('bun run build && electron-builder --dir')
    expect(workflow).not.toContain('OKS_VISUAL_EVIDENCE_DIR')
    expect(workflow).not.toContain('.ci-artifacts')
    expect(workflow).not.toContain('store_artifacts')
    expect(workflow).not.toContain('bun run test:visual')
    expect(workflow).not.toContain('electron-builder')
  })
})
