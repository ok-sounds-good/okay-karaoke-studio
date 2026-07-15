'use strict'

function compareOrdinal(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
function resolveFontFace(typeface, requested) {
  const exactPostscript = requested.postscriptName
    ? typeface.faces.find((face) => face.postscriptName === requested.postscriptName)
    : null
  if (exactPostscript) return { ...exactPostscript }
  const exactStyle = typeface.faces.filter((face) => (
    face.style.toLowerCase() === requested.style.toLowerCase() &&
    face.weight === requested.weight &&
    face.slant === requested.slant
  )).sort(compareFontFaces)[0]
  if (exactStyle) return { ...exactStyle }
  return { ...[...typeface.faces].sort((left, right) => {
    const score = (face) => Math.abs(face.weight - requested.weight) +
      (face.slant === requested.slant ? 0 : 1_000)
    return score(left) - score(right) || compareFontFaces(left, right)
  })[0] }
}
function compareFontFaces(left, right) {
  return compareOrdinal(left.style, right.style) ||
    compareOrdinal(left.fullName, right.fullName) ||
    compareOrdinal(String(left.postscriptName), String(right.postscriptName))
}
function resolveVocalStyle(projectLyrics, vocal) {
  const typeface = vocal.typeface ?? projectLyrics.typeface
  return {
    typeface,
    fontStyle: resolveFontFace(typeface, vocal.fontStyle ?? projectLyrics.fontStyle),
    sizePx: vocal.sizePx ?? projectLyrics.sizePx,
    unsungColor: vocal.unsungColor ?? projectLyrics.unsungColor,
    sungColor: vocal.sungColor ?? projectLyrics.sungColor,
    alignment: vocal.alignment,
    previewMs: vocal.previewMs,
    syncAid: { ...vocal.syncAid },
  }
}
function rawLineRange(line) {
  const timedWords = line.words.filter((word) => word.startMs !== null && word.endMs !== null)
  const startMs = timedWords[0]?.startMs ?? line.startMs ?? null
  const endMs = line.endMs ?? timedWords.at(-1)?.endMs ?? null
  if (startMs === null || endMs === null || endMs <= startMs) return null
  return { startMs, endMs }
}
function adjustedLineRange(line, offsetMs) {
  const range = rawLineRange(line)
  if (!range) return null
  const startMs = Math.max(0, range.startMs + offsetMs)
  const endMs = range.endMs + offsetMs
  return endMs > startMs ? { startMs, endMs } : null
}
function visibleTracks(project) {
  const hasSolo = project.tracks.some((track) => track.solo && !track.muted)
  return project.tracks.filter((track) => !track.muted && (!hasSolo || track.solo))
}
function sectionsForTrack(track) {
  const sections = []
  let section = []
  for (const line of track.lines) {
    if (!line.text.trim() && line.words.length === 0) {
      if (section.length) sections.push(section)
      section = []
    } else {
      section.push(line)
    }
  }
  if (section.length) sections.push(section)
  return sections
}
function displayWindows(track, settings) {
  const windows = []
  const firstSectionLineIds = new Set()
  let previousCompletion = Number.NEGATIVE_INFINITY
  for (const section of sectionsForTrack(track)) {
    if (section[0]) firstSectionLineIds.add(section[0].id)
    const timed = section.flatMap((line) => {
      const range = rawLineRange(line)
      return range ? [{ line, range }] : []
    })
    if (!timed.length) continue
    if (settings.advanceMode === 'clear') {
      for (let start = 0; start < timed.length; start += settings.lineCount) {
        const entries = timed.slice(start, start + settings.lineCount)
        const completionMs = Math.max(...entries.map(({ range }) => range.endMs))
        windows.push({
          entries,
          activationMs: Math.max(
            entries[0].range.startMs - track.vocalStyle.previewMs,
            previousCompletion,
          ),
          completionMs,
        })
        previousCompletion = completionMs
      }
    } else {
      const maximumStart = Math.max(0, timed.length - settings.lineCount)
      for (let start = 0; start <= maximumStart; start += 1) {
        const entries = timed.slice(start, start + settings.lineCount)
        const entering = start === 0 ? timed[0] : timed[start + settings.lineCount - 1]
        const removed = start > 0 ? timed[start - 1] : null
        const completionMs = Math.max(...entries.map(({ range }) => range.endMs))
        windows.push({
          entries,
          activationMs: Math.max(
            entering.range.startMs - track.vocalStyle.previewMs,
            removed?.range.endMs ?? previousCompletion,
          ),
          completionMs,
        })
        if (start === maximumStart) previousCompletion = completionMs
      }
    }
  }
  return { firstSectionLineIds, windows }
}
function activeWindow(windows, lyricMs) {
  let low = 0
  let high = windows.length - 1
  let active = null
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (windows[middle].activationMs <= lyricMs) {
      active = windows[middle]
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (!active || (active === windows.at(-1) && lyricMs >= active.completionMs)) return null
  return active
}
function wordProgress(word, lyricMs) {
  if (word.startMs === null || word.endMs === null) return 0
  if (lyricMs <= word.startMs) return 0
  if (lyricMs >= word.endMs) return 1
  return Math.max(0, Math.min(1, (lyricMs - word.startMs) / (word.endMs - word.startMs)))
}

function syncAidFor(track, firstSectionLineIds, active, lyricMs) {
  const config = track.vocalStyle.syncAid
  if (!config.enabled || !active) return null
  const entry = active.entries.find(({ line }) => firstSectionLineIds.has(line.id))
  const firstWord = entry?.line.words[0]
  if (
    !entry || !firstWord || firstWord.startMs === null || firstWord.endMs === null ||
    firstWord.endMs <= firstWord.startMs
  ) return null
  const availableMs = Math.max(0, firstWord.startMs - active.activationMs)
  const durationMs = Math.min(availableMs, config.maxLeadMs, track.vocalStyle.previewMs)
  if (durationMs < config.minLeadMs) return null
  const startMs = firstWord.startMs - durationMs
  if (lyricMs < startMs || lyricMs >= firstWord.startMs) return null
  return {
    lineId: entry.line.id,
    startMs,
    endMs: firstWord.startMs,
    durationMs,
    progress: Math.max(0, Math.min(1, (lyricMs - startMs) / Math.max(1, durationMs))),
  }
}

function createStageFramePlanner(project) {
  const tracks = visibleTracks(project).map((track) => ({
    ...displayWindows(track, project.lyricDisplay),
    style: resolveVocalStyle(project.stageStyle.lyrics, track.vocalStyle),
    track,
  }))
  const titleHandoffMs = tracks.reduce((handoff, { windows }) => {
    const activationMs = windows[0]?.activationMs
    return activationMs === undefined
      ? handoff
      : Math.min(handoff, Math.max(0, activationMs + project.offsetMs))
  }, Number.POSITIVE_INFINITY)

  return (playbackMs) => {
    const lyricMs = playbackMs - project.offsetMs
    const planned = tracks.map((entry) => ({ ...entry, active: activeWindow(entry.windows, lyricMs) }))
    const lines = []
    for (
      let lineIndex = 0;
      lineIndex < project.lyricDisplay.lineCount && lines.length < project.lyricDisplay.lineCount;
      lineIndex += 1
    ) {
      for (const { active, style, track } of planned) {
        const line = active?.entries[lineIndex]?.line
        if (!line || lines.length >= project.lyricDisplay.lineCount) continue
        lines.push({
          id: line.id,
          trackId: track.id,
          text: line.text.replaceAll('/', '·'),
          style,
          words: line.words.filter((word) => word.text).map((word) => ({
            id: word.id,
            text: word.text.replaceAll('/', '·'),
            progress: wordProgress(word, lyricMs),
          })),
        })
      }
    }
    const admitted = new Set(lines.map((line) => JSON.stringify([line.trackId, line.id])))
    const syncAids = planned.flatMap(({ active, firstSectionLineIds, style, track }) => {
      const aid = syncAidFor(track, firstSectionLineIds, active, lyricMs)
      return aid && admitted.has(JSON.stringify([track.id, aid.lineId]))
        ? [{ ...aid, trackId: track.id, style }]
        : []
    })
    return {
      title: project.title || 'Untitled song',
      artist: project.artist || 'Unknown artist',
      playbackMs,
      showTitle: playbackMs < titleHandoffMs,
      stageStyle: project.stageStyle,
      lines,
      syncAids,
    }
  }
}

function frameStateAt(project, playbackMs) {
  return createStageFramePlanner(project)(playbackMs)
}

const apiKey = Symbol.for('studio.okay-karaoke.stage-frame-state')
const localApi = Object.freeze({
  adjustedLineRange,
  createStageFramePlanner,
  frameStateAt,
  resolveVocalStyle,
  visibleTracks,
})
const sharedApi = globalThis[apiKey] ?? localApi
if (globalThis[apiKey] === undefined) {
  Object.defineProperty(globalThis, apiKey, { value: sharedApi })
}
if (typeof module !== 'undefined' && module.exports) module.exports = sharedApi
