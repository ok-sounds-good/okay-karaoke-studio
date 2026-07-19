import type { KaraokeProject, LyricLine, LyricWord, ValidationIssue, VocalTrack } from './karaoke'

const DEFAULT_LRC_LINE_DURATION_MS = 3_000
const LRC_LINE_TIMESTAMP = /^\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/u
const LRC_WORD_TIMESTAMP = /(?<!\\)<(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?>/gu
const LRC_WORD_TIMESTAMP_AT_START = /^<(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?>/u
const LRC_LITERAL_TIMESTAMP =
  /(\[\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?\]|<\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?>)/gu

interface LrcAdapterDependencies {
  maxProjectDurationMs: number
  maxProjectLines: number
  maxProjectWords: number
  createLyricWord: (text: string, options?: Partial<Omit<LyricWord, 'text'>>) => LyricWord
  createLyricLine: (
    text: string,
    options?: Partial<Omit<LyricLine, 'text' | 'words'>> & { words?: LyricWord[] },
  ) => LyricLine
  createVocalTrack: (options: Partial<VocalTrack> & Pick<VocalTrack, 'id'>) => VocalTrack
  createValidationProject: (track: VocalTrack) => KaraokeProject
  validateProject: (project: KaraokeProject) => ValidationIssue[]
}

interface ImportedLrcLine {
  sourceIndex: number
  startMs: number
  text: string
  words: LyricWord[]
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ')
}

function tokenizeWithinLimit(text: string, maximumWords: number, label: string): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const words = normalized.split(' ')
  if (words.length > maximumWords) {
    throw new RangeError(`${label} exceeds the remaining ${maximumWords} word limit.`)
  }
  return words
}

function parseTimestamp(minutes: string, seconds: string, fraction = ''): number {
  const fractionMs = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + fractionMs
}

function escapeLrcText(text: string): string {
  return text.replace(LRC_LITERAL_TIMESTAMP, '\\$1')
}

function unescapeLrcText(text: string): string {
  let result = ''
  let index = 0
  while (index < text.length) {
    if (text[index] !== '\\' || index + 1 >= text.length) {
      result += text[index]
      index += 1
      continue
    }
    const escapedRemainder = text.slice(index + 1)
    if (
      LRC_LINE_TIMESTAMP.test(escapedRemainder) ||
      LRC_WORD_TIMESTAMP_AT_START.test(escapedRemainder)
    ) {
      result += text[index + 1]
      index += 2
      continue
    }
    result += '\\'
    index += 1
  }
  return result
}

function splitLeadingLrcTimestamps(rawLine: string): {
  timestamps: RegExpExecArray[]
  body: string
} | null {
  let remainder = rawLine.trimStart()
  const timestamps: RegExpExecArray[] = []
  while (true) {
    const timestamp = LRC_LINE_TIMESTAMP.exec(remainder)
    if (!timestamp) break
    timestamps.push(timestamp)
    remainder = remainder.slice(timestamp[0].length)
  }
  return timestamps.length > 0 ? { timestamps, body: remainder.trim() } : null
}

function materializeLrcTimestamp(
  minutes: string,
  seconds: string,
  fraction: string | undefined,
  lrcOffsetMs: number,
  targetProjectOffsetMs: number,
  maximumDurationMs: number,
): number {
  const timestampMs = parseTimestamp(minutes, seconds, fraction)
  const effectiveMs = timestampMs + lrcOffsetMs
  const internalMs = effectiveMs - targetProjectOffsetMs
  if (
    !Number.isSafeInteger(timestampMs) ||
    !Number.isSafeInteger(effectiveMs) ||
    !Number.isSafeInteger(internalMs) ||
    timestampMs > maximumDurationMs ||
    effectiveMs > maximumDurationMs ||
    internalMs > maximumDurationMs
  ) {
    throw new RangeError('LRC timing cannot exceed four hours.')
  }
  if (internalMs < 0) {
    throw new RangeError('LRC timing occurs before zero after applying project and file offsets.')
  }
  return internalMs
}

function parseEnhancedLrcWords(
  body: string,
  lrcOffsetMs: number,
  targetProjectOffsetMs: number,
  remainingWordBudget: number,
  dependencies: LrcAdapterDependencies,
): LyricWord[] {
  const matches: RegExpExecArray[] = []
  LRC_WORD_TIMESTAMP.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LRC_WORD_TIMESTAMP.exec(body))) {
    matches.push(match)
    if (matches.length > remainingWordBudget + 1) {
      throw new RangeError(
        `LRC imports are limited to ${dependencies.maxProjectWords} lyric words.`,
      )
    }
  }
  if (matches.length === 0) {
    return tokenizeWithinLimit(unescapeLrcText(body), remainingWordBudget, 'LRC import').map(
      (word) => dependencies.createLyricWord(word),
    )
  }

  const words: LyricWord[] = []
  const prefix = normalizeText(unescapeLrcText(body.slice(0, matches[0].index)))
  if (prefix) {
    words.push(
      ...tokenizeWithinLimit(prefix, remainingWordBudget, 'LRC import').map((word) =>
        dependencies.createLyricWord(word),
      ),
    )
  }

  matches.forEach((timestampMatch, index) => {
    const contentStart = (timestampMatch.index ?? 0) + timestampMatch[0].length
    const contentEnd = matches[index + 1]?.index ?? body.length
    const tokens = tokenizeWithinLimit(
      unescapeLrcText(body.slice(contentStart, contentEnd)),
      remainingWordBudget - words.length,
      'LRC import',
    )
    const startMs = materializeLrcTimestamp(
      timestampMatch[1],
      timestampMatch[2],
      timestampMatch[3],
      lrcOffsetMs,
      targetProjectOffsetMs,
      dependencies.maxProjectDurationMs,
    )
    tokens.forEach((token) => {
      words.push(dependencies.createLyricWord(token, { startMs, endMs: null }))
    })
  })
  return words
}

function formatLrcTimestamp(ms: number): string {
  const absolute = Math.max(0, Math.round(ms))
  const minutes = Math.floor(absolute / 60_000)
  const seconds = Math.floor((absolute % 60_000) / 1_000)
  const milliseconds = absolute % 1_000
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`
}

function metadataValue(value: string): string {
  return value.replace(/[\r\n\[\]]/gu, ' ').trim()
}

function trackById(project: KaraokeProject, trackId: string): VocalTrack {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new RangeError(`No vocal track with ID "${trackId}".`)
  return track
}

export function createLrcAdapter(dependencies: LrcAdapterDependencies): {
  importLrc(text: string, trackId: string, targetProjectOffsetMs?: number): VocalTrack
  exportLrc(project: KaraokeProject, trackId: string): string
} {
  function importLrc(text: string, trackId: string, targetProjectOffsetMs = 0): VocalTrack {
    const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
    const offsetMatch = normalized.match(/^\s*\[offset:([+-]?\d+)\]\s*$/imu)
    const offsetMs = offsetMatch ? Number(offsetMatch[1]) : 0
    if (
      !Number.isSafeInteger(offsetMs) ||
      Math.abs(offsetMs) > dependencies.maxProjectDurationMs ||
      !Number.isSafeInteger(targetProjectOffsetMs) ||
      Math.abs(targetProjectOffsetMs) > dependencies.maxProjectDurationMs
    ) {
      throw new RangeError('LRC and target project offsets must be within four hours.')
    }
    const imported: ImportedLrcLine[] = []
    let importedWordCount = 0

    normalized.split('\n').forEach((rawLine, sourceIndex) => {
      const parsedLine = splitLeadingLrcTimestamps(rawLine)
      if (!parsedLine) return
      parsedLine.timestamps.forEach((timestamp) => {
        if (imported.length >= dependencies.maxProjectLines) {
          throw new RangeError(
            `LRC imports are limited to ${dependencies.maxProjectLines} lyric lines.`,
          )
        }
        const startMs = materializeLrcTimestamp(
          timestamp[1],
          timestamp[2],
          timestamp[3],
          offsetMs,
          targetProjectOffsetMs,
          dependencies.maxProjectDurationMs,
        )
        const words = parseEnhancedLrcWords(
          parsedLine.body,
          offsetMs,
          targetProjectOffsetMs,
          dependencies.maxProjectWords - importedWordCount,
          dependencies,
        )
        importedWordCount += words.length
        if (importedWordCount > dependencies.maxProjectWords) {
          throw new RangeError(
            `LRC imports are limited to ${dependencies.maxProjectWords} lyric words.`,
          )
        }
        imported.push({
          sourceIndex,
          startMs,
          text: words.map((word) => word.text).join(' '),
          words,
        })
      })
    })

    imported.sort(
      (left, right) => left.startMs - right.startMs || left.sourceIndex - right.sourceIndex,
    )
    const nextDistinctStarts = new Array<number | undefined>(imported.length)
    let nextDistinctStart: number | undefined
    for (let index = imported.length - 1; index >= 0; index -= 1) {
      if (index < imported.length - 1 && imported[index + 1].startMs > imported[index].startMs) {
        nextDistinctStart = imported[index + 1].startMs
      }
      nextDistinctStarts[index] = nextDistinctStart
    }

    const lines = imported.map((entry, lineIndex) => {
      const nextStart = nextDistinctStarts[lineIndex]
      const lastWordStart = entry.words.reduce<number | null>(
        (latest, word) =>
          word.startMs === null ? latest : Math.max(latest ?? word.startMs, word.startMs),
        null,
      )
      const inferredEndMs =
        nextStart ??
        Math.max(
          entry.startMs + DEFAULT_LRC_LINE_DURATION_MS,
          (lastWordStart ?? entry.startMs) + 1_500,
        )
      const endMs = Math.min(dependencies.maxProjectDurationMs, inferredEndMs)
      if (endMs <= entry.startMs) {
        throw new RangeError('An LRC line starts too close to the four-hour limit.')
      }

      const words = entry.words.map((word) => ({ ...word }))
      let nextTimedWordStart = endMs
      for (let wordIndex = words.length - 1; wordIndex >= 0; wordIndex -= 1) {
        const word = words[wordIndex]
        if (word.startMs === null) continue
        words[wordIndex] = { ...word, endMs: Math.max(word.startMs + 1, nextTimedWordStart) }
        nextTimedWordStart = word.startMs
      }

      return dependencies.createLyricLine(entry.text, {
        id: `${trackId}-line-${lineIndex + 1}`,
        startMs: entry.startMs,
        endMs,
        words: words.map((word, wordIndex) => ({
          ...word,
          id: `${trackId}-line-${lineIndex + 1}-word-${wordIndex + 1}`,
        })),
      })
    })

    const track = dependencies.createVocalTrack({ id: trackId, name: 'Imported LRC', lines })
    const firstError = dependencies
      .validateProject(dependencies.createValidationProject(track))
      .find((validationIssue) => validationIssue.severity === 'error')
    if (firstError) {
      const lineIndex = firstError.lineId
        ? lines.findIndex((line) => line.id === firstError.lineId)
        : -1
      const sourceLine =
        lineIndex >= 0 ? ` on source line ${imported[lineIndex].sourceIndex + 1}` : ''
      throw new Error(`Invalid LRC timing${sourceLine}: ${firstError.message}`)
    }
    return track
  }

  function exportLrc(project: KaraokeProject, trackId: string): string {
    const track = trackById(project, trackId)
    const header = [
      `[ti:${metadataValue(project.title)}]`,
      `[ar:${metadataValue(project.artist)}]`,
      '[by:Okay Karaoke Studio]',
    ]
    if (project.offsetMs !== 0) header.push(`[offset:${project.offsetMs}]`)
    const lines = track.lines.flatMap((line) => {
      const derivedStart = line.words.find((word) => word.startMs !== null)?.startMs ?? null
      const startMs = line.startMs ?? derivedStart
      if (startMs === null) return []
      const hasWordTiming = line.words.some((word) => word.startMs !== null)
      const body = hasWordTiming
        ? line.words
            .map((word) =>
              word.startMs === null
                ? escapeLrcText(word.text)
                : `<${formatLrcTimestamp(word.startMs)}>${escapeLrcText(word.text)}`,
            )
            .join(' ')
        : escapeLrcText(line.text)
      return [`[${formatLrcTimestamp(startMs)}]${body}`]
    })
    return [...header, '', ...lines].join('\n')
  }

  return { importLrc, exportLrc }
}
