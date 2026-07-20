import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  AudioWaveform,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  SkipBack,
  TimerReset,
  Zap,
  ZoomIn,
} from 'lucide-react'
import type { KaraokeProject, LyricWord } from '../lib/model'
import { formatTime } from '../lib/model'
import { resolveVocalSungColor } from '../lib/video-style'
import { flattenTrack, motionAwareScrollBehavior, type ProjectTimingDraft } from '../utils'
import {
  buildTimelineTrackLayout,
  TIMELINE_LABEL_TOP_PX,
  TIMELINE_MIN_TRACK_HEIGHT_PX,
  TIMELINE_WORD_HEIGHT_PX,
  timelineTime,
  timelineWordIdsInRect,
  timelineWordLabel,
  type TimelineTrackLayout,
} from './timeline-geometry'
import {
  createTimelineGestureActivity,
  createTimelineGestureSession,
  safelyHasPointerCapture,
  safelyReleasePointerCapture,
  timelineGestureScopeKey,
  type TimelineGestureContext,
  type TimelinePointerGesture,
} from './timeline-gestures'
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
  onGestureActiveChange?: (active: boolean) => void
  onToggleSync: () => void
  onClearTiming: () => void
  onClearTimingAfterCursor: () => void
}

interface TimelineMarquee {
  trackId: string
  pointerId: number
  captureTarget: EventTarget
  scopeKey: string
  add: boolean
  startX: number
  startY: number
  currentX: number
  currentY: number
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
  onGestureActiveChange,
  onToggleSync,
  onClearTiming,
  onClearTimingAfterCursor,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [timingDraft, setTimingDraft] = useState<ProjectTimingDraft | null>(null)
  const [marquee, setMarquee] = useState<TimelineMarquee | null>(null)
  const marqueeRef = useRef<TimelineMarquee | null>(null)
  const mountedRef = useRef(true)
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  const pixelsPerSecond = 72 * zoom
  const trackLayouts = useMemo(
    () =>
      project.tracks.map((track) =>
        buildTimelineTrackLayout(track, project.offsetMs, pixelsPerSecond, timingDraft),
      ),
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
  const activeGestureScopeKey = useMemo(
    () => timelineGestureScopeKey(project.id, activeTrackId, activeTrack),
    [activeTrack, activeTrackId, project.id],
  )
  const activeTrackWords = activeTrack ? flattenTrack(activeTrack) : []
  const clearBoundaryMs = Math.max(0, currentMs - project.offsetMs)
  const activeHasTiming = Boolean(
    activeTrack?.lines.some(
      (line) =>
        line.startMs !== null ||
        line.endMs !== null ||
        line.words.some((word) => word.startMs !== null || word.endMs !== null),
    ),
  )
  const canClearAfterCursor =
    clearBoundaryMs === 0
      ? activeHasTiming
      : Boolean(
          activeTrack?.lines.some(
            (line) =>
              (line.words.every((word) => word.startMs === null && word.endMs === null) &&
                (line.startMs ?? -1) >= clearBoundaryMs) ||
              line.words.some((word) => (word.startMs ?? -1) >= clearBoundaryMs),
          ),
        )
  const gestureContextRef = useRef<TimelineGestureContext | null>(null)
  const gestureActiveCallbackRef = useRef(onGestureActiveChange)
  gestureActiveCallbackRef.current = onGestureActiveChange
  const gestureActivityRef = useRef<ReturnType<typeof createTimelineGestureActivity> | null>(null)
  if (!gestureActivityRef.current) {
    gestureActivityRef.current = createTimelineGestureActivity(
      () => gestureActiveCallbackRef.current,
    )
  }
  const timingGestureScopeRef = useRef<string | null>(null)
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

  const finishTimingActivity = (finished: boolean) => {
    if (!finished) return false
    timingGestureScopeRef.current = null
    gestureActivityRef.current!.end('timing')
    return true
  }

  const updateMarquee = (next: TimelineMarquee | null) => {
    marqueeRef.current = next
    if (mountedRef.current) setMarquee(next)
  }

  const clearMarquee = (pointerId?: number, eventTarget?: EventTarget | null) => {
    const activeMarquee = marqueeRef.current
    if (!activeMarquee || (pointerId !== undefined && activeMarquee.pointerId !== pointerId)) {
      return false
    }
    const targetDisconnected =
      activeMarquee.captureTarget instanceof Node && !activeMarquee.captureTarget.isConnected
    if (
      eventTarget !== undefined &&
      eventTarget !== activeMarquee.captureTarget &&
      !targetDisconnected
    ) {
      return false
    }
    updateMarquee(null)
    gestureActivityRef.current!.end('marquee')
    return true
  }
  const ticks = useMemo(
    () =>
      Array.from(
        { length: Math.ceil(durationMs / 1000 / tickStepSeconds) + 1 },
        (_, index) => index * tickStepSeconds,
      ),
    [durationMs, tickStepSeconds],
  )
  const waveformPath = useMemo(() => {
    const mid = 38
    const top = peaks.map((peak, index) => `${index},${mid - peak * 31}`).join(' L ')
    const bottom = [...peaks]
      .reverse()
      .map((peak, reverseIndex) => `${peaks.length - 1 - reverseIndex},${mid + peak * 31}`)
      .join(' L ')
    return `M 0,${mid} L ${top} L ${bottom} Z`
  }, [peaks])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const left = ((followBucket * 500) / 1000) * pixelsPerSecond
    const margin = 130
    if (
      left < viewport.scrollLeft + margin ||
      left > viewport.scrollLeft + viewport.clientWidth - margin
    ) {
      viewport.scrollTo({
        left: Math.max(0, left - viewport.clientWidth * 0.32),
        behavior: 'auto',
      })
    }
  }, [followBucket, pixelsPerSecond])

  useLayoutEffect(() => {
    if (
      timingGestureScopeRef.current !== null &&
      timingGestureScopeRef.current !== activeGestureScopeKey
    ) {
      const abandoned = gestureSessionRef.current!.abandon()
      if (abandoned) gestureContextRef.current!.onTimingDraftChange(null)
      finishTimingActivity(abandoned)
    } else {
      finishTimingActivity(gestureSessionRef.current!.invalidateProject(project))
    }
    if (marqueeRef.current && marqueeRef.current.scopeKey !== activeGestureScopeKey) {
      clearMarquee()
    }
  }, [activeGestureScopeKey, project])

  useEffect(() => {
    mountedRef.current = true
    const captureEnded = (event: Event) => {
      const pointerId = (event as PointerEvent).pointerId
      if (typeof pointerId !== 'number') return
      finishTimingActivity(gestureSessionRef.current!.captureLost(pointerId, event.target))
      clearMarquee(pointerId, event.target)
    }
    document.addEventListener('lostpointercapture', captureEnded, true)
    document.addEventListener('pointercancel', captureEnded, true)
    return () => {
      mountedRef.current = false
      document.removeEventListener('lostpointercapture', captureEnded, true)
      document.removeEventListener('pointercancel', captureEnded, true)
      if (gestureSessionRef.current!.abandon()) parentDraftCallbackRef.current(null)
      timingGestureScopeRef.current = null
      marqueeRef.current = null
      gestureActivityRef.current!.clear()
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
    if (
      trackId !== activeTrackId ||
      event.button !== 0 ||
      marqueeRef.current ||
      timingGestureScopeRef.current
    )
      return
    event.preventDefault()
    const point = lanePoint(event)
    const nextMarquee: TimelineMarquee = {
      trackId,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      scopeKey: activeGestureScopeKey,
      add: event.shiftKey || event.metaKey || event.ctrlKey,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    if (!safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    marqueeRef.current = nextMarquee
    if (!gestureActivityRef.current!.begin('marquee')) {
      marqueeRef.current = null
      safelyReleasePointerCapture(event.currentTarget, event.pointerId)
      return
    }
    if (mountedRef.current && marqueeRef.current === nextMarquee) setMarquee(nextMarquee)
  }

  const marqueePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeMarquee = marqueeRef.current
    if (
      !activeMarquee ||
      activeMarquee.pointerId !== event.pointerId ||
      activeMarquee.trackId !== activeTrackId
    )
      return
    event.preventDefault()
    const point = lanePoint(event)
    updateMarquee({ ...activeMarquee, currentX: point.x, currentY: point.y })
  }

  const marqueePointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
    layout: TimelineTrackLayout,
  ) => {
    const activeMarquee = marqueeRef.current
    if (
      !activeMarquee ||
      activeMarquee.pointerId !== event.pointerId ||
      activeMarquee.trackId !== layout.trackId
    )
      return
    const point = lanePoint(event)
    const selected = timelineWordIdsInRect(layout, {
      left: activeMarquee.startX,
      top: activeMarquee.startY,
      right: point.x,
      bottom: point.y,
    })
    const activeWordIds = new Set(activeTrackWords.map(({ word }) => word.id))
    const next = activeMarquee.add
      ? new Set([...selectedWordIds].filter((wordId) => activeWordIds.has(wordId)))
      : new Set<string>()
    selected.forEach((wordId) => next.add(wordId))
    onSelectWords(next)
    clearMarquee(event.pointerId, event.currentTarget)
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const marqueePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!clearMarquee(event.pointerId, event.currentTarget)) return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const marqueeCaptureLost = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (marqueeRef.current?.pointerId !== event.pointerId) return
    if (safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    clearMarquee(event.pointerId, event.currentTarget)
  }

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, word: LyricWord) => {
    if (word.startMs === null || marqueeRef.current) return
    event.stopPropagation()
    const mode = (event.target as HTMLElement).dataset.resize as
      TimelinePointerGesture['mode'] | undefined
    const activeIds =
      selectedWordIds.has(word.id) && !mode ? new Set(selectedWordIds) : new Set([word.id])
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
    timingGestureScopeRef.current = activeGestureScopeKey
    if (!selectedWordIds.has(word.id))
      onSelectWord(word.id, event.shiftKey || event.metaKey || event.ctrlKey)
    if (!gestureSessionRef.current!.owns(event.pointerId, event.currentTarget)) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      gestureSessionRef.current!.abandon()
      timingGestureScopeRef.current = null
      return
    }
    if (!safelyHasPointerCapture(event.currentTarget, event.pointerId)) {
      gestureSessionRef.current!.abandon()
      timingGestureScopeRef.current = null
      return
    }
    if (!gestureActivityRef.current!.begin('timing')) {
      gestureSessionRef.current!.abandon()
      timingGestureScopeRef.current = null
      safelyReleasePointerCapture(event.currentTarget, event.pointerId)
      return
    }
  }

  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    gestureSessionRef.current!.move(event.pointerId, event.currentTarget, event.clientX)
  }

  const pointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !finishTimingActivity(gestureSessionRef.current!.finish(event.pointerId, event.currentTarget))
    )
      return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const pointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      !finishTimingActivity(gestureSessionRef.current!.cancel(event.pointerId, event.currentTarget))
    )
      return
    safelyReleasePointerCapture(event.currentTarget, event.pointerId)
  }

  const lostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (safelyHasPointerCapture(event.currentTarget, event.pointerId)) return
    finishTimingActivity(
      gestureSessionRef.current!.captureLost(event.pointerId, event.currentTarget),
    )
  }

  const wordKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    word: LyricWord,
    selected: boolean,
  ) => {
    const isEnter = event.key === 'Enter'
    const isSpace = event.key === ' ' || event.code === 'Space'
    const isBareSpace =
      isSpace && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if ((!isEnter && !isBareSpace) || event.repeat) return
    // Bare Space owns tap-sync while synchronization is active. Enter remains
    // available for changing the editor selection without moving a timing block.
    // Modified Space chords bubble to the app-level shortcut handler.
    if (isBareSpace && syncMode) return
    event.preventDefault()
    event.stopPropagation()
    onSelectWord(word.id, selected || event.shiftKey || event.metaKey || event.ctrlKey)
  }

  const untimedWords = project.tracks.flatMap((track) =>
    flattenTrack(track)
      .filter(({ word }) => word.startMs === null)
      .map(({ word }) => ({ word, track })),
  )
  const totalWordCount = project.tracks.reduce(
    (total, track) => total + flattenTrack(track).length,
    0,
  )

  return (
    <section className="timeline-panel panel" aria-label="Lyric Timing">
      <header className="panel-header timeline-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <AudioWaveform size={16} />
          </span>
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
              title={
                syncMode
                  ? 'Exit lyric synchronization (Escape)'
                  : 'Start lyric synchronization from the playhead'
              }
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
          <span className="timeline-hint">
            Drag words · drag empty space to select · click ruler to seek
          </span>
          <div className="timeline-navigation" aria-label="Timeline navigation">
            <IconButton
              aria-label="Jump timeline view to start"
              onClick={() =>
                viewportRef.current?.scrollTo({ left: 0, behavior: motionAwareScrollBehavior() })
              }
            >
              <SkipBack size={15} />
            </IconButton>
            <IconButton
              aria-label="Scroll timeline backward"
              onClick={() =>
                viewportRef.current?.scrollBy({ left: -420, behavior: motionAwareScrollBehavior() })
              }
            >
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton
              aria-label="Scroll timeline forward"
              onClick={() =>
                viewportRef.current?.scrollBy({ left: 420, behavior: motionAwareScrollBehavior() })
              }
            >
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
          <span className="zoom-value">
            <ZoomIn size={12} />
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </header>

      <div className="timeline-workspace">
        <div
          className="timeline-track-labels"
          style={{ '--track-count': project.tracks.length } as CSSProperties}
        >
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
                style={{
                  height: trackLayoutById.get(track.id)?.height ?? TIMELINE_MIN_TRACK_HEIGHT_PX,
                }}
              >
                <span
                  style={{
                    background: resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                  }}
                >
                  {index + 1}
                </span>
                <div>
                  <strong>{track.name}</strong>
                  <small>Voice {index + 1}</small>
                </div>
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
              <svg
                viewBox={`0 0 ${Math.max(1, peaks.length - 1)} 76`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d={waveformPath} />
              </svg>
              <div className="waveform-played" style={{ width: playheadLeft }} />
            </div>

            <div className="timeline-lanes">
              {project.tracks.map((track) => {
                const layout =
                  trackLayoutById.get(track.id) ??
                  buildTimelineTrackLayout(track, project.offsetMs, pixelsPerSecond, timingDraft)
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
                          style={
                            {
                              top: lineLayout.top,
                              left: lineLayout.intervalStart,
                              width: Math.max(1, lineLayout.intervalEnd - lineLayout.intervalStart),
                              height: lineLayout.height - 2,
                              '--track-color': resolveVocalSungColor(
                                project.stageStyle,
                                track.vocalStyle,
                              ),
                            } as CSSProperties
                          }
                        />
                        <span
                          className="timeline-line-label"
                          style={
                            {
                              top: lineLayout.top + TIMELINE_LABEL_TOP_PX,
                              left: lineLayout.labelLeft,
                              width: lineLayout.labelWidth,
                              '--track-color': resolveVocalSungColor(
                                project.stageStyle,
                                track.vocalStyle,
                              ),
                            } as CSSProperties
                          }
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
                          const adjustedStart = Math.max(
                            0,
                            timelineTime(rawStart, project.offsetMs),
                          )
                          const adjustedEnd = timelineTime(rawEnd, project.offsetMs)
                          const timingLabel = `${formatTime(adjustedStart, true)}–${formatTime(adjustedEnd, true)}`
                          const selected = selectedWordIds.has(word.id)
                          return (
                            <button
                              key={word.id}
                              data-word-id={word.id}
                              className={`timeline-word ${wordLayout.width < 14 ? 'is-compact' : ''} ${selected ? 'is-selected' : ''} ${syncWordId === word.id ? 'is-sync-target' : ''}`}
                              style={
                                {
                                  top: wordLayout.top,
                                  left: wordLayout.left,
                                  width: wordLayout.width,
                                  height: TIMELINE_WORD_HEIGHT_PX,
                                  '--track-color': resolveVocalSungColor(
                                    project.stageStyle,
                                    track.vocalStyle,
                                  ),
                                } as CSSProperties
                              }
                              aria-label={`${timelineWordLabel(word)} timing block, ${timingLabel}`}
                              aria-pressed={selected}
                              title={`${timelineWordLabel(word)} · ${timingLabel}`}
                              onKeyDown={(event) => wordKeyDown(event, word, selected)}
                              onPointerDown={(event) => pointerDown(event, word)}
                              onPointerMove={pointerMove}
                              onPointerUp={pointerUp}
                              onPointerCancel={pointerCancel}
                              onLostPointerCapture={lostPointerCapture}
                              onDoubleClick={() =>
                                onSeek(
                                  Math.max(0, timelineTime(word.startMs ?? 0, project.offsetMs)),
                                )
                              }
                            >
                              <i
                                data-resize="start"
                                className="timeline-word__handle timeline-word__handle--start"
                              />
                              <i
                                data-resize="end"
                                className="timeline-word__handle timeline-word__handle--end"
                              />
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
          {untimedWords.length ? (
            untimedWords.slice(0, 28).map(({ word, track }) => (
              <button
                key={word.id}
                className={`${syncWordId === word.id ? 'is-sync-target' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
                style={
                  {
                    '--track-color': resolveVocalSungColor(project.stageStyle, track.vocalStyle),
                  } as CSSProperties
                }
                title={`Select untimed word: ${timelineWordLabel(word)}`}
                onClick={(event) =>
                  onSelectWord(word.id, event.shiftKey || event.metaKey || event.ctrlKey)
                }
              >
                {word.text.replaceAll('/', '·')}
              </button>
            ))
          ) : (
            <span>{totalWordCount ? 'All words are timed.' : 'Add lyrics to start timing.'}</span>
          )}
          {untimedWords.length > 28 && <em>+{untimedWords.length - 28}</em>}
        </div>
      </div>
    </section>
  )
}
