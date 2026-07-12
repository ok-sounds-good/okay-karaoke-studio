import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KaraokeProject, LyricWord, ValidationIssue, VocalTrack } from './lib/model'
import {
  createDemoProject,
  createProject,
  createVocalTrack,
  exportAss,
  exportLrc,
  importLrc,
  parseLyrics,
  parseProject,
  serializeProject,
  validateProject,
} from './lib/model'
import { TopBar } from './components/TopBar'
import { InspectorPanel } from './components/InspectorPanel'
import { KaraokePreview } from './components/KaraokePreview'
import { LyricsPanel } from './components/LyricsPanel'
import { Timeline } from './components/Timeline'
import { TransportBar } from './components/TransportBar'
import { ExportDialog, LyricsEditorDialog, ValidationDialog, WorkflowGuideDialog } from './components/Dialogs'
import { usePlayback } from './hooks/usePlayback'
import { useWaveform } from './hooks/useWaveform'
import {
  downloadText,
  effectiveDuration,
  flattenProject,
  flattenTrack,
  applyTimingDraft,
  patchWord,
  recalculateLine,
  shiftWords,
  slugify,
  type ProjectTimingDraft,
} from './utils'

interface HistoryEntry {
  project: KaraokeProject
  revision: number
}

function useProjectHistory(initialProject: KaraokeProject) {
  const sequenceRef = useRef(0)
  const pastRef = useRef<HistoryEntry[]>([])
  const futureRef = useRef<HistoryEntry[]>([])
  const [entry, setEntry] = useState<HistoryEntry>({ project: initialProject, revision: 0 })
  const [savedRevision, setSavedRevision] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)

  const commit = useCallback((updater: KaraokeProject | ((project: KaraokeProject) => KaraokeProject)) => {
    setEntry((current) => {
      const nextProject = typeof updater === 'function' ? updater(current.project) : updater
      if (nextProject === current.project) return current
      pastRef.current.push(current)
      if (pastRef.current.length > 120) pastRef.current.shift()
      futureRef.current = []
      sequenceRef.current += 1
      setHistoryVersion((value) => value + 1)
      return { project: nextProject, revision: sequenceRef.current }
    })
  }, [])

  const replaceCurrent = useCallback((updater: (project: KaraokeProject) => KaraokeProject) => {
    setEntry((current) => {
      const nextProject = updater(current.project)
      if (nextProject === current.project) return current
      sequenceRef.current += 1
      return { project: nextProject, revision: sequenceRef.current }
    })
  }, [])

  const reset = useCallback((project: KaraokeProject, markClean = true) => {
    sequenceRef.current += 1
    const next = { project, revision: sequenceRef.current }
    pastRef.current = []
    futureRef.current = []
    setEntry(next)
    if (markClean) setSavedRevision(next.revision)
    setHistoryVersion((value) => value + 1)
  }, [])

  const undo = useCallback(() => {
    setEntry((current) => {
      const previous = pastRef.current.pop()
      if (!previous) return current
      futureRef.current.push(current)
      setHistoryVersion((value) => value + 1)
      return previous
    })
  }, [])

  const redo = useCallback(() => {
    setEntry((current) => {
      const next = futureRef.current.pop()
      if (!next) return current
      pastRef.current.push(current)
      setHistoryVersion((value) => value + 1)
      return next
    })
  }, [])

  const markSaved = useCallback(() => setSavedRevision(entry.revision), [entry.revision])

  return {
    project: entry.project,
    revision: entry.revision,
    dirty: entry.revision !== savedRevision,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    historyVersion,
    commit,
    replaceCurrent,
    reset,
    undo,
    redo,
    markSaved,
  }
}

interface ToastState {
  message: string
  tone: 'success' | 'warning' | 'neutral'
}

interface WorkflowGuideActionDependencies {
  canStartSync: boolean
  close: () => void
  startNew: () => void
  open: () => void
  attachAudio: () => void
  editLyrics: () => void
  importLrc: () => void
  startSync: () => void
  save: () => void
  exportProject: () => void
}

export const EDITABLE_PROJECT_EXPORT_FORMAT: StudioExportFormat = 'oks'

export function createWorkflowGuideActions({
  canStartSync,
  close,
  startNew,
  open,
  attachAudio,
  editLyrics,
  importLrc,
  startSync,
  save,
  exportProject,
}: WorkflowGuideActionDependencies) {
  const closeThen = (action: () => void) => () => {
    close()
    action()
  }

  return {
    canStartSync,
    onClose: close,
    onNew: closeThen(startNew),
    onOpen: closeThen(open),
    onAttachAudio: closeThen(attachAudio),
    onEditLyrics: closeThen(editLyrics),
    onImportLrc: closeThen(importLrc),
    onStartSync: () => {
      if (!canStartSync) return
      close()
      startSync()
    },
    onSave: closeThen(save),
    onExport: closeThen(exportProject),
  }
}

export interface ActiveTimingDraft {
  revision: number
  timings: ProjectTimingDraft
}

export function projectForTimingPreview(
  project: KaraokeProject,
  revision: number,
  timingDraft: ActiveTimingDraft | null,
) {
  return timingDraft?.revision === revision
    ? applyTimingDraft(project, timingDraft.timings)
    : project
}

function inputHasTypingFocus() {
  const element = document.activeElement
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable)
}

export function lyricTimeAtPlayback(playbackMs: number, offsetMs: number) {
  return playbackMs - offsetMs
}

export default function App() {
  const history = useProjectHistory(createDemoProject())
  const { project, commit, replaceCurrent } = history
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [activeTrackId, setActiveTrackId] = useState(project.tracks[0]?.id ?? '')
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [syncMode, setSyncMode] = useState(false)
  const [syncCursor, setSyncCursor] = useState(0)
  const [heldWordId, setHeldWordId] = useState<string | null>(null)
  const [lyricsDialogOpen, setLyricsDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [videoExportProgress, setVideoExportProgress] = useState<StudioVideoExportProgress | null>(null)
  const [validationDialogOpen, setValidationDialogOpen] = useState(false)
  const [workflowGuideOpen, setWorkflowGuideOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [timingDraft, setTimingDraft] = useState<ActiveTimingDraft | null>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const lrcInputRef = useRef<HTMLInputElement>(null)
  const currentTimeRef = useRef(0)
  const syncHeldRef = useRef<{ wordId: string; startMs: number } | null>(null)
  const projectRestoreSequenceRef = useRef(0)
  const videoExportActiveRef = useRef(false)

  const persistAudioDuration = useCallback((nextDurationMs: number) => {
    replaceCurrent((current) => current.durationMs === nextDurationMs
      ? current
      : { ...current, durationMs: nextDurationMs })
  }, [replaceCurrent])

  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0]
  const syncWords = useMemo(() => (activeTrack ? flattenTrack(activeTrack).map(({ word }) => word) : []), [activeTrack])
  const durationMs = effectiveDuration(project)
  const playback = usePlayback({ durationMs, audioUrl, onDuration: persistAudioDuration })
  const waveform = useWaveform(audioUrl)
  const lyricTimeMs = lyricTimeAtPlayback(playback.currentMs, project.offsetMs)
  const previewProject = useMemo(
    () => projectForTimingPreview(project, history.revision, timingDraft),
    [history.revision, project, timingDraft],
  )

  const updateTimingDraft = useCallback((timings: ProjectTimingDraft | null) => {
    setTimingDraft(timings ? { revision: history.revision, timings } : null)
  }, [history.revision])

  useEffect(() => {
    currentTimeRef.current = playback.currentMs
  }, [playback.currentMs])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!window.studio?.onVideoExportProgress) return
    return window.studio.onVideoExportProgress(setVideoExportProgress)
  }, [])

  useEffect(() => {
    videoExportActiveRef.current = videoExportProgress !== null
  }, [videoExportProgress])

  useEffect(() => {
    if (!activeTrack && project.tracks[0]) setActiveTrackId(project.tracks[0].id)
  }, [activeTrack, project.tracks])

  useEffect(() => {
    if (!history.dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [history.dirty])

  const reviewIssues = useMemo<ValidationIssue[]>(() => {
    const issues = validateProject(project)
    project.tracks.forEach((track, trackIndex) => {
      const untimed = flattenTrack(track).filter(({ word }) => word.startMs === null).length
      if (untimed) {
        issues.push({
          severity: 'warning',
          code: 'words-untimed',
          message: `${track.name} has ${untimed} untimed ${untimed === 1 ? 'word' : 'words'}.`,
          path: `tracks[${trackIndex}]`,
          trackId: track.id,
        })
      }
    })
    return issues
  }, [project])

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral') => setToast({ message, tone }), [])

  const confirmDiscardChanges = useCallback((message: string) => (
    !history.dirty || window.confirm(message)
  ), [history.dirty])

  const replaceTrack = useCallback((trackId: string, nextTrack: VocalTrack) => {
    commit((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      tracks: current.tracks.map((track) => (track.id === trackId ? nextTrack : track)),
    }))
  }, [commit])

  const updateProject = useCallback((patch: Partial<Pick<KaraokeProject, 'title' | 'artist' | 'offsetMs'>>) => {
    commit((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }, [commit])

  const updateTrack = useCallback((trackId: string, patch: Partial<Pick<VocalTrack, 'name' | 'color' | 'muted' | 'solo'>>) => {
    commit((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      tracks: current.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
    }))
  }, [commit])

  const openProjectContents = useCallback(async (contents: string, path: string | null) => {
    let next: KaraokeProject
    try {
      next = parseProject(contents)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not open that project.', 'warning')
      return
    }

    if (!confirmDiscardChanges('Discard the unsaved changes and open another project?')) return

    const restoreSequence = projectRestoreSequenceRef.current + 1
    projectRestoreSequenceRef.current = restoreSequence
    history.reset(next, true)
    setProjectPath(path)
    setActiveTrackId(next.tracks[0]?.id ?? '')
    setSelectedWordIds(new Set())
    setSyncMode(false)
    playback.pause()
    playback.seek(0)
    setAudioUrl(null)

    if (window.studio?.releaseAudio) {
      try {
        await window.studio.releaseAudio()
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Media release failed.'
        showToast(`Project opened, but the previous audio could not be released: ${detail}`, 'warning')
      }
    }

    if (!next.audioPath) {
      showToast(`Opened ${next.title}`, 'success')
      return
    }
    if (!window.studio?.resolveProjectAudio || !path) {
      showToast('Project opened; relink its audio file in this browser.', 'warning')
      return
    }

    try {
      const resolved = await window.studio.resolveProjectAudio(path)
      if (restoreSequence !== projectRestoreSequenceRef.current) return
      setAudioUrl(resolved?.url ?? null)
      showToast(
        resolved ? `Opened ${next.title}` : 'Project opened; relink the missing audio file.',
        resolved ? 'success' : 'warning',
      )
    } catch (error) {
      if (restoreSequence !== projectRestoreSequenceRef.current) return
      const detail = error instanceof Error ? error.message : 'Audio restoration failed.'
      showToast(`Project opened, but its audio could not be restored: ${detail}`, 'warning')
    }
  }, [confirmDiscardChanges, history.reset, playback.pause, playback.seek, showToast])

  const handleNew = useCallback(() => {
    if (!confirmDiscardChanges('Discard the unsaved changes and start a new project?')) return
    projectRestoreSequenceRef.current += 1
    const next = createProject({ title: 'Untitled Song', artist: 'Unknown Artist' })
    history.reset(next, true)
    setProjectPath(null)
    setAudioUrl(null)
    setActiveTrackId(next.tracks[0]?.id ?? '')
    setSelectedWordIds(new Set())
    setSyncMode(false)
    playback.pause()
    playback.seek(0)
    void window.studio?.releaseAudio?.().catch((error: unknown) => {
      console.error('Unable to release the previous audio:', error)
    })
    showToast('New project ready', 'neutral')
  }, [confirmDiscardChanges, history.reset, playback.pause, playback.seek, showToast])

  const handleOpen = useCallback(async () => {
    if (window.studio) {
      const result = await window.studio.openProject()
      if (result) await openProjectContents(result.contents, result.path)
    } else {
      projectInputRef.current?.click()
    }
  }, [openProjectContents])

  const handleSave = useCallback(async (saveAs = false) => {
    try {
      const contents = serializeProject(project)
      const suggestedName = `${slugify(project.title)}.oks`
      if (window.studio) {
        const result = await window.studio.saveProject({
          path: saveAs ? undefined : projectPath ?? undefined,
          suggestedName,
          contents,
        })
        if (!result) return
        setProjectPath(result.path)
      } else {
        downloadText(suggestedName, contents, 'application/json')
      }
      history.markSaved()
      showToast('Project saved', 'success')
    } catch (error) {
      setValidationDialogOpen(true)
      showToast(error instanceof Error ? error.message : 'Project could not be saved.', 'warning')
    }
  }, [history.markSaved, project, projectPath, showToast])

  const applyAudio = useCallback((path: string, url: string, name?: string) => {
    projectRestoreSequenceRef.current += 1
    playback.pause()
    setAudioUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return url
    })
    commit((current) => ({ ...current, audioPath: path, updatedAt: new Date().toISOString() }))
    showToast(`${name ?? path.split('/').pop() ?? 'Audio'} linked`, 'success')
  }, [commit, playback.pause, showToast])

  const handleImportAudio = useCallback(async () => {
    if (window.studio) {
      const result = await window.studio.importAudio()
      if (result) applyAudio(result.path, result.url, result.name)
    } else {
      audioInputRef.current?.click()
    }
  }, [applyAudio])

  const applyLrc = useCallback((contents: string) => {
    if (!activeTrack) return
    try {
      const imported = importLrc(contents, activeTrack.id, project.offsetMs)
      replaceTrack(activeTrack.id, { ...imported, name: activeTrack.name, color: activeTrack.color })
      setSelectedWordIds(new Set())
      showToast(`Imported LRC into ${activeTrack.name}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import that LRC file.', 'warning')
    }
  }, [activeTrack, project.offsetMs, replaceTrack, showToast])

  const handleImportLrc = useCallback(async () => {
    if (window.studio) {
      const result = await window.studio.importLrc()
      if (result) applyLrc(result.contents)
    } else {
      lrcInputRef.current?.click()
    }
  }, [applyLrc])

  const exportText = useCallback(async (format: StudioExportFormat) => {
    if (!activeTrack) return
    try {
      const base = slugify(`${project.artist}-${project.title}`)
      const contents = format === 'lrc'
        ? exportLrc(project, activeTrack.id)
        : format === 'ass'
          ? exportAss(project)
          : serializeProject(project)
      const suggestedName = `${base}.${format}`
      if (window.studio) {
        const result = await window.studio.exportText({ suggestedName, contents, format })
        if (!result) return
      } else {
        downloadText(suggestedName, contents, format === 'oks' ? 'application/json' : 'text/plain')
      }
      setExportDialogOpen(false)
      showToast(`${format.toUpperCase()} export created`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Export failed.', 'warning')
    }
  }, [activeTrack, project, showToast])

  const exportVideo = useCallback(async () => {
    if (!window.studio?.exportVideo) {
      showToast('Video export is available in the desktop app.', 'warning')
      return
    }
    if (!project.audioPath || !playback.hasAudio) {
      showToast('Attach a readable audio track before exporting video.', 'warning')
      return
    }

    try {
      playback.pause()
      videoExportActiveRef.current = true
      setVideoExportProgress({ phase: 'preparing', completed: 0, total: 1 })
      const result = await window.studio.exportVideo({
        suggestedName: `${slugify(`${project.artist}-${project.title}`)}.mp4`,
        projectJson: serializeProject(project),
        audioPath: project.audioPath,
        durationMs: Math.max(1_000, Math.round(playback.durationMs)),
      })
      if (!result) return
      setExportDialogOpen(false)
      showToast(`Video export created with ${result.frameCount} lyric frames`, 'success')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Video export failed.'
      showToast(
        /cancel(?:led|ed|ing)/iu.test(detail) ? 'Video export cancelled' : detail,
        /cancel(?:led|ed|ing)/iu.test(detail) ? 'neutral' : 'warning',
      )
    } finally {
      videoExportActiveRef.current = false
      setVideoExportProgress(null)
    }
  }, [playback.durationMs, playback.hasAudio, playback.pause, project, showToast])

  const cancelVideoExport = useCallback(() => {
    if (!window.studio?.cancelVideoExport) return
    void window.studio.cancelVideoExport().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : 'Could not cancel video export.', 'warning')
    })
  }, [showToast])

  const handleSelectWord = useCallback((word: LyricWord, add: boolean) => {
    setSelectedWordIds((current) => {
      const next = add ? new Set(current) : new Set<string>()
      if (add && next.has(word.id)) next.delete(word.id)
      else next.add(word.id)
      return next
    })
    if (word.startMs !== null) playback.seek(Math.max(0, word.startMs + project.offsetMs))
    const index = syncWords.findIndex((candidate) => candidate.id === word.id)
    if (index >= 0 && syncMode) setSyncCursor(index)
  }, [playback.seek, project.offsetMs, syncMode, syncWords])

  const handleSelectWordId = useCallback((wordId: string, add: boolean) => {
    const item = flattenProject(project).find(({ word }) => word.id === wordId)
    if (item) {
      if (item.track.id !== activeTrackId) setActiveTrackId(item.track.id)
      handleSelectWord(item.word, add)
    }
  }, [activeTrackId, handleSelectWord, project])

  const toggleSyncMode = useCallback(() => {
    setSyncMode((enabled) => {
      const next = !enabled
      if (next) {
        const lyricTimeMs = lyricTimeAtPlayback(currentTimeRef.current, project.offsetMs)
        const fromPlayhead = syncWords.findIndex((word) => word.startMs === null || word.startMs >= lyricTimeMs - 80)
        setSyncCursor(fromPlayhead >= 0 ? fromPlayhead : 0)
        playback.play()
        showToast('Tap sync armed — hold Space for each word', 'neutral')
      } else {
        syncHeldRef.current = null
        setHeldWordId(null)
      }
      return next
    })
  }, [playback.play, project.offsetMs, showToast, syncWords])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (inputHasTypingFocus()) return
      if (event.code === 'Escape' && syncMode) {
        event.preventDefault()
        setSyncMode(false)
        syncHeldRef.current = null
        setHeldWordId(null)
        return
      }
      if ((event.code === 'Backspace' || event.code === 'Delete') && selectedWordIds.size) {
        event.preventDefault()
        commit((current) => {
          let next = current
          selectedWordIds.forEach((id) => { next = patchWord(next, id, { startMs: null, endMs: null }) })
          return next
        })
        return
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        playback.seek(currentTimeRef.current - (event.shiftKey ? 1000 : 250))
        return
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        playback.seek(currentTimeRef.current + (event.shiftKey ? 1000 : 250))
        return
      }
      if (event.code !== 'Space') return
      event.preventDefault()
      if (!syncMode) {
        if (!event.repeat) playback.toggle()
        return
      }
      if (event.repeat || syncHeldRef.current) return
      const word = syncWords[syncCursor]
      if (!word) {
        setSyncMode(false)
        showToast('All words are timed', 'success')
        return
      }
      syncHeldRef.current = {
        wordId: word.id,
        startMs: Math.max(0, lyricTimeAtPlayback(currentTimeRef.current, project.offsetMs)),
      }
      setHeldWordId(word.id)
      playback.play()
    }

    const keyUp = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) {
        if (event.code === 'Space') {
          syncHeldRef.current = null
          setHeldWordId(null)
        }
        return
      }
      if (event.code !== 'Space' || !syncMode) return
      event.preventDefault()
      const held = syncHeldRef.current
      if (!held) return
      const rawCurrentMs = Math.max(0, lyricTimeAtPlayback(currentTimeRef.current, project.offsetMs))
      const endMs = Math.max(held.startMs + 100, rawCurrentMs)
      commit((current) => patchWord(current, held.wordId, { startMs: Math.round(held.startMs), endMs: Math.round(endMs) }))
      syncHeldRef.current = null
      setHeldWordId(null)
      setSyncCursor((index) => {
        const next = index + 1
        if (next >= syncWords.length) {
          setSyncMode(false)
          showToast('Track timing complete', 'success')
        }
        return next
      })
    }

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [commit, playback.play, playback.seek, playback.toggle, project.offsetMs, selectedWordIds, showToast, syncCursor, syncMode, syncWords])

  useEffect(() => {
    if (!window.studio) return
    return window.studio.onMenuAction((action) => {
      if (
        videoExportActiveRef.current &&
        ['new', 'open', 'import-audio', 'import-lrc'].includes(action)
      ) {
        showToast('Cancel the video export before changing projects or media.', 'warning')
        return
      }
      if (action === 'new') handleNew()
      else if (action === 'open') void handleOpen()
      else if (action === 'save') void handleSave(false)
      else if (action === 'save-as') void handleSave(true)
      else if (action === 'import-audio') void handleImportAudio()
      else if (action === 'import-lrc') void handleImportLrc()
      else if (action === 'export') setExportDialogOpen(true)
      else if (action === 'play-toggle') playback.toggle()
      else if (action === 'undo') history.undo()
      else if (action === 'redo') history.redo()
    })
  }, [handleImportAudio, handleImportLrc, handleNew, handleOpen, handleSave, history.redo, history.undo, playback.toggle, showToast])

  const workflowGuideActions = createWorkflowGuideActions({
    canStartSync: syncWords.length > 0,
    close: () => setWorkflowGuideOpen(false),
    startNew: handleNew,
    open: () => void handleOpen(),
    attachAudio: () => void handleImportAudio(),
    editLyrics: () => setLyricsDialogOpen(true),
    importLrc: () => void handleImportLrc(),
    startSync: toggleSyncMode,
    save: () => void handleSave(false),
    exportProject: () => setExportDialogOpen(true),
  })

  const syncWordId = heldWordId ?? (syncMode ? syncWords[syncCursor]?.id ?? null : null)

  return (
    <div className="app-shell">
      <TopBar
        title={project.title}
        dirty={history.dirty}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        issueCount={reviewIssues.length}
        onNew={handleNew}
        onOpen={() => void handleOpen()}
        onSave={() => void handleSave(false)}
        onUndo={history.undo}
        onRedo={history.redo}
        onShowWorkflow={() => setWorkflowGuideOpen(true)}
        onValidate={() => setValidationDialogOpen(true)}
        onExport={() => setExportDialogOpen(true)}
      />

      <main className="studio-main">
        <InspectorPanel
          project={project}
          activeTrackId={activeTrackId}
          onSelectTrack={(trackId) => { setActiveTrackId(trackId); setSelectedWordIds(new Set()) }}
          onUpdateProject={updateProject}
          onUpdateTrack={updateTrack}
          onAddTrack={() => {
            const track = createVocalTrack({ id: crypto.randomUUID(), name: 'Duet Vocal', color: '#ff8f6b' })
            commit((current) => ({ ...current, tracks: [...current.tracks, track], updatedAt: new Date().toISOString() }))
            setActiveTrackId(track.id)
          }}
          onImportAudio={() => void handleImportAudio()}
          onImportLrc={() => void handleImportLrc()}
          onClearTiming={() => {
            if (!activeTrack) return
            replaceTrack(activeTrack.id, {
              ...activeTrack,
              lines: activeTrack.lines.map((line) => ({
                ...line,
                startMs: null,
                endMs: null,
                words: line.words.map((word) => ({ ...word, startMs: null, endMs: null })),
              })),
            })
          }}
        />

        <div className="unified-workspace">
          <div className="workspace-top">
            <KaraokePreview
              project={previewProject}
              playbackMs={playback.currentMs}
              lyricMs={lyricTimeMs}
              selectedWordIds={selectedWordIds}
            />
            <LyricsPanel
              tracks={project.tracks}
              activeTrackId={activeTrackId}
              lyricMs={lyricTimeMs}
              selectedWordIds={selectedWordIds}
              syncWordId={syncWordId}
              onSelectTrack={(trackId) => { setActiveTrackId(trackId); setSelectedWordIds(new Set()) }}
              onSelectWord={handleSelectWord}
              onEditLyrics={() => setLyricsDialogOpen(true)}
            />
          </div>

          <Timeline
            project={project}
            peaks={waveform.peaks}
            isAnalyzing={waveform.isAnalyzing}
            durationMs={playback.durationMs}
            currentMs={playback.currentMs}
            zoom={zoom}
            activeTrackId={activeTrackId}
            selectedWordIds={selectedWordIds}
            syncWordId={syncWordId}
            onSeek={playback.seek}
            onZoom={setZoom}
            onSelectWord={handleSelectWordId}
            onShiftWords={(ids, deltaMs) => commit((current) => shiftWords(current, ids, deltaMs))}
            onResizeWord={(wordId, startMs, endMs) => commit((current) => patchWord(current, wordId, { startMs, endMs }))}
            onTimingDraftChange={updateTimingDraft}
          />
        </div>
      </main>

      <TransportBar
        currentMs={playback.currentMs}
        durationMs={playback.durationMs}
        isPlaying={playback.isPlaying}
        rate={playback.rate}
        volume={playback.volume}
        syncMode={syncMode}
        syncPosition={syncCursor}
        syncTotal={syncWords.length}
        hasAudio={playback.hasAudio}
        onToggle={playback.toggle}
        onSeek={playback.seek}
        onRate={playback.setRate}
        onVolume={playback.setVolume}
        onToggleSync={toggleSyncMode}
      />

      <input
        ref={projectInputRef}
        hidden
        type="file"
        accept=".oks,.json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then((contents) => openProjectContents(contents, null))
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={audioInputRef}
        hidden
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.flac,.aac,.ogg"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) applyAudio(file.name, URL.createObjectURL(file), file.name)
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={lrcInputRef}
        hidden
        type="file"
        accept=".lrc,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void file.text().then(applyLrc)
          event.currentTarget.value = ''
        }}
      />

      {lyricsDialogOpen && activeTrack && (
        <LyricsEditorDialog
          track={activeTrack}
          onClose={() => setLyricsDialogOpen(false)}
          onSave={(text) => {
            replaceTrack(activeTrack.id, parseLyrics(text, activeTrack.id, activeTrack))
            setLyricsDialogOpen(false)
            showToast('Lyrics updated', 'success')
          }}
        />
      )}
      {workflowGuideOpen && activeTrack && (
        <WorkflowGuideDialog {...workflowGuideActions} />
      )}
      {exportDialogOpen && activeTrack && (
        <ExportDialog
          projectTitle={project.title}
          activeTrackName={activeTrack.name}
          issueCount={reviewIssues.length}
          onClose={() => setExportDialogOpen(false)}
          onExportLrc={() => void exportText('lrc')}
          onExportAss={() => void exportText('ass')}
          onExportVideo={() => void exportVideo()}
          onCancelVideo={cancelVideoExport}
          onExportProject={() => void exportText(EDITABLE_PROJECT_EXPORT_FORMAT)}
          videoAvailable={Boolean(window.studio?.exportVideo && project.audioPath && playback.hasAudio)}
          videoProgress={videoExportProgress}
        />
      )}
      {validationDialogOpen && <ValidationDialog issues={reviewIssues} onClose={() => setValidationDialogOpen(false)} />}
      {toast && <div className={`toast toast--${toast.tone}`} role="status"><span />{toast.message}</div>}
    </div>
  )
}
