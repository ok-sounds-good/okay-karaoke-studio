import { videoStyleValidationErrors } from './video-style-codec'
import type {
  KaraokeProject,
  LyricLine,
  LyricWord,
  ValidationIssue,
  ValidationSeverity,
} from './karaoke'

export const MAX_PROJECT_DURATION_MS = 4 * 60 * 60 * 1_000
export const MAX_PROJECT_TRACKS = 8
export const MAX_PROJECT_LINES = 20_000
export const MAX_PROJECT_WORDS = 150_000
export const MIN_LYRIC_DISPLAY_LINES = 1
export const MAX_LYRIC_DISPLAY_LINES = 5
export const PROJECT_SCHEMA_VERSION = 0 as const
export const UNSUPPORTED_PROJECT_FORMAT_ERROR =
  'Unsupported project format. This build accepts only the current v0 format (schemaVersion 0).'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function issue(
  issues: ValidationIssue[],
  severity: ValidationSeverity,
  code: string,
  message: string,
  path: string,
  context: Pick<ValidationIssue, 'trackId' | 'lineId' | 'wordId'> = {},
): void {
  issues.push({ severity, code, message, path, ...context })
}

function validateRange(
  issues: ValidationIssue[],
  startMs: number | null,
  endMs: number | null,
  path: string,
  label: string,
  context: Pick<ValidationIssue, 'trackId' | 'lineId' | 'wordId'>,
): boolean {
  if (startMs === null && endMs === null) return false
  if (startMs === null || endMs === null) {
    issue(
      issues,
      'error',
      'timing-incomplete',
      `${label} must have both a start and end time, or neither.`,
      path,
      context,
    )
    return false
  }
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
    issue(
      issues,
      'error',
      'timing-not-integer',
      `${label} timings must be safe integer milliseconds.`,
      path,
      context,
    )
    return false
  }
  if (startMs < 0 || endMs < 0) {
    issue(issues, 'error', 'timing-negative', `${label} timings cannot be negative.`, path, context)
    return false
  }
  if (startMs > MAX_PROJECT_DURATION_MS || endMs > MAX_PROJECT_DURATION_MS) {
    issue(
      issues,
      'error',
      'timing-after-limit',
      `${label} timings cannot exceed four hours.`,
      path,
      context,
    )
    return false
  }
  if (endMs <= startMs) {
    issue(issues, 'error', 'timing-reversed', `${label} must end after it starts.`, path, context)
    return false
  }
  return true
}

export function validateProject(project: KaraokeProject): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = new Set<string>()

  const registerId = (
    id: string,
    path: string,
    context: Pick<ValidationIssue, 'trackId' | 'lineId' | 'wordId'> = {},
  ) => {
    if (!id.trim()) {
      issue(issues, 'error', 'id-empty', 'IDs cannot be empty.', path, context)
    } else if (ids.has(id)) {
      issue(issues, 'error', 'id-duplicate', `Duplicate ID: ${id}`, path, context)
    }
    ids.add(id)
  }

  registerId(project.id, 'id')
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    issue(issues, 'error', 'schema-version', UNSUPPORTED_PROJECT_FORMAT_ERROR, 'schemaVersion')
  }
  if (
    !isRecord(project.lyricDisplay) ||
    !Number.isSafeInteger(project.lyricDisplay.lineCount) ||
    project.lyricDisplay.lineCount < MIN_LYRIC_DISPLAY_LINES ||
    project.lyricDisplay.lineCount > MAX_LYRIC_DISPLAY_LINES
  ) {
    issue(
      issues,
      'error',
      'lyric-display-line-count',
      `Lyric display line count must be an integer from ${MIN_LYRIC_DISPLAY_LINES} to ${MAX_LYRIC_DISPLAY_LINES}.`,
      'lyricDisplay.lineCount',
    )
  }
  if (
    !isRecord(project.lyricDisplay) ||
    (project.lyricDisplay.advanceMode !== 'clear' && project.lyricDisplay.advanceMode !== 'scroll')
  ) {
    issue(
      issues,
      'error',
      'lyric-display-advance-mode',
      'Lyric display advance mode must be clear or scroll.',
      'lyricDisplay.advanceMode',
    )
  }
  videoStyleValidationErrors(
    project.stageStyle,
    project.tracks.map((track, trackIndex) => ({
      path: `project.tracks[${trackIndex}].vocalStyle`,
      style: track.vocalStyle,
    })),
  ).forEach((error) => issue(issues, 'error', error.code, error.message, error.path))
  if (
    project.durationMs !== null &&
    (!Number.isSafeInteger(project.durationMs) ||
      project.durationMs < 0 ||
      project.durationMs > MAX_PROJECT_DURATION_MS)
  ) {
    issue(
      issues,
      'error',
      'duration-invalid',
      'Project duration must be a safe integer between zero and four hours.',
      'durationMs',
    )
  }
  if (
    !Number.isSafeInteger(project.offsetMs) ||
    Math.abs(project.offsetMs) > MAX_PROJECT_DURATION_MS
  ) {
    issue(
      issues,
      'error',
      'offset-not-integer',
      'Project offset must be a safe integer between negative and positive four hours.',
      'offsetMs',
    )
  }

  if (project.tracks.length > MAX_PROJECT_TRACKS) {
    issue(
      issues,
      'error',
      'track-count-limit',
      `Projects are limited to ${MAX_PROJECT_TRACKS} vocal tracks.`,
      'tracks',
    )
  }
  let lineCount = 0
  let wordCount = 0

  project.tracks.forEach((track, trackIndex) => {
    lineCount += track.lines.length
    const trackPath = `tracks[${trackIndex}]`
    const trackContext = { trackId: track.id }
    registerId(track.id, `${trackPath}.id`, trackContext)
    let priorTimedLine: LyricLine | undefined
    let priorTimedWord: LyricWord | undefined

    track.lines.forEach((line, lineIndex) => {
      wordCount += line.words.length
      const linePath = `${trackPath}.lines[${lineIndex}]`
      const lineContext = { ...trackContext, lineId: line.id }
      registerId(line.id, `${linePath}.id`, lineContext)
      const lineIsTimed = validateRange(
        issues,
        line.startMs,
        line.endMs,
        linePath,
        'Line',
        lineContext,
      )

      if (line.text !== line.words.map((word) => word.text).join(' ')) {
        issue(
          issues,
          'warning',
          'line-text-mismatch',
          'Line text does not match its word text.',
          `${linePath}.text`,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        project.durationMs !== null &&
        line.endMs !== null &&
        Number.isSafeInteger(project.offsetMs) &&
        line.endMs + project.offsetMs > project.durationMs
      ) {
        issue(
          issues,
          'error',
          'timing-after-duration',
          'Line ends after the project duration.',
          linePath,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        line.endMs !== null &&
        Number.isSafeInteger(project.offsetMs) &&
        line.endMs + project.offsetMs > MAX_PROJECT_DURATION_MS
      ) {
        issue(
          issues,
          'error',
          'timing-after-limit',
          'Offset-adjusted line timing cannot exceed four hours.',
          linePath,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        priorTimedLine?.startMs !== null &&
        line.startMs !== null &&
        priorTimedLine?.startMs !== undefined &&
        line.startMs < priorTimedLine.startMs
      ) {
        issue(
          issues,
          'error',
          'line-order',
          'Timed lines must be ordered by start time.',
          linePath,
          lineContext,
        )
      }
      if (
        lineIsTimed &&
        priorTimedLine?.endMs !== null &&
        priorTimedLine?.endMs !== undefined &&
        line.startMs !== null &&
        line.startMs < priorTimedLine.endMs
      ) {
        issue(
          issues,
          'warning',
          'line-overlap',
          'This line overlaps the previous line on the same track.',
          linePath,
          lineContext,
        )
      }
      if (lineIsTimed) priorTimedLine = line

      line.words.forEach((word, wordIndex) => {
        const wordPath = `${linePath}.words[${wordIndex}]`
        const wordContext = { ...lineContext, wordId: word.id }
        registerId(word.id, `${wordPath}.id`, wordContext)
        const wordIsTimed = validateRange(
          issues,
          word.startMs,
          word.endMs,
          wordPath,
          'Word',
          wordContext,
        )

        if (
          wordIsTimed &&
          lineIsTimed &&
          word.startMs !== null &&
          word.endMs !== null &&
          line.startMs !== null &&
          line.endMs !== null &&
          (word.startMs < line.startMs || word.endMs > line.endMs)
        ) {
          issue(
            issues,
            'error',
            'word-outside-line',
            'Word timing must stay within its line timing.',
            wordPath,
            wordContext,
          )
        }
        if (
          wordIsTimed &&
          project.durationMs !== null &&
          word.endMs !== null &&
          Number.isSafeInteger(project.offsetMs) &&
          word.endMs + project.offsetMs > project.durationMs
        ) {
          issue(
            issues,
            'error',
            'timing-after-duration',
            'Word ends after the project duration.',
            wordPath,
            wordContext,
          )
        }
        if (
          wordIsTimed &&
          word.endMs !== null &&
          Number.isSafeInteger(project.offsetMs) &&
          word.endMs + project.offsetMs > MAX_PROJECT_DURATION_MS
        ) {
          issue(
            issues,
            'error',
            'timing-after-limit',
            'Offset-adjusted word timing cannot exceed four hours.',
            wordPath,
            wordContext,
          )
        }
        if (
          wordIsTimed &&
          priorTimedWord?.startMs !== null &&
          priorTimedWord?.startMs !== undefined &&
          word.startMs !== null &&
          word.startMs < priorTimedWord.startMs
        ) {
          issue(
            issues,
            'error',
            'word-order',
            'Timed words must be ordered by start time.',
            wordPath,
            wordContext,
          )
        }
        if (
          wordIsTimed &&
          priorTimedWord?.endMs !== null &&
          priorTimedWord?.endMs !== undefined &&
          word.startMs !== null &&
          word.startMs < priorTimedWord.endMs
        ) {
          issue(
            issues,
            'warning',
            'word-overlap',
            'This word overlaps the previous timed word.',
            wordPath,
            wordContext,
          )
        }
        if (wordIsTimed) priorTimedWord = word
      })
    })
  })

  if (lineCount > MAX_PROJECT_LINES) {
    issue(
      issues,
      'error',
      'line-count-limit',
      `Projects are limited to ${MAX_PROJECT_LINES} lyric lines.`,
      'tracks',
    )
  }
  if (wordCount > MAX_PROJECT_WORDS) {
    issue(
      issues,
      'error',
      'word-count-limit',
      `Projects are limited to ${MAX_PROJECT_WORDS} lyric words.`,
      'tracks',
    )
  }

  return issues
}

export function hasValidationErrors(issues: ValidationIssue[]): boolean {
  return issues.some((validationIssue) => validationIssue.severity === 'error')
}
