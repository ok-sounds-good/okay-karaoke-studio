import { execFileSync, spawnSync } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { collectToolPaths, hookProjectRoot, runHook } from '../scripts/codex-format-post-write.mjs'
import { runCli } from '../scripts/format-diff.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const formatterScript = path.join(repositoryRoot, 'scripts', 'format-diff.mjs')
const hookScript = path.join(repositoryRoot, 'scripts', 'codex-format-post-write.mjs')
const ZERO_SHA = '0000000000000000000000000000000000000000'

function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-C', root, '--literal-pathspecs', ...args], {
    encoding: 'utf8',
  }).trim()
}

async function createRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'oks-format-diff-'))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Formatter Test')
  git(root, 'config', 'user.email', 'formatter@example.invalid')
  await writeFile(
    path.join(root, '.prettierrc.json'),
    JSON.stringify({ semi: false, singleQuote: true, printWidth: 100, endOfLine: 'lf' }),
  )
  await writeFile(path.join(root, '.prettierignore'), '')
  return root
}

function runFormatter(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [formatterScript, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

describe('range-formatting integration', () => {
  it('fails a dirty range, writes only its enclosing statement, then passes', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.ts')
    await writeFile(file, 'const legacy={alpha:1,beta:2}\n\nconst value = 1\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')

    await writeFile(file, 'const legacy={alpha:1,beta:2}\n\nconst value={ alpha:1,beta:2 }\n')

    const failed = runFormatter(root, '--check', '--path', 'example.ts')
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('example.ts (changed lines 3)')

    const written = runFormatter(root, '--write', '--path', 'example.ts')
    expect(written.status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(
      'const legacy={alpha:1,beta:2}\n\nconst value = { alpha: 1, beta: 2 }\n',
    )

    expect(runFormatter(root, '--check', '--path', 'example.ts').status).toBe(0)
  })

  it('ignores a deletion-only hunk instead of formatting the next survivor', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.ts')
    await writeFile(file, 'const legacy={alpha:1}\nconst remove = true\nconst next={beta:2}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(file, 'const legacy={alpha:1}\nconst next={beta:2}\n')

    expect(runFormatter(root, '--check', '--path', 'example.ts').status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe('const legacy={alpha:1}\nconst next={beta:2}\n')
  })

  it('formats an entire untracked file while leaving other files alone', async () => {
    const root = await createRepository()
    await writeFile(path.join(root, 'baseline.ts'), 'const legacy={alpha:1}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')

    const untracked = path.join(root, 'new-file.ts')
    await writeFile(untracked, 'export const value={ alpha:1,beta:2 }\n')

    expect(runFormatter(root, '--write', '--path', 'new-file.ts').status).toBe(0)
    expect(await readFile(untracked, 'utf8')).toBe('export const value = { alpha: 1, beta: 2 }\n')
    expect(await readFile(path.join(root, 'baseline.ts'), 'utf8')).toBe('const legacy={alpha:1}\n')
  })

  it('preserves a same-inode edit made after formatting and fails before writing', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.ts')
    await writeFile(file, 'export const value = true\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(file, 'export const value={alpha:1}\n')
    const formattedSourceStats = await lstat(file)
    const concurrentSource = 'export const concurrentlyEdited = true\n'
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const status = await runCli(['--write', '--path', 'example.ts'], root, {
        beforeWrite: async () => {
          await writeFile(file, concurrentSource)
          expect((await lstat(file)).ino).toBe(formattedSourceStats.ino)
        },
      })

      expect(status).toBe(2)
      expect(logError).toHaveBeenCalledWith('File contents changed before formatting: example.ts')
    } finally {
      logError.mockRestore()
    }

    expect(await readFile(file, 'utf8')).toBe(concurrentSource)
  })

  it('checks the committed base-to-head ranges used by CI', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.ts')
    await writeFile(file, 'const legacy={alpha:1}\n\nconst value = 1\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    const base = git(root, 'rev-parse', 'HEAD')

    await writeFile(file, 'const legacy={alpha:1}\n\nconst value={alpha:1,beta:2}\n')
    git(root, 'add', 'example.ts')
    git(root, 'commit', '-qm', 'feature')

    expect(runFormatter(root, '--check', '--base', base).status).toBe(1)
    expect(runFormatter(root, '--write', '--base', base).status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(
      'const legacy={alpha:1}\n\nconst value = { alpha: 1, beta: 2 }\n',
    )
    expect(runFormatter(root, '--check', '--base', base).status).toBe(0)
  })

  it('keeps hunks separate when user Git config adds inter-hunk context', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.ts')
    await writeFile(
      file,
      [
        'const first = 1',
        'const legacyOne={alpha:1}',
        'const legacyTwo={beta:2}',
        'const last = 4',
        '',
      ].join('\n'),
    )
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    git(root, 'config', 'diff.interHunkContext', '100')
    await writeFile(
      file,
      [
        'const first={alpha:1}',
        'const legacyOne={alpha:1}',
        'const legacyTwo={beta:2}',
        'const last={beta:2}',
        '',
      ].join('\n'),
    )

    expect(runFormatter(root, '--write', '--path', 'example.ts').status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(
      [
        'const first = { alpha: 1 }',
        'const legacyOne={alpha:1}',
        'const legacyTwo={beta:2}',
        'const last = { beta: 2 }',
        '',
      ].join('\n'),
    )
  })

  it('uses the default-branch merge base for an all-zero first-push SHA', async () => {
    const root = await createRepository()
    await writeFile(path.join(root, 'baseline.ts'), 'const baseline = true\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    git(root, 'switch', '-qc', 'feature')

    await writeFile(path.join(root, 'first.ts'), 'export const first={alpha:1}\n')
    git(root, 'add', 'first.ts')
    git(root, 'commit', '-qm', 'first feature commit')
    await writeFile(path.join(root, 'second.ts'), 'export const second = true\n')
    git(root, 'add', 'second.ts')
    git(root, 'commit', '-qm', 'second feature commit')

    const failed = runFormatter(
      root,
      '--check',
      '--base',
      ZERO_SHA,
      '--branch',
      'feature',
      '--default-branch',
      'main',
    )
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('first.ts')
  })

  it('uses the empty tree for an all-zero initial default-branch push', async () => {
    const root = await createRepository()
    await writeFile(path.join(root, 'initial.ts'), 'export const initial={alpha:1}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'initial')

    const failed = runFormatter(
      root,
      '--check',
      '--base',
      ZERO_SHA,
      '--branch',
      'main',
      '--default-branch',
      'main',
    )
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('initial.ts')
  })

  it('checks zero files when a new feature branch still equals the default branch', async () => {
    const root = await createRepository()
    await writeFile(path.join(root, 'legacy.ts'), 'export const legacy={alpha:1}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    git(root, 'switch', '-qc', 'feature')

    const result = runFormatter(
      root,
      '--check',
      '--base',
      ZERO_SHA,
      '--branch',
      'feature',
      '--default-branch',
      'main',
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('0 changed file(s)')
  })

  it('detects a pure rename even when the user disables rename detection', async () => {
    const root = await createRepository()
    await writeFile(path.join(root, 'old-name.ts'), 'const legacy={alpha:1}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    const base = git(root, 'rev-parse', 'HEAD')
    git(root, 'config', 'diff.renames', 'false')

    git(root, 'mv', 'old-name.ts', 'new-name.ts')
    git(root, 'commit', '-qm', 'rename')

    expect(runFormatter(root, '--check', '--base', base).status).toBe(0)
    expect(await readFile(path.join(root, 'new-name.ts'), 'utf8')).toBe('const legacy={alpha:1}\n')
  })

  it('formats a symlink-to-regular type change', async () => {
    const root = await createRepository()
    const file = path.join(root, 'value.ts')
    await symlink('missing-target.ts', file)
    git(root, 'add', 'value.ts')
    git(root, 'commit', '-qm', 'symlink baseline')
    await unlink(file)
    await writeFile(file, 'export const value={alpha:1}\n')

    expect(runFormatter(root, '--write', '--path', 'value.ts').status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe('export const value = { alpha: 1 }\n')
  })

  it('handles literal pathspec metacharacters and Unicode filenames', async () => {
    const root = await createRepository()
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    const name = '[literal]weird-🎤.ts'
    await writeFile(path.join(root, name), 'export const value={alpha:1}\n')

    expect(runFormatter(root, '--write', '--path', name).status).toBe(0)
    expect(await readFile(path.join(root, name), 'utf8')).toBe(
      'export const value = { alpha: 1 }\n',
    )
  })

  it.skipIf(process.platform === 'win32')(
    'handles a filename that begins with Git pathspec magic',
    async () => {
      const root = await createRepository()
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'baseline')
      const name = ':(literal)weird.ts'
      await writeFile(path.join(root, name), 'export const value={alpha:1}\n')

      expect(runFormatter(root, '--write', '--path', name).status).toBe(0)
      expect(await readFile(path.join(root, name), 'utf8')).toBe(
        'export const value = { alpha: 1 }\n',
      )
    },
  )

  it('formats a changed package field and restores its missing final newline', async () => {
    const root = await createRepository()
    const file = path.join(root, 'package.json')
    await writeFile(file, '{\n  "name": "sample",\n  "private": true\n}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(file, '{\n  "name": "sample",\n  "private":false\n}')

    expect(runFormatter(root, '--write', '--path', 'package.json').status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe('{\n  "name": "sample",\n  "private": false\n}\n')
    expect(runFormatter(root, '--check', '--path', 'package.json').status).toBe(0)
  })

  it('expands a YAML change to its sequence without changing its structure', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.yml')
    await writeFile(file, 'group:\n   - legacy\n   - old\nunrelated:   dirty\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(file, 'group:\n   - legacy\n   - changed\nunrelated:   dirty\n')

    expect(runFormatter(root, '--write', '--path', 'example.yml').status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(
      'group:\n  - legacy\n  - changed\nunrelated:   dirty\n',
    )
    expect(runFormatter(root, '--check', '--path', 'example.yml').status).toBe(0)
  })

  it('expands GraphQL block-string indentation without changing its value', async () => {
    const root = await createRepository()
    const file = path.join(root, 'example.graphql')
    await writeFile(file, 'query Q {\n field(arg: """\n   legacy\n   old\n """)\n}\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(file, 'query Q {\n field(arg: """\n   legacy\n   changed\n """)\n}\n')

    expect(runFormatter(root, '--write', '--path', 'example.graphql').status).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(
      'query Q {\n field(arg: """\n    legacy\n    changed\n """)\n}\n',
    )
    expect(runFormatter(root, '--check', '--path', 'example.graphql').status).toBe(0)
  })

  it('rejects a symlink before it can rewrite an external target', async () => {
    const root = await createRepository()
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'oks-format-outside-'))
    const outside = path.join(outsideRoot, 'outside.ts')
    await writeFile(outside, 'export const outside={alpha:1}\n')
    await symlink(outside, path.join(root, 'link.ts'))

    const result = runFormatter(root, '--write', '--path', 'link.ts')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Refusing to format symbolic link')
    expect(await readFile(outside, 'utf8')).toBe('export const outside={alpha:1}\n')
  })

  it('rejects a multiply-linked file before it can rewrite an external alias', async () => {
    const root = await createRepository()
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'oks-format-outside-'))
    const outside = path.join(outsideRoot, 'outside.ts')
    await writeFile(outside, 'export const outside={alpha:1}\n')
    await link(outside, path.join(root, 'hardlink.ts'))

    const result = runFormatter(root, '--write', '--path', 'hardlink.ts')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Refusing to format multiply-linked file')
    expect(await readFile(outside, 'utf8')).toBe('export const outside={alpha:1}\n')
  })
})

describe('Codex hook path extraction', () => {
  it('anchors the default project root to the checked-in hook', () => {
    expect(hookProjectRoot).toBe(repositoryRoot)
  })

  it('collects added, updated, moved, and structured tool paths but skips deletes', () => {
    const paths = collectToolPaths({
      file_path: 'src/structured.ts',
      command: [
        '*** Begin Patch',
        '*** Update File: src/old.ts',
        '*** Move to: src/new.ts',
        '*** Add File: src/added.ts',
        '*** Delete File: src/deleted.ts',
        '*** End Patch',
      ].join('\n'),
    })

    expect(paths).toEqual(['src/structured.ts', 'src/old.ts', 'src/added.ts', 'src/new.ts'])
  })

  it('runs the repository formatter with only the paths from the completed write', async () => {
    const root = await createRepository()
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'okay-karaoke-studio',
        scripts: { format: 'bun scripts/format-diff.mjs --write' },
      }),
    )
    await writeFile(path.join(root, 'changed.ts'), 'const changed = true\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(path.join(root, 'changed.ts'), 'const changed={alpha:1,beta:2}\n')

    const output = await runHook(
      JSON.stringify({
        cwd: root,
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: '*** Update File: changed.ts' },
      }),
      { formatterPath: formatterScript, projectRoot: root },
    )

    expect(output?.systemMessage).toContain('changed.ts (changed lines 1)')
    expect(await readFile(path.join(root, 'changed.ts'), 'utf8')).toBe(
      'const changed = { alpha: 1, beta: 2 }\n',
    )
  })

  it('reports a missing formatter without relying on Git discovery', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oks-format-hook-root-'))
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'okay-karaoke-studio',
        scripts: { format: 'bun scripts/format-diff.mjs --write' },
      }),
    )
    await writeFile(path.join(root, 'changed.ts'), 'const changed = true\n')
    const missingFormatter = path.join(root, 'missing-formatter.mjs')

    await expect(
      runHook(
        JSON.stringify({
          cwd: root,
          hook_event_name: 'PostToolUse',
          tool_name: 'apply_patch',
          tool_input: { command: '*** Update File: changed.ts' },
        }),
        { formatterPath: missingFormatter, projectRoot: root },
      ),
    ).rejects.toThrow(`Changed-range formatter is missing: ${missingFormatter}`)
  })

  it('keeps the anchored root for an aliased nested directory with the same marker', async () => {
    const root = await createRepository()
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'okay-karaoke-studio',
        scripts: { format: 'bun scripts/format-diff.mjs --write' },
      }),
    )
    await writeFile(path.join(root, 'changed.ts'), 'const changed = true\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(path.join(root, 'changed.ts'), 'const changed={alpha:1,beta:2}\n')
    const nested = path.join(root, 'nested')
    await mkdir(nested)
    await writeFile(
      path.join(nested, 'package.json'),
      JSON.stringify({
        name: 'okay-karaoke-studio',
        scripts: { format: 'bun scripts/format-diff.mjs --write' },
      }),
    )
    const aliasParent = await mkdtemp(path.join(tmpdir(), 'oks-format-hook-alias-'))
    const alias = path.join(aliasParent, 'repository')
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')

    const output = await runHook(
      JSON.stringify({
        cwd: path.join(alias, 'nested'),
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: '*** Update File: ../changed.ts' },
      }),
      { formatterPath: formatterScript, projectRoot: root },
    )

    expect(output?.systemMessage).toContain('changed.ts (changed lines 1)')
    expect(await readFile(path.join(root, 'changed.ts'), 'utf8')).toBe(
      'const changed = { alpha: 1, beta: 2 }\n',
    )
  })

  it('runs its CLI entry point from outside the script directory', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'oks-format-hook-cwd-'))
    const result = spawnSync(process.execPath, [hookScript], {
      cwd,
      input: '{',
      encoding: 'utf8',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('JSON')
  })

  it('reports a formatter that exits successfully without producing a result', async () => {
    const root = await createRepository()
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'okay-karaoke-studio',
        scripts: { format: 'bun scripts/format-diff.mjs --write' },
      }),
    )
    await writeFile(path.join(root, 'changed.ts'), 'const changed = true\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'baseline')
    await writeFile(path.join(root, 'changed.ts'), 'const changed={alpha:1}\n')
    const silentFormatter = path.join(root, 'silent-formatter.mjs')
    await writeFile(silentFormatter, '')

    await expect(
      runHook(
        JSON.stringify({
          cwd: root,
          hook_event_name: 'PostToolUse',
          tool_name: 'apply_patch',
          tool_input: { command: '*** Update File: changed.ts' },
        }),
        { formatterPath: silentFormatter, projectRoot: root },
      ),
    ).rejects.toThrow(
      'Changed-range formatting failed: formatter exited successfully without reporting a result',
    )
  })
})
