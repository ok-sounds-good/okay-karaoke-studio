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
    const reviewing = source('docs/REVIEWING.md')
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
    expect(reviewing).toContain('issue form is the evidence-field contract')
    expect(reviewing).toContain('A human may submit the form directly')
    expect(reviewing).toContain('an agent-authored equivalent')
    expect(reviewing).toContain("author's role marker as its first\nnonblank line")
    expect(reviewing).toContain(
      'reproduce every applicable form field and tracking attestation\nwithout omission',
    )

    for (const canonicalField of [
      'Originating pull request and review thread',
      'Finding class',
      'Runtime reachability',
      'Affected contract or boundary',
      'Class-specific evidence',
      'Severity and impact',
      'Acceptance rationale',
      'Existing invariant, mitigation, or consistency mechanism',
      'Supporting evidence and validation gaps',
      'Closure acceptance criteria',
      'Target milestone, dependency, or roadmap disposition',
      'Tracking checks',
    ]) {
      expect(issueForm).toContain(`label: ${canonicalField}`)
    }

    expect(sdlc).toContain('finding class and class-specific evidence')
    expect(sdlc).not.toContain('records its trigger')
  })

  it('requires evidence before a conditional validation gate is inapplicable', () => {
    const pullRequestTemplate = source('.github/pull_request_template.md')

    expect(pullRequestTemplate).toContain('NOT APPLICABLE — <reason>')
    expect(pullRequestTemplate).toContain('NOT APPLICABLE is valid only with a concrete')
    expect(pullRequestTemplate).toContain('applicability rationale')
    expect(pullRequestTemplate).not.toMatch(/\|\s*Not applicable\s*\|/i)

    for (const gate of ['Electron/package', 'Video/media', 'Manual workflow', 'Visual evidence']) {
      const row = pullRequestTemplate.split(/\r?\n/).find((line) => line.includes(`| ${gate}`))
      expect(row, `missing ${gate} row`).toBeDefined()
      expect(row?.split('|').at(-2)?.trim(), `${gate} must start without a result`).toBe('')
    }
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

  it('makes direct agent GitHub participation narrow, explicit, and optional', () => {
    const agents = source('AGENTS.md')
    const sdlc = source('docs/SDLC.md')
    const reviewer = source('.codex/agents/oks_reviewer.toml')
    const electronWorker = source('.codex/agents/oks_electron_worker.toml')
    const generalWorker = source('.codex/agents/oks_worker.toml')

    for (const contract of [agents, sdlc]) {
      expect(contract).toContain('local-only by default')
      expect(contract).toContain('explicit per-task')
      expect(contract).toMatch(/push\s+without\s+force/)
      expect(contract).toContain('already assigned branch')
      expect(contract).toContain('linked pull request')
      expect(contract).toContain('review feedback')
      expect(contract).toContain('findings-first')
      expect(contract).toContain('exactly matches')
      expect(contract).toContain('credentials, network, keychain, sandbox, or')
    }

    expect(sdlc).toMatch(
      /Only the Orchestrator may create, switch, move, or remove worktrees; create,\s+switch, merge, or delete branches/,
    )
    expect(sdlc).toContain('arbitrate Issues, labels, assignments, or the\ndelivery queue')
    expect(sdlc).toContain("change a pull request's base; merge a pull request")
    expect(sdlc).toContain('post-merge verification or cleanup')
    expect(sdlc).toContain('A remote\nparticipation assignment never transfers those operations')
    expect(sdlc).toContain('does not provide credentials, network, keychain, sandbox, or')
    expect(sdlc).toContain('bypassing inherited or managed permissions')
    expect(sdlc).toContain('An authorized agent posts only its own substantive analysis')

    for (const worker of [generalWorker, electronWorker]) {
      expect(worker).toContain('Remain local-only by default')
      expect(worker).toContain('the specific operation')
      expect(worker).toContain('Remote permissions\nare independent and fail closed')
      expect(worker).toContain(
        'perform only operations individually named in\nthe current assignment',
      )
      expect(worker).toContain('Permission for one never implies permission for another')
      expect(worker).toContain('commit only your own scoped changes')
      expect(worker).toMatch(/push\s+without\s+force only the assigned branch/)
      expect(worker).toContain('`open/update pull request`')
      expect(worker).toContain('`read review feedback`')
      expect(worker).toContain('`post Developer comment`')
      expect(worker).toContain('A `read review feedback`-only assignment is read-only')
      expect(worker).toMatch(/permits no commit,\s+push, pull-request mutation, or comment/)
      expect(worker).toMatch(
        /A partial assignment naming only\s+`commit` and `push` permits only those two operations/,
      )
      expect(worker).toMatch(
        /The full set is permitted\s+only when the current assignment individually names all five operations/,
      )
      expect(worker).toContain('connector or gh only for an individually named remote operation')
      expect(worker).toContain('Never create, switch, merge, or delete branches')
      expect(worker).toContain('perform post-merge verification or cleanup')
      expect(worker).toContain('follow inherited and managed permissions')
      expect(worker).not.toMatch(
        /When\s+that narrow authorization exists,[\s\S]{0,500}you may commit[\s\S]{0,500}post only/,
      )
    }

    expect(reviewer).toContain('sandbox_mode = "read-only"')
    expect(reviewer).toContain('Remain local-only by default')
    expect(reviewer).toContain('these two remote permissions independently')
    expect(reviewer).toContain('`read pull request`')
    expect(reviewer).toContain('`post review`')
    expect(reviewer).toContain('The two permissions are independent and fail closed')
    expect(reviewer).toContain('Permission for one never\nimplies permission for the other')
    expect(reviewer).toContain('Reading pull-request content requires the')
    expect(reviewer).toContain('current assignment to name `read pull request`')
    expect(reviewer).toContain('Posting requires the assignment\nto name `post review`')
    expect(reviewer).toMatch(/A read-only\s+assignment naming only/)
    expect(reviewer).toMatch(/`read pull request` permits inspection but never posting/)
    expect(reviewer).toMatch(/A partial assignment naming only\s+`post review`/)
    expect(reviewer).toMatch(/but no remote pull-request content or feedback read/)
    expect(reviewer).toContain('includes only the minimum current-head query')
    expect(reviewer).toMatch(/remote head exactly matches the locally\s+reviewed/)
    expect(reviewer).toMatch(
      /The full set is permitted only when the current\s+assignment\s+individually names both permissions/,
    )
    expect(reviewer).toContain('starting with\n  `## Reviewer` as its first nonblank line')
    expect(reviewer).toContain('A named remote\npermission grants no other GitHub')
    expect(reviewer).not.toContain('authorizes remote review')
    expect(reviewer).not.toMatch(
      /When\s+that narrow authorization exists[\s\S]{0,500}read the\s+linked pull request and post/,
    )
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
})
