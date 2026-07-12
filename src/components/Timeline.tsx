import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AudioWaveform, ChevronLeft, ChevronRight, Focus, Minus, Plus, ZoomIn } from 'lucide-react'
import type { KaraokeProject, LyricWord } from '../lib/model'
import { formatTime } from '../lib/model'
import { flattenTrack, type ProjectTimingDraft } from '../utils'
import { IconButton } from './ui'

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
  onSeek: (timeMs: number) => void
  onZoom: (zoom: number) => void
  onSelectWord: (wordId: string, add: boolean) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
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
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (!gesture.ids.has(word.id) || word.startMs === null) return
          const duration = Math.max(80, (word.endMs ?? word.startMs + 300) - word.startMs)
          const startMs = Math.max(0, Math.round(word.startMs + gesture.deltaMs))
          timingDraft.set(word.id, { startMs, endMs: startMs + duration })
        })
      })
    })
    return timingDraft
  }

  const minDuration = 80
  if (gesture.mode === 'start') {
    timingDraft.set(gesture.wordId, {
      startMs: Math.max(0, Math.min(gesture.originalEnd - minDuration, gesture.originalStart + gesture.deltaMs)),
      endMs: gesture.originalEnd,
    })
  } else {
    timingDraft.set(gesture.wordId, {
      startMs: gesture.originalStart,
      endMs: Math.max(gesture.originalStart + minDuration, gesture.originalEnd + gesture.deltaMs),
    })
  }
  return timingDraft
}

export function createTimelineGestureSession(
  getContext: () => TimelineGestureContext,
) {
  let active: TimelinePointerGesture | null = null

  const clear = (pointerId: number, captureTarget: EventTarget) => {
    if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return null
    const gesture = active
    active = null
    getContext().onTimingDraftChange(null)
    return gesture
  }

  return {
    begin(gesture: TimelinePointerGesture) {
      if (active) return false
      active = gesture
      return true
    },
    move(pointerId: number, captureTarget: EventTarget, clientX: number) {
      if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return false
      const context = getContext()
      const deltaMs = Math.round(((clientX - active.clientX) / context.pixelsPerSecond) * 1000)
      active = { ...active, deltaMs }
      context.onTimingDraftChange(timingDraftForGesture(context.project, active))
      return true
    },
    finish(pointerId: number, captureTarget: EventTarget) {
      const gesture = clear(pointerId, captureTarget)
      if (!gesture) return false

      const context = getContext()
      if (gesture.mode === 'move') {
        if (gesture.deltaMs !== 0) context.onShiftWords(gesture.ids, gesture.deltaMs)
        return true
      }

      if (gesture.deltaMs === 0) return true

      const minDuration = 80
      const startMs = gesture.mode === 'start'
        ? Math.max(0, Math.min(gesture.originalEnd - minDuration, gesture.originalStart + gesture.deltaMs))
        : gesture.originalStart
      const endMs = gesture.mode === 'end'
        ? Math.max(gesture.originalStart + minDuration, gesture.originalEnd + gesture.deltaMs)
        : gesture.originalEnd
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
    abandon() {
      const hadActiveGesture = active !== null
      active = null
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
  onSeek,
  onZoom,
  onSelectWord,
  onShiftWords,
  onResizeWord,
  onTimingDraftChange,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [timingDraft, setTimingDraft] = useState<ProjectTimingDraft | null>(null)
  const pixelsPerSecond = 72 * zoom
  const width = Math.max(1040, (durationMs / 1000) * pixelsPerSecond)
  const playheadLeft = (currentMs / 1000) * pixelsPerSecond
  const tickStepSeconds = zoom < 0.8 ? 5 : zoom < 1.7 ? 2 : 1
  const labelStepSeconds = zoom < 0.8 ? 10 : zoom < 1.7 ? 5 : 2
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
    const left = playheadLeft
    const margin = 130
    if (left < viewport.scrollLeft + margin || left > viewport.scrollLeft + viewport.clientWidth - margin) {
      viewport.scrollTo({ left: Math.max(0, left - viewport.clientWidth * 0.32), behavior: 'smooth' })
    }
  }, [Math.floor(currentMs / 500), playheadLeft])

  useEffect(() => () => {
    if (gestureSessionRef.current?.abandon()) parentDraftCallbackRef.current(null)
  }, [])

  const seekFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    onSeek(Math.round((x / pixelsPerSecond) * 1000))
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
    if (!selectedWordIds.has(word.id)) onSelectWord(word.id, event.shiftKey || event.metaKey)
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
    gestureSessionRef.current!.cancel(event.pointerId, event.currentTarget)
  }

  const untimedWords = project.tracks.flatMap((track) =>
    flattenTrack(track)
      .filter(({ word }) => word.startMs === null)
      .map(({ word }) => ({ word, track })),
  )

  return (
    <section className="timeline-panel panel" aria-label="TimeBoard">
      <header className="panel-header timeline-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon"><AudioWaveform size={16} /></span>
          <div>
            <span className="eyebrow">Precision editor</span>
            <h2>TimeBoard</h2>
          </div>
        </div>
        <div className="timeline-tools">
          <span className="timeline-hint">Drag words · resize edges · click ruler to seek</span>
          <IconButton aria-label="Scroll timeline left" onClick={() => viewportRef.current?.scrollBy({ left: -420, behavior: 'smooth' })}>
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton aria-label="Center playhead" onClick={() => viewportRef.current?.scrollTo({ left: Math.max(0, playheadLeft - (viewportRef.current?.clientWidth ?? 0) / 2), behavior: 'smooth' })}>
            <Focus size={15} />
          </IconButton>
          <IconButton aria-label="Scroll timeline right" onClick={() => viewportRef.current?.scrollBy({ left: 420, behavior: 'smooth' })}>
            <ChevronRight size={15} />
          </IconButton>
          <div className="zoom-control">
            <Minus size={12} />
            <input
              aria-label="Timeline zoom"
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
          <div className="timeline-label-spacer">
            <span>Waveform</span>
            {isAnalyzing && <i>Analyzing…</i>}
          </div>
          {project.tracks.map((track, index) => (
            <div key={track.id} className={`timeline-track-label ${track.id === activeTrackId ? 'is-active' : ''}`}>
              <span style={{ background: track.color }}>{index + 1}</span>
              <div><strong>{track.name}</strong><small>Voice {index + 1}</small></div>
            </div>
          ))}
        </div>

        <div className="timeline-viewport" ref={viewportRef}>
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
              {project.tracks.map((track) => (
                <div key={track.id} className={`timeline-lane ${track.id === activeTrackId ? 'is-active' : ''}`}>
                  {track.lines.map((line) => {
                    if (line.startMs === null || line.endMs === null) return null
                    const adjustedStart = timelineTime(line.startMs, project.offsetMs)
                    const adjustedEnd = timelineTime(line.endMs, project.offsetMs)
                    if (adjustedEnd <= 0) return null
                    const visibleStart = Math.max(0, adjustedStart)
                    return (
                      <span
                        key={line.id}
                        className="line-region"
                        style={{
                          left: (visibleStart / 1000) * pixelsPerSecond,
                          width: Math.max(2, ((adjustedEnd - visibleStart) / 1000) * pixelsPerSecond),
                          '--track-color': track.color,
                        } as CSSProperties}
                      />
                    )
                  })}
                  {flattenTrack(track).map(({ word }) => {
                    if (word.startMs === null) return null
                    const endMs = word.endMs ?? word.startMs + 360
                    const draftTiming = timingDraft?.get(word.id)
                    const draftStart = draftTiming?.startMs ?? word.startMs
                    const draftEnd = draftTiming?.endMs ?? endMs
                    const adjustedStart = timelineTime(draftStart, project.offsetMs)
                    const adjustedEnd = timelineTime(draftEnd, project.offsetMs)
                    if (adjustedEnd <= 0) return null
                    const visibleStart = Math.max(0, adjustedStart)
                    const left = (visibleStart / 1000) * pixelsPerSecond
                    const blockWidth = Math.max(16, ((adjustedEnd - visibleStart) / 1000) * pixelsPerSecond)
                    const selected = selectedWordIds.has(word.id)
                    return (
                      <button
                        key={word.id}
                        className={`timeline-word ${selected ? 'is-selected' : ''} ${syncWordId === word.id ? 'is-sync-target' : ''}`}
                        style={{ left, width: blockWidth, '--track-color': track.color } as CSSProperties}
                        title={`${word.text} · ${formatTime(visibleStart, true)}–${formatTime(adjustedEnd, true)}`}
                        onPointerDown={(event) => pointerDown(event, word)}
                        onPointerMove={pointerMove}
                        onPointerUp={pointerUp}
                        onPointerCancel={pointerCancel}
                        onLostPointerCapture={lostPointerCapture}
                        onDoubleClick={() => onSeek(Math.max(0, timelineTime(word.startMs ?? 0, project.offsetMs)))}
                      >
                        <i data-resize="start" className="timeline-word__handle timeline-word__handle--start" />
                        <span>{word.text.replaceAll('/', '·')}</span>
                        <i data-resize="end" className="timeline-word__handle timeline-word__handle--end" />
                      </button>
                    )
                  })}
                </div>
              ))}
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
              className={syncWordId === word.id ? 'is-sync-target' : ''}
              style={{ '--track-color': track.color } as CSSProperties}
              onClick={(event) => onSelectWord(word.id, event.shiftKey || event.metaKey)}
            >{word.text.replaceAll('/', '·')}</button>
          )) : <span>Everything is on the board. Nice work.</span>}
          {untimedWords.length > 28 && <em>+{untimedWords.length - 28}</em>}
        </div>
      </div>
    </section>
  )
}
