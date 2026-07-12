import { useEffect, useMemo, useRef } from 'react'
import { Captions, Check, Edit3, Mic2, TimerReset } from 'lucide-react'
import type { LyricWord, VocalTrack } from '../lib/model'
import { formatTime } from '../lib/model'
import { flattenTrack, getActiveLine } from '../utils'
import { Button } from './ui'

interface LyricsPanelProps {
  tracks: VocalTrack[]
  activeTrackId: string
  currentMs: number
  selectedWordIds: Set<string>
  syncWordId: string | null
  onSelectTrack: (trackId: string) => void
  onSelectWord: (word: LyricWord, add: boolean) => void
  onEditLyrics: () => void
}

export function LyricsPanel({
  tracks,
  activeTrackId,
  currentMs,
  selectedWordIds,
  syncWordId,
  onSelectTrack,
  onSelectWord,
  onEditLyrics,
}: LyricsPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeTrack = tracks.find((track) => track.id === activeTrackId) ?? tracks[0]
  const activeLine = activeTrack ? getActiveLine(activeTrack, currentMs) : null
  const words = useMemo(() => (activeTrack ? flattenTrack(activeTrack) : []), [activeTrack])
  const timedCount = words.filter(({ word }) => word.startMs !== null).length

  useEffect(() => {
    if (!activeLine || !listRef.current) return
    const element = listRef.current.querySelector<HTMLElement>(`[data-line-id="${activeLine.id}"]`)
    element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeLine?.id])

  if (!activeTrack) return null

  return (
    <section className="lyrics-panel panel" aria-label="Lyrics editor">
      <header className="panel-header lyrics-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon"><Captions size={16} /></span>
          <div>
            <span className="eyebrow">Word map</span>
            <h2>Lyrics</h2>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onEditLyrics}>
          <Edit3 size={14} /> Edit text
        </Button>
      </header>

      <div className="track-tabs" role="tablist" aria-label="Vocal tracks">
        {tracks.map((track, index) => (
          <button
            key={track.id}
            className={`track-tab ${track.id === activeTrack.id ? 'is-active' : ''}`}
            onClick={() => onSelectTrack(track.id)}
            role="tab"
            aria-selected={track.id === activeTrack.id}
          >
            <span style={{ background: track.color }}><Mic2 size={12} /></span>
            <b>{index + 1}</b>
            {track.name}
          </button>
        ))}
      </div>

      <div className="lyrics-progress">
        <div>
          <strong>{timedCount}</strong>
          <span>of {words.length} words timed</span>
        </div>
        <span className="lyrics-progress__bar">
          <i style={{ width: `${words.length ? (timedCount / words.length) * 100 : 0}%`, background: activeTrack.color }} />
        </span>
      </div>

      <div className="lyrics-list" ref={listRef}>
        {activeTrack.lines.map((line, lineIndex) => {
          const isActive = line.id === activeLine?.id
          const lineTimed = line.words.filter((word) => word.startMs !== null).length
          return (
            <article
              key={line.id}
              data-line-id={line.id}
              className={`lyric-line ${isActive ? 'is-active' : ''}`}
            >
              <div className="lyric-line__meta">
                <span>{String(lineIndex + 1).padStart(2, '0')}</span>
                {line.startMs !== null ? (
                  <button onClick={() => line.startMs !== null && onSelectWord(line.words[0], false)}>
                    {formatTime(line.startMs, true)}
                  </button>
                ) : (
                  <span className="untimed-label"><TimerReset size={11} /> Untimed</span>
                )}
                {lineTimed === line.words.length && line.words.length > 0 && <Check size={12} className="line-check" />}
              </div>
              <p className="lyric-line__words">
                {line.words.map((word) => {
                  const selected = selectedWordIds.has(word.id)
                  const isSyncWord = syncWordId === word.id
                  const isPast = word.endMs !== null && currentMs >= word.endMs
                  const isCurrent = word.startMs !== null && currentMs >= word.startMs && currentMs <= (word.endMs ?? word.startMs + 350)
                  return (
                    <button
                      key={word.id}
                      className={`lyric-word ${selected ? 'is-selected' : ''} ${isSyncWord ? 'is-sync-target' : ''} ${isPast ? 'is-past' : ''} ${isCurrent ? 'is-current' : ''} ${word.startMs === null ? 'is-untimed' : ''}`}
                      onClick={(event) => onSelectWord(word, event.shiftKey || event.metaKey)}
                      title={word.startMs === null ? 'Not timed yet' : `${formatTime(word.startMs, true)} – ${formatTime(word.endMs ?? word.startMs, true)}`}
                    >
                      {word.text.replaceAll('/', '·')}
                    </button>
                  )
                })}
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
