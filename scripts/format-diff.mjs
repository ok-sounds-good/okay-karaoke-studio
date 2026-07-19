#!/usr/bin/env node

import { constants, realpathSync } from 'node:fs'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { diffChars } from 'diff'
import * as prettier from 'prettier'
import {
  changedRanges,
  changedTargets,
  normalizeRequestedPaths,
  resolveBase,
  resolveRepositoryRoot,
} from './format-diff-git.mjs'

const SYNTAX_RANGE_PARSERS = new Set([
  'acorn',
  'babel',
  'babel-flow',
  'babel-ts',
  'espree',
  'flow',
  'meriyah',
  'typescript',
])

function isMainModule(meta) {
  if (typeof meta.main === 'boolean') return meta.main
  if (!process.argv[1]) return false

  try {
    return realpathSync(fileURLToPath(meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}

export function normalizeLineRanges(ranges, lineCount) {
  if (lineCount === 0) return []

  const normalized = ranges
    .filter((range) => range.lineCount > 0)
    .map((range) => {
      const startLine = Math.min(Math.max(range.startLine || 1, 1), lineCount)
      const endLine = Math.min(startLine + range.lineCount - 1, lineCount)
      return { startLine, endLine }
    })
    .sort((left, right) => left.startLine - right.startLine)

  const merged = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine)
    } else {
      merged.push({ ...range })
    }
  }

  return merged
}

function lineStarts(source) {
  if (source.length === 0) return []

  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n' && index + 1 < source.length) starts.push(index + 1)
  }
  return starts
}

function lineAtOffset(starts, sourceLength, offset) {
  if (starts.length === 0) return 1

  const target = Math.min(Math.max(offset, 0), Math.max(sourceLength - 1, 0))
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle] <= target) low = middle + 1
    else high = middle
  }
  return Math.max(low, 1)
}

export function lineRangeToOffsets(source, range) {
  const starts = lineStarts(source)
  if (starts.length === 0) return null

  const startIndex = Math.min(Math.max(range.startLine - 1, 0), starts.length - 1)
  const endIndex = Math.min(Math.max(range.endLine, startIndex + 1), starts.length)

  return {
    rangeStart: starts[startIndex],
    rangeEnd: endIndex < starts.length ? starts[endIndex] : source.length,
  }
}

function sourceEndOfLine(source, configured) {
  const endings = new Set()
  for (const match of source.matchAll(/\r\n|\r|\n/g)) endings.add(match[0])
  if (endings.size > 1) {
    throw new Error('Mixed line endings are not supported; normalize the file before formatting it')
  }
  if (endings.has('\r\n')) return 'crlf'
  if (endings.has('\r')) return 'cr'
  if (endings.has('\n')) return 'lf'
  return configured === 'crlf' || configured === 'cr' ? configured : 'lf'
}

function minimalEdit(source, formatted) {
  if (source === formatted) return null

  let start = 0
  while (start < source.length && start < formatted.length && source[start] === formatted[start]) {
    start += 1
  }

  let sourceEnd = source.length
  let formattedEnd = formatted.length
  while (
    sourceEnd > start &&
    formattedEnd > start &&
    source[sourceEnd - 1] === formatted[formattedEnd - 1]
  ) {
    sourceEnd -= 1
    formattedEnd -= 1
  }

  return { start, end: sourceEnd, replacement: formatted.slice(start, formattedEnd) }
}

function editsOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end
}

function sameEdit(left, right) {
  return (
    left.start === right.start && left.end === right.end && left.replacement === right.replacement
  )
}

function applyEdits(source, edits) {
  let result = source
  const ordered = [...edits].sort((left, right) => right.start - left.start || right.end - left.end)
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

async function formatSyntaxRanges(source, filePath, ranges, options) {
  let groups = ranges.map((range) => ({ ...range }))

  while (groups.length > 0) {
    const candidates = []
    for (const range of groups) {
      const offsets = lineRangeToOffsets(source, range)
      if (!offsets) continue
      const formatted = await prettier.format(source, {
        ...options,
        filepath: filePath,
        ...offsets,
      })
      const edit = minimalEdit(source, formatted)
      if (edit && !candidates.some((candidate) => sameEdit(candidate.edit, edit))) {
        candidates.push({ range, edit })
      }
    }

    let overlap = null
    for (let left = 0; left < candidates.length && !overlap; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        if (editsOverlap(candidates[left].edit, candidates[right].edit)) {
          overlap = [candidates[left].range, candidates[right].range]
          break
        }
      }
    }

    if (!overlap)
      return applyEdits(
        source,
        candidates.map(({ edit }) => edit),
      )

    const [left, right] = overlap
    groups = groups.filter((range) => range !== left && range !== right)
    groups.push({
      startLine: Math.min(left.startLine, right.startLine),
      endLine: Math.max(left.endLine, right.endLine),
    })
  }

  return source
}

function fullFormatEdits(source, formatted) {
  const edits = []
  let sourceOffset = 0
  let current = null

  const flush = () => {
    if (current) edits.push(current)
    current = null
  }

  for (const part of diffChars(source, formatted)) {
    if (!part.added && !part.removed) {
      flush()
      sourceOffset += part.value.length
      continue
    }

    current ||= { start: sourceOffset, end: sourceOffset, replacement: '' }
    if (part.removed) {
      current.end += part.value.length
      sourceOffset += part.value.length
    } else {
      current.replacement += part.value
    }
  }
  flush()
  return edits
}

function editTouchesRanges(edit, ranges, starts, sourceLength) {
  const startLine = lineAtOffset(starts, sourceLength, edit.start)
  const endOffset = edit.end > edit.start ? edit.end - 1 : edit.start
  const endLine = lineAtOffset(starts, sourceLength, endOffset)
  return ranges.some((range) => startLine <= range.endLine && endLine >= range.startLine)
}

function rangeKey(ranges) {
  return ranges.map((range) => `${range.startLine}-${range.endLine}`).join(',')
}

function rangesCoverFile(ranges, lineCount) {
  return ranges.length === 1 && ranges[0].startLine === 1 && ranges[0].endLine === lineCount
}

function preserveUnchangedTerminalLineEnding(source, formatted, ranges, lineCount) {
  if (ranges.some((range) => range.endLine === lineCount)) return formatted

  const sourceEnding = source.match(/\r\n$|\r$|\n$/)?.[0] ?? ''
  const formattedWithoutEnding = formatted.replace(/\r\n$|\r$|\n$/, '')
  return formattedWithoutEnding + sourceEnding
}

function expansionNeighbors(ranges, lineCount) {
  const neighbors = []
  for (let index = 0; index < ranges.length; index += 1) {
    for (const direction of ['up', 'down']) {
      if (direction === 'up' && ranges[index].startLine === 1) continue
      if (direction === 'down' && ranges[index].endLine === lineCount) continue

      const expanded = ranges.map((range) => ({ ...range }))
      if (direction === 'up') expanded[index].startLine -= 1
      else expanded[index].endLine += 1
      neighbors.push(
        normalizeLineRanges(
          expanded.map((range) => ({
            startLine: range.startLine,
            lineCount: range.endLine - range.startLine + 1,
          })),
          lineCount,
        ),
      )
    }
  }
  return neighbors
}

function projectEdits(source, canonical, ranges) {
  const starts = lineStarts(source)
  const edits = fullFormatEdits(source, canonical).filter((edit) =>
    editTouchesRanges(edit, ranges, starts, source.length),
  )
  return applyEdits(source, edits)
}

async function formatProjectedRanges(source, filePath, ranges, options) {
  const prettierOptions = { ...options, filepath: filePath }
  const canonical = await prettier.format(source, prettierOptions)
  const lineCount = lineStarts(source).length
  const originalCoversFile = rangesCoverFile(ranges, lineCount)
  const queue = [ranges]
  const queued = new Set([rangeKey(ranges)])
  const visited = new Set()

  while (queue.length > 0 && visited.size < 128) {
    const effectiveRanges = queue.shift()
    const key = rangeKey(effectiveRanges)
    queued.delete(key)
    if (visited.has(key)) continue
    visited.add(key)

    const coversFile = rangesCoverFile(effectiveRanges, lineCount)
    if (coversFile && !originalCoversFile) continue

    const candidate = projectEdits(source, canonical, effectiveRanges)

    try {
      const candidateCanonical = await prettier.format(candidate, prettierOptions)
      const stableCandidate = projectEdits(candidate, candidateCanonical, effectiveRanges)
      if (candidateCanonical === canonical && stableCandidate === candidate) return candidate
    } catch {
      // Expand to the surrounding structure when a partial whitespace edit is invalid.
    }

    for (const neighbor of expansionNeighbors(effectiveRanges, lineCount)) {
      const neighborKey = rangeKey(neighbor)
      if (visited.has(neighborKey) || queued.has(neighborKey)) continue
      queue.push(neighbor)
      queued.add(neighborKey)
    }
  }

  throw new Error(
    `Formatting ${filePath} crosses a structural boundary; format the enclosing construct explicitly`,
  )
}

export async function formatChangedRanges({ source, filePath, ranges, options = {} }) {
  const lineCount = lineStarts(source).length
  const normalized = normalizeLineRanges(ranges, lineCount)
  if (normalized.length === 0) return { formatted: source, ranges: normalized }

  const effectiveOptions = {
    ...options,
    endOfLine: sourceEndOfLine(source, options.endOfLine),
  }
  if (rangesCoverFile(normalized, lineCount)) {
    const formatted = await prettier.format(source, {
      ...effectiveOptions,
      filepath: filePath,
    })
    return { formatted, ranges: normalized }
  }

  let formatted
  if (SYNTAX_RANGE_PARSERS.has(effectiveOptions.parser)) {
    try {
      const candidate = await formatSyntaxRanges(source, filePath, normalized, effectiveOptions)
      const prettierOptions = { ...effectiveOptions, filepath: filePath }
      const sourceCanonical = await prettier.format(source, prettierOptions)
      const candidateCanonical = await prettier.format(candidate, prettierOptions)
      if (candidateCanonical === sourceCanonical) formatted = candidate
    } catch {
      // The structurally expanding projector below will fail closed if needed.
    }
  }
  formatted ??= await formatProjectedRanges(source, filePath, normalized, effectiveOptions)

  formatted = preserveUnchangedTerminalLineEnding(source, formatted, normalized, lineCount)

  return { formatted, ranges: normalized }
}

function parseArgs(argv) {
  const result = {
    base: process.env.FORMAT_BASE_SHA || null,
    branch: process.env.FORMAT_BRANCH || null,
    defaultBranch: process.env.FORMAT_DEFAULT_BRANCH || null,
    head: 'HEAD',
    mode: 'check',
    paths: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--write') result.mode = 'write'
    else if (argument === '--check') result.mode = 'check'
    else if (argument === '--base') result.base = argv[++index]
    else if (argument === '--branch') result.branch = argv[++index]
    else if (argument === '--default-branch') result.defaultBranch = argv[++index]
    else if (argument === '--head') result.head = argv[++index]
    else if (argument === '--path') result.paths.push(argv[++index])
    else throw new Error(`Unknown argument: ${argument}`)
  }

  if (result.paths.some((value) => !value)) throw new Error('--path requires a value')
  return result
}

function describeRanges(ranges) {
  return ranges
    .map(({ startLine, endLine }) =>
      startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`,
    )
    .join(', ')
}

async function readFormatterConfig(root) {
  const configPath = path.join(root, '.prettierrc.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error(`${configPath} must contain a JSON object`)
  }
  return config
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function safeRegularFile(root, file) {
  const absolute = path.resolve(root, file)
  if (!isInside(root, absolute)) throw new Error(`Path is outside the repository: ${file}`)

  let stats
  try {
    stats = await lstat(absolute)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (stats.isSymbolicLink()) throw new Error(`Refusing to format symbolic link: ${file}`)
  if (!stats.isFile()) throw new Error(`Refusing to format non-regular file: ${file}`)
  if (stats.nlink !== 1) throw new Error(`Refusing to format multiply-linked file: ${file}`)

  const canonical = await realpath(absolute)
  if (!isInside(root, canonical))
    throw new Error(`Resolved path is outside the repository: ${file}`)
  return { absolute, stats }
}

async function writeSafeFile(root, file, expected, source, contents) {
  const current = await safeRegularFile(root, file)
  if (!current) throw new Error(`File disappeared before formatting: ${file}`)

  const flags = constants.O_RDWR | (constants.O_NOFOLLOW || 0)
  const handle = await open(current.absolute, flags)
  try {
    const opened = await handle.stat()
    if (
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      opened.nlink !== 1 ||
      !opened.isFile()
    ) {
      throw new Error(`File changed identity before formatting: ${file}`)
    }

    const currentContents = await handle.readFile()
    if (!currentContents.equals(Buffer.from(source, 'utf8'))) {
      throw new Error(`File contents changed before formatting: ${file}`)
    }

    await handle.truncate(0)
    const output = Buffer.from(contents, 'utf8')
    let written = 0
    while (written < output.length) {
      const result = await handle.write(output, written, output.length - written, written)
      if (result.bytesWritten === 0) {
        throw new Error(`Unable to write formatted contents: ${file}`)
      }
      written += result.bytesWritten
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function formatFile(root, file, ranges, config) {
  const safeFile = await safeRegularFile(root, file)
  if (!safeFile) return null

  const info = await prettier.getFileInfo(safeFile.absolute, {
    ignorePath: path.join(root, '.prettierignore'),
  })
  if (info.ignored || !info.inferredParser) return null

  const source = await readFile(safeFile.absolute, 'utf8')
  const result = await formatChangedRanges({
    source,
    filePath: safeFile.absolute,
    ranges,
    options: { ...config, parser: info.inferredParser },
  })

  return { ...result, ...safeFile, source, changed: result.formatted !== source }
}

export async function run(argv = process.argv.slice(2), cwd = process.cwd(), dependencies = {}) {
  const { beforeWrite } = dependencies
  const args = parseArgs(argv)
  const root = resolveRepositoryRoot(cwd)
  const base = resolveBase(root, args.base, args.head, args.defaultBranch, args.branch)
  const paths = normalizeRequestedPaths(root, args.paths)
  const config = await readFormatterConfig(root)
  const failures = []
  const writes = []
  let checkedFiles = 0

  for (const target of changedTargets(root, { base, head: args.head, paths })) {
    const { file } = target
    const ranges = changedRanges(root, target, { base, head: args.head })
    if (ranges.length === 0) continue

    const result = await formatFile(root, file, ranges, config)
    if (!result) continue
    checkedFiles += 1

    if (!result.changed) continue
    const detail = `${file} (changed lines ${describeRanges(result.ranges)})`

    if (args.mode === 'write') {
      await beforeWrite?.()
      await writeSafeFile(root, file, result.stats, result.source, result.formatted)
      writes.push(detail)
    } else {
      failures.push(detail)
    }
  }

  if (failures.length > 0) {
    console.error('Formatting is required in these changed ranges:')
    for (const failure of failures) console.error(`- ${failure}`)
    console.error('Run `bun run format` and commit the resulting mechanical changes.')
    return 1
  }

  if (writes.length > 0) {
    console.log('Formatted changed ranges:')
    for (const write of writes) console.log(`- ${write}`)
  } else {
    console.log(`Formatting check passed for ${checkedFiles} changed file(s).`)
  }

  return 0
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd(), dependencies = {}) {
  try {
    return await run(argv, cwd, dependencies)
  } catch (error) {
    console.error(error.message)
    return 2
  }
}

if (isMainModule(import.meta)) {
  runCli().then((code) => {
    process.exitCode = code
  })
}
