import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AudioWaveform, ChevronLeft, ChevronRight, Focus, Minus, Plus, ZoomIn } from 'lucide-react'
import type { KaraokeProject, LyricWord } from '../lib/model'
import { formatTime } from '../lib/model'
import { flattenTrack } from '../utils'
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
}

interface DragState {
  wordId: string
  mode: 'move' | 'start' | 'end'
  clientX: number
  originalStart: number
  originalEnd: number
  ids: Set<string>
  deltaMs: number
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
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [draft, setDraft] = useState<DragState | null>(null)
  const pixelsPerSecond = 72 * zoom
  const width = Math.max(1040, (durationMs / 1000) * pixelsPerSecond)
  const playheadLeft = (currentMs / 1000) * pixelsPerSecond
  const tickStepSeconds = zoom < 0.8 ? 5 : zoom < 1.7 ? 2 : 1
  const labelStepSeconds = zoom < 0.8 ? 10 : zoom < 1.7 ? 5 : 2
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

  const seekFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    onSeek(Math.round((x / pixelsPerSecond) * 1000))
  }

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, word: LyricWord) => {
    if (word.startMs === null) return
    event.stopPropagation()
    const mode = (event.target as HTMLElement).dataset.resize as DragState['mode'] | undefined
    const activeIds = selectedWordIds.has(word.id) && !mode ? new Set(selectedWordIds) : new Set([word.id])
    if (!selectedWordIds.has(word.id)) onSelectWord(word.id, event.shiftKey || event.metaKey)
    const drag: DragState = {
      wordId: word.id,
      mode: mode ?? 'move',
      clientX: event.clientX,
      originalStart: word.startMs,
      originalEnd: word.endMs ?? word.startMs + 360,
      ids: activeIds,
      deltaMs: 0,
    }
    dragRef.current = drag
    setDraft(drag)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const deltaMs = Math.round(((event.clientX - drag.clientX) / pixelsPerSecond) * 1000)
    const next = { ...drag, deltaMs }
    dragRef.current = next
    setDraft(next)
  }

  const pointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const minDuration = 80
    if (drag.mode === 'move') {
      onShiftWords(drag.ids, drag.deltaMs)
    } else if (drag.mode === 'start') {
      onResizeWord(drag.wordId, Math.max(0, Math.min(drag.originalEnd - minDuration, drag.originalStart + drag.deltaMs)), drag.originalEnd)
    } else {
      onResizeWord(drag.wordId, drag.originalStart, Math.max(drag.originalStart + minDuration, drag.originalEnd + drag.deltaMs))
    }
    dragRef.current = null
    setDraft(null)
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
                  {track.lines.map((line) =>
                    line.startMs !== null && line.endMs !== null ? (
                      <span
                        key={line.id}
                        className="line-region"
                        style={{
                          left: (line.startMs / 1000) * pixelsPerSecond,
                          width: Math.max(2, ((line.endMs - line.startMs) / 1000) * pixelsPerSecond),
                          '--track-color': track.color,
                        } as CSSProperties}
                      />
                    ) : null,
                  )}
                  {flattenTrack(track).map(({ word }) => {
                    if (word.startMs === null) return null
                    const endMs = word.endMs ?? word.startMs + 360
                    const isDraftWord = draft?.mode === 'move' ? draft.ids.has(word.id) : draft?.wordId === word.id
                    let draftStart = word.startMs
                    let draftEnd = endMs
                    if (isDraftWord && draft) {
                      if (draft.mode === 'move') {
                        draftStart = Math.max(0, word.startMs + draft.deltaMs)
                        draftEnd = draftStart + (endMs - word.startMs)
                      } else if (draft.mode === 'start') {
                        draftStart = Math.max(0, Math.min(draft.originalEnd - 80, draft.originalStart + draft.deltaMs))
                      } else {
                        draftEnd = Math.max(draft.originalStart + 80, draft.originalEnd + draft.deltaMs)
                      }
                    }
                    const left = (draftStart / 1000) * pixelsPerSecond
                    const blockWidth = Math.max(16, ((draftEnd - draftStart) / 1000) * pixelsPerSecond)
                    const selected = selectedWordIds.has(word.id)
                    return (
                      <button
                        key={word.id}
                        className={`timeline-word ${selected ? 'is-selected' : ''} ${syncWordId === word.id ? 'is-sync-target' : ''}`}
                        style={{ left, width: blockWidth, '--track-color': track.color } as CSSProperties}
                        title={`${word.text} · ${formatTime(draftStart, true)}–${formatTime(draftEnd, true)}`}
                        onPointerDown={(event) => pointerDown(event, word)}
                        onPointerMove={pointerMove}
                        onPointerUp={pointerUp}
                        onDoubleClick={() => onSeek(word.startMs ?? 0)}
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
