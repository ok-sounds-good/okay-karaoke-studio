import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleStop, Clapperboard, Download, FileJson2, FileText, Music, Sparkles } from 'lucide-react'
import type { ValidationIssue, VocalTrack } from '../lib/model'
import { Button, Modal } from './ui'

interface LyricsEditorDialogProps {
  track: VocalTrack
  onClose: () => void
  onSave: (lyrics: string) => void
}

export function LyricsEditorDialog({ track, onClose, onSave }: LyricsEditorDialogProps) {
  const initialText = useMemo(() => track.lines.map((line) => line.text).join('\n'), [track])
  const [text, setText] = useState(initialText)
  const lines = text.split(/\r?\n/)
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <Modal
      title={`Edit ${track.name}`}
      eyebrow="Lyrics workspace"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="modal-note">Existing timings are preserved by word position where possible.</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(text)}>Apply lyrics</Button>
        </>
      }
    >
      <div className="lyrics-editor-dialog">
        <div className="raw-lyrics">
          <div className="dialog-section-title">
            <span>Lyrics text</span>
            <small>{lines.length} lines · {wordCount} words</small>
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck
            placeholder={'Paste one lyric line per row…\nUse / to mark a syllable break.'}
          />
          <p><Sparkles size={13} /> Tip: write <code>nev/er</code> to display <strong>nev·er</strong> as two visual syllables.</p>
        </div>
        <div className="line-fit-preview">
          <div className="dialog-section-title">
            <span>Screen fit</span>
            <small>16:9 title-safe preview</small>
          </div>
          <div className="fit-stage">
            <i />
            <div>
              <span>Line preview</span>
              <p>{(lines.find((line) => line.trim()) || 'Your lyrics will appear here').replaceAll('/', '·')}</p>
            </div>
          </div>
          <div className="fit-lines">
            {lines.filter((line) => line.trim()).map((line, index) => {
              const length = line.trim().length
              const severity = length > 52 ? 'danger' : length > 40 ? 'warning' : 'good'
              return (
                <div key={`${index}-${line}`} className={`fit-line fit-line--${severity}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{line.replaceAll('/', '·')}</p>
                  <small>{length}</small>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}

interface ExportDialogProps {
  projectTitle: string
  activeTrackName: string
  issueCount: number
  onClose: () => void
  onExportLrc: () => void
  onExportAss: () => void
  onExportVideo: () => void
  onCancelVideo: () => void
  onExportProject: () => void
  videoAvailable: boolean
  videoProgress: StudioVideoExportProgress | null
}

export function ExportDialog({
  projectTitle,
  activeTrackName,
  issueCount,
  onClose,
  onExportLrc,
  onExportAss,
  onExportVideo,
  onCancelVideo,
  onExportProject,
  videoAvailable,
  videoProgress,
}: ExportDialogProps) {
  const exportingVideo = videoProgress !== null
  const videoStatus = videoProgress?.phase === 'frames'
    ? `Rendering lyric frames · ${videoProgress.completed} / ${videoProgress.total}`
    : videoProgress?.phase === 'encoding'
      ? 'Encoding MP4 and mixing the backing track…'
      : videoProgress
        ? 'Preparing the video renderer…'
        : videoAvailable
          ? '1080p MP4 · both voices and linked audio'
          : 'Attach audio in the desktop app to enable'

  return (
    <Modal
      title="Export karaoke"
      eyebrow={projectTitle}
      onClose={onClose}
      closeDisabled={exportingVideo}
    >
      <div className={`export-readiness ${issueCount ? 'export-readiness--warning' : ''}`}>
        {issueCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        <div>
          <strong>{issueCount ? `${issueCount} timing ${issueCount === 1 ? 'item needs' : 'items need'} review` : 'Timing checks passed'}</strong>
          <span>{issueCount ? 'You can export a draft now or review the timing first.' : 'This project is ready to hand off.'}</span>
        </div>
      </div>
      {videoProgress && (
        <div className="video-export-progress" role="status" aria-live="polite">
          <span>{videoStatus}</span>
          <progress
            aria-label="Karaoke video export progress"
            max={videoProgress.total}
            value={videoProgress.phase === 'frames' ? videoProgress.completed : undefined}
          />
        </div>
      )}
      <div className="export-options">
        <button onClick={onExportLrc} disabled={exportingVideo}>
          <span className="export-option__icon"><FileText size={21} /></span>
          <span><strong>Enhanced LRC</strong><small>{activeTrackName} · line and word timing</small></span>
          <Download size={16} />
        </button>
        <button onClick={onExportAss} disabled={exportingVideo}>
          <span className="export-option__icon"><Music size={21} /></span>
          <span><strong>ASS karaoke subtitles</strong><small>Both voices · karaoke timing tags</small></span>
          <Download size={16} />
        </button>
        <button
          onClick={exportingVideo ? onCancelVideo : onExportVideo}
          disabled={!exportingVideo && !videoAvailable}
          aria-busy={exportingVideo}
        >
          <span className="export-option__icon">
            {exportingVideo ? <CircleStop size={21} /> : <Clapperboard size={21} />}
          </span>
          <span>
            <strong>{exportingVideo ? 'Cancel video export' : 'Karaoke video'}</strong>
            <small>{videoStatus}</small>
          </span>
          {exportingVideo ? <CircleStop size={16} /> : <Download size={16} />}
        </button>
        <button onClick={onExportProject} disabled={exportingVideo}>
          <span className="export-option__icon"><FileJson2 size={21} /></span>
          <span><strong>Project JSON</strong><small>Portable editable timing document</small></span>
          <Download size={16} />
        </button>
      </div>
    </Modal>
  )
}

export function ValidationDialog({ issues, onClose }: { issues: ValidationIssue[]; onClose: () => void }) {
  return (
    <Modal title="Timing review" eyebrow="Project validation" onClose={onClose}>
      {issues.length ? (
        <div className="validation-list">
          {issues.map((issue, index) => (
            <article key={`${issue.path}-${issue.code}-${index}`} className={`validation-item validation-item--${issue.severity}`}>
              <span>{issue.severity === 'error' ? <AlertTriangle size={16} /> : <AlertTriangle size={16} />}</span>
              <div><strong>{issue.message}</strong><small>{issue.path}</small></div>
              <em>{issue.code.replaceAll('_', ' ')}</em>
            </article>
          ))}
        </div>
      ) : (
        <div className="validation-empty">
          <span><CheckCircle2 size={30} /></span>
          <h3>Every timed word looks clean.</h3>
          <p>No negative, incomplete, inverted, or overlapping timing was found.</p>
        </div>
      )}
    </Modal>
  )
}
