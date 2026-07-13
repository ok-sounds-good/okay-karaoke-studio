import { CheckCircle2, CircleHelp, Download, FilePlus2, FolderOpen, Redo2, Save, Undo2 } from 'lucide-react'
import { Button, IconButton, LogoMark } from './ui'

interface TopBarProps {
  title: string
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  issueCount: number
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
        <div>
          <strong>Okay</strong>
          <span>Karaoke Studio</span>
        </div>
      </div>

      <div className="topbar__document">
        <span>{title || 'Untitled song'}</span>
        {dirty && <i title="Unsaved changes" />}
        <small>EDITING</small>
      </div>

      <nav className="topbar__actions" aria-label="Project actions">
        <div className="toolbar-group">
          <IconButton aria-label="New project" title="New project" onClick={onNew}><FilePlus2 size={17} /></IconButton>
          <IconButton aria-label="Open project" title="Open project" onClick={onOpen}><FolderOpen size={17} /></IconButton>
          <IconButton aria-label="Save project" title="Save project (⌘S)" onClick={onSave}><Save size={17} /></IconButton>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <IconButton aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}><Undo2 size={17} /></IconButton>
          <IconButton aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={onRedo}><Redo2 size={17} /></IconButton>
        </div>
        <span className="toolbar-divider" />
        <Button className="workflow-button" variant="ghost" onClick={onShowWorkflow}>
          <CircleHelp size={15} /> Workflow
        </Button>
        <button className={`validation-button ${issueCount ? 'has-issues' : ''}`} onClick={onValidate}>
          <CheckCircle2 size={15} />
          {issueCount ? `${issueCount} to review` : 'Timing clean'}
        </button>
        <Button variant="primary" onClick={onExport}>
          <Download size={15} /> Export
        </Button>
      </nav>
    </header>
  )
}
