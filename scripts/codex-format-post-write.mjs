#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const hookProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      value += chunk
    })
    process.stdin.on('end', () => resolve(value))
    process.stdin.on('error', reject)
  })
}

function isMainModule(meta) {
  if (typeof meta.main === 'boolean') return meta.main
  if (!process.argv[1]) return false

  try {
    return realpathSync(fileURLToPath(meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

export function collectToolPaths(toolInput = {}) {
  const paths = new Set()
  for (const key of ['path', 'file_path', 'filename']) {
    if (typeof toolInput[key] === 'string') paths.add(toolInput[key])
  }

  const patch = typeof toolInput.command === 'string' ? toolInput.command : ''
  const fileMarker = /^\*\*\* (?:Add|Update) File: (.+)$/gm
  const moveMarker = /^\*\*\* Move to: (.+)$/gm
  for (const match of patch.matchAll(fileMarker)) paths.add(match[1].trim())
  for (const match of patch.matchAll(moveMarker)) paths.add(match[1].trim())

  return [...paths]
}

function isOkayKaraokeStudio(root) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    return (
      manifest.name === 'okay-karaoke-studio' &&
      manifest.scripts?.format === 'bun scripts/format-diff.mjs --write'
    )
  } catch {
    return false
  }
}

function normalizePaths(root, cwd, values) {
  const results = []
  const normalizedRoot = realpathSync(root)
  const normalizedCwd = existsSync(cwd) ? realpathSync(cwd) : path.resolve(cwd)
  for (const value of values) {
    const absoluteValue = path.isAbsolute(value) ? path.resolve(value) : null
    const cwdCandidate = absoluteValue || path.resolve(normalizedCwd, value)
    const rootCandidate = absoluteValue || path.resolve(normalizedRoot, value)
    const candidate = existsSync(cwdCandidate) ? cwdCandidate : rootCandidate
    let normalizedCandidate
    try {
      normalizedCandidate = path.join(
        realpathSync(path.dirname(candidate)),
        path.basename(candidate),
      )
    } catch {
      normalizedCandidate = path.resolve(candidate)
    }
    const relative = path.relative(normalizedRoot, normalizedCandidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue
    results.push(relative)
  }
  return [...new Set(results)]
}

export async function runHook(
  rawInput,
  { formatterPath = null, projectRoot = hookProjectRoot } = {},
) {
  const event = JSON.parse(rawInput || '{}')
  if (event.hook_event_name !== 'PostToolUse') return null
  if (!['apply_patch', 'Edit', 'Write'].includes(event.tool_name)) return null

  const cwd = event.cwd || process.cwd()
  const root = realpathSync(path.resolve(projectRoot))
  if (!isOkayKaraokeStudio(root)) return null

  const paths = normalizePaths(root, cwd, collectToolPaths(event.tool_input))
  if (paths.length === 0) return null

  const formatter = formatterPath || path.join(root, 'scripts', 'format-diff.mjs')
  if (!existsSync(formatter)) {
    throw new Error(`Changed-range formatter is missing: ${formatter}`)
  }

  const result = spawnSync(
    process.execPath,
    [formatter, '--write', ...paths.flatMap((value) => ['--path', value])],
    { cwd: root, encoding: 'utf8' },
  )

  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ||
      result.stderr?.trim() ||
      result.stdout?.trim() ||
      (result.signal ? `formatter stopped by ${result.signal}` : 'unknown formatter error')
    throw new Error(`Changed-range formatting failed: ${detail}`)
  }

  const summary = result.stdout?.trim()
  if (!summary) {
    throw new Error(
      'Changed-range formatting failed: formatter exited successfully without reporting a result',
    )
  }
  return { systemMessage: summary }
}

if (isMainModule(import.meta)) {
  readStdin()
    .then(runHook)
    .then((output) => {
      if (output) process.stdout.write(`${JSON.stringify(output)}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 2
    })
}
