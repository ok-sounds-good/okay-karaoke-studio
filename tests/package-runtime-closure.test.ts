import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  build: { files: string[] }
  main: string
}

const ROOT = process.cwd()
const RELATIVE_REQUIRE = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu

function repositoryPath(file: string) {
  return relative(ROOT, file).split(sep).join('/')
}

async function existingRequireTarget(importer: string, specifier: string) {
  const target = resolve(dirname(importer), specifier)
  const candidates = extname(target)
    ? [target]
    : [`${target}.cjs`, `${target}.js`, `${target}.json`, join(target, 'index.cjs')]

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // Try the next CommonJS resolution candidate.
    }
  }

  throw new Error(`Cannot resolve ${specifier} from ${repositoryPath(importer)}`)
}

async function staticRuntimeClosure(entrypoint: string) {
  const pending = [resolve(ROOT, entrypoint)]
  const closure = new Set<string>()

  while (pending.length > 0) {
    const file = pending.pop()!
    const name = repositoryPath(file)
    if (closure.has(name)) continue
    closure.add(name)
    if (extname(file) === '.json') continue

    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(RELATIVE_REQUIRE)) {
      pending.push(await existingRequireTarget(file, match[1]))
    }
  }

  return [...closure].sort()
}

function isPackaged(file: string, allowlist: string[]) {
  return allowlist.some((pattern) => {
    if (!pattern.endsWith('/**/*')) return file === pattern
    const directory = pattern.slice(0, -5)
    return file.startsWith(`${directory}/`)
  })
}

async function packageManifest() {
  return JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as PackageManifest
}

describe('packaged main-process runtime closure', () => {
  it('includes every static relative CommonJS dependency of the application entrypoint', async () => {
    const manifest = await packageManifest()
    const closure = await staticRuntimeClosure(manifest.main)
    const missing = closure.filter((file) => !isPackaged(file, manifest.build.files))

    expect(closure).toContain('scripts/visual-result-validation.cjs')
    expect(missing).toEqual([])
  })

  it('allowlists the shared visual validator without packaging every development script', async () => {
    const { files } = (await packageManifest()).build

    expect(files).toContain('scripts/visual-result-validation.cjs')
    expect(files).not.toContain('scripts/**/*')
  })
})
