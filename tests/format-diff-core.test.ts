import { diffChars } from 'diff'
import { describe, expect, it, vi } from 'vitest'
import {
  formatChangedRanges,
  lineRangeToOffsets,
  normalizeLineRanges,
} from '../scripts/format-diff.mjs'
import { parseHunkRanges } from '../scripts/format-diff-git.mjs'

vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>()
  return { ...actual, diffChars: vi.fn(actual.diffChars) }
})

describe('changed-range parsing', () => {
  it('parses additions, replacements, and deletion-only hunks', () => {
    const ranges = parseHunkRanges(
      ['@@ -2 +2,3 @@', '@@ -10,2 +12 @@ detail', '@@ -20,4 +22,0 @@'].join('\n'),
    )

    expect(ranges).toEqual([
      { startLine: 2, lineCount: 3 },
      { startLine: 12, lineCount: 1 },
      { startLine: 22, lineCount: 0 },
    ])
  })

  it('merges adjacent spans and drops deletion-only hunks', () => {
    expect(
      normalizeLineRanges(
        [
          { startLine: 3, lineCount: 0 },
          { startLine: 4, lineCount: 2 },
          { startLine: 20, lineCount: 1 },
        ],
        8,
      ),
    ).toEqual([
      { startLine: 4, endLine: 5 },
      { startLine: 8, endLine: 8 },
    ])
  })

  it('converts line spans to JavaScript character offsets', () => {
    const source = 'const emoji = "🎤"\nconst next = true\nlast()\n'
    const offsets = lineRangeToOffsets(source, { startLine: 2, endLine: 2 })

    expect(source.slice(offsets!.rangeStart, offsets!.rangeEnd)).toBe('const next = true\n')
  })
})

describe('range-formatting algorithm', () => {
  it('formats the selected statement without sweeping an untouched legacy line', async () => {
    const source = ['const legacy={alpha:1,beta:2}', '', 'const changed={alpha:1,beta:2}', ''].join(
      '\n',
    )

    const result = await formatChangedRanges({
      source,
      filePath: 'example.ts',
      ranges: [{ startLine: 3, lineCount: 1 }],
      options: { parser: 'typescript', semi: false, singleQuote: true },
    })

    expect(result.formatted).toBe(
      ['const legacy={alpha:1,beta:2}', '', 'const changed = { alpha: 1, beta: 2 }', ''].join('\n'),
    )
  })

  it('falls back when a changed block depends on its async function context', async () => {
    const source = [
      'async function save() {',
      '  {',
      '    handle = await open( )',
      '  }',
      '}',
      'const legacy={alpha:1,beta:2}',
      '',
    ].join('\n')

    const result = await formatChangedRanges({
      source,
      filePath: 'example.cjs',
      ranges: [{ startLine: 2, lineCount: 2 }],
      options: { parser: 'babel', semi: false, singleQuote: true },
    })

    expect(result.formatted).toBe(
      [
        'async function save() {',
        '  {',
        '    handle = await open()',
        '  }',
        '}',
        'const legacy={alpha:1,beta:2}',
        '',
      ].join('\n'),
    )
  })

  it('derives disjoint syntax edits from the original source instead of stale offsets', async () => {
    const source = 'function f(\na ,\nb,\nc ,\n){}\nconst legacyBottom={z:9}\n'
    const result = await formatChangedRanges({
      source,
      filePath: 'example.ts',
      ranges: [
        { startLine: 2, lineCount: 1 },
        { startLine: 4, lineCount: 1 },
      ],
      options: { parser: 'typescript', semi: false, singleQuote: true },
    })

    expect(result.formatted).toBe('function f(a, b, c) {}\nconst legacyBottom={z:9}\n')
  })

  it('preserves a uniform CRLF file while formatting a changed statement', async () => {
    const source = 'const legacy={alpha:1}\r\n\r\nconst changed={beta:2}\r\n'
    const result = await formatChangedRanges({
      source,
      filePath: 'example.ts',
      ranges: [{ startLine: 3, lineCount: 1 }],
      options: { parser: 'typescript', semi: false, singleQuote: true, endOfLine: 'lf' },
    })

    expect(result.formatted).toBe('const legacy={alpha:1}\r\n\r\nconst changed = { beta: 2 }\r\n')
  })

  it('preserves a canonical final newline when changed ranges stop before EOF', async () => {
    const source = [
      'import {',
      '  Fragment,',
      '  useEffect,',
      '  useLayoutEffect,',
      '  useMemo,',
      '  useRef,',
      '  useState,',
      '  type CSSProperties,',
      '  type KeyboardEvent as ReactKeyboardEvent,',
      '  type PointerEvent as ReactPointerEvent,',
      "} from 'react'",
      'import {',
      '  AudioWaveform,',
      '  ChevronLeft,',
      '  ChevronRight,',
      '  Minus,',
      '  Plus,',
      '  RotateCcw,',
      '  SkipBack,',
      '  TimerReset,',
      '  Zap,',
      '  ZoomIn,',
      "} from 'lucide-react'",
      '',
      'export const unchanged = true',
      '',
    ].join('\n')

    const result = await formatChangedRanges({
      source,
      filePath: 'example.tsx',
      ranges: [{ startLine: 1, lineCount: 23 }],
      options: { parser: 'typescript', semi: false, singleQuote: true },
    })

    expect(result.formatted).toBe(source)
  })

  it('does not add a final newline when a non-EOF range leaves that boundary untouched', async () => {
    const source = 'const changed={alpha:1}\nconst untouched = true'

    const result = await formatChangedRanges({
      source,
      filePath: 'example.ts',
      ranges: [{ startLine: 1, lineCount: 1 }],
      options: { parser: 'typescript', semi: false, singleQuote: true },
    })

    expect(result.formatted).toBe('const changed = { alpha: 1 }\nconst untouched = true')
  })

  it('rejects mixed line endings instead of normalizing untouched lines', async () => {
    await expect(
      formatChangedRanges({
        source: 'const legacy = 1\r\nconst changed={beta:2}\n',
        filePath: 'example.ts',
        ranges: [{ startLine: 2, lineCount: 1 }],
        options: { parser: 'typescript', semi: false, singleQuote: true },
      }),
    ).rejects.toThrow('Mixed line endings')
  })

  it.each([
    {
      parser: 'css',
      filePath: 'example.css',
      source: '.legacy{color:red}\n.changed{ color: blue}\n',
      ranges: [{ startLine: 2, lineCount: 1 }],
      expected: '.legacy{color:red}\n.changed {\n  color: blue;\n}\n',
    },
    {
      parser: 'yaml',
      filePath: 'example.yml',
      source: 'legacy:   value\nchanged:   value\n',
      ranges: [{ startLine: 2, lineCount: 1 }],
      expected: 'legacy:   value\nchanged: value\n',
    },
    {
      parser: 'markdown',
      filePath: 'example.md',
      source: '# Legacy\n\nlegacy   words\n\n-   changed\n',
      ranges: [{ startLine: 5, lineCount: 1 }],
      expected: '# Legacy\n\nlegacy   words\n\n- changed\n',
    },
    {
      parser: 'json',
      filePath: 'example.json',
      source: '{\n"legacy":1,\n"changed":2\n}\n',
      ranges: [{ startLine: 3, lineCount: 1 }],
      expected: '{\n"legacy":1,\n  "changed": 2\n}\n',
    },
  ])('projects $parser formatting onto changed lines', async (sample) => {
    const result = await formatChangedRanges({
      ...sample,
      options: { parser: sample.parser, semi: false, singleQuote: true },
    })
    expect(result.formatted).toBe(sample.expected)
  })

  it('returns canonical Prettier output without diffing when changed ranges cover the file', async () => {
    const diffSpy = vi.mocked(diffChars)
    diffSpy.mockClear()
    const source = '{\r\n"legacy":1,\r\n"changed":[1,2]\r\n}\r\n'

    const result = await formatChangedRanges({
      source,
      filePath: 'example.json',
      ranges: [{ startLine: 1, lineCount: Number.MAX_SAFE_INTEGER }],
      options: { parser: 'json', semi: false, singleQuote: true },
    })

    expect(result.formatted).toBe('{\r\n  "legacy": 1,\r\n  "changed": [1, 2]\r\n}\r\n')
    expect(diffSpy).not.toHaveBeenCalled()
  })
})
