import { readFileSync } from 'node:fs'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowGuideActions,
  EDITABLE_PROJECT_EXPORT_FORMAT,
  lyricTimeAtPlayback,
  projectForTimingPreview,
  type ActiveTimingDraft,
} from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { LyricsPanel } from '../src/components/LyricsPanel'
import {
  createTimelineGestureSession,
  timelineTime,
  timingDraftForGesture,
} from '../src/components/Timeline'
import { WorkflowGuideDialog } from '../src/components/Dialogs'
import { TopBar } from '../src/components/TopBar'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  retimeLine,
} from '../src/lib/karaoke'
import { applyTimingDraft, patchWord, shiftWords } from '../src/utils'

function offsetProject() {
  const line = retimeLine(createLyricLine('Hold'), 1_000, 2_000)
  const track = createVocalTrack({ id: 'lead', lines: [line] })
  return createProject({ offsetMs: 500, tracks: [track] })
}

interface ActionElementProps {
  children?: ReactNode
  disabled?: boolean
  onClick?: () => void
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (!isValidElement<ActionElementProps>(node)) return ''
  return Children.toArray(node.props.children).map(nodeText).join('')
}

function findAction(root: ReactNode, label: string): ReactElement<ActionElementProps> {
  if (!isValidElement<ActionElementProps>(root)) {
    throw new Error(`Could not find action: ${label}`)
  }
  if (root.props.onClick && nodeText(root.props.children).includes(label)) return root
  for (const child of Children.toArray(root.props.children)) {
    try {
      return findAction(child, label)
    } catch {
      // Continue through the declarative child tree until the labeled action is found.
    }
  }
  throw new Error(`Could not find action: ${label}`)
}

describe('offset-aware renderer state', () => {
  it('delays positive offsets and advances negative offsets', () => {
    expect(lyricTimeAtPlayback(1_500, 500)).toBe(1_000)
    expect(lyricTimeAtPlayback(1_500, -500)).toBe(2_000)
    expect(timelineTime(1_000, 500)).toBe(1_500)
    expect(timelineTime(1_000, -500)).toBe(500)
  })

  it('uses lyric time for preview progress while retaining the playback clock', () => {
    const project = offsetProject()
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_000}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('karaoke-stage__time">00:01.500')
    expect(markup).toContain('--word-progress:0%')
  })

  it('uses lyric time for current-word editor highlighting', () => {
    const project = offsetProject()
    const props = {
      tracks: project.tracks,
      activeTrackId: project.tracks[0].id,
      selectedWordIds: new Set<string>(),
      syncWordId: null,
      onSelectTrack: () => undefined,
      onSelectWord: () => undefined,
      onEditLyrics: () => undefined,
    }

    const before = renderToStaticMarkup(<LyricsPanel {...props} lyricMs={999} />)
    const during = renderToStaticMarkup(<LyricsPanel {...props} lyricMs={1_000} />)

    expect(before).not.toContain('is-current')
    expect(during).toContain('is-current')
  })

  it('matches video export by showing only soloed preview tracks', () => {
    const lead = createVocalTrack({
      id: 'lead',
      name: 'Lead',
      lines: [retimeLine(createLyricLine('Hidden lead'), 1_000, 2_000)],
    })
    const solo = createVocalTrack({
      id: 'duet',
      name: 'Solo duet',
      solo: true,
      lines: [retimeLine(createLyricLine('Visible duet'), 1_000, 2_000)],
    })
    const project = createProject({ tracks: [lead, solo] })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('Solo duet')
    expect(markup).not.toContain('>Lead<')
  })
})

describe('first-time workflow', () => {
  it('describes the complete primary journey inside one guide', () => {
    const markup = renderToStaticMarkup(
      <WorkflowGuideDialog
        canStartSync
        onClose={() => undefined}
        onNew={() => undefined}
        onOpen={() => undefined}
        onAttachAudio={() => undefined}
        onEditLyrics={() => undefined}
        onImportLrc={() => undefined}
        onStartSync={() => undefined}
        onSave={() => undefined}
        onExport={() => undefined}
      />,
    )

    expect(markup).toContain('One-window workflow')
    expect(markup).toContain('Start a project')
    expect(markup).toContain('Attach the backing track')
    expect(markup).toContain('Add the lyrics')
    expect(markup).toContain('Time each word')
    expect(markup).toContain('Correct the TimeBoard')
    expect(markup).toContain('Preview continuously')
    expect(markup).toContain('Save and export')
    expect(markup).toContain('system file pickers only appear when you choose a file or destination')
  })

  it('routes every guide button to its assigned interaction handler', () => {
    const calls: string[] = []
    const guide = WorkflowGuideDialog({
      canStartSync: true,
      onClose: () => calls.push('close'),
      onNew: () => calls.push('new'),
      onOpen: () => calls.push('open'),
      onAttachAudio: () => calls.push('audio'),
      onEditLyrics: () => calls.push('lyrics'),
      onImportLrc: () => calls.push('lrc'),
      onStartSync: () => calls.push('sync'),
      onSave: () => calls.push('save'),
      onExport: () => calls.push('export'),
    })

    for (const label of [
      'Open .oks',
      'New project',
      'Attach audio',
      'Import LRC',
      'Edit lyrics',
      'Arm tap sync',
      'Show TimeBoard',
      'Show preview',
      'Save .oks',
      'Choose export',
    ]) {
      findAction(guide, label).props.onClick?.()
    }

    expect(calls).toEqual([
      'open',
      'new',
      'audio',
      'lrc',
      'lyrics',
      'sync',
      'close',
      'close',
      'save',
      'export',
    ])
  })

  it('uses the App action coordinator to close the guide before each workflow transition', () => {
    const close = vi.fn()
    const transitions = {
      startNew: vi.fn(),
      open: vi.fn(),
      attachAudio: vi.fn(),
      editLyrics: vi.fn(),
      importLrc: vi.fn(),
      startSync: vi.fn(),
      save: vi.fn(),
      exportProject: vi.fn(),
    }
    const actions = createWorkflowGuideActions({ canStartSync: true, close, ...transitions })

    actions.onNew()
    actions.onOpen()
    actions.onAttachAudio()
    actions.onEditLyrics()
    actions.onImportLrc()
    actions.onStartSync()
    actions.onSave()
    actions.onExport()

    expect(close).toHaveBeenCalledTimes(8)
    Object.values(transitions).forEach((transition) => expect(transition).toHaveBeenCalledOnce())
    expect(EDITABLE_PROJECT_EXPORT_FORMAT).toBe('oks')
  })

  it('keeps the workflow guide discoverable from the main toolbar', () => {
    const markup = renderToStaticMarkup(
      <TopBar
        title="First song"
        dirty={false}
        canUndo={false}
        canRedo={false}
        issueCount={0}
        onNew={() => undefined}
        onOpen={() => undefined}
        onSave={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        onShowWorkflow={() => undefined}
        onValidate={() => undefined}
        onExport={() => undefined}
      />,
    )

    expect(markup).toContain('Workflow')
    expect(markup).toContain('aria-label="Project actions"')
  })

  it('prevents tap sync from being launched before lyrics exist', () => {
    const close = vi.fn()
    const startSync = vi.fn()
    const actions = createWorkflowGuideActions({
      canStartSync: false,
      close,
      startSync,
      startNew: vi.fn(),
      open: vi.fn(),
      attachAudio: vi.fn(),
      editLyrics: vi.fn(),
      importLrc: vi.fn(),
      save: vi.fn(),
      exportProject: vi.fn(),
    })
    const guide = WorkflowGuideDialog(actions)
    const syncButton = findAction(guide, 'Add lyrics first')

    expect(syncButton.props.disabled).toBe(true)
    actions.onStartSync()
    expect(close).not.toHaveBeenCalled()
    expect(startSync).not.toHaveBeenCalled()
  })

  it('enforces a scroll-safe workflow layout at the 1280 by 720 contract', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const minimumWindow = electronMain.match(/minWidth:\s*(\d+),\s*\n\s*minHeight:\s*(\d+)/)

    expect(minimumWindow).not.toBeNull()
    expect(Number(minimumWindow?.[1])).toBeLessThanOrEqual(1280)
    expect(Number(minimumWindow?.[2])).toBeLessThanOrEqual(720)
    expect(styles).toMatch(
      /\.modal__body\s*\{[\s\S]*?max-height:\s*calc\(100vh - 190px\);[\s\S]*?overflow:\s*auto;/,
    )
    expect(styles).toMatch(
      /@media \(max-height: 720px\)\s*\{[\s\S]*?\.workflow-guide > li\s*\{[\s\S]*?min-height:\s*52px;/,
    )
  })
})

describe('live timeline timing drafts', () => {
  function timedProject() {
    const line = createLyricLine('Move resize', {
      id: 'line',
      words: [
        createLyricWord('Move', { id: 'move', startMs: 1_000, endMs: 2_000 }),
        createLyricWord('resize', { id: 'resize', startMs: 2_100, endMs: 3_000 }),
      ],
      startMs: 1_000,
      endMs: 3_000,
    })
    return createProject({
      updatedAt: '2026-01-02T03:04:05.000Z',
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })
  }

  it('publishes actual gesture-session moves through the App preview projection', () => {
    const project = timedProject()
    const draftEvents: Array<ActiveTimingDraft | null> = []
    const shifts: Array<{ ids: Set<string>; deltaMs: number }> = []
    let activeDraft: ActiveTimingDraft | null = null
    const context = {
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (timings: ReturnType<typeof timingDraftForGesture> | null) => {
        activeDraft = timings ? { revision: 7, timings } : null
        draftEvents.push(activeDraft)
      },
      onShiftWords: (ids: Set<string>, deltaMs: number) => shifts.push({ ids, deltaMs }),
      onResizeWord: () => undefined,
    }
    const session = createTimelineGestureSession(() => context)
    const captureTarget = new EventTarget()
    expect(session.begin({
      wordId: 'move',
      mode: 'move',
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['move', 'resize']),
      deltaMs: 0,
      clientX: 100,
      pointerId: 41,
      captureTarget,
    })).toBe(true)
    expect(session.move(41, captureTarget, 600)).toBe(true)

    const previewProject = projectForTimingPreview(project, 7, activeDraft)
    const committedMarkup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set(['move'])}
      />,
    )
    const previewMarkup = renderToStaticMarkup(
      <KaraokePreview
        project={previewProject}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set(['move'])}
      />,
    )

    expect(activeDraft!.timings.get('move')).toEqual({ startMs: 1_500, endMs: 2_500 })
    expect(activeDraft!.timings.get('resize')).toEqual({ startMs: 2_600, endMs: 3_500 })
    expect(previewProject.tracks[0].lines[0]).toMatchObject({ startMs: 1_500, endMs: 3_500 })
    expect(committedMarkup).toContain('--word-progress:50%')
    expect(previewMarkup).toContain('--word-progress:0%')
    expect(previewMarkup).not.toContain('--word-progress:50%')
    expect(project.tracks[0].lines[0].words[0]).toMatchObject({ startMs: 1_000, endMs: 2_000 })
    expect(previewProject.updatedAt).toBe(project.updatedAt)

    expect(session.finish(41, captureTarget)).toBe(true)
    expect(draftEvents.at(-1)).toBeNull()
    expect(shifts).toEqual([{ ids: new Set(['move', 'resize']), deltaMs: 500 }])
  })

  it('renders edge-resize drafts with the same minimum-duration bounds as commit', () => {
    const project = timedProject()
    let currentDraft: ReturnType<typeof timingDraftForGesture> | null = null
    const resizeCommits: Array<{ startMs: number; endMs: number }> = []
    const context = {
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (draft: ReturnType<typeof timingDraftForGesture> | null) => { currentDraft = draft },
      onShiftWords: () => undefined,
      onResizeWord: (_wordId: string, startMs: number, endMs: number) => resizeCommits.push({ startMs, endMs }),
    }
    const session = createTimelineGestureSession(() => context)
    const startTarget = new EventTarget()
    expect(session.begin({
      wordId: 'move',
      mode: 'start',
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['move']),
      deltaMs: 0,
      clientX: 100,
      pointerId: 51,
      captureTarget: startTarget,
    })).toBe(true)
    expect(session.move(51, startTarget, 2_100)).toBe(true)
    expect(currentDraft!.get('move')).toEqual({ startMs: 1_920, endMs: 2_000 })
    expect(applyTimingDraft(project, currentDraft!).tracks[0].lines[0].startMs).toBe(1_920)
    expect(session.finish(51, startTarget)).toBe(true)

    const endTarget = new EventTarget()
    expect(session.begin({
      wordId: 'move',
      mode: 'end',
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['move']),
      deltaMs: 0,
      clientX: 2_100,
      pointerId: 52,
      captureTarget: endTarget,
    })).toBe(true)
    expect(session.move(52, endTarget, 100)).toBe(true)
    expect(currentDraft!.get('move')).toEqual({ startMs: 1_000, endMs: 1_080 })
    expect(session.finish(52, endTarget)).toBe(true)

    expect(resizeCommits).toEqual([
      { startMs: 1_920, endMs: 2_000 },
      { startMs: 1_000, endMs: 1_080 },
    ])
    expect(project.tracks[0].lines[0].startMs).toBe(1_000)
  })

  it('preserves untouched line timing and makes draft and committed moves agree', () => {
    const movedLine = createLyricLine('Timed word', {
      id: 'moved-line',
      startMs: 1_000,
      endMs: 2_000,
      words: [createLyricWord('Timed', { id: 'timed', startMs: 1_000, endMs: 2_000 })],
    })
    const lineTimedOnly = createLyricLine('Line timed only', {
      id: 'line-only',
      startMs: 5_000,
      endMs: 6_000,
    })
    const project = createProject({
      tracks: [createVocalTrack({ id: 'lead', lines: [movedLine, lineTimedOnly] })],
    })
    const untouchedLine = project.tracks[0].lines[1]
    const gesture = {
      wordId: 'timed',
      mode: 'move' as const,
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['timed']),
      deltaMs: 375,
    }
    const preview = applyTimingDraft(project, timingDraftForGesture(project, gesture))
    const committed = shiftWords(project, gesture.ids, gesture.deltaMs)

    expect(committed.tracks[0].lines[1]).toBe(untouchedLine)
    expect(committed.tracks[0].lines[1]).toMatchObject({ startMs: 5_000, endMs: 6_000 })
    expect(preview.tracks[0].lines[1]).toBe(untouchedLine)
    expect(committed.tracks[0].lines[0].words[0]).toEqual(preview.tracks[0].lines[0].words[0])
    expect(committed.tracks[0].lines[0]).toMatchObject({ startMs: 1_375, endMs: 2_375 })
  })

  it('owns one pointer and ignores stale cancellation from another gesture', () => {
    const project = timedProject()
    const draftEvents: Array<ReturnType<typeof timingDraftForGesture> | null> = []
    const shifts: number[] = []
    const context = {
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: (draft: ReturnType<typeof timingDraftForGesture> | null) => draftEvents.push(draft),
      onShiftWords: (_ids: Set<string>, deltaMs: number) => shifts.push(deltaMs),
      onResizeWord: () => undefined,
    }
    const session = createTimelineGestureSession(() => context)
    const firstTarget = new EventTarget()
    const nextTarget = new EventTarget()
    const gesture = {
      wordId: 'move',
      mode: 'move' as const,
      originalStart: 1_000,
      originalEnd: 2_000,
      ids: new Set(['move']),
      deltaMs: 0,
      clientX: 100,
      pointerId: 7,
      captureTarget: firstTarget,
    }

    expect(session.begin(gesture)).toBe(true)
    expect(session.begin({ ...gesture, pointerId: 8, captureTarget: nextTarget })).toBe(false)
    expect(session.move(8, nextTarget, 600)).toBe(false)
    expect(session.cancel(8, nextTarget)).toBe(false)
    expect(draftEvents).toEqual([])
    expect(session.move(7, firstTarget, 350)).toBe(true)
    expect(draftEvents).toHaveLength(1)
    expect(session.cancel(7, firstTarget)).toBe(true)
    expect(draftEvents.at(-1)).toBeNull()

    expect(session.begin({ ...gesture, captureTarget: nextTarget })).toBe(true)
    expect(session.cancel(7, firstTarget)).toBe(false)
    expect(session.owns(7, nextTarget)).toBe(true)
    expect(session.finish(7, nextTarget)).toBe(true)
    expect(shifts).toEqual([])
  })

  it('returns original project identity for no-op move and resize commits', () => {
    const project = timedProject()
    const line = project.tracks[0].lines[0]
    const word = line.words[0]
    const resizeCommits: Array<{ startMs: number; endMs: number }> = []
    const captureTarget = new EventTarget()
    const session = createTimelineGestureSession(() => ({
      project,
      pixelsPerSecond: 1_000,
      onTimingDraftChange: () => undefined,
      onShiftWords: () => undefined,
      onResizeWord: (_wordId, startMs, endMs) => resizeCommits.push({ startMs, endMs }),
    }))

    expect(shiftWords(project, new Set([word.id]), 0)).toBe(project)
    expect(patchWord(project, word.id, { startMs: word.startMs, endMs: word.endMs })).toBe(project)
    expect(patchWord(project, 'missing', { startMs: 100, endMs: 200 })).toBe(project)
    expect(project.tracks[0].lines[0]).toBe(line)
    expect(session.begin({
      wordId: word.id,
      mode: 'start',
      originalStart: word.startMs!,
      originalEnd: word.endMs!,
      ids: new Set([word.id]),
      deltaMs: 0,
      clientX: 100,
      pointerId: 12,
      captureTarget,
    })).toBe(true)
    expect(session.finish(12, captureTarget)).toBe(true)
    expect(resizeCommits).toEqual([])
  })
})
