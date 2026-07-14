import { useMemo, type CSSProperties } from 'react'
import { Edit3, MonitorPlay, ShieldCheck } from 'lucide-react'
import type { KaraokeProject, LyricDisplaySettings, LyricLine, LyricWord, VocalTrack } from '../lib/model'
import { formatTime, planLyricDisplayLines } from '../lib/model'
import { Button } from './ui'

interface KaraokePreviewProps {
  project: KaraokeProject
  playbackMs: number
  lyricMs: number
  selectedWordIds: Set<string>
  onUpdateLyricDisplay?: (patch: Partial<LyricDisplaySettings>) => void
  onEditLyrics?: () => void
}

function wordProgress(word: LyricWord, currentMs: number) {
  if (word.startMs === null) return 0
  const endMs = word.endMs ?? word.startMs + 350
  if (currentMs <= word.startMs) return 0
  if (currentMs >= endMs) return 1
  return (currentMs - word.startMs) / Math.max(1, endMs - word.startMs)
}

function adjustedLineStart(line: LyricLine, offsetMs: number) {
  const timedWords = line.words.filter(
    (word) => word.startMs !== null && word.endMs !== null,
  )
  const startMs = line.startMs ?? timedWords[0]?.startMs ?? null
  const endMs = line.endMs ?? timedWords.at(-1)?.endMs ?? null
  if (startMs === null || endMs === null || endMs <= startMs) return null
  const adjustedStartMs = Math.max(0, startMs + offsetMs)
  if (endMs + offsetMs <= adjustedStartMs) return null
  return adjustedStartMs
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

export function KaraokePreview({
  project,
  playbackMs,
  lyricMs,
  selectedWordIds,
  onUpdateLyricDisplay,
  onEditLyrics,
}: KaraokePreviewProps) {
  const unmutedTracks = useMemo(
    () => project.tracks.filter((track) => !track.muted),
    [project.tracks],
  )
  const visibleTracks = useMemo(() => {
    const hasSolo = unmutedTracks.some((track) => track.solo)
    return hasSolo ? unmutedTracks.filter((track) => track.solo) : unmutedTracks
  }, [unmutedTracks])
  const trackWindows = visibleTracks.map((track) => ({
    track,
    lines: planLyricDisplayLines(track, lyricMs, project.lyricDisplay),
  }))
  const displayLines: Array<{ track: VocalTrack; line: LyricLine }> = []
  for (
    let lineIndex = 0;
    lineIndex < project.lyricDisplay.lineCount && displayLines.length < project.lyricDisplay.lineCount;
    lineIndex += 1
  ) {
    trackWindows.forEach(({ track, lines }) => {
      const line = lines[lineIndex]
      if (line && displayLines.length < project.lyricDisplay.lineCount) {
        displayLines.push({ track, line })
      }
    })
  }
  const firstTimedLineStart = useMemo(() => Math.min(
    ...visibleTracks.flatMap((track) =>
      track.lines.flatMap((line) => {
        const startMs = adjustedLineStart(line, project.offsetMs)
        return startMs === null ? [] : [startMs]
      }),
    ),
    Number.POSITIVE_INFINITY,
  ), [project.offsetMs, visibleTracks])
  const showTitle = !Number.isFinite(firstTimedLineStart) ||
    playbackMs < Math.max(0, firstTimedLineStart - 1_500)

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
        <div className="preview-toolbar">
          <label className="preview-setting">
            <span>Lines</span>
            <select
              aria-label="Visible lyric lines"
              title="Choose how many lyric lines appear in the preview and exported video"
              value={project.lyricDisplay.lineCount}
              onChange={(event) => onUpdateLyricDisplay?.({ lineCount: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label className="preview-setting">
            <span>Advance</span>
            <select
              aria-label="Lyric line advance mode"
              title="Clear replaces a page; Scroll advances one line at a time within a section"
              value={project.lyricDisplay.advanceMode}
              onChange={(event) => onUpdateLyricDisplay?.({
                advanceMode: event.target.value as LyricDisplaySettings['advanceMode'],
              })}
            >
              <option value="clear">Clear</option>
              <option value="scroll">Scroll</option>
            </select>
          </label>
          {onEditLyrics && (
            <Button size="sm" variant="ghost" title="Open the lyric text editor" onClick={onEditLyrics}>
              <Edit3 size={13} /> Edit text
            </Button>
          )}
          <div className="preview-badges">
            <span className="status-pill status-pill--live"><i /> Live</span>
            <span className="status-pill"><ShieldCheck size={12} /> Title safe</span>
          </div>
        </div>
      </header>

      <div className={`karaoke-stage karaoke-stage--lines-${project.lyricDisplay.lineCount} ${displayLines.length > 5 ? 'karaoke-stage--dense' : ''}`}>
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
          ) : displayLines.length ? (
            <div className={`active-lines ${visibleTracks.length > 1 ? 'active-lines--duet' : ''}`}>
              {displayLines.map(({ line, track }) => (
                <PreviewLine
                  key={`${track.id}-${line.id}`}
                  line={line}
                  track={track}
                  lyricMs={lyricMs}
                  selectedWordIds={selectedWordIds}
                />
              ))}
            </div>
          ) : null}

        </div>

        <div className="karaoke-stage__footer">
          <span>{project.artist || 'Performer'} · {project.title || 'Untitled'}</span>
        </div>
      </div>
    </section>
  )
}
