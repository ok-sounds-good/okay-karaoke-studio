import type { KaraokeProject, LyricLine, LyricWord, TimingRange, VocalTrack } from './karaoke'
import { resolveVocalSungColor } from './video-style'

function formatAssTimestamp(ms: number): string {
  const centisecondsTotal = Math.max(0, Math.round(ms / 10))
  const centiseconds = centisecondsTotal % 100
  const secondsTotal = Math.floor(centisecondsTotal / 100)
  const seconds = secondsTotal % 60
  const minutesTotal = Math.floor(secondsTotal / 60)
  const minutes = minutesTotal % 60
  const hours = Math.floor(minutesTotal / 60)
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
}

function assColor(color: string): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(color)
  if (!match) return '&H00FFFFFF'
  return `&H00${match[3]}${match[2]}${match[1]}`.toUpperCase()
}

function assStyleName(track: VocalTrack, index: number): string {
  const cleaned = track.name.replace(/[,\r\n]/gu, ' ').trim()
  return cleaned || `Vocal ${index + 1}`
}

function metadataValue(value: string): string {
  return value.replace(/[\r\n\[\]]/gu, ' ').trim()
}

function trackById(project: KaraokeProject, trackId: string): VocalTrack {
  const track = project.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new RangeError(`No vocal track with ID "${trackId}".`)
  return track
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/gu, '\\\\')
    .replace(/\{/gu, '\\{')
    .replace(/\}/gu, '\\}')
    .replace(/\r?\n/gu, '\\N')
}

function assLineText(
  line: LyricLine,
  offsetMs: number,
  eventStartCs: number,
  eventEndCs: number,
): string {
  if (!line.words.some((word) => word.startMs !== null && word.endMs !== null)) {
    return escapeAssText(line.text)
  }
  const nextTimedStarts = new Array<number | undefined>(line.words.length)
  let nextTimedStart: number | undefined
  for (let index = line.words.length - 1; index >= 0; index -= 1) {
    nextTimedStarts[index] = nextTimedStart
    if (line.words[index].startMs !== null) nextTimedStart = line.words[index].startMs ?? undefined
  }
  let cursorCs = eventStartCs
  return line.words
    .map((word, wordIndex) => {
      if (word.startMs === null || word.endMs === null) return escapeAssText(word.text)
      const followingStart = nextTimedStarts[wordIndex]
      const adjustedStartCs = Math.max(
        eventStartCs,
        Math.min(eventEndCs, Math.round((word.startMs + offsetMs) / 10)),
      )
      const adjustedEndCs = Math.max(
        eventStartCs,
        Math.min(
          eventEndCs,
          Math.round((Math.min(word.endMs, followingStart ?? word.endMs) + offsetMs) / 10),
        ),
      )
      const wordStartCs = Math.max(cursorCs, adjustedStartCs)
      if (adjustedEndCs <= wordStartCs || wordStartCs >= eventEndCs) {
        return escapeAssText(word.text)
      }
      const gapCs = wordStartCs - cursorCs
      const durationCs = adjustedEndCs - wordStartCs
      cursorCs = adjustedEndCs
      const delay = gapCs > 0 ? `{\\k${gapCs}}` : ''
      return `${delay}{\\kf${durationCs}}${escapeAssText(word.text)}`
    })
    .join(' ')
}

function lineTiming(line: LyricLine): TimingRange | null {
  const timedWords = line.words.filter(
    (word): word is LyricWord & TimingRange => word.startMs !== null && word.endMs !== null,
  )
  const startMs = line.startMs ?? timedWords[0]?.startMs ?? null
  const endMs = line.endMs ?? timedWords.at(-1)?.endMs ?? null
  if (startMs === null || endMs === null || endMs <= startMs) return null
  return { startMs, endMs }
}

export function exportAss(project: KaraokeProject, trackId?: string): string {
  const tracks = trackId ? [trackById(project, trackId)] : project.tracks
  const styleNames = tracks.map((track, index) => {
    const base = assStyleName(track, index)
    const duplicateCount = tracks
      .slice(0, index)
      .filter(
        (candidate, candidateIndex) => assStyleName(candidate, candidateIndex) === base,
      ).length
    return duplicateCount === 0 ? base : `${base} ${duplicateCount + 1}`
  })
  const safeTitle = metadataValue(project.title)
  const header = [
    '[Script Info]',
    `Title: ${safeTitle}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...tracks.map((track, index) => {
      const name = styleNames[index]
      const primary = assColor(resolveVocalSungColor(project.stageStyle, track.vocalStyle))
      return `Style: ${name},Arial,72,${primary},&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,80,1`
    }),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = tracks.flatMap((track, trackIndex) =>
    track.lines.flatMap((line) => {
      const timing = lineTiming(line)
      if (!timing) return []
      const adjustedEndMs = timing.endMs + project.offsetMs
      if (adjustedEndMs <= 0) return []
      const adjustedStartMs = Math.max(0, timing.startMs + project.offsetMs)
      const eventStartCs = Math.round(adjustedStartMs / 10)
      const eventEndCs = Math.max(
        eventStartCs + 1,
        Math.round(Math.max(adjustedStartMs + 10, adjustedEndMs) / 10),
      )
      const start = formatAssTimestamp(eventStartCs * 10)
      const end = formatAssTimestamp(eventEndCs * 10)
      const style = styleNames[trackIndex]
      return [
        `Dialogue: ${trackIndex},${start},${end},${style},,0,0,0,,${assLineText(line, project.offsetMs, eventStartCs, eventEndCs)}`,
      ]
    }),
  )
  return [...header, ...events].join('\n')
}
