import {
  CheckCircle2,
  CircleHelp,
  Download,
  FilePlus2,
  FolderOpen,
  Redo2,
  Save,
  Type,
  Undo2,
} from 'lucide-react'
import { Button, IconButton, LogoMark } from './ui'

interface TopBarProps {
  title: string
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  issueCount: number
  hasLyrics: boolean
  styleDisabledReason: string | null
  workflowDisabled: boolean
  validationDisabled: boolean
  onStyle: (trigger: HTMLButtonElement) => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onUndo: () => void
  onRedo: () => void
  onShowWorkflow: () => void
  onValidate: () => void
  onExport: () => void
}

export function TopBar({
  title,
  dirty,
  canUndo,
  canRedo,
  issueCount,
  hasLyrics,
  styleDisabledReason,
  workflowDisabled,
  validationDisabled,
  onStyle,
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onShowWorkflow,
  onValidate,
  onExport,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <LogoMark />
        <div className="topbar__identity">
          <strong>Okay</strong>
          <span>Karaoke Studio</span>
        </div>
        <Button
          className="style-button"
          size="sm"
          variant="ghost"
          aria-disabled={styleDisabledReason !== null}
          aria-label={
            styleDisabledReason ? `Style unavailable: ${styleDisabledReason}` : 'Edit project Style'
          }
          title={styleDisabledReason ?? 'Edit project Style'}
          onClick={(event) => {
            if (!styleDisabledReason) onStyle(event.currentTarget)
          }}
        >
          <Type size={15} /> Style
        </Button>
      </div>

      <div className="topbar__document">
        <span>{title || 'Untitled song'}</span>
        {dirty && <i title="Unsaved changes" />}
        <small>EDITING</small>
      </div>

      <nav className="topbar__actions" aria-label="Project actions">
        <div className="toolbar-group">
          <IconButton aria-label="New project" title="New project" onClick={onNew}>
            <FilePlus2 size={17} />
          </IconButton>
          <IconButton aria-label="Open project" title="Open project" onClick={onOpen}>
            <FolderOpen size={17} />
          </IconButton>
          <IconButton aria-label="Save project" title="Save project (⌘S)" onClick={onSave}>
            <Save size={17} />
          </IconButton>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <IconButton aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={17} />
          </IconButton>
          <IconButton aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={17} />
          </IconButton>
        </div>
        <span className="toolbar-divider" />
        <Button
          className="workflow-button"
          variant="ghost"
          disabled={workflowDisabled}
          onClick={onShowWorkflow}
        >
          <CircleHelp size={15} /> Workflow
        </Button>
        <button
          className={`validation-button ${issueCount ? 'has-issues' : ''}`}
          title={
            issueCount
              ? 'Review timing issues'
              : hasLyrics
                ? 'No timing issues found'
                : 'Add lyrics to begin timing'
          }
          disabled={validationDisabled}
          onClick={onValidate}
        >
          <CheckCircle2 size={15} />
          {issueCount ? `${issueCount} to review` : hasLyrics ? 'Timing clean' : 'Add lyrics'}
        </button>
        <Button variant="primary" onClick={onExport}>
          <Download size={15} /> Export
        </Button>
      </nav>
    </header>
  )
}
