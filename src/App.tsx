import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KaraokeProject, LyricDisplaySettings, LyricWord, ValidationIssue, VocalTrack } from './lib/model'
import {
  createProject,
  exportAss,
  exportLrc,
  importLrc,
  parseLyrics,
  parseProject,
  serializeProject,
  validateProject,
} from './lib/model'
import { cloneVocalStyle } from './lib/video-style'
import { TopBar } from './components/TopBar'
import { InspectorPanel } from './components/InspectorPanel'
import { KaraokePreview } from './components/KaraokePreview'
import { SyncCueStrip } from './components/SyncCueStrip'
import { Timeline } from './components/Timeline'
import { TransportBar } from './components/TransportBar'
import { ExportDialog, LyricsEditorDialog, ValidationDialog, WorkflowGuideDialog } from './components/Dialogs'
import { usePlayback } from './hooks/usePlayback'
import { useWaveform } from './hooks/useWaveform'
import { useProjectActionArbiter } from './hooks/useProjectActionArbiter'
import type { ProjectActionKind, ProjectActionRequest } from './lib/project-action-arbiter'
import {
  downloadText,
  effectiveDuration,
  flattenProject,
  flattenTrack,
  applyTimingDraft,
  clearTrackTimingFrom,
  patchWord,
  patchWords,
  recalculateLine,
  shiftWords,
  slugify,
  type ProjectTimingDraft,
} from './utils'

interface HistoryEntry {
  project: KaraokeProject
  revision: number
}

function useProjectHistory(initialProject: KaraokeProject | (() => KaraokeProject)) {
  const sequenceRef = useRef(0)
  const pastRef = useRef<HistoryEntry[]>([])
  const futureRef = useRef<HistoryEntry[]>([])
  const [entry, setEntry] = useState<HistoryEntry>(() => ({
    project: typeof initialProject === 'function' ? initialProject() : initialProject,
    revision: 0,
  }))
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

  const markSaved = useCallback((revision: number) => setSavedRevision(revision), [])

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

function eventTargetsSpaceActivatableControl(event: KeyboardEvent) {
  const target = event.target
  return target instanceof Element && Boolean(target.closest('button, a[href], summary, [role="button"], [role="menuitem"]'))
}

function selectAllInFocusedEditor() {
  const element = document.activeElement
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    try {
      element.select()
    } catch {
      // Non-text input types do not expose a selectable text range.
    }
    return true
  }
  if (element instanceof HTMLSelectElement) return true
  if (element instanceof HTMLElement && element.isContentEditable) {
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(element.closest('[contenteditable]') ?? element)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    return true
  }
  return false
}

export function lyricTimeAtPlayback(playbackMs: number, offsetMs: number) {
  return playbackMs - offsetMs
}

export function syncWordIndexFromLyricTime(words: LyricWord[], lyricTimeMs: number) {
  const boundaryMs = lyricTimeMs - 80
  const untimedIsEligible = new Set<number>()
  let nextTimedStartMs: number | null = null
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index]
    if (word.startMs !== null) {
      nextTimedStartMs = word.startMs
    } else if (nextTimedStartMs === null || nextTimedStartMs >= boundaryMs) {
      untimedIsEligible.add(index)
    }
  }
  return words.findIndex((word, index) => (
    word.startMs === null
      ? untimedIsEligible.has(index)
      : word.startMs >= boundaryMs
  ))
}

const DEFAULT_SYNC_WORD_DURATION_MS = 100

function syncWordEnd(word: LyricWord): number | null {
  if (word.startMs === null) return null
  return Math.max(word.startMs + 1, word.endMs ?? word.startMs + DEFAULT_SYNC_WORD_DURATION_MS)
}

function adjacentTimedWord(
  words: LyricWord[],
  index: number,
  direction: -1 | 1,
): LyricWord | null {
  for (
    let candidateIndex = index + direction;
    candidateIndex >= 0 && candidateIndex < words.length;
    candidateIndex += direction
  ) {
    if (words[candidateIndex].startMs !== null) return words[candidateIndex]
  }
  return null
}

export default function App() {
  const history = useProjectHistory(createProject)
  const { project, commit: commitHistory, replaceCurrent } = history
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [activeTrackId, setActiveTrackId] = useState(project.tracks[0]?.id ?? '')
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [syncMode, setSyncMode] = useState(false)
  const [syncCursor, setSyncCursor] = useState(0)
  const [lyricsDialogOpen, setLyricsDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [videoExportProgress, setVideoExportProgress] = useState<StudioVideoExportProgress | null>(null)
  const [validationDialogOpen, setValidationDialogOpen] = useState(false)
  const [workflowGuideOpen, setWorkflowGuideOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [projectAuthorityWarning, setProjectAuthorityWarning] = useState<string | null>(null)
  const [timingDraft, setTimingDraft] = useState<ActiveTimingDraft | null>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const lrcInputRef = useRef<HTMLInputElement>(null)
  const syncHeldRef = useRef<{
    wordId: string
    startMs: number
    isLineFinal: boolean
    nextTimedStartMs: number | null
  } | null>(null)
  const syncSessionHasCommitRef = useRef(false)
  const projectRestoreSequenceRef = useRef(0)
  const projectLifecycleSequenceRef = useRef(0)
  const projectTransitionRef = useRef(false)
  const projectAuthorityCertainRef = useRef(true)
  const saveRequestSequenceRef = useRef(0)
  const videoExportActiveRef = useRef(false)
  const lastReviewIssuesRef = useRef<ValidationIssue[]>([])

  const projectMutationIsBlocked = useCallback(() => projectTransitionRef.current, [])

  // Any ordinary edit ends an armed synchronization transaction before it
  // creates its own history entry. Sync timing uses commitHistory directly so
  // its first real mutation can remain the session's single undo baseline.
  const commit = useCallback(
    (updater: KaraokeProject | ((project: KaraokeProject) => KaraokeProject)) => {
      if (projectMutationIsBlocked()) return
      syncHeldRef.current = null
      syncSessionHasCommitRef.current = false
      setSyncMode(false)
      commitHistory(updater)
    },
    [commitHistory, projectMutationIsBlocked],
  )

  const persistAudioDuration = useCallback(
    (nextDurationMs: number) => {
      if (projectMutationIsBlocked()) return
      replaceCurrent((current) =>
        current.durationMs === nextDurationMs
          ? current
          : { ...current, durationMs: nextDurationMs },
      )
    },
    [projectMutationIsBlocked, replaceCurrent],
  )

  const activeTrack = project.tracks.find((track) => track.id === activeTrackId) ?? project.tracks[0]
  const syncItems = useMemo(() => (activeTrack ? flattenTrack(activeTrack) : []), [activeTrack])
  const syncWords = useMemo(() => syncItems.map(({ word }) => word), [syncItems])
  const projectHasLyrics = useMemo(
    () => project.tracks.some((track) => track.lines.some((line) => line.words.length > 0)),
    [project.tracks],
  )
  const durationMs = useMemo(() => effectiveDuration(project), [project])
  const playback = usePlayback({
    durationMs,
    audioUrl,
    onDuration: persistAudioDuration,
    refreshIntervalMs: syncMode ? 50 : 16,
  })
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

  const reviewProject = syncMode ? null : project
  const reviewIssues = useMemo<ValidationIssue[]>(() => {
    if (!reviewProject) return lastReviewIssuesRef.current
    const issues = validateProject(reviewProject)
    reviewProject.tracks.forEach((track, trackIndex) => {
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
    lastReviewIssuesRef.current = issues
    return issues
  }, [reviewProject])

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'neutral') => setToast({ message, tone }), [])

  const beginProjectTransition = useCallback(() => {
    if (projectTransitionRef.current) {
      showToast('Wait for the current project change to finish.', 'warning')
      return false
    }
    projectTransitionRef.current = true
    return true
  }, [showToast])

  const blockUncertainProjectAuthority = useCallback(() => {
    if (projectAuthorityCertainRef.current) return false
    showToast('Reopen a project or start New before continuing.', 'warning')
    return true
  }, [showToast])

  const blockProjectSideEffect = useCallback(() => {
    if (projectTransitionRef.current) {
      showToast('Wait for the current project change to finish.', 'warning')
      return true
    }
    return blockUncertainProjectAuthority()
  }, [blockUncertainProjectAuthority, showToast])

  const markProjectAuthorityUncertain = useCallback(() => {
    projectAuthorityCertainRef.current = false
    setProjectAuthorityWarning(
      'Project access could not be confirmed. Reopen a project or start New before saving or linking media.',
    )
  }, [])

  const markProjectAuthorityCertain = useCallback(() => {
    projectAuthorityCertainRef.current = true
    setProjectAuthorityWarning(null)
  }, [])

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

  const updateLyricDisplay = useCallback((patch: Partial<LyricDisplaySettings>) => {
    commit((current) => ({
      ...current,
      lyricDisplay: { ...current.lyricDisplay, ...patch },
      updatedAt: new Date().toISOString(),
    }))
  }, [commit])

  const updateTrack = useCallback((trackId: string, patch: Partial<Pick<VocalTrack, 'name' | 'vocalStyle' | 'muted' | 'solo'>>) => {
    commit((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      tracks: current.tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track)),
    }))
  }, [commit])

  const openProjectContents = useCallback(
    async (contents: string, path: string | null, pendingRequestId: string | null = null) => {
      const settlePendingOpen = async (accepted: boolean) => {
        if (!pendingRequestId) return true
        if (!window.studio?.settleProjectOpen) return false
        return window.studio.settleProjectOpen(pendingRequestId, accepted)
      }
      if (!beginProjectTransition()) {
        if (pendingRequestId) void settlePendingOpen(false).catch(() => false)
        return false
      }

      let next: KaraokeProject | null = null
      let restoreSequence = 0
      try {
        try {
          next = parseProject(contents)
        } catch (error) {
          await settlePendingOpen(false).catch(() => false)
          showToast(
            error instanceof Error ? error.message : 'Could not open that project.',
            'warning',
          )
          return false
        }

        if (!confirmDiscardChanges('Discard the unsaved changes and open another project?')) {
          await settlePendingOpen(false).catch(() => false)
          return false
        }

        if (pendingRequestId) {
          try {
            if (!(await settlePendingOpen(true))) {
              showToast('The selected project is no longer pending. Open it again.', 'warning')
              return false
            }
          } catch (error) {
            markProjectAuthorityUncertain()
            showToast(
              error instanceof Error && error.message.trim()
                ? error.message
                : 'Project access acknowledgement was lost.',
              'warning',
            )
            return false
          }
        }

        restoreSequence = projectRestoreSequenceRef.current + 1
        projectRestoreSequenceRef.current = restoreSequence
        projectLifecycleSequenceRef.current += 1
        history.reset(next, true)
        setProjectPath(path)
        setActiveTrackId(next.tracks[0]?.id ?? '')
        setSelectedWordIds(new Set())
        setSyncMode(false)
        syncHeldRef.current = null
        syncSessionHasCommitRef.current = false
        playback.pause()
        playback.seek(0)
        setAudioUrl(null)
        markProjectAuthorityCertain()
        await Promise.resolve()
      } finally {
        projectTransitionRef.current = false
      }

      if (!next.audioPath) {
        showToast(`Opened ${next.title}`, 'success')
        return true
      }
      if (!window.studio?.resolveProjectAudio || !path) {
        showToast('Project opened; relink its audio file in this browser.', 'warning')
        return true
      }

      try {
        const resolved = await window.studio.resolveProjectAudio(path)
        if (restoreSequence !== projectRestoreSequenceRef.current) return false
        setAudioUrl(resolved?.url ?? null)
        showToast(
          resolved ? `Opened ${next.title}` : 'Project opened; relink the missing audio file.',
          resolved ? 'success' : 'warning',
        )
      } catch (error) {
        if (restoreSequence !== projectRestoreSequenceRef.current) return false
        const detail = error instanceof Error ? error.message : 'Audio restoration failed.'
        showToast(`Project opened, but its audio could not be restored: ${detail}`, 'warning')
      }
      return true
    },
    [
      beginProjectTransition,
      confirmDiscardChanges,
      history.reset,
      markProjectAuthorityCertain,
      markProjectAuthorityUncertain,
      playback.pause,
      playback.seek,
      showToast,
    ],
  )

  const handleNew = useCallback(async () => {
    if (!beginProjectTransition()) return false
    try {
      if (!confirmDiscardChanges('Discard the unsaved changes and start a new project?')) {
        return false
      }
      if (window.studio) {
        try {
          if (!window.studio.resetProjectScope || !(await window.studio.resetProjectScope())) {
            showToast(
              'The current project could not be cleared. Keep editing and try again.',
              'warning',
            )
            return false
          }
        } catch (error) {
          markProjectAuthorityUncertain()
          showToast(
            error instanceof Error && error.message.trim()
              ? error.message
              : 'Project reset acknowledgement was lost.',
            'warning',
          )
          return false
        }
      }

      projectRestoreSequenceRef.current += 1
      projectLifecycleSequenceRef.current += 1
      const next = createProject({ title: 'Untitled Song', artist: 'Unknown Artist' })
      history.reset(next, true)
      setProjectPath(null)
      setAudioUrl(null)
      setActiveTrackId(next.tracks[0]?.id ?? '')
      setSelectedWordIds(new Set())
      setSyncMode(false)
      syncHeldRef.current = null
      syncSessionHasCommitRef.current = false
      playback.pause()
      playback.seek(0)
      markProjectAuthorityCertain()
      showToast('New project ready', 'neutral')
      return true
    } finally {
      projectTransitionRef.current = false
    }
  }, [
    beginProjectTransition,
    confirmDiscardChanges,
    history.reset,
    markProjectAuthorityCertain,
    markProjectAuthorityUncertain,
    playback.pause,
    playback.seek,
    showToast,
  ])

  const handleOpen = useCallback(async () => {
    if (projectTransitionRef.current) {
      showToast('Wait for the current project change to finish.', 'warning')
      return false
    }
    if (!window.studio) {
      projectInputRef.current?.click()
      return false
    }
    let result: StudioOpenProjectResult | null
    try {
      result = await window.studio.openProject()
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Project could not be opened.'
      showToast(message, 'warning')
      return false
    }
    if (result && (typeof result.requestId !== 'string' || !result.requestId)) {
      showToast(
        'The selected project did not include a valid access handle. Open it again.',
        'warning',
      )
      return false
    }
    return result ? openProjectContents(result.contents, result.path, result.requestId) : false
  }, [openProjectContents, showToast])

  const handleSave = useCallback(
    async (saveAs = false) => {
      if (blockProjectSideEffect()) return
      const saveRequestSequence = saveRequestSequenceRef.current + 1
      saveRequestSequenceRef.current = saveRequestSequence
      const projectLifecycleSequence = projectLifecycleSequenceRef.current
      const savedRevision = history.revision
      const saveIsCurrent = () =>
        saveRequestSequence === saveRequestSequenceRef.current &&
        projectLifecycleSequence === projectLifecycleSequenceRef.current

      try {
        const contents = serializeProject(project)
        const suggestedName = `${slugify(project.title)}.oks`
        if (window.studio) {
          const result = await window.studio.saveProject({
            path: saveAs ? undefined : (projectPath ?? undefined),
            suggestedName,
            contents,
          })
          if (!result) return
          if (!saveIsCurrent()) return
          setProjectPath(result.path)
        } else {
          downloadText(suggestedName, contents, 'application/json')
        }
        if (!saveIsCurrent()) return
        history.markSaved(savedRevision)
        showToast('Project saved', 'success')
      } catch (error) {
        if (!saveIsCurrent()) return
        setValidationDialogOpen(true)
        showToast(error instanceof Error ? error.message : 'Project could not be saved.', 'warning')
      }
    },
    [blockProjectSideEffect, history.markSaved, history.revision, project, projectPath, showToast],
  )

  const applyAudio = useCallback((path: string, url: string, name?: string) => {
    projectRestoreSequenceRef.current += 1
    playback.pause()
    playback.seek(0)
    setAudioUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current)
      return url
    })
    commit((current) => ({ ...current, audioPath: path, updatedAt: new Date().toISOString() }))
    showToast(`${name ?? path.split('/').pop() ?? 'Audio'} linked`, 'success')
  }, [commit, playback.pause, playback.seek, showToast])

  const handleImportAudio = useCallback(async () => {
    if (blockProjectSideEffect()) return
    if (window.studio) {
      const result = await window.studio.importAudio()
      if (result && !blockProjectSideEffect()) applyAudio(result.path, result.url, result.name)
    } else {
      audioInputRef.current?.click()
    }
  }, [applyAudio, blockProjectSideEffect])

  const applyLrc = useCallback((contents: string) => {
    if (!activeTrack) return
    try {
      const imported = importLrc(contents, activeTrack.id, project.offsetMs)
      replaceTrack(activeTrack.id, {
        ...imported,
        name: activeTrack.name,
        vocalStyle: cloneVocalStyle(activeTrack.vocalStyle),
      })
      setSelectedWordIds(new Set())
      syncHeldRef.current = null
      syncSessionHasCommitRef.current = false
      setSyncMode(false)
      showToast(`Imported LRC into ${activeTrack.name}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import that LRC file.', 'warning')
    }
  }, [activeTrack, project.offsetMs, replaceTrack, showToast])

  const handleImportLrc = useCallback(async () => {
    if (blockProjectSideEffect()) return
    if (window.studio) {
      const result = await window.studio.importLrc()
      if (result && !blockProjectSideEffect()) applyLrc(result.contents)
    } else {
      lrcInputRef.current?.click()
    }
  }, [applyLrc, blockProjectSideEffect])

  const exportText = useCallback(
    async (format: StudioExportFormat) => {
      if (blockProjectSideEffect()) return
      if (!activeTrack) return
      try {
        const base = slugify(`${project.artist}-${project.title}`)
        const contents =
          format === 'lrc'
            ? exportLrc(project, activeTrack.id)
            : format === 'ass'
              ? exportAss(project)
              : serializeProject(project)
        const suggestedName = `${base}.${format}`
        if (window.studio) {
          const result = await window.studio.exportText({ suggestedName, contents, format })
          if (!result) return
        } else {
          downloadText(
            suggestedName,
            contents,
            format === 'oks' ? 'application/json' : 'text/plain',
          )
        }
        setExportDialogOpen(false)
        showToast(`${format.toUpperCase()} export created`, 'success')
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Export failed.', 'warning')
      }
    },
    [activeTrack, blockProjectSideEffect, project, showToast],
  )

  const exportVideo = useCallback(
    async ({ resolution, fps }: Pick<StudioVideoExportOptions, 'resolution' | 'fps'>) => {
      if (blockProjectSideEffect()) return
      if (project.stageStyle.background.mode === 'image')
        return void showToast(
          'Linked-image video export is deferred until Live Preview can verify the same image.',
          'warning',
        )
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
          resolution,
          fps,
        })
        if (!result) return
        setExportDialogOpen(false)
        const fallback = result.fontFallbacks?.[0]
        showToast(
          fallback
            ? `Video exported with ${fallback.effective} because ${fallback.requested} was unavailable`
            : `Video export created with ${result.frameCount} lyric frames`,
          fallback ? 'warning' : 'success',
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Video export failed.'
        const canceled = /cancel(?:led|ed|ing)/iu.test(detail)
        showToast(
          canceled
            ? 'Video export cancelled; any partial MP4 was kept beside the destination'
            : detail,
          canceled ? 'neutral' : 'warning',
        )
      } finally {
        videoExportActiveRef.current = false
        setVideoExportProgress(null)
      }
    },
    [
      blockProjectSideEffect,
      playback.durationMs,
      playback.hasAudio,
      playback.pause,
      project,
      showToast,
    ],
  )

  const cancelVideoExport = useCallback(async () => {
    if (!window.studio?.cancelVideoExport) return false
    return window.studio.cancelVideoExport()
  }, [])

  const openExportDialog = useCallback(() => {
    if (!blockProjectSideEffect()) setExportDialogOpen(true)
  }, [blockProjectSideEffect])

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

  const cancelHeldSync = useCallback(() => {
    syncHeldRef.current = null
  }, [])

  const applySyncMutation = useCallback(
    (updater: (current: KaraokeProject) => KaraokeProject) => {
      if (projectMutationIsBlocked()) return false
      if (syncSessionHasCommitRef.current) {
        replaceCurrent(updater)
        return true
      }
      commitHistory((current) => {
        const next = updater(current)
        if (next === current) return current
        syncSessionHasCommitRef.current = true
        return next
      })
      return true
    },
    [commitHistory, projectMutationIsBlocked, replaceCurrent],
  )

  const handleUndo = useCallback(() => {
    if (projectMutationIsBlocked()) return
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    history.undo()
  }, [cancelHeldSync, history.undo, projectMutationIsBlocked])

  const handleRedo = useCallback(() => {
    if (projectMutationIsBlocked()) return
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    history.redo()
  }, [cancelHeldSync, history.redo, projectMutationIsBlocked])

  const nativeCloseBridge = useMemo(() => {
    const studio = window.studio
    if (
      !studio?.onWindowCloseRequest ||
      !studio.getPendingWindowClose ||
      !studio.resolveWindowClose
    ) {
      return undefined
    }
    return {
      onWindowCloseRequest: studio.onWindowCloseRequest,
      getPendingWindowClose: studio.getPendingWindowClose,
      resolveWindowClose: studio.resolveWindowClose,
    }
  }, [])

  const { request: arbitrateProjectAction } = useProjectActionArbiter({
    nativeClose: nativeCloseBridge,
    executors: {
      new: handleNew,
      open: handleOpen,
      save: () => handleSave(false),
      'save-as': () => handleSave(true),
      export: openExportDialog,
      'import-audio': handleImportAudio,
      'import-lrc': handleImportLrc,
      undo: handleUndo,
      redo: handleRedo,
      'native-close': (request: ProjectActionRequest) =>
        request.kind === 'native-close'
          ? (nativeCloseBridge?.resolveWindowClose(request.nativeRequestId, true) ?? false)
          : false,
    },
  })

  const requestProjectAction = useCallback(
    (kind: Exclude<ProjectActionKind, 'native-close'>, source: 'ui' | 'menu' = 'ui') =>
      arbitrateProjectAction({ kind, source }),
    [arbitrateProjectAction],
  )

  const selectAllActiveTrackWords = useCallback(() => {
    setSelectedWordIds(new Set(activeTrack ? flattenTrack(activeTrack).map(({ word }) => word.id) : []))
  }, [activeTrack])

  const handleSelectWordId = useCallback((wordId: string, add: boolean) => {
    const item = flattenProject(project).find(({ word }) => word.id === wordId)
    if (item) {
      const changingTrack = item.track.id !== activeTrackId
      if (changingTrack) {
        cancelHeldSync()
        syncSessionHasCommitRef.current = false
        setSyncMode(false)
        setActiveTrackId(item.track.id)
      }
      handleSelectWord(item.word, changingTrack ? false : add)
    }
  }, [activeTrackId, cancelHeldSync, handleSelectWord, project])

  const clearActiveTrackTimingFrom = useCallback((fromMs: number, successMessage: string, emptyMessage: string) => {
    if (!activeTrack) return
    const nextTrack = clearTrackTimingFrom(activeTrack, fromMs)
    if (nextTrack === activeTrack) {
      showToast(emptyMessage, 'neutral')
      return
    }
    playback.pause()
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    setSelectedWordIds(new Set())
    replaceTrack(activeTrack.id, nextTrack)
    showToast(successMessage, 'success')
  }, [activeTrack, cancelHeldSync, playback.pause, replaceTrack, showToast])

  const handleClearTiming = useCallback(() => {
    clearActiveTrackTimingFrom(0, 'Cleared active-track timing', 'The active track has no timing to clear')
  }, [clearActiveTrackTimingFrom])

  const handleClearTimingAfterCursor = useCallback(() => {
    clearActiveTrackTimingFrom(
      lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs),
      'Cleared active-track timing from the playhead',
      'No active-track timing starts at or after the playhead',
    )
  }, [clearActiveTrackTimingFrom, playback.getCurrentMs, project.offsetMs])

  const handleStop = useCallback(() => {
    cancelHeldSync()
    setSyncMode(false)
    syncSessionHasCommitRef.current = false
    playback.pause()
    playback.seek(0)
  }, [cancelHeldSync, playback.pause, playback.seek])

  const toggleSyncMode = useCallback(() => {
    if (syncMode) {
      cancelHeldSync()
      setSyncMode(false)
      syncSessionHasCommitRef.current = false
      return
    }
    if (!syncWords.length) {
      showToast('Add lyrics before starting sync', 'warning')
      return
    }
    const lyricTimeMs = lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs)
    const fromPlayhead = syncWordIndexFromLyricTime(syncWords, lyricTimeMs)
    if (fromPlayhead < 0) {
      showToast('No words remain at or after the playhead', 'neutral')
      return
    }
    syncSessionHasCommitRef.current = false
    setSyncCursor(fromPlayhead)
    setSyncMode(true)
    playback.play()
    showToast('Tap sync armed — press each word onset; hold the final word of a line', 'neutral')
  }, [cancelHeldSync, playback.getCurrentMs, playback.play, project.offsetMs, showToast, syncMode, syncWords])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (inputHasTypingFocus()) return
      if (event.code === 'Escape' && syncMode) {
        event.preventDefault()
        setSyncMode(false)
        cancelHeldSync()
        syncSessionHasCommitRef.current = false
        return
      }
      if (
        event.code === 'KeyA' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault()
        selectAllActiveTrackWords()
        return
      }
      if ((event.code === 'Backspace' || event.code === 'Delete') && selectedWordIds.size) {
        event.preventDefault()
        const patches = new Map(
          [...selectedWordIds].map((id) => [id, { startMs: null, endMs: null }]),
        )
        commit((current) => patchWords(current, patches))
        return
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        playback.seek(playback.getCurrentMs() - (event.shiftKey ? 1000 : 250))
        return
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        playback.seek(playback.getCurrentMs() + (event.shiftKey ? 1000 : 250))
        return
      }
      if (event.code !== 'Space') return
      const exactShiftSpace = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      const exactBareSpace = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      if (!exactShiftSpace && !exactBareSpace) return
      if (exactBareSpace && !syncMode && eventTargetsSpaceActivatableControl(event)) return
      event.preventDefault()
      if (exactShiftSpace) {
        if (!event.repeat) playback.toggle()
        return
      }
      if (!syncMode) return
      if (event.repeat || syncHeldRef.current) return
      const item = syncItems[syncCursor]
      if (!item) {
        setSyncMode(false)
        syncSessionHasCommitRef.current = false
        showToast('All words are timed', 'success')
        return
      }

      const sampledLyricMs = lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs)
      if (sampledLyricMs < 0) {
        showToast('The lyric clock has not reached 0:00 yet', 'neutral')
        return
      }
      const previous = syncItems[syncCursor - 1]
      const sameLine = previous?.line.id === item.line.id
      const previousTimed = adjacentTimedWord(syncWords, syncCursor, -1)
      const nextTimed = adjacentTimedWord(syncWords, syncCursor, 1)
      const previousEndMs = previousTimed ? syncWordEnd(previousTimed) : null
      const nextTimedStartMs = nextTimed?.startMs ?? null
      const startMs = Math.max(Math.round(sampledLyricMs), previousEndMs ?? 0)

      if (nextTimedStartMs !== null && startMs >= nextTimedStartMs) {
        showToast('No timing space remains before the next timed word', 'warning')
        return
      }

      const patches = new Map<string, Partial<Pick<LyricWord, 'startMs' | 'endMs'>>>()
      if (previous && sameLine && previous.word.startMs !== null) {
        patches.set(previous.word.id, { endMs: startMs })
      }
      patches.set(item.word.id, {
        startMs,
        endMs: Math.min(
          startMs + DEFAULT_SYNC_WORD_DURATION_MS,
          nextTimedStartMs ?? Number.POSITIVE_INFINITY,
        ),
      })
      if (!applySyncMutation((current) => patchWords(current, patches))) return
      syncHeldRef.current = {
        wordId: item.word.id,
        startMs,
        isLineFinal: item.wordIndex === item.line.words.length - 1,
        nextTimedStartMs,
      }
      playback.play()
    }

    const keyUp = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) {
        if (event.code === 'Space') {
          cancelHeldSync()
        }
        return
      }
      if (event.code !== 'Space' || !syncMode) return
      const held = syncHeldRef.current
      if (!held) return
      event.preventDefault()
      if (projectMutationIsBlocked()) {
        cancelHeldSync()
        return
      }
      if (held.isLineFinal) {
        const sampledLyricMs = lyricTimeAtPlayback(playback.getCurrentMs(), project.offsetMs)
        const endMs = Math.min(
          Math.max(held.startMs + DEFAULT_SYNC_WORD_DURATION_MS, Math.round(sampledLyricMs)),
          held.nextTimedStartMs ?? Number.POSITIVE_INFINITY,
        )
        applySyncMutation((current) =>
          patchWord(current, held.wordId, {
            startMs: held.startMs,
            endMs,
          }),
        )
      }
      cancelHeldSync()
      setSyncCursor((index) => {
        const next = index + 1
        if (next >= syncItems.length) {
          setSyncMode(false)
          syncSessionHasCommitRef.current = false
          showToast('Track timing complete', 'success')
        }
        return next
      })
    }

    const windowBlur = () => cancelHeldSync()

    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', windowBlur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', windowBlur)
    }
  }, [
    applySyncMutation,
    cancelHeldSync,
    commit,
    playback.getCurrentMs,
    playback.play,
    playback.seek,
    playback.toggle,
    project.offsetMs,
    projectMutationIsBlocked,
    selectAllActiveTrackWords,
    selectedWordIds,
    showToast,
    syncCursor,
    syncItems,
    syncMode,
    syncWords,
  ])

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
      if (action === 'new') requestProjectAction('new', 'menu')
      else if (action === 'open') requestProjectAction('open', 'menu')
      else if (action === 'save') requestProjectAction('save', 'menu')
      else if (action === 'save-as') requestProjectAction('save-as', 'menu')
      else if (action === 'import-audio') requestProjectAction('import-audio', 'menu')
      else if (action === 'import-lrc') requestProjectAction('import-lrc', 'menu')
      else if (action === 'export') requestProjectAction('export', 'menu')
      else if (action === 'play-toggle') playback.toggle()
      else if (action === 'select-all') {
        const editorHandledSelection = selectAllInFocusedEditor()
        if (!editorHandledSelection && !document.querySelector('[role="dialog"]')) {
          selectAllActiveTrackWords()
        }
      } else if (action === 'undo') requestProjectAction('undo', 'menu')
      else if (action === 'redo') requestProjectAction('redo', 'menu')
    })
  }, [playback.toggle, requestProjectAction, selectAllActiveTrackWords, showToast])

  const handleSelectTrack = useCallback((trackId: string) => {
    cancelHeldSync()
    syncSessionHasCommitRef.current = false
    setSyncMode(false)
    setActiveTrackId(trackId)
    setSelectedWordIds(new Set())
  }, [cancelHeldSync])

  const workflowGuideActions = createWorkflowGuideActions({
    canStartSync: syncWords.length > 0,
    close: () => setWorkflowGuideOpen(false),
    startNew: () => requestProjectAction('new'),
    open: () => requestProjectAction('open'),
    attachAudio: () => requestProjectAction('import-audio'),
    editLyrics: () => setLyricsDialogOpen(true),
    importLrc: () => requestProjectAction('import-lrc'),
    startSync: toggleSyncMode,
    save: () => requestProjectAction('save'),
    exportProject: () => requestProjectAction('export'),
  })

  const syncWordId = syncMode ? syncWords[syncCursor]?.id ?? null : null

  return (
    <div className="app-shell">
      <TopBar
        title={project.title}
        dirty={history.dirty}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        issueCount={reviewIssues.length}
        hasLyrics={projectHasLyrics}
        onNew={() => requestProjectAction('new')}
        onOpen={() => requestProjectAction('open')}
        onSave={() => requestProjectAction('save')}
        onUndo={() => requestProjectAction('undo')}
        onRedo={() => requestProjectAction('redo')}
        onShowWorkflow={() => setWorkflowGuideOpen(true)}
        onValidate={() => setValidationDialogOpen(true)}
        onExport={() => requestProjectAction('export')}
      />

      <main className="studio-main">
        <InspectorPanel
          project={project}
          activeTrackId={activeTrackId}
          onSelectTrack={handleSelectTrack}
          onUpdateProject={updateProject}
          onUpdateTrack={updateTrack}
          onImportAudio={() => requestProjectAction('import-audio')}
          onImportLrc={() => requestProjectAction('import-lrc')}
        />

        <div className={`unified-workspace ${syncMode ? 'is-syncing' : ''}`}>
          <div className="workspace-top">
            {syncMode && activeTrack ? (
              <SyncCueStrip
                track={activeTrack}
                syncCursor={syncCursor}
                onEditLyrics={() => setLyricsDialogOpen(true)}
              />
            ) : (
              <KaraokePreview
                project={previewProject}
                playbackMs={playback.currentMs}
                lyricMs={lyricTimeMs}
                selectedWordIds={selectedWordIds}
                onUpdateLyricDisplay={updateLyricDisplay}
                onEditLyrics={() => setLyricsDialogOpen(true)}
              />
            )}
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
            syncMode={syncMode}
            onSeek={playback.seek}
            onZoom={setZoom}
            onSelectWord={handleSelectWordId}
            onSelectWords={setSelectedWordIds}
            onShiftWords={(ids, deltaMs) => commit((current) => shiftWords(current, ids, deltaMs))}
            onResizeWord={(wordId, startMs, endMs) =>
              commit((current) => patchWord(current, wordId, { startMs, endMs }))
            }
            onTimingDraftChange={updateTimingDraft}
            onToggleSync={toggleSyncMode}
            onClearTiming={handleClearTiming}
            onClearTimingAfterCursor={handleClearTimingAfterCursor}
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
        onStop={handleStop}
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
            cancelHeldSync()
            syncSessionHasCommitRef.current = false
            setSyncMode(false)
            setSelectedWordIds(new Set())
            setLyricsDialogOpen(false)
            showToast('Lyrics updated', 'success')
          }}
        />
      )}
      {workflowGuideOpen && activeTrack && <WorkflowGuideDialog {...workflowGuideActions} />}
      {exportDialogOpen && activeTrack && (
        <ExportDialog
          projectTitle={project.title}
          activeTrackName={activeTrack.name}
          issueCount={reviewIssues.length}
          hasLyrics={projectHasLyrics}
          activeTrackHasLyrics={syncWords.length > 0}
          onClose={() => setExportDialogOpen(false)}
          onExportLrc={() => void exportText('lrc')}
          onExportAss={() => void exportText('ass')}
          onExportVideo={(settings) => void exportVideo(settings)}
          onCancelVideo={cancelVideoExport}
          onExportProject={() => void exportText(EDITABLE_PROJECT_EXPORT_FORMAT)}
          videoAvailable={Boolean(
            window.studio?.exportVideo && project.audioPath && playback.hasAudio,
          )}
          videoProgress={videoExportProgress}
        />
      )}
      {validationDialogOpen && (
        <ValidationDialog issues={reviewIssues} onClose={() => setValidationDialogOpen(false)} />
      )}
      {projectAuthorityWarning && (
        <div className="toast toast--warning" role="alert">
          <span />
          {projectAuthorityWarning}
        </div>
      )}
      {toast && (
        <div className={`toast toast--${toast.tone}`} role="status">
          <span />
          {toast.message}
        </div>
      )}
    </div>
  )
}
