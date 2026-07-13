import { memo, useMemo } from 'react'
import { FileAudio2, Import, Mic2, Music2, SlidersHorizontal, UsersRound } from 'lucide-react'
import type { KaraokeProject, VocalTrack } from '../lib/model'
import { formatTime } from '../lib/model'
import { effectiveDuration, flattenProject, flattenTrack } from '../utils'
import { Button } from './ui'

interface InspectorPanelProps {
  project: KaraokeProject
  activeTrackId: string
  onSelectTrack: (trackId: string) => void
  onUpdateProject: (patch: Partial<Pick<KaraokeProject, 'title' | 'artist' | 'offsetMs'>>) => void
  onUpdateTrack: (trackId: string, patch: Partial<Pick<VocalTrack, 'name' | 'color' | 'muted' | 'solo'>>) => void
  onImportAudio: () => void
  onImportLrc: () => void
}

export const InspectorPanel = memo(function InspectorPanel({
  project,
  activeTrackId,
  onSelectTrack,
  onUpdateProject,
  onUpdateTrack,
  onImportAudio,
  onImportLrc,
}: InspectorPanelProps) {
  const allWords = useMemo(() => flattenProject(project), [project.tracks])
  const trackStats = useMemo(() => new Map(project.tracks.map((track) => {
    const words = flattenTrack(track)
    return [track.id, {
      total: words.length,
      complete: words.filter(({ word }) => word.startMs !== null).length,
    }]
  })), [project.tracks])
  const untimed = allWords.filter(({ word }) => word.startMs === null).length
  return (
    <aside className="inspector panel" aria-label="Project inspector">
      <header className="panel-header">
        <div className="panel-title">
          <span className="panel-title__icon"><SlidersHorizontal size={16} /></span>
          <div>
            <span className="eyebrow">Document</span>
            <h2>Project</h2>
          </div>
        </div>
      </header>

      <div className="inspector__scroll">
        <section className="inspector-section">
          <div className="inspector-section__title">
            <span>Song details</span>
            <Music2 size={13} />
          </div>
          <label className="field">
            <span>Title</span>
            <input
              value={project.title}
              placeholder="Untitled song"
              onChange={(event) => onUpdateProject({ title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Artist</span>
            <input
              value={project.artist}
              placeholder="Unknown artist"
              onChange={(event) => onUpdateProject({ artist: event.target.value })}
            />
          </label>
          <label className="field field--inline">
            <span>Global offset</span>
            <div>
              <input
                type="number"
                step="10"
                value={project.offsetMs}
                onChange={(event) => onUpdateProject({ offsetMs: Number(event.target.value) || 0 })}
              />
              <em>ms</em>
            </div>
          </label>
        </section>

        <section className="inspector-section">
          <div className="inspector-section__title">
            <span>Backing track</span>
            <FileAudio2 size={13} />
          </div>
          <button className="audio-source" title="Attach or replace the project audio file" onClick={onImportAudio}>
            <span className="audio-source__icon"><FileAudio2 size={18} /></span>
            <span>
              <strong>{project.audioPath?.split('/').pop() ?? 'Attach an audio file'}</strong>
              <small>{project.audioPath ? `${formatTime(effectiveDuration(project))} · Linked file` : 'MP3, WAV, M4A, FLAC or OGG'}</small>
            </span>
            <Import size={14} />
          </button>
        </section>

        <section className="inspector-section">
          <div className="inspector-section__title">
            <span>{project.tracks.length === 1 ? 'Vocal track' : 'Vocal tracks'}</span>
            <UsersRound size={13} />
          </div>
          <div className="vocal-track-list">
            {project.tracks.map((track, index) => {
              const { total, complete } = trackStats.get(track.id) ?? { total: 0, complete: 0 }
              return (
                <article
                  key={track.id}
                  className={`vocal-track-card ${track.id === activeTrackId ? 'is-active' : ''}`}
                  onClick={() => onSelectTrack(track.id)}
                >
                  <div className="vocal-track-card__top">
                    <span className="vocal-track-card__number" style={{ background: track.color }}>
                      <Mic2 size={13} />
                    </span>
                    <input
                      aria-label={`Track ${index + 1} name`}
                      value={track.name}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onUpdateTrack(track.id, { name: event.target.value })}
                    />
                    <input
                      className="track-color"
                      aria-label={`Track ${index + 1} color`}
                      title={`Choose color for ${track.name}`}
                      type="color"
                      value={track.color}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onUpdateTrack(track.id, { color: event.target.value })}
                    />
                  </div>
                  <div className="vocal-track-card__status">
                    <span>{complete}/{total} timed</span>
                    {project.tracks.length > 1 && (
                      <div>
                        <button
                          className={track.muted ? 'is-on' : ''}
                          aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                          title={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                          onClick={(event) => { event.stopPropagation(); onUpdateTrack(track.id, { muted: !track.muted }) }}
                        >M</button>
                        <button
                          className={track.solo ? 'is-on' : ''}
                          aria-label={`${track.solo ? 'Disable solo for' : 'Solo'} ${track.name}`}
                          title={`${track.solo ? 'Disable solo for' : 'Solo'} ${track.name}`}
                          onClick={(event) => { event.stopPropagation(); onUpdateTrack(track.id, { solo: !track.solo }) }}
                        >S</button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="inspector-section">
          <div className="inspector-section__title">
            <span>Active track tools</span>
            <SlidersHorizontal size={13} />
          </div>
          <div className="stacked-actions">
            <Button size="sm" variant="secondary" title="Import timed lyrics into the active track" onClick={onImportLrc}>
              <Import size={14} /> Import LRC lyrics
            </Button>
          </div>
        </section>

        <section className={`project-health ${untimed ? 'project-health--warning' : 'project-health--good'}`}>
          <div className="project-health__score">
            <strong>{allWords.length ? Math.round(((allWords.length - untimed) / allWords.length) * 100) : 0}</strong>
            <span>%</span>
          </div>
          <div>
            <span className="eyebrow">Timing coverage</span>
            <strong>{allWords.length === 0
              ? 'Add lyrics to begin'
              : untimed
                ? `${untimed} words still need timing`
                : 'Timing complete'}</strong>
          </div>
        </section>
      </div>
    </aside>
  )
})
