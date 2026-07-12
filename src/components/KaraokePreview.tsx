import type { CSSProperties } from 'react'
import { MonitorPlay, ShieldCheck } from 'lucide-react'
import type { KaraokeProject, LyricLine, LyricWord, VocalTrack } from '../lib/model'
import { formatTime } from '../lib/model'
import { getActiveLine, lineProgress } from '../utils'

interface KaraokePreviewProps {
  project: KaraokeProject
  playbackMs: number
  lyricMs: number
  selectedWordIds: Set<string>
}

function wordProgress(word: LyricWord, currentMs: number) {
  if (word.startMs === null) return 0
  const endMs = word.endMs ?? word.startMs + 350
  if (currentMs <= word.startMs) return 0
  if (currentMs >= endMs) return 1
  return (currentMs - word.startMs) / Math.max(1, endMs - word.startMs)
}

function lineAfter(track: VocalTrack, active: LyricLine | null, currentMs: number) {
  const index = active ? track.lines.findIndex((line) => line.id === active.id) : -1
  if (index >= 0) return track.lines[index + 1] ?? null
  return track.lines.find((line) => line.startMs !== null && line.startMs > currentMs) ?? track.lines[0] ?? null
}

function PreviewLine({
  line,
  track,
  lyricMs,
  selectedWordIds,
}: {
  line: LyricLine
  track: VocalTrack
  lyricMs: number
  selectedWordIds: Set<string>
}) {
  return (
    <div className="stage-line" style={{ '--track-color': track.color } as CSSProperties}>
      <span className="stage-line__artist">{track.name}</span>
      <p>
        {line.words.map((word) => {
          const progress = wordProgress(word, lyricMs)
          return (
            <span
              key={word.id}
              className={`stage-word ${progress >= 1 ? 'is-done' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
              style={{ '--word-progress': `${progress * 100}%` } as CSSProperties}
            >
              {word.text.replaceAll('/', '·')}{' '}
            </span>
          )
        })}
      </p>
    </div>
  )
}

export function KaraokePreview({ project, playbackMs, lyricMs, selectedWordIds }: KaraokePreviewProps) {
  const unmutedTracks = project.tracks.filter((track) => !track.muted)
  const hasSolo = unmutedTracks.some((track) => track.solo)
  const visibleTracks = hasSolo
    ? unmutedTracks.filter((track) => track.solo)
    : unmutedTracks
  const active = visibleTracks
    .map((track) => ({ track, line: getActiveLine(track, lyricMs) }))
    .filter((item): item is { track: VocalTrack; line: LyricLine } => Boolean(item.line))
  const next = visibleTracks
    .map((track) => ({ track, line: lineAfter(track, getActiveLine(track, lyricMs), lyricMs) }))
    .find((item) => item.line)
  const firstTimedWord = Math.min(
    ...visibleTracks.flatMap((track) =>
      track.lines.flatMap((line) => line.words.flatMap((word) => (word.startMs === null ? [] : [word.startMs]))),
    ),
    Number.POSITIVE_INFINITY,
  )
  const showTitle = active.length === 0 && lyricMs < firstTimedWord - 1500
  const primaryProgress = active[0] ? lineProgress(active[0].line, lyricMs) : 0

  return (
    <section className="preview-panel panel" aria-label="Karaoke preview">
      <header className="panel-header preview-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon"><MonitorPlay size={16} /></span>
          <div>
            <span className="eyebrow">Stage monitor</span>
            <h2>Live preview</h2>
          </div>
        </div>
        <div className="preview-badges">
          <span className="status-pill status-pill--live"><i /> Live</span>
          <span className="status-pill"><ShieldCheck size={12} /> Title safe</span>
        </div>
      </header>

      <div className="karaoke-stage">
        <div className="karaoke-stage__glow karaoke-stage__glow--one" />
        <div className="karaoke-stage__glow karaoke-stage__glow--two" />
        <div className="karaoke-stage__grain" />
        <div className="karaoke-stage__safe-area" aria-hidden="true" />
        <div className="karaoke-stage__brand">OKAY / STUDIO</div>
        <div className="karaoke-stage__time">{formatTime(playbackMs)}</div>

        <div className="karaoke-stage__content">
          {showTitle ? (
            <div className="title-card">
              <span>Tonight's performance</span>
              <h3>{project.title || 'Untitled song'}</h3>
              <p>{project.artist || 'Unknown artist'}</p>
              <i />
            </div>
          ) : active.length ? (
            <div className={`active-lines ${active.length > 1 ? 'active-lines--duet' : ''}`}>
              {active.map(({ line, track }) => (
                <PreviewLine
                  key={`${track.id}-${line.id}`}
                  line={line}
                  track={track}
                  lyricMs={lyricMs}
                  selectedWordIds={selectedWordIds}
                />
              ))}
            </div>
          ) : (
            <div className="instrumental-break">
              <span>Instrumental</span>
              <i /><i /><i /><i />
            </div>
          )}

          {next?.line && !showTitle && (
            <p className="next-line">{next.line.text.replaceAll('/', '·')}</p>
          )}
        </div>

        <div className="karaoke-stage__footer">
          <span>{project.artist || 'Performer'} · {project.title || 'Untitled'}</span>
          <span className="stage-progress"><i style={{ width: `${primaryProgress * 100}%` }} /></span>
        </div>
      </div>
    </section>
  )
}
