import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { AudioWaveform, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, SkipBack, TimerReset, Zap, ZoomIn } from 'lucide-react'
import type { KaraokeProject, LyricLine, LyricWord, VocalTrack } from '../lib/model'
import { formatTime } from '../lib/model'
import { resolveVocalSungColor } from '../lib/video-style'
import {
  constrainWordResizeTiming,
  constrainWordShiftDelta,
  flattenTrack,
  motionAwareScrollBehavior,
  type ProjectTimingDraft,
} from '../utils'
import { Button, IconButton } from './ui'

interface TimelineProps {
  project: KaraokeProject
  peaks: number[]
  isAnalyzing: boolean
  durationMs: number
  currentMs: number
  zoom: number
  activeTrackId: string
  selectedWordIds: Set<string>
  syncWordId: string | null
  syncMode: boolean
  onSeek: (timeMs: number) => void
  onZoom: (zoom: number) => void
  onSelectWord: (wordId: string, add: boolean) => void
  onSelectWords: (wordIds: Set<string>) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
  onToggleSync: () => void
  onClearTiming: () => void
  onClearTimingAfterCursor: () => void
}

const TIMELINE_LABEL_GAP_PX = 4
const TIMELINE_LABEL_LANE_GAP_PX = 4
const TIMELINE_LABEL_ROW_HEIGHT_PX = 20
const TIMELINE_LABEL_TOP_PX = 3
const TIMELINE_WORD_ZONE_GAP_PX = 5
const TIMELINE_WORD_HEIGHT_PX = 17
const TIMELINE_WORD_ROW_GAP_PX = 3
const TIMELINE_MIN_TRACK_HEIGHT_PX = 62
const TIMELINE_EDGE_TOLERANCE_PX = 0.01

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

interface TimelineMarquee {
  trackId: string
  pointerId: number
  add: boolean
  startX: number
  startY: number
  currentX: number
  currentY: number
}

function timelineWordLabel(word: LyricWord) {
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

export function buildTimelineTrackLayout(
  track: VocalTrack,
  offsetMs: number,
  pixelsPerSecond: number,
  timingDraft: ProjectTimingDraft | null = null,
): TimelineTrackLayout {
  const candidates = track.lines.flatMap((line, lineIndex) => {
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
      return [{
        word,
        wordIndex,
        left,
        width: Math.max(1, timingWidth),
        labelWidth: timelineLabelWidth(word),
        collisionEnd: left + timingWidth,
      }]
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
    return [{
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
    }]
  }).sort((a, b) => a.intervalStart - b.intervalStart || a.lineIndex - b.lineIndex)

  const laneEnds: number[] = []
  candidates.forEach((line) => {
    const availableLane = laneEnds.findIndex((end) => end + TIMELINE_LABEL_GAP_PX <= line.intervalStart)
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
      top: wordZoneTop
        + (rows.get(word.word.id) ?? 0) * (TIMELINE_WORD_HEIGHT_PX + TIMELINE_WORD_ROW_GAP_PX),
    }))
  })

  const trackHeight = wordZoneTop
    + rowCount * TIMELINE_WORD_HEIGHT_PX
    + Math.max(0, rowCount - 1) * TIMELINE_WORD_ROW_GAP_PX
    + 6

  return {
    trackId: track.id,
    height: Math.max(TIMELINE_MIN_TRACK_HEIGHT_PX, trackHeight),
    maxRight: candidates.reduce((maximum, line) => Math.max(
      maximum,
      line.intervalEnd,
      line.words.reduce(
        (wordMaximum, word) => Math.max(wordMaximum, word.left + word.width),
        0,
      ),
    ), 0),
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
      ) selected.add(word.word.id)
    })
  })
  return selected
}

export interface TimelineTimingGesture {
  wordId: string
  mode: 'move' | 'start' | 'end'
  originalStart: number
  originalEnd: number
  ids: Set<string>
  deltaMs: number
}

export interface TimelinePointerGesture extends TimelineTimingGesture {
  clientX: number
  pointerId: number
  captureTarget: EventTarget
}

export interface TimelineGestureContext {
  project: KaraokeProject
  pixelsPerSecond: number
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
}

export function timelineTime(rawTimingMs: number, offsetMs: number) {
  return rawTimingMs + offsetMs
}

export function timingDraftForGesture(
  project: KaraokeProject,
  gesture: TimelineTimingGesture,
): ProjectTimingDraft {
  const timingDraft = new Map<string, { startMs: number; endMs: number }>()

  if (gesture.mode === 'move') {
    const constrainedDeltaMs = constrainWordShiftDelta(project, gesture.ids, gesture.deltaMs)
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (!gesture.ids.has(word.id) || word.startMs === null) return
          const duration = Math.max(1, (word.endMs ?? word.startMs + 300) - word.startMs)
          const startMs = Math.max(0, Math.round(word.startMs + constrainedDeltaMs))
          timingDraft.set(word.id, { startMs, endMs: startMs + duration })
        })
      })
    })
    return timingDraft
  }

  const constrained = constrainWordResizeTiming(
    project,
    gesture.wordId,
    gesture.mode,
    gesture.mode === 'start' ? gesture.originalStart + gesture.deltaMs : gesture.originalStart,
    gesture.mode === 'end' ? gesture.originalEnd + gesture.deltaMs : gesture.originalEnd,
  )
  if (constrained) timingDraft.set(gesture.wordId, constrained)
  return timingDraft
}

export function createTimelineGestureSession(
  getContext: () => TimelineGestureContext,
) {
  let active: TimelinePointerGesture | null = null
  let activeProject: KaraokeProject | null = null
  let affectedTimingSnapshot = new Map<string, { startMs: number; endMs: number | null }>()
  let draftPublished = false

  const snapshotAffectedTimings = (project: KaraokeProject, gesture: TimelinePointerGesture) => {
    const affectedIds = gesture.mode === 'move' ? gesture.ids : new Set([gesture.wordId])
    const snapshot = new Map<string, { startMs: number; endMs: number | null }>()
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (affectedIds.has(word.id) && word.startMs !== null) {
            snapshot.set(word.id, { startMs: word.startMs, endMs: word.endMs })
          }
        })
      })
    })
    return snapshot
  }

  const affectedTimingsUnchanged = (project: KaraokeProject) => {
    if (!activeProject || project.id !== activeProject.id || affectedTimingSnapshot.size === 0) return false
    const remaining = new Map(affectedTimingSnapshot)
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          const timing = remaining.get(word.id)
          if (
            timing &&
            word.startMs === timing.startMs &&
            word.endMs === timing.endMs
          ) remaining.delete(word.id)
        })
      })
    })
    return remaining.size === 0
  }

  const clear = (pointerId: number, captureTarget: EventTarget) => {
    if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return null
    const gesture = active
    active = null
    activeProject = null
    affectedTimingSnapshot = new Map()
    draftPublished = false
    getContext().onTimingDraftChange(null)
    return gesture
  }

  return {
    begin(gesture: TimelinePointerGesture) {
      if (active) return false
      active = gesture
      activeProject = getContext().project
      affectedTimingSnapshot = snapshotAffectedTimings(activeProject, gesture)
      draftPublished = false
      return true
    },
    move(pointerId: number, captureTarget: EventTarget, clientX: number) {
      if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return false
      const context = getContext()
      if (context.project !== activeProject) {
        if (!affectedTimingsUnchanged(context.project)) {
          clear(pointerId, captureTarget)
          return false
        }
        activeProject = context.project
      }
      const deltaMs = Math.round(((clientX - active.clientX) / context.pixelsPerSecond) * 1000)
      active = { ...active, deltaMs }
      context.onTimingDraftChange(timingDraftForGesture(context.project, active))
      draftPublished = true
      return true
    },
    finish(pointerId: number, captureTarget: EventTarget) {
      const currentProject = getContext().project
      if (
        active?.pointerId === pointerId &&
        active.captureTarget === captureTarget &&
        currentProject !== activeProject
      ) {
        if (!affectedTimingsUnchanged(currentProject)) {
          clear(pointerId, captureTarget)
          return false
        }
        activeProject = currentProject
      }
      const gesture = clear(pointerId, captureTarget)
      if (!gesture) return false

      const context = getContext()
      if (gesture.mode === 'move') {
        const constrainedDeltaMs = constrainWordShiftDelta(
          context.project,
          gesture.ids,
          gesture.deltaMs,
        )
        if (constrainedDeltaMs !== 0) context.onShiftWords(gesture.ids, constrainedDeltaMs)
        return true
      }

      if (gesture.deltaMs === 0) return true

      const constrained = constrainWordResizeTiming(
        context.project,
        gesture.wordId,
        gesture.mode,
        gesture.mode === 'start' ? gesture.originalStart + gesture.deltaMs : gesture.originalStart,
        gesture.mode === 'end' ? gesture.originalEnd + gesture.deltaMs : gesture.originalEnd,
      )
      if (!constrained) return true
      const { startMs, endMs } = constrained
      if (startMs !== gesture.originalStart || endMs !== gesture.originalEnd) {
        context.onResizeWord(gesture.wordId, startMs, endMs)
      }
      return true
    },
    cancel(pointerId: number, captureTarget: EventTarget) {
      return clear(pointerId, captureTarget) !== null
    },
    owns(pointerId: number, captureTarget: EventTarget) {
      return active?.pointerId === pointerId && active.captureTarget === captureTarget
    },
    captureLost(pointerId: number, eventTarget: EventTarget | null) {
      if (active?.pointerId !== pointerId) return false
      const targetDisconnected = active.captureTarget instanceof Node && !active.captureTarget.isConnected
      if (eventTarget !== active.captureTarget && !targetDisconnected) return false
      return clear(pointerId, active.captureTarget) !== null
    },
    invalidateProject(project: KaraokeProject) {
      if (!active) return false
      if (project === activeProject) return false
      if (!affectedTimingsUnchanged(project)) {
        return clear(active.pointerId, active.captureTarget) !== null
      }
      activeProject = project
      if (draftPublished) {
        getContext().onTimingDraftChange(timingDraftForGesture(project, active))
      }
      return false
    },
    abandon() {
      const hadActiveGesture = active !== null
      active = null
      activeProject = null
      affectedTimingSnapshot = new Map()
      draftPublished = false
      return hadActiveGesture
    },
  }
}

function safelyHasPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    return element.hasPointerCapture(pointerId)
  } catch {
    return false
  }
}

function safelyReleasePointerCapture(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Capture may already have been released by the browser during cancellation.
  }
}

export function Timeline({
  project,
  peaks,
  isAnalyzing,
  durationMs,
  currentMs,
  zoom,
  activeTrackId,
  selectedWordIds,
  syncWordId,
  syncMode,
  onSeek,
  onZoom,
  onSelectWord,
  onSelectWords,
  onShiftWords,
  onResizeWord,
  onTimingDraftChange,
  onToggleSync,
  onClearTiming,
  onClearTimingAfterCursor,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [timingDraft, setTimingDraft] = useState<ProjectTimingDraft | null>(null)
  const [marquee, setMarquee] = useState<TimelineMarquee | null>(null)
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  const pixelsPerSecond = 72 * zoom
  const trackLayouts = useMemo(
    () => project.tracks.map((track) => (
      buildTimelineTrackLayout(track, project.offsetMs, pixelsPerSecond, timingDraft)
    )),
    [pixelsPerSecond, project.offsetMs, project.tracks, timingDraft],
  )
  const trackLayoutById = useMemo(
    () => new Map(trackLayouts.map((layout) => [layout.trackId, layout])),
    [trackLayouts],
  )
  const width = Math.max(
    1040,
    (durationMs / 1000) * pixelsPerSecond,
    ...trackLayouts.map((layout) => layout.maxRight + 24),
  )
  const playheadLeft = (currentMs / 1000) * pixelsPerSecond
  const followBucket = Math.floor(currentMs / 500)
  const tickStepSeconds = zoom < 0.8 ? 5 : zoom < 1.7 ? 2 : 1
  const labelStepSeconds = zoom < 0.8 ? 10 : zoom < 1.7 ? 5 : 2
  const activeTrack = project.tracks.find((track) => track.id === activeTrackId)
  const activeTrackWords = activeTrack ? flattenTrack(activeTrack) : []
  const clearBoundaryMs = Math.max(0, currentMs - project.offsetMs)
  const activeHasTiming = Boolean(activeTrack?.lines.some((line) => (
    line.startMs !== null || line.endMs !== null || line.words.some((word) => word.startMs !== null || word.endMs !== null)
  )))
  const canClearAfterCursor = clearBoundaryMs === 0
    ? activeHasTiming
    : Boolean(activeTrack?.lines.some((line) => (
      (line.words.every((word) => word.startMs === null && word.endMs === null) && (line.startMs ?? -1) >= clearBoundaryMs) ||
      line.words.some((word) => (word.startMs ?? -1) >= clearBoundaryMs)
    )))
  const gestureContextRef = useRef<TimelineGestureContext | null>(null)
  gestureContextRef.current = {
    project,
    pixelsPerSecond,
    onTimingDraftChange: (nextDraft) => {
      setTimingDraft(nextDraft)
      onTimingDraftChange(nextDraft)
    },
    onShiftWords,
    onResizeWord,
  }
  const gestureSessionRef = useRef<ReturnType<typeof createTimelineGestureSession> | null>(null)
  if (!gestureSessionRef.current) {
    gestureSessionRef.current = createTimelineGestureSession(() => gestureContextRef.current!)
  }
  const parentDraftCallbackRef = useRef(onTimingDraftChange)
  parentDraftCallbackRef.current = onTimingDraftChange
  const ticks = useMemo(
    () => Array.from({ length: Math.ceil(durationMs / 1000 / tickStepSeconds) + 1 }, (_, index) => index * tickStepSeconds),
    [durationMs, tickStepSeconds],
  )
  const waveformPath = useMemo(() => {
    const mid = 38
    const top = peaks.map((peak, index) => `${index},${mid - peak * 31}`).join(' L ')
    const bottom = [...peaks].reverse().map((peak, reverseIndex) => `${peaks.length - 1 - reverseIndex},${mid + peak * 31}`).join(' L ')
    return `M 0,${mid} L ${top} L ${bottom} Z`
  }, [peaks])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const left = (followBucket * 500 / 1000) * pixelsPerSecond
    const margin = 130
    if (left < viewport.scrollLeft + margin || left > viewport.scrollLeft + viewport.clientWidth - margin) {
      viewport.scrollTo({
        left: Math.max(0, left - viewport.clientWidth * 0.32),
        behavior: 'auto',
      })
    }
  }, [followBucket, pixelsPerSecond])

  useEffect(() => () => {
    if (gestureSessionRef.current?.abandon()) parentDraftCallbackRef.current(null)
  }, [])

  useEffect(() => {
    setMarquee(null)
  }, [activeTrackId, project.id])

  useLayoutEffect(() => {
    gestureSessionRef.current!.invalidateProject(project)
  }, [project])

  useEffect(() => {
    const captureEnded = (event: Event) => {
      const pointerId = (event as PointerEvent).pointerId
      if (typeof pointerId !== 'number') return
      gestureSessionRef.current!.captureLost(pointerId, event.target)
    }
    document.addEventListener('lostpointercapture', captureEnded, true)
    document.addEventListener('pointercancel', captureEnded, true)
    return () => {
      document.removeEventListener('lostpointercapture', captureEnded, true)
      document.removeEventListener('pointercancel', captureEnded, true)
    }
  }, [])

  const seekFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    onSeek(Math.round((x / pixelsPerSecond) * 1000))
  }

  const lanePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  const marqueePointerDown = (event: ReactPointerEvent<HTMLDivElement>, trackId: string) => {
    if (trackId !== activeTrackId || event.button !== 0) return
    event.preventDefault()
    const point = lanePoint(event)
    setMarquee({
      trackId,
      pointerId: event.pointerId,
      add: event.shiftKey || event.metaKey || event.ctrlKey,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      setMarquee(null)
    }
  }

  const marqueePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId || marquee.trackId !== activeTrackId) return
    event.preventDefault()
    const point = lanePoint(event)
    setMarquee({ ...marquee, currentX: point.x, currentY: point.y })
  }

  const marqueePointerUp = (event: ReactPointerEvent<HTMLDivElement>, layout: TimelineTrackLayout) => {
    if (!marquee || marquee.pointerId !== event.pointerId || marquee.trackId !== layout.trackId) return
    const point = lanePoint(event)
    const selected = timelineWordIdsInRect(layout, {
      left: marquee.startX,
      top: marquee.startY,
      right: point.x,
      bottom: point.y,
    })
    const activeWordIds = new Set(activeTrackWords.map(({ word }) => word.id))
    const next = marquee.add
      ? new Set([...selectedWordIds].filter((wordId) => activeWordIds.has(wordId)))
      : new Set<string>()
    selected.forEach((wordId) => next.add(wordId))
    onSelectWords(next)
    setMarquee(null)
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const marqueePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId) return
    setMarquee(null)
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const marqueeCaptureLost = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId) return
    if (safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    setMarquee(null)
  }

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, word: LyricWord) => {
    if (word.startMs === null) return
    event.stopPropagation()
    const mode = (event.target as HTMLElement).dataset.resize as TimelinePointerGesture['mode'] | undefined
    const activeIds = selectedWordIds.has(word.id) && !mode ? new Set(selectedWordIds) : new Set([word.id])
    const drag: TimelinePointerGesture = {
      wordId: word.id,
      mode: mode ?? 'move',
      clientX: event.clientX,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      originalStart: word.startMs,
      originalEnd: word.endMs ?? word.startMs + 360,
      ids: activeIds,
      deltaMs: 0,
    }
    if (!gestureSessionRef.current!.begin(drag)) return
    if (!selectedWordIds.has(word.id)) onSelectWord(word.id, event.shiftKey || event.metaKey || event.ctrlKey)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      gestureSessionRef.current!.cancel(event.pointerId, event.currentTarget)
    }
  }

  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    gestureSessionRef.current!.move(event.pointerId, event.currentTarget, event.clientX)
  }

  const pointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!gestureSessionRef.current!.finish(event.pointerId, event.currentTarget)) return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const pointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!gestureSessionRef.current!.cancel(event.pointerId, event.currentTarget)) return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const lostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    gestureSessionRef.current!.captureLost(event.pointerId, event.currentTarget)
  }

  const wordKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    word: LyricWord,
    selected: boolean,
  ) => {
    const isEnter = event.key === 'Enter'
    const isSpace = event.key === ' ' || event.code === 'Space'
    const isBareSpace = isSpace
      && !event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    if ((!isEnter && !isBareSpace) || event.repeat) return
    // Bare Space owns tap-sync while synchronization is active. Enter remains
    // available for changing the editor selection without moving a timing block.
    // Modified Space chords bubble to the app-level shortcut handler.
    if (isBareSpace && syncMode) return
    event.preventDefault()
    event.stopPropagation()
    onSelectWord(
      word.id,
      selected || event.shiftKey || event.metaKey || event.ctrlKey,
    )
  }

  const untimedWords = project.tracks.flatMap((track) =>
    flattenTrack(track)
      .filter(({ word }) => word.startMs === null)
      .map(({ word }) => ({ word, track })),
  )
  const totalWordCount = project.tracks.reduce((total, track) => total + flattenTrack(track).length, 0)

  return (
    <section className="timeline-panel panel" aria-label="Lyric Timing">
      <header className="panel-header timeline-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon"><AudioWaveform size={16} /></span>
          <div>
            <span className="eyebrow">Precision editor</span>
            <h2>Lyric Timing</h2>
          </div>
        </div>
        <div className="timeline-tools">
          <div className="timeline-sync-tools" aria-label="Timing controls">
            <Button
              size="sm"
              variant={syncMode ? 'primary' : 'secondary'}
              title={syncMode ? 'Exit lyric synchronization (Escape)' : 'Start lyric synchronization from the playhead'}
              disabled={!activeTrackWords.length}
              onClick={onToggleSync}
            >
              <Zap size={13} fill="currentColor" /> {syncMode ? 'Exit sync' : 'Start sync'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Clear every timing in the active track; lyric text is preserved"
              disabled={!activeHasTiming}
              onClick={onClearTiming}
            >
              <RotateCcw size={13} /> Clear timing
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Clear active-track timings that begin at or after the playhead"
              disabled={!canClearAfterCursor}
              onClick={onClearTimingAfterCursor}
            >
              <TimerReset size={13} /> Clear from cursor
            </Button>
          </div>
          <span className="timeline-hint">Drag words · drag empty space to select · click ruler to seek</span>
          <div className="timeline-navigation" aria-label="Timeline navigation">
            <IconButton aria-label="Jump timeline view to start" onClick={() => viewportRef.current?.scrollTo({ left: 0, behavior: motionAwareScrollBehavior() })}>
              <SkipBack size={15} />
            </IconButton>
            <IconButton aria-label="Scroll timeline backward" onClick={() => viewportRef.current?.scrollBy({ left: -420, behavior: motionAwareScrollBehavior() })}>
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton aria-label="Scroll timeline forward" onClick={() => viewportRef.current?.scrollBy({ left: 420, behavior: motionAwareScrollBehavior() })}>
              <ChevronRight size={15} />
            </IconButton>
          </div>
          <div className="zoom-control">
            <Minus size={12} />
            <input
              aria-label="Timeline zoom"
              title="Zoom Lyric Timing horizontally"
              type="range"
              min="0.45"
              max="3.5"
              step="0.05"
              value={zoom}
              onChange={(event) => onZoom(Number(event.target.value))}
            />
            <Plus size={12} />
          </div>
          <span className="zoom-value"><ZoomIn size={12} />{Math.round(zoom * 100)}%</span>
        </div>
      </header>

      <div className="timeline-workspace">
        <div className="timeline-track-labels" style={{ '--track-count': project.tracks.length } as CSSProperties}>
          <div
            className="timeline-track-label-stack"
            style={{ transform: `translateY(${-timelineScrollTop}px)` }}
          >
            <div className="timeline-label-spacer">
              <span>Waveform</span>
              {isAnalyzing && <i>Analyzing…</i>}
            </div>
            {project.tracks.map((track, index) => (
              <div
                key={track.id}
                className={`timeline-track-label ${track.id === activeTrackId ? 'is-active' : ''}`}
                style={{ height: trackLayoutById.get(track.id)?.height ?? TIMELINE_MIN_TRACK_HEIGHT_PX }}
              >
                <span style={{
                  background: resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                }}>{index + 1}</span>
                <div><strong>{track.name}</strong><small>Voice {index + 1}</small></div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="timeline-viewport"
          ref={viewportRef}
          onScroll={(event) => setTimelineScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="timeline-canvas" style={{ width }}>
            <div className="timeline-ruler" onPointerDown={seekFromPointer}>
              {ticks.map((second) => (
                <span
                  key={second}
                  className={`timeline-tick ${second % labelStepSeconds === 0 ? 'is-major' : ''}`}
                  style={{ left: second * pixelsPerSecond }}
                >
                  {second % labelStepSeconds === 0 && <b>{formatTime(second * 1000)}</b>}
                </span>
              ))}
            </div>

            <div className="timeline-waveform" onPointerDown={seekFromPointer}>
              <svg viewBox={`0 0 ${Math.max(1, peaks.length - 1)} 76`} preserveAspectRatio="none" aria-hidden="true">
                <path d={waveformPath} />
              </svg>
              <div className="waveform-played" style={{ width: playheadLeft }} />
            </div>

            <div className="timeline-lanes">
              {project.tracks.map((track) => {
                const layout = trackLayoutById.get(track.id) ?? buildTimelineTrackLayout(
                  track,
                  project.offsetMs,
                  pixelsPerSecond,
                  timingDraft,
                )
                const activeMarquee = marquee?.trackId === track.id ? marquee : null
                return (
                  <div
                    key={track.id}
                    data-track-id={track.id}
                    className={`timeline-lane ${track.id === activeTrackId ? 'is-active' : ''}`}
                    style={{ height: layout.height }}
                    onPointerDown={(event) => marqueePointerDown(event, track.id)}
                    onPointerMove={marqueePointerMove}
                    onPointerUp={(event) => marqueePointerUp(event, layout)}
                    onPointerCancel={marqueePointerCancel}
                    onLostPointerCapture={marqueeCaptureLost}
                  >
                    {layout.lines.map((lineLayout) => (
                      <Fragment key={lineLayout.line.id}>
                        <span
                          className="line-region"
                          style={{
                            top: lineLayout.top,
                            left: lineLayout.intervalStart,
                            width: Math.max(1, lineLayout.intervalEnd - lineLayout.intervalStart),
                            height: lineLayout.height - 2,
                            '--track-color': resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                          } as CSSProperties}
                        />
                        <span
                          className="timeline-line-label"
                          style={{
                            top: lineLayout.top + TIMELINE_LABEL_TOP_PX,
                            left: lineLayout.labelLeft,
                            width: lineLayout.labelWidth,
                            '--track-color': resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                          } as CSSProperties}
                          aria-hidden="true"
                        >
                          {lineLayout.words.map((wordLayout) => (
                            <span
                              key={wordLayout.word.id}
                              className={`timeline-line-label__word ${selectedWordIds.has(wordLayout.word.id) ? 'is-selected' : ''} ${syncWordId === wordLayout.word.id ? 'is-sync-target' : ''}`}
                              style={{ width: wordLayout.labelWidth }}
                            >
                              {timelineWordLabel(wordLayout.word)}
                            </span>
                          ))}
                        </span>
                        {lineLayout.words.map((wordLayout) => {
                          const { word } = wordLayout
                          const draftTiming = timingDraft?.get(word.id)
                          const rawStart = draftTiming?.startMs ?? word.startMs ?? 0
                          const rawEnd = draftTiming?.endMs ?? word.endMs ?? rawStart + 360
                          const adjustedStart = Math.max(0, timelineTime(rawStart, project.offsetMs))
                          const adjustedEnd = timelineTime(rawEnd, project.offsetMs)
                          const timingLabel = `${formatTime(adjustedStart, true)}–${formatTime(adjustedEnd, true)}`
                          const selected = selectedWordIds.has(word.id)
                          return (
                            <button
                              key={word.id}
                              data-word-id={word.id}
                              className={`timeline-word ${wordLayout.width < 14 ? 'is-compact' : ''} ${selected ? 'is-selected' : ''} ${syncWordId === word.id ? 'is-sync-target' : ''}`}
                              style={{
                                top: wordLayout.top,
                                left: wordLayout.left,
                                width: wordLayout.width,
                                height: TIMELINE_WORD_HEIGHT_PX,
                                '--track-color': resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                              } as CSSProperties}
                              aria-label={`${timelineWordLabel(word)} timing block, ${timingLabel}`}
                              aria-pressed={selected}
                              title={`${timelineWordLabel(word)} · ${timingLabel}`}
                              onKeyDown={(event) => wordKeyDown(event, word, selected)}
                              onPointerDown={(event) => pointerDown(event, word)}
                              onPointerMove={pointerMove}
                              onPointerUp={pointerUp}
                              onPointerCancel={pointerCancel}
                              onLostPointerCapture={lostPointerCapture}
                              onDoubleClick={() => onSeek(Math.max(0, timelineTime(word.startMs ?? 0, project.offsetMs)))}
                            >
                              <i data-resize="start" className="timeline-word__handle timeline-word__handle--start" />
                              <i data-resize="end" className="timeline-word__handle timeline-word__handle--end" />
                            </button>
                          )
                        })}
                      </Fragment>
                    ))}
                    {activeMarquee && (
                      <span
                        className="timeline-marquee"
                        style={{
                          left: Math.min(activeMarquee.startX, activeMarquee.currentX),
                          top: Math.min(activeMarquee.startY, activeMarquee.currentY),
                          width: Math.abs(activeMarquee.currentX - activeMarquee.startX),
                          height: Math.abs(activeMarquee.currentY - activeMarquee.startY),
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                )
              })}
            </div>

            <div className="timeline-playhead" style={{ left: playheadLeft }} aria-hidden="true">
              <span>{formatTime(currentMs, true)}</span>
              <i />
            </div>
          </div>
        </div>
      </div>

      <div className={`untimed-tray ${untimedWords.length ? '' : 'untimed-tray--empty'}`}>
        <span className="untimed-tray__label">Untimed</span>
        <div>
          {untimedWords.length ? untimedWords.slice(0, 28).map(({ word, track }) => (
            <button
              key={word.id}
              className={`${syncWordId === word.id ? 'is-sync-target' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
              style={{
                '--track-color': resolveVocalSungColor(project.stageStyle, track.vocalStyle),
              } as CSSProperties}
              title={`Select untimed word: ${timelineWordLabel(word)}`}
              onClick={(event) => onSelectWord(word.id, event.shiftKey || event.metaKey || event.ctrlKey)}
            >{word.text.replaceAll('/', '·')}</button>
          )) : <span>{totalWordCount ? 'All words are timed.' : 'Add lyrics to start timing.'}</span>}
          {untimedWords.length > 28 && <em>+{untimedWords.length - 28}</em>}
        </div>
      </div>
    </section>
  )
}
