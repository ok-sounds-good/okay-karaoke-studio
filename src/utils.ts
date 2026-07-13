import {
  MAX_PROJECT_DURATION_MS,
  type KaraokeProject,
  type LyricLine,
  type LyricWord,
  type VocalTrack,
} from './lib/model'

export interface WordRef {
  word: LyricWord
  line: LyricLine
  track: VocalTrack
  wordIndex: number
  lineIndex: number
}

export interface WordTimingDraft {
  startMs: number
  endMs: number
}

export type ProjectTimingDraft = ReadonlyMap<string, WordTimingDraft>

export type WordResizeEdge = 'start' | 'end'

export const MIN_EDITED_WORD_DURATION_MS = 80

export function motionAwareScrollBehavior(): ScrollBehavior {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth'
}

export function flattenTrack(track: VocalTrack): WordRef[] {
  return track.lines.flatMap((line, lineIndex) =>
    line.words.map((word, wordIndex) => ({ word, line, track, wordIndex, lineIndex })),
  )
}

export function flattenProject(project: KaraokeProject): WordRef[] {
  return project.tracks.flatMap(flattenTrack)
}

export function timedWords(track: VocalTrack): WordRef[] {
  return flattenTrack(track)
    .filter(({ word }) => word.startMs !== null)
    .sort((a, b) => (a.word.startMs ?? 0) - (b.word.startMs ?? 0))
}

export function effectiveDuration(project: KaraokeProject): number {
  let latestTiming = 0
  project.tracks.forEach((track) => {
    track.lines.forEach((line) => {
      latestTiming = Math.max(latestTiming, line.endMs ?? line.startMs ?? 0)
      line.words.forEach((word) => {
        latestTiming = Math.max(latestTiming, word.endMs ?? word.startMs ?? 0)
      })
    })
  })
  const adjustedLatest = latestTiming > 0
    ? latestTiming + Math.max(0, project.offsetMs)
    : 0
  const paddedLatest = Math.min(
    MAX_PROJECT_DURATION_MS,
    adjustedLatest > 0 ? adjustedLatest + 4_000 : 0,
  )
  return Math.max(project.durationMs ?? 0, paddedLatest, 30_000)
}

export function getActiveLine(track: VocalTrack, timeMs: number): LyricLine | null {
  const timed = track.lines.filter((line) => line.startMs !== null)
  const direct = timed.find(
    (line) => timeMs >= (line.startMs ?? 0) - 120 && timeMs <= (line.endMs ?? line.startMs ?? 0) + 500,
  )
  if (direct) return direct
  const upcoming = timed.find((line) => (line.startMs ?? Number.POSITIVE_INFINITY) > timeMs)
  return upcoming && (upcoming.startMs ?? 0) - timeMs < 1800 ? upcoming : null
}

export function lineProgress(line: LyricLine, timeMs: number): number {
  if (line.startMs === null || line.endMs === null || line.endMs <= line.startMs) return 0
  return Math.max(0, Math.min(1, (timeMs - line.startMs) / (line.endMs - line.startMs)))
}

export function recalculateLine(line: LyricLine): LyricLine {
  let startMs: number | null = null
  let endMs: number | null = null
  line.words.forEach((word) => {
    if (word.startMs !== null) startMs = Math.min(startMs ?? word.startMs, word.startMs)
    if (word.endMs !== null) endMs = Math.max(endMs ?? word.endMs, word.endMs)
  })
  return {
    ...line,
    startMs,
    endMs: endMs ?? startMs,
    text: line.words.map((word) => word.text).join(' '),
  }
}

export function clearTrackTimingFrom(track: VocalTrack, fromMs: number): VocalTrack {
  const boundaryMs = Math.max(0, Math.round(fromMs))
  let trackChanged = false
  const lines = track.lines.map((line) => {
    let wordsChanged = false
    const words = line.words.map((word) => {
      const clearWord = boundaryMs === 0
        ? word.startMs !== null || word.endMs !== null
        : word.startMs !== null && word.startMs >= boundaryMs
      if (!clearWord) return word
      wordsChanged = true
      return { ...word, startMs: null, endMs: null }
    })

    if (wordsChanged) {
      trackChanged = true
      return { ...recalculateLine({ ...line, words }), text: line.text }
    }

    const hasTimedWords = line.words.some((word) => word.startMs !== null || word.endMs !== null)
    const clearLine = boundaryMs === 0
      ? line.startMs !== null || line.endMs !== null
      : line.startMs !== null && line.startMs >= boundaryMs
    if (!hasTimedWords && clearLine) {
      trackChanged = true
      return { ...line, startMs: null, endMs: null }
    }

    return line
  })

  return trackChanged ? { ...track, lines } : track
}

export function patchWord(
  project: KaraokeProject,
  wordId: string,
  patch: Partial<Pick<LyricWord, 'text' | 'startMs' | 'endMs'>>,
): KaraokeProject {
  return patchWords(project, new Map([[wordId, patch]]))
}

export function patchWords(
  project: KaraokeProject,
  patches: ReadonlyMap<
    string,
    Partial<Pick<LyricWord, 'text' | 'startMs' | 'endMs'>>
  >,
): KaraokeProject {
  if (patches.size === 0) return project
  let projectChanged = false
  const tracks = project.tracks.map((track) => {
    let trackChanged = false
    const lines = track.lines.map((line) => {
      let lineChanged = false
      const words = line.words.map((word) => {
        const patch = patches.get(word.id)
        if (!patch) return word
        const changed = Object.entries(patch).some(
          ([key, value]) => word[key as keyof Pick<LyricWord, 'text' | 'startMs' | 'endMs'>] !== value,
        )
        if (!changed) return word
        lineChanged = true
        return { ...word, ...patch }
      })
      if (!lineChanged) return line
      trackChanged = true
      return recalculateLine({ ...line, words })
    })
    if (!trackChanged) return track
    projectChanged = true
    return { ...track, lines }
  })

  return projectChanged
    ? { ...project, updatedAt: new Date().toISOString(), tracks }
    : project
}

/**
 * Produces a render-only view of a project with draft word timings applied.
 * The project's persisted metadata and the source object are intentionally left
 * untouched so an in-progress pointer gesture cannot enter history or a save.
 */
export function applyTimingDraft(
  project: KaraokeProject,
  draft: ProjectTimingDraft | null,
): KaraokeProject {
  if (!draft?.size) return project

  let projectChanged = false
  const tracks = project.tracks.map((track) => {
    let trackChanged = false
    const lines = track.lines.map((line) => {
      let lineChanged = false
      const words = line.words.map((word) => {
        const timing = draft.get(word.id)
        if (
          !timing ||
          (word.startMs === timing.startMs && word.endMs === timing.endMs)
        ) return word

        lineChanged = true
        return { ...word, startMs: timing.startMs, endMs: timing.endMs }
      })

      if (!lineChanged) return line
      trackChanged = true
      return recalculateLine({ ...line, words })
    })

    if (!trackChanged) return track
    projectChanged = true
    return { ...track, lines }
  })

  return projectChanged ? { ...project, tracks } : project
}

function effectiveWordEnd(word: LyricWord): number | null {
  if (word.startMs === null) return null
  return Math.max(word.startMs + 1, word.endMs ?? word.startMs + 300)
}

function projectRawTimingCeiling(project: KaraokeProject): number {
  const offsetLimit = Math.max(0, MAX_PROJECT_DURATION_MS - Math.max(0, project.offsetMs))
  const durationLimit = project.durationMs === null
    ? MAX_PROJECT_DURATION_MS
    : Math.max(0, project.durationMs - project.offsetMs)
  return Math.min(MAX_PROJECT_DURATION_MS, offsetLimit, durationLimit)
}

function previousTimedWord(
  words: WordRef[],
  index: number,
  excludedIds: ReadonlySet<string> = new Set(),
): LyricWord | null {
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = words[candidateIndex].word
    if (!excludedIds.has(candidate.id) && candidate.startMs !== null) return candidate
  }
  return null
}

function nextTimedWord(
  words: WordRef[],
  index: number,
  excludedIds: ReadonlySet<string> = new Set(),
): LyricWord | null {
  for (let candidateIndex = index + 1; candidateIndex < words.length; candidateIndex += 1) {
    const candidate = words[candidateIndex].word
    if (!excludedIds.has(candidate.id) && candidate.startMs !== null) return candidate
  }
  return null
}

/**
 * Keeps a moved selection inside the project and between its nearest unselected
 * lyric-order neighbors on each singer track. Selected words move as a rigid
 * group, so their internal timing relationships are preserved.
 */
export function constrainWordShiftDelta(
  project: KaraokeProject,
  wordIds: ReadonlySet<string>,
  requestedDeltaMs: number,
): number {
  const requested = Math.round(requestedDeltaMs)
  if (!Number.isFinite(requested) || wordIds.size === 0) return 0

  let minimumDelta = Number.NEGATIVE_INFINITY
  let maximumDelta = Number.POSITIVE_INFINITY
  let foundTimedWord = false
  const timingCeiling = projectRawTimingCeiling(project)

  project.tracks.forEach((track) => {
    const words = flattenTrack(track)
    words.forEach(({ word }, index) => {
      if (!wordIds.has(word.id) || word.startMs === null) return
      foundTimedWord = true
      const endMs = effectiveWordEnd(word) ?? word.startMs + 1
      minimumDelta = Math.max(minimumDelta, -word.startMs)
      maximumDelta = Math.min(maximumDelta, timingCeiling - endMs)

      const previous = previousTimedWord(words, index, wordIds)
      const previousEndMs = previous ? effectiveWordEnd(previous) : null
      if (previousEndMs !== null) {
        minimumDelta = Math.max(minimumDelta, previousEndMs - word.startMs)
      }

      const next = nextTimedWord(words, index, wordIds)
      if (next?.startMs !== null && next?.startMs !== undefined) {
        maximumDelta = Math.min(maximumDelta, next.startMs - endMs)
      }
    })
  })

  if (!foundTimedWord || minimumDelta > maximumDelta) return 0

  // An older project may already contain an overlap. Do not make a drag in the
  // wrong direction jump to the far side of the invalid range; leave it alone
  // until the user drags toward the valid boundary.
  if (minimumDelta > 0 && requested <= 0) return 0
  if (maximumDelta < 0 && requested >= 0) return 0
  return Math.max(minimumDelta, Math.min(maximumDelta, requested))
}

/** Constrains one edge without moving the opposite edge. */
export function constrainWordResizeTiming(
  project: KaraokeProject,
  wordId: string,
  edge: WordResizeEdge,
  requestedStartMs: number,
  requestedEndMs: number,
): WordTimingDraft | null {
  for (const track of project.tracks) {
    const words = flattenTrack(track)
    const index = words.findIndex(({ word }) => word.id === wordId)
    if (index < 0) continue
    const word = words[index].word
    if (word.startMs === null) return null

    const originalStartMs = word.startMs
    const originalEndMs = effectiveWordEnd(word) ?? originalStartMs + 1
    if (edge === 'start') {
      const previous = previousTimedWord(words, index)
      const minimumStartMs = Math.max(0, previous ? effectiveWordEnd(previous) ?? 0 : 0)
      const maximumStartMs = originalEndMs - MIN_EDITED_WORD_DURATION_MS
      if (minimumStartMs > maximumStartMs) {
        return { startMs: originalStartMs, endMs: originalEndMs }
      }
      const requested = Math.round(requestedStartMs)
      if (!Number.isFinite(requested)) {
        return { startMs: originalStartMs, endMs: originalEndMs }
      }
      if (
        (originalStartMs < minimumStartMs && requested <= originalStartMs) ||
        (originalStartMs > maximumStartMs && requested >= originalStartMs)
      ) {
        return { startMs: originalStartMs, endMs: originalEndMs }
      }
      return {
        startMs: Math.max(
          minimumStartMs,
          Math.min(maximumStartMs, requested),
        ),
        endMs: originalEndMs,
      }
    }

    const next = nextTimedWord(words, index)
    const maximumEndMs = Math.min(
      projectRawTimingCeiling(project),
      next?.startMs ?? Number.POSITIVE_INFINITY,
    )
    const minimumEndMs = originalStartMs + MIN_EDITED_WORD_DURATION_MS
    if (minimumEndMs > maximumEndMs) {
      return { startMs: originalStartMs, endMs: originalEndMs }
    }
    const requested = Math.round(requestedEndMs)
    if (!Number.isFinite(requested)) {
      return { startMs: originalStartMs, endMs: originalEndMs }
    }
    if (
      (originalEndMs < minimumEndMs && requested <= originalEndMs) ||
      (originalEndMs > maximumEndMs && requested >= originalEndMs)
    ) {
      return { startMs: originalStartMs, endMs: originalEndMs }
    }
    return {
      startMs: originalStartMs,
      endMs: Math.max(
        minimumEndMs,
        Math.min(maximumEndMs, requested),
      ),
    }
  }
  return null
}

export function shiftWords(project: KaraokeProject, wordIds: Set<string>, deltaMs: number): KaraokeProject {
  const constrainedDeltaMs = constrainWordShiftDelta(project, wordIds, deltaMs)
  if (Math.abs(constrainedDeltaMs) < 1) return project
  let projectChanged = false
  const tracks = project.tracks.map((track) => {
    let trackChanged = false
    const lines = track.lines.map((line) => {
      let lineChanged = false
      const words = line.words.map((word) => {
        if (!wordIds.has(word.id) || word.startMs === null) return word
        const duration = Math.max(1, (word.endMs ?? word.startMs + 300) - word.startMs)
        const startMs = Math.max(0, Math.round(word.startMs + constrainedDeltaMs))
        const endMs = startMs + duration
        if (startMs === word.startMs && endMs === word.endMs) return word
        lineChanged = true
        return { ...word, startMs, endMs }
      })
      if (!lineChanged) return line
      trackChanged = true
      return recalculateLine({ ...line, words })
    })
    if (!trackChanged) return track
    projectChanged = true
    return { ...track, lines }
  })

  return projectChanged
    ? { ...project, updatedAt: new Date().toISOString(), tracks }
    : project
}

export function downloadText(filename: string, contents: string, type = 'text/plain') {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled-karaoke'
}
