import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

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
    expect(contract).toContain('**Consistency evidence**')
  })

  it('lets accepted-residual issues represent either finding class', () => {
    const issueForm = source('.github/ISSUE_TEMPLATE/accepted-residual.yml')

    expect(issueForm).toContain('label: Finding class')
    expect(issueForm).toContain('- Runtime/path finding')
    expect(issueForm).toContain('- Scope-integrity finding')
    expect(issueForm).toContain('leave blank for a scope-integrity finding')
    expect(issueForm).toContain('label: Class-specific evidence')
  })
})
