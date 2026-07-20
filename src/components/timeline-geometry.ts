import type { LyricLine, LyricWord, VocalTrack } from '../lib/model'
import type { ProjectTimingDraft } from '../utils'

const TIMELINE_LABEL_GAP_PX = 4
const TIMELINE_LABEL_LANE_GAP_PX = 4
const TIMELINE_LABEL_ROW_HEIGHT_PX = 20
const TIMELINE_WORD_ZONE_GAP_PX = 5
const TIMELINE_WORD_ROW_GAP_PX = 3
const TIMELINE_EDGE_TOLERANCE_PX = 0.01

export const TIMELINE_LABEL_TOP_PX = 3
export const TIMELINE_WORD_HEIGHT_PX = 17
export const TIMELINE_MIN_TRACK_HEIGHT_PX = 62

export interface TimelineWordLayout {
  word: LyricWord
  wordIndex: number
  left: number
  top: number
  width: number
  labelWidth: number
  collisionEnd: number
}

export interface TimelineLineLayout {
  line: LyricLine
  lineIndex: number
  lane: number
  top: number
  height: number
  labelLeft: number
  labelWidth: number
  intervalStart: number
  intervalEnd: number
  words: TimelineWordLayout[]
}

export interface TimelineTrackLayout {
  trackId: string
  height: number
  maxRight: number
  lines: TimelineLineLayout[]
}

export interface TimelineSelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function timelineWordLabel(word: LyricWord) {
  return word.text.replaceAll('/', '·')
}

function timelineLabelWidth(word: LyricWord) {
  return Math.max(14, Array.from(timelineWordLabel(word)).length * 6 + 4)
}

function assignNonOverlappingRows(words: Omit<TimelineWordLayout, 'top'>[]) {
  const rowEnds: number[] = []
  const rows = new Map<string, number>()
  ;[...words]
    .sort((a, b) => a.left - b.left || a.wordIndex - b.wordIndex)
    .forEach((word) => {
      const row = rowEnds.findIndex((end) => end <= word.left + TIMELINE_EDGE_TOLERANCE_PX)
      const assignedRow = row >= 0 ? row : rowEnds.length
      rowEnds[assignedRow] = word.collisionEnd
      rows.set(word.word.id, assignedRow)
    })
  return { rowCount: Math.max(1, rowEnds.length), rows }
}

export function timelineTime(rawTimingMs: number, offsetMs: number) {
  return rawTimingMs + offsetMs
}

export function buildTimelineTrackLayout(
  track: VocalTrack,
  offsetMs: number,
  pixelsPerSecond: number,
  timingDraft: ProjectTimingDraft | null = null,
): TimelineTrackLayout {
  const candidates = track.lines
    .flatMap((line, lineIndex) => {
      const wordsWithoutTop = line.words.flatMap((word, wordIndex) => {
        if (word.startMs === null) return []
        const endMs = word.endMs ?? word.startMs + 360
        const draftTiming = timingDraft?.get(word.id)
        const adjustedStart = timelineTime(draftTiming?.startMs ?? word.startMs, offsetMs)
        const adjustedEnd = timelineTime(draftTiming?.endMs ?? endMs, offsetMs)
        if (adjustedEnd <= 0) return []
        const visibleStart = Math.max(0, adjustedStart)
        const left = (visibleStart / 1000) * pixelsPerSecond
        const timingWidth = Math.max(0, ((adjustedEnd - visibleStart) / 1000) * pixelsPerSecond)
        return [
          {
            word,
            wordIndex,
            left,
            width: Math.max(1, timingWidth),
            labelWidth: timelineLabelWidth(word),
            collisionEnd: left + timingWidth,
          },
        ]
      })
      if (!wordsWithoutTop.length) return []

      let labelLeft = Number.POSITIVE_INFINITY
      let labelWidth = Math.max(0, wordsWithoutTop.length - 1) * TIMELINE_LABEL_GAP_PX
      wordsWithoutTop.forEach((word) => {
        labelLeft = Math.min(labelLeft, word.left)
        labelWidth += word.labelWidth
      })
      const intervalStart = labelLeft
      const intervalEnd = labelLeft + labelWidth
      return [
        {
          line,
          lineIndex,
          lane: 0,
          top: 0,
          height: TIMELINE_LABEL_ROW_HEIGHT_PX,
          labelLeft,
          labelWidth,
          intervalStart,
          intervalEnd,
          words: wordsWithoutTop.map((word) => ({
            ...word,
            top: 0,
          })),
        },
      ]
    })
    .sort((a, b) => a.intervalStart - b.intervalStart || a.lineIndex - b.lineIndex)

  const laneEnds: number[] = []
  candidates.forEach((line) => {
    const availableLane = laneEnds.findIndex(
      (end) => end + TIMELINE_LABEL_GAP_PX <= line.intervalStart,
    )
    line.lane = availableLane >= 0 ? availableLane : laneEnds.length
    laneEnds[line.lane] = line.intervalEnd
  })

  const laneTops = laneEnds.map(
    (_end, lane) => 2 + lane * (TIMELINE_LABEL_ROW_HEIGHT_PX + TIMELINE_LABEL_LANE_GAP_PX),
  )
  const labelZoneEnd = laneEnds.length
    ? 2 + laneEnds.length * (TIMELINE_LABEL_ROW_HEIGHT_PX + TIMELINE_LABEL_LANE_GAP_PX)
    : 2
  const { rowCount, rows } = assignNonOverlappingRows(
    candidates.flatMap((line) => line.words.map(({ top: _top, ...word }) => word)),
  )
  const wordZoneTop = labelZoneEnd + TIMELINE_WORD_ZONE_GAP_PX
  candidates.forEach((line) => {
    line.top = laneTops[line.lane] ?? 2
    line.words = line.words.map((word) => ({
      ...word,
      top:
        wordZoneTop +
        (rows.get(word.word.id) ?? 0) * (TIMELINE_WORD_HEIGHT_PX + TIMELINE_WORD_ROW_GAP_PX),
    }))
  })

  const trackHeight =
    wordZoneTop +
    rowCount * TIMELINE_WORD_HEIGHT_PX +
    Math.max(0, rowCount - 1) * TIMELINE_WORD_ROW_GAP_PX +
    6

  return {
    trackId: track.id,
    height: Math.max(TIMELINE_MIN_TRACK_HEIGHT_PX, trackHeight),
    maxRight: candidates.reduce(
      (maximum, line) =>
        Math.max(
          maximum,
          line.intervalEnd,
          line.words.reduce(
            (wordMaximum, word) => Math.max(wordMaximum, word.left + word.width),
            0,
          ),
        ),
      0,
    ),
    lines: candidates.sort((a, b) => a.lineIndex - b.lineIndex),
  }
}

export function timelineWordIdsInRect(layout: TimelineTrackLayout, rect: TimelineSelectionRect) {
  const left = Math.min(rect.left, rect.right)
  const right = Math.max(rect.left, rect.right)
  const top = Math.min(rect.top, rect.bottom)
  const bottom = Math.max(rect.top, rect.bottom)
  const selected = new Set<string>()
  layout.lines.forEach((line) => {
    line.words.forEach((word) => {
      if (
        word.left <= right &&
        word.left + word.width >= left &&
        word.top <= bottom &&
        word.top + TIMELINE_WORD_HEIGHT_PX >= top
      )
        selected.add(word.word.id)
    })
  })
  return selected
}
