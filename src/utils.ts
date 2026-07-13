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

export function patchWord(
  project: KaraokeProject,
  wordId: string,
  patch: Partial<Pick<LyricWord, 'text' | 'startMs' | 'endMs'>>,
): KaraokeProject {
  let projectChanged = false
  const tracks = project.tracks.map((track) => {
    let trackChanged = false
    const lines = track.lines.map((line) => {
      let lineChanged = false
      const words = line.words.map((word) => {
        if (word.id !== wordId) return word
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

export function shiftWords(project: KaraokeProject, wordIds: Set<string>, deltaMs: number): KaraokeProject {
  if (Math.abs(deltaMs) < 1) return project
  let projectChanged = false
  const tracks = project.tracks.map((track) => {
    let trackChanged = false
    const lines = track.lines.map((line) => {
      let lineChanged = false
      const words = line.words.map((word) => {
        if (!wordIds.has(word.id) || word.startMs === null) return word
        const duration = Math.max(80, (word.endMs ?? word.startMs + 300) - word.startMs)
        const startMs = Math.max(0, Math.round(word.startMs + deltaMs))
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
