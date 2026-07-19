import { useMemo } from 'react'
import { Edit3, Radio, Zap } from 'lucide-react'
import type { VocalTrack } from '../lib/model'
import { flattenTrack } from '../utils'
import { Button, KeyboardKey } from './ui'

interface SyncCueStripProps {
  track: VocalTrack
  syncCursor: number
  onEditLyrics: () => void
}

export function SyncCueStrip({ track, syncCursor, onEditLyrics }: SyncCueStripProps) {
  const words = useMemo(() => flattenTrack(track), [track])
  const current = words[syncCursor] ?? null
  const currentLineIndex = current?.lineIndex ?? -1
  const visibleLines =
    currentLineIndex >= 0
      ? [
          track.lines[currentLineIndex],
          track.lines.slice(currentLineIndex + 1).find((line) => line.words.length > 0),
        ].filter((line): line is VocalTrack['lines'][number] => Boolean(line))
      : []

  return (
    <section className="sync-cue panel" aria-label="Synchronization focus">
      <header className="panel-header sync-cue__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <Radio size={16} />
          </span>
          <div>
            <span className="eyebrow">Low-latency timing view</span>
            <h2>Sync focus</h2>
          </div>
        </div>
        <div className="sync-cue__actions">
          <span>
            <Zap size={12} /> Word {Math.min(syncCursor + 1, words.length)} of {words.length}
          </span>
          <Button
            size="sm"
            variant="ghost"
            title="Open the lyric text editor"
            onClick={onEditLyrics}
          >
            <Edit3 size={13} /> Edit text
          </Button>
        </div>
      </header>

      <div className="sync-cue__lines">
        {visibleLines.map((line, lineOffset) => (
          <div
            key={line.id}
            className={`sync-cue__line ${lineOffset === 0 ? 'is-current' : 'is-next'}`}
          >
            <span>{lineOffset === 0 ? 'Now' : 'Next'}</span>
            <p>
              {line.words.map((word) => (
                <b
                  key={word.id}
                  className={`${word.id === current?.word.id ? 'is-target' : ''} ${word.startMs !== null ? 'is-timed' : ''}`}
                >
                  {word.text.replaceAll('/', '·')}
                </b>
              ))}
            </p>
          </div>
        ))}
      </div>

      <footer className="sync-cue__help">
        <KeyboardKey>Space</KeyboardKey>
        <span>
          Press at each word onset. The next press closes the previous word; hold the final word of
          a line to extend it.
        </span>
      </footer>
    </section>
  )
}
