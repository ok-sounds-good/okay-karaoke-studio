import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const firstBodyLine = (contents: string) => {
  let body = contents
  if (body.startsWith('---\n')) {
    const closingDelimiter = body.indexOf('\n---\n', 4)
    expect(closingDelimiter).toBeGreaterThan(0)
    body = body.slice(closingDelimiter + '\n---\n'.length)
  }

  return body
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
}

describe('reviewer infrastructure contract', () => {
  it('keeps the custom agent as a fail-closed canonical-document pointer', () => {
    const reviewer = source('.codex/agents/oks_reviewer.toml')
    const originalDescription = [
      'description = "Independent read-only adversarial reviewer for',
      'Okay Karaoke Studio changes, focused on correctness, security,',
      'data integrity, regressions, and missing tests."',
    ].join(' ')

    expect(reviewer).toContain(originalDescription)
    expect(reviewer).toContain('Read docs/REVIEWING.md completely')
    expect(reviewer).toContain('return NOT PASS with the exact')
    expect(reviewer).toContain('sole canonical contract')

    for (const duplicatedCanonicalRule of [
      'Current product path',
      'Accepted dependent behavior',
      'PASS WITH ACCEPTED RESIDUALS',
      'Preventing invariant',
      'linked GitHub issue',
    ]) {
      expect(reviewer).not.toContain(duplicatedCanonicalRule)
    }
  })

  it('defines distinct runtime and scope-integrity evidence contracts', () => {
    const contract = source('docs/REVIEWING.md')

    expect(contract).toContain('**Runtime/path finding**')
    expect(contract).toContain('**Scope-integrity finding**')
    expect(contract).toContain('A runtime/path finding additionally includes:')
    expect(contract).toContain('A scope-integrity finding instead includes:')
    expect(contract).toContain('Do not add a runtime reachability label')
    expect(contract).toContain('**Declared scope or contract**')
    expect(contract).toContain('**Diff evidence**')
    expect(contract).toContain('**Integrity failure**')
    expect(contract).toContain('**Consistency evidence**')
  })

  it('requires each residual finding class to supply its canonical evidence', () => {
    const issueForm = source('.github/ISSUE_TEMPLATE/accepted-residual.yml')
    const sdlc = source('docs/SDLC.md')

    expect(issueForm).toContain('label: Finding class')
    expect(issueForm).toContain('- Runtime/path finding')
    expect(issueForm).toContain('- Scope-integrity finding')
    expect(issueForm).toContain('leave blank for a scope-integrity finding')
    expect(issueForm).toContain('label: Class-specific evidence')

    for (const runtimeEvidence of [
      'concrete trigger and event order',
      'boundary evidence',
      'preventing invariant',
    ]) {
      expect(issueForm).toContain(runtimeEvidence)
    }

    for (const scopeEvidence of [
      'declared scope and obligation',
      'exact diff evidence',
      'integrity failure',
      'consistency evidence',
    ]) {
      expect(issueForm).toContain(scopeEvidence)
    }

    expect(issueForm).toContain('without inventing a runtime trigger')
    expect(sdlc).toContain('finding class and class-specific evidence')
    expect(sdlc).not.toContain('records its trigger')
  })

  it('requires a durable delivery Issue before assignment and a closing PR link', () => {
    const sdlc = source('docs/SDLC.md')
    const issueTemplate = source('.github/ISSUE_TEMPLATE/implementation.md')
    const pullRequestTemplate = source('.github/pull_request_template.md')

    expect(sdlc).toMatch(
      /Before the Orchestrator assigns or resumes any implementation chunk,\s+a durable, scoped GitHub Issue must exist/,
    )
    expect(sdlc).toMatch(/reconciliation\s+Issue before its implementation resumes/)
    expect(sdlc).toContain('**Transcribed\nhistory**')
    expect(sdlc).toContain('must link and close its delivery Issue')
    expect(sdlc).toContain('`Closes #123`')
    expect(pullRequestTemplate).toContain('Closes #')

    for (const field of [
      '## Scope',
      '## Deliberate exclusions',
      '## Acceptance criteria',
      '## Assignment',
      '## Validation plan',
      'Reviewer findings and exact-head recommendation',
      'Developer responses or rebuttals',
      'Residual decisions and linked Issues',
      'Exact-head Orchestrator merge rationale',
      '## Transcribed history',
    ]) {
      expect(issueTemplate).toContain(field)
    }
  })

  it('keeps role markers and transparent relay rules on every GitHub surface', () => {
    const sdlc = source('docs/SDLC.md')
    const agents = source('AGENTS.md')
    const pullRequestTemplate = source('.github/pull_request_template.md')
    const issueTemplate = source('.github/ISSUE_TEMPLATE/implementation.md')

    expect(sdlc).toMatch(
      /Every agent-authored GitHub Issue body, pull-request body, review, comment,\s+rebuttal, status update, and merge rationale starts with the substantive\s+author's role marker as its first nonblank line/,
    )
    for (const marker of ['`## Orchestrator`', '`## Developer`', '`## Reviewer`']) {
      expect(sdlc).toContain(marker)
    }
    expect(sdlc).toMatch(
      /A relay preserves the originating `## Developer` or\s+`## Reviewer` marker and the authored text verbatim/,
    )
    expect(sdlc).toContain('immediately adjacent `## Orchestrator` post')
    expect(sdlc).toContain('separate `## Orchestrator` post')
    expect(agents).toMatch(/does not\s+transfer worktree, branch, commit/)

    expect(firstBodyLine(pullRequestTemplate)).toBe('## Developer')
    expect(firstBodyLine(issueTemplate)).toBe('## Orchestrator')

    for (const issueForm of [
      '.github/ISSUE_TEMPLATE/accepted-residual.yml',
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
    ]) {
      expect(source(issueForm)).toContain(
        'Agent-authored submissions must follow the role and relay contract',
      )
      expect(source(issueForm)).toContain('submitting the form output unchanged')
    }
  })

  it('makes review local, exact-head, and COMMENT-compatible', () => {
    const contract = source('docs/REVIEWING.md')
    const agents = source('AGENTS.md')
    const reviewer = source('.codex/agents/oks_reviewer.toml')

    expect(contract).toContain('Review does not require GitHub, a connector, a')
    expect(contract).toContain('starts with `## Reviewer` as its first nonblank line')
    expect(contract).toContain('A recommendation applies only to')
    expect(contract).toContain('requires a\nReviewer rereview and a new exact-head recommendation')
    expect(contract).toContain('pull-request review with the `COMMENT` event')
    expect(contract).toMatch(
      /containing `PASS`, `NOT PASS`, or `PASS WITH ACCEPTED RESIDUALS`, is the\s+canonical recommendation record/,
    )
    expect(agents).toContain(
      'without GitHub, a\n  connector, a browser, `gh`, or direct network access',
    )
    expect(reviewer).toContain(
      'GitHub, connectors, browsers, gh, and direct network access are never',
    )
    expect(reviewer).toContain('Return a GitHub-ready, role-marked handoff under')
  })

  it('records the protected-check outage without manufacturing a pass', () => {
    const sdlc = source('docs/SDLC.md')
    const pullRequestTemplate = source('.github/pull_request_template.md')

    expect(sdlc).toMatch(
      /protected `macOS` and `Windows` checks are recorded as \*\*unavailable — not\s+passed\*\*/i,
    )
    expect(sdlc).toContain('temporarily suspended as merge blockers')
    expect(sdlc).toContain('All feasible local and environment-dependent gates')
    expect(sdlc).toContain('never\ninfer a pass from another platform')
    expect(sdlc).toContain('resume prospectively as protected merge blockers')
    expect(sdlc).toContain('does not retroactively invalidate an authorized outage-period')
    expect(sdlc).toContain('does not close Windows x64 MVP validation')
    expect(pullRequestTemplate).toContain('Protected `macOS` check and evidence')
    expect(pullRequestTemplate).toContain('Protected `Windows` check and evidence')
    expect(pullRequestTemplate).toContain('use UNAVAILABLE, never PASS')
  })
})
