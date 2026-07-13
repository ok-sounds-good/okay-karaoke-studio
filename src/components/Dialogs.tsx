import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  Clapperboard,
  Download,
  Edit3,
  FileAudio2,
  FileJson2,
  FilePlus2,
  FileText,
  FolderOpen,
  Import,
  MousePointer2,
  Music,
  Play,
  Save,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { ValidationIssue, VocalTrack } from '../lib/model'
import { Button, Modal } from './ui'

interface WorkflowGuideDialogProps {
  canStartSync: boolean
  onClose: () => void
  onNew: () => void
  onOpen: () => void
  onAttachAudio: () => void
  onEditLyrics: () => void
  onImportLrc: () => void
  onStartSync: () => void
  onSave: () => void
  onExport: () => void
}

export function WorkflowGuideDialog({
  canStartSync,
  onClose,
  onNew,
  onOpen,
  onAttachAudio,
  onEditLyrics,
  onImportLrc,
  onStartSync,
  onSave,
  onExport,
}: WorkflowGuideDialogProps) {
  return (
    <Modal
      title="Make your first karaoke"
      eyebrow="One-window workflow"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="modal-note">Reopen this guide from Workflow in the top bar.</span>
          <Button variant="primary" onClick={onClose}>Back to studio</Button>
        </>
      }
    >
      <p className="workflow-guide__intro">
        Work through these steps in order. Every editor stays in this window; system file pickers only appear when you choose a file or destination.
      </p>
      <ol className="workflow-guide" aria-label="Primary karaoke workflow">
        <li>
          <span><FilePlus2 size={18} /></span>
          <div><strong>Start a project</strong><p>Begin blank, or reopen an editable <code>.oks</code> project.</p></div>
          <div className="workflow-guide__actions">
            <Button size="sm" variant="ghost" onClick={onOpen}><FolderOpen size={13} /> Open .oks</Button>
            <Button size="sm" variant="secondary" onClick={onNew}><FilePlus2 size={13} /> New project</Button>
          </div>
        </li>
        <li>
          <span><FileAudio2 size={18} /></span>
          <div><strong>Attach the backing track</strong><p>Link MP3, WAV, M4A, FLAC, AAC, or OGG audio from your computer.</p></div>
          <Button size="sm" variant="secondary" onClick={onAttachAudio}><FileAudio2 size={13} /> Attach audio</Button>
        </li>
        <li>
          <span><Edit3 size={18} /></span>
          <div><strong>Add the lyrics</strong><p>Paste one lyric line per row, or import an existing LRC into the active voice.</p></div>
          <div className="workflow-guide__actions">
            <Button size="sm" variant="ghost" onClick={onImportLrc}><Import size={13} /> Import LRC</Button>
            <Button size="sm" variant="secondary" onClick={onEditLyrics}><Edit3 size={13} /> Edit lyrics</Button>
          </div>
        </li>
        <li>
          <span><Zap size={18} /></span>
          <div><strong>Time each word</strong><p>Move the playhead, arm Tap sync, then press Space at each word onset. Hold the final word of a line to extend it.</p></div>
          <Button size="sm" variant="secondary" disabled={!canStartSync} onClick={onStartSync}>
            <Zap size={13} /> {canStartSync ? 'Arm tap sync' : 'Add lyrics first'}
          </Button>
        </li>
        <li>
          <span><MousePointer2 size={18} /></span>
          <div><strong>Correct the TimeBoard</strong><p>Select or drag word blocks to move them; drag either edge to resize.</p></div>
          <Button size="sm" variant="secondary" onClick={onClose}><MousePointer2 size={13} /> Show TimeBoard</Button>
        </li>
        <li>
          <span><Play size={18} /></span>
          <div><strong>Verify in Live Preview</strong><p>Sync focus keeps timing lightweight; exit sync to review the configured Clear or Scroll stage view.</p></div>
          <Button size="sm" variant="secondary" onClick={onClose}><Play size={13} /> Show preview</Button>
        </li>
        <li>
          <span><Save size={18} /></span>
          <div><strong>Save and export</strong><p>Save the editable <code>.oks</code>, then export LRC, ASS, or a finished MP4.</p></div>
          <div className="workflow-guide__actions">
            <Button size="sm" variant="ghost" onClick={onSave}><Save size={13} /> Save .oks</Button>
            <Button size="sm" variant="secondary" onClick={onExport}><Download size={13} /> Choose export</Button>
          </div>
        </li>
      </ol>
    </Modal>
  )
}

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
  hasLyrics: boolean
  activeTrackHasLyrics: boolean
  onClose: () => void
  onExportLrc: () => void
  onExportAss: () => void
  onExportVideo: (settings: Pick<StudioVideoExportOptions, 'resolution' | 'fps'>) => void
  onCancelVideo: () => Promise<boolean>
  onExportProject: () => void
  videoAvailable: boolean
  videoProgress: StudioVideoExportProgress | null
}

const VIDEO_RESOLUTION_OPTIONS: Array<{
  value: StudioVideoResolution
  label: string
  dimensions: string
}> = [
  { value: '240p', label: '240p', dimensions: '426 × 240' },
  { value: '360p', label: '360p', dimensions: '640 × 360' },
  { value: '480p', label: '480p', dimensions: '854 × 480' },
  { value: '720p', label: '720p', dimensions: '1280 × 720' },
  { value: '1080p', label: '1080p', dimensions: '1920 × 1080' },
  { value: '1440p', label: '1440p', dimensions: '2560 × 1440' },
  { value: '2160p', label: '2160p', dimensions: '3840 × 2160' },
]

export function ExportDialog({
  projectTitle,
  activeTrackName,
  issueCount,
  hasLyrics,
  activeTrackHasLyrics,
  onClose,
  onExportLrc,
  onExportAss,
  onExportVideo,
  onCancelVideo,
  onExportProject,
  videoAvailable,
  videoProgress,
}: ExportDialogProps) {
  const [resolution, setResolution] = useState<StudioVideoResolution>('720p')
  const [fps, setFps] = useState<StudioVideoFps>(30)
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false)
  const [cancellationPending, setCancellationPending] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const exportingVideo = videoProgress !== null
  const resolutionOption = VIDEO_RESOLUTION_OPTIONS.find((option) => option.value === resolution)
  const videoStatus = videoProgress?.phase === 'frames'
    ? `Rendering lyric frames · ${videoProgress.completed} / ${videoProgress.total}`
    : videoProgress?.phase === 'encoding'
      ? 'Encoding MP4 and mixing the backing track…'
      : videoProgress
        ? 'Preparing video export and checking FFmpeg…'
        : !hasLyrics
          ? 'Add lyrics to enable karaoke video export'
          : videoAvailable
            ? `${resolutionOption?.dimensions} · ${fps} fps MP4 · linked audio`
            : 'Attach audio in the desktop app to enable'

  const handleClose = () => {
    if (cancellationPending) return
    if (cancelConfirmationOpen) {
      setCancelConfirmationOpen(false)
    } else if (exportingVideo) {
      setCancelError(null)
      setCancelConfirmationOpen(true)
    } else {
      onClose()
    }
  }

  const requestCancellation = () => {
    setCancelError(null)
    setCancelConfirmationOpen(true)
  }

  const confirmCancellation = async () => {
    setCancellationPending(true)
    setCancelError(null)
    try {
      const accepted = await onCancelVideo()
      if (!accepted) {
        setCancellationPending(false)
        setCancelConfirmationOpen(false)
        setCancelError('The export could not be canceled. If it is still running, try again.')
        return
      }
      setCancellationPending(false)
      onClose()
    } catch (error) {
      setCancellationPending(false)
      setCancelConfirmationOpen(false)
      setCancelError(error instanceof Error ? error.message : 'The export could not be canceled.')
    }
  }

  return (
    <Modal
      title="Export karaoke"
      eyebrow={projectTitle}
      onClose={handleClose}
      closeDisabled={cancellationPending}
    >
      {cancelConfirmationOpen ? (
        <div className="video-export-cancel-confirmation" role="alertdialog" aria-labelledby="video-export-cancel-title">
          <CircleStop size={28} />
          <h3 id="video-export-cancel-title">Cancel video export?</h3>
          <p>The encoder will stop. Any partial MP4 will remain beside the destination you chose.</p>
          <div>
            <Button
              autoFocus
              variant="secondary"
              disabled={cancellationPending}
              onClick={() => setCancelConfirmationOpen(false)}
            >
              Keep exporting
            </Button>
            <Button
              variant="danger"
              disabled={cancellationPending}
              aria-busy={cancellationPending}
              onClick={() => void confirmCancellation()}
            >
              {cancellationPending ? 'Canceling…' : 'Cancel export'}
            </Button>
          </div>
        </div>
      ) : <>
      <div className={`export-readiness ${!hasLyrics || issueCount ? 'export-readiness--warning' : ''}`}>
        {!hasLyrics || issueCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        <div>
          <strong>{!hasLyrics
            ? 'Add lyrics before exporting karaoke'
            : issueCount
              ? `${issueCount} timing ${issueCount === 1 ? 'item needs' : 'items need'} review`
              : 'Timing checks passed'}</strong>
          <span>{!hasLyrics
            ? 'The editable .oks project is available now; karaoke formats need lyric content.'
            : issueCount
              ? 'You can export a draft now or review the timing first.'
              : 'This project is ready to hand off.'}</span>
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
      {cancelError && <p className="video-export-cancel-error" role="alert">{cancelError}</p>}
      <fieldset className="video-export-settings" disabled={exportingVideo}>
        <legend>Video settings</legend>
        <label>
          <span>Resolution</span>
          <select
            aria-label="Video resolution"
            value={resolution}
            onChange={(event) => setResolution(event.target.value as StudioVideoResolution)}
          >
            {VIDEO_RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.dimensions}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Frame rate</span>
          <select
            aria-label="Video frame rate"
            value={fps}
            onChange={(event) => setFps(Number(event.target.value) as StudioVideoFps)}
          >
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
      </fieldset>
      <div className="export-options">
        <button onClick={onExportLrc} disabled={exportingVideo || !activeTrackHasLyrics}>
          <span className="export-option__icon"><FileText size={21} /></span>
          <span>
            <strong>Enhanced LRC</strong>
            <small>{activeTrackName} · {activeTrackHasLyrics ? 'line and word timing' : 'add lyrics to this track first'}</small>
          </span>
          <Download size={16} />
        </button>
        <button onClick={onExportAss} disabled={exportingVideo || !hasLyrics}>
          <span className="export-option__icon"><Music size={21} /></span>
          <span><strong>ASS karaoke subtitles</strong><small>Lead vocal · karaoke timing tags</small></span>
          <Download size={16} />
        </button>
        <button
          onClick={exportingVideo
            ? requestCancellation
            : () => onExportVideo({ resolution, fps })}
          disabled={!exportingVideo && (!hasLyrics || !videoAvailable)}
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
          <span><strong>Editable .oks project</strong><small>Portable project with lyrics, tracks, and timing</small></span>
          <Download size={16} />
        </button>
      </div>
      </>}
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
