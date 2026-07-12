import { Gauge, Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, Zap } from 'lucide-react'
import { formatTime } from '../lib/model'
import { KeyboardKey } from './ui'

interface TransportBarProps {
  currentMs: number
  durationMs: number
  isPlaying: boolean
  rate: number
  volume: number
  syncMode: boolean
  syncPosition: number
  syncTotal: number
  hasAudio: boolean
  onToggle: () => void
  onSeek: (timeMs: number) => void
  onRate: (rate: number) => void
  onVolume: (volume: number) => void
  onToggleSync: () => void
}

export function TransportBar({
  currentMs,
  durationMs,
  isPlaying,
  rate,
  volume,
  syncMode,
  syncPosition,
  syncTotal,
  hasAudio,
  onToggle,
  onSeek,
  onRate,
  onVolume,
  onToggleSync,
}: TransportBarProps) {
  return (
    <footer className={`transport ${syncMode ? 'is-syncing' : ''}`}>
      <div className="transport__sync">
        <button className={`sync-button ${syncMode ? 'is-active' : ''}`} onClick={onToggleSync}>
          <span><Zap size={17} fill="currentColor" /></span>
          <div>
            <strong>{syncMode ? 'Syncing words' : 'Tap sync'}</strong>
            <small>{syncMode ? `${Math.min(syncPosition + 1, syncTotal)} of ${syncTotal}` : 'Time lyrics by feel'}</small>
          </div>
          <KeyboardKey>Space</KeyboardKey>
        </button>
      </div>

      <div className="transport__controls">
        <button className="transport-button" aria-label="Skip back five seconds" onClick={() => onSeek(currentMs - 5000)}>
          <RotateCcw size={18} />
          <small>5</small>
        </button>
        <button className="play-button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={onToggle}>
          {isPlaying ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}
        </button>
        <button className="transport-button" aria-label="Skip forward five seconds" onClick={() => onSeek(currentMs + 5000)}>
          <RotateCw size={18} />
          <small>5</small>
        </button>
        <div className="time-readout">
          <strong>{formatTime(currentMs, true)}</strong>
          <span>/</span>
          <em>{formatTime(durationMs, true)}</em>
        </div>
      </div>

      <div className="transport__settings">
        <div className="transport-status">
          <i className={hasAudio ? 'is-linked' : ''} />
          <span>{hasAudio ? 'Audio linked' : 'Demo clock'}</span>
        </div>
        <label className="speed-control">
          <Gauge size={15} />
          <select aria-label="Playback speed" value={rate} onChange={(event) => onRate(Number(event.target.value))}>
            <option value="0.5">0.5×</option>
            <option value="0.75">0.75×</option>
            <option value="0.9">0.9×</option>
            <option value="1">1.0×</option>
            <option value="1.1">1.1×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
          </select>
        </label>
        <label className="volume-control">
          {volume > 0.5 ? <Volume2 size={16} /> : <Volume1 size={16} />}
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
        </label>
      </div>
    </footer>
  )
}
