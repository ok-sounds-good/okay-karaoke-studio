import { readFileSync } from 'node:fs'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowGuideActions,
  EDITABLE_PROJECT_EXPORT_FORMAT,
  lyricTimeAtPlayback,
  projectForTimingPreview,
  syncWordIndexFromLyricTime,
  type ActiveTimingDraft,
} from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { LyricsPanel } from '../src/components/LyricsPanel'
import {
  buildTimelineTrackLayout,
  createTimelineGestureSession,
  timelineTime,
  timelineWordIdsInRect,
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
import {
  applyTimingDraft,
  clearTrackTimingFrom,
  constrainWordResizeTiming,
  constrainWordShiftDelta,
  patchWord,
  shiftWords,
} from '../src/utils'

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

function cssContrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const normalized = value.length === 4
      ? value.slice(1).split('').map((digit) => digit.repeat(2)).join('')
      : value.slice(1)
    const [red, green, blue] = normalized.match(/.{2}/g)!.map((channel) => {
      const srgb = Number.parseInt(channel, 16) / 255
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
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

  it('keeps per-word progress without rendering a whole-line progress meter', () => {
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={offsetProject()}
        playbackMs={2_000}
        lyricMs={1_500}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('--word-progress:50%')
    expect(markup).not.toContain('stage-progress')
  })

  it('uses lyric time for current-word editor highlighting', () => {
    const project = offsetProject()
    const props = {
      tracks: project.tracks,
      stageStyle: project.stageStyle,
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
    expect(during).toContain('title="Select the first word and seek to 0:01.000"')
  })

  it('renders the lyric editor safely when a valid project has no vocal tracks', () => {
    const project = createProject({ tracks: [] })
    const markup = renderToStaticMarkup(<LyricsPanel
      tracks={project.tracks}
      stageStyle={project.stageStyle}
      activeTrackId=""
      lyricMs={0}
      selectedWordIds={new Set()}
      syncWordId={null}
      onSelectTrack={() => undefined}
      onSelectWord={() => undefined}
      onEditLyrics={() => undefined}
    />)

    expect(markup).toBe('')
  })

  it('matches video export by showing only soloed preview tracks', () => {
    const lead = createVocalTrack({
      id: 'lead',
      name: 'Hidden track label',
      lines: [retimeLine(createLyricLine('Hidden lyric'), 1_000, 2_000)],
    })
    const solo = createVocalTrack({
      id: 'duet',
      name: 'Solo track label',
      solo: true,
      lines: [retimeLine(createLyricLine('Visible lyric'), 1_000, 2_000)],
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

    expect(markup).toContain('Visible lyric')
    expect(markup).not.toContain('Hidden lyric')
    expect(markup).not.toContain('Solo track label')
    expect(markup).not.toContain('Hidden track label')
    expect(markup).not.toContain('stage-voice')
  })

  it('leaves lyric breaks visually empty instead of inserting an instrumental graphic', () => {
    const project = createProject({
      tracks: [createVocalTrack({ id: 'lead', name: 'Lead', lines: [] })],
    })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={5_000}
        lyricMs={5_000}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).not.toMatch(/instrumental/iu)
  })
})

describe('TimeBoard layout and selection geometry', () => {
  it('keeps long labels independent and separates overlapping lines and same-line blocks', () => {
    const firstLine = createLyricLine('Extraordinarily brief', {
      id: 'first-line',
      startMs: 1_000,
      endMs: 1_100,
      words: [
        createLyricWord('Extraordinarily', {
          id: 'long-label',
          startMs: 1_000,
          endMs: 1_050,
        }),
        createLyricWord('brief', {
          id: 'overlapping-block',
          startMs: 1_020,
          endMs: 1_100,
        }),
      ],
    })
    const overlappingLine = createLyricLine('Second line', {
      id: 'second-line',
      startMs: 1_025,
      endMs: 1_400,
      words: [
        createLyricWord('Second', {
          id: 'second-line-word',
          startMs: 1_025,
          endMs: 1_400,
        }),
      ],
    })
    const track = createVocalTrack({ id: 'lead', lines: [firstLine, overlappingLine] })
    const layout = buildTimelineTrackLayout(track, 0, 100)
    const firstLayout = layout.lines.find((line) => line.line.id === 'first-line')!
    const secondLayout = layout.lines.find((line) => line.line.id === 'second-line')!
    const longLabel = firstLayout.words.find((word) => word.word.id === 'long-label')!
    const overlappingBlock = firstLayout.words.find(
      (word) => word.word.id === 'overlapping-block',
    )!

    expect(longLabel.width).toBe(5)
    expect(longLabel.labelWidth).toBeGreaterThan(longLabel.width)
    expect(longLabel.top).not.toBe(overlappingBlock.top)
    expect(firstLayout.lane).not.toBe(secondLayout.lane)
    expect(firstLayout.top).not.toBe(secondLayout.top)
  })

  it('keeps edge-touching timing blocks on one baseline and separates only genuine overlap', () => {
    const line = createLyricLine('One Two Three Four', {
      id: 'baseline-line',
      startMs: 13_953,
      endMs: 14_929,
      words: [
        createLyricWord('One', { id: 'edge-first', startMs: 13_953, endMs: 14_271 }),
        createLyricWord('Two', { id: 'edge-second', startMs: 14_271, endMs: 14_554 }),
        createLyricWord('Three', { id: 'edge-third', startMs: 14_554, endMs: 14_829 }),
        createLyricWord('Four', { id: 'true-overlap', startMs: 14_800, endMs: 14_929 }),
      ],
    })
    const layout = buildTimelineTrackLayout(
      createVocalTrack({ id: 'lead', lines: [line] }),
      0,
      72,
    )
    const words = Object.fromEntries(
      layout.lines[0].words.map((word) => [word.word.id, word]),
    )

    expect(words['edge-first'].top).toBe(words['edge-second'].top)
    expect(words['edge-second'].top).toBe(words['edge-third'].top)
    expect(words['true-overlap'].top).not.toBe(words['edge-third'].top)
  })

  it('keeps split resize handles exposed for compact timing blocks', () => {
    const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

    expect(styles).not.toMatch(
      /\.timeline-word\.is-compact \.timeline-word__handle\s*\{[^}]*display:\s*none/,
    )
    expect(styles).toMatch(
      /\.timeline-word\.is-compact \.timeline-word__handle--start\s*\{[^}]*top:\s*-4px;[^}]*left:\s*-4px;/,
    )
    expect(styles).toMatch(
      /\.timeline-word\.is-compact \.timeline-word__handle--end\s*\{[^}]*right:\s*-4px;[^}]*bottom:\s*-4px;/,
    )
  })

  it('keeps Sync Focus text opaque and readable in the light identity theme', () => {
    const identity = readFileSync(new URL('../src/identity.css', import.meta.url), 'utf8')
    const colorFor = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = identity.match(new RegExp(`${escaped}\\s*\\{[^}]*color:\\s*(#[\\da-f]{3,6})`, 'i'))
      expect(match, `Missing explicit color for ${selector}`).not.toBeNull()
      return match![1]
    }

    expect(identity).toMatch(/\.sync-cue__line\.is-next\s*\{[^}]*opacity:\s*1;/)
    for (const selector of [
      '.sync-cue__line.is-current > span',
      '.sync-cue__line.is-next > span',
      '.sync-cue__line.is-current b',
      '.sync-cue__line.is-current b.is-timed',
      '.sync-cue__line.is-next b',
      '.sync-cue__line.is-next b.is-timed',
      '.sync-cue__help',
    ]) {
      expect(cssContrast(colorFor(selector), '#fff'), selector).toBeGreaterThanOrEqual(4.5)
    }
    expect(identity).toMatch(
      /\.sync-cue__line b\.is-target,[\s\S]*?background:\s*#70469e;[\s\S]*?color:\s*#fff;/,
    )
    expect(cssContrast('#fff', '#70469e')).toBeGreaterThanOrEqual(4.5)
  })

  it('returns only active-layout timing blocks intersected by a marquee rectangle', () => {
    const line = createLyricLine('First Second', {
      id: 'selection-line',
      startMs: 1_000,
      endMs: 3_500,
      words: [
        createLyricWord('First', { id: 'first', startMs: 1_000, endMs: 1_500 }),
        createLyricWord('Second', { id: 'second', startMs: 3_000, endMs: 3_500 }),
      ],
    })
    const layout = buildTimelineTrackLayout(
      createVocalTrack({ id: 'active-track', lines: [line] }),
      0,
      100,
    )
    const first = layout.lines[0].words[0]

    expect(timelineWordIdsInRect(layout, {
      left: first.left + 8,
      top: first.top + 8,
      right: first.left + 2,
      bottom: first.top + 2,
    })).toEqual(new Set(['first']))
  })
})

describe('active-track timing clearing', () => {
  it('keeps timings that span the cursor and clears word and line starts at the offset-aware boundary', () => {
    const mixedLine = createLyricLine('Keep authored punctuation — exactly.', {
      id: 'mixed-line',
      startMs: 1_000,
      endMs: 8_000,
      words: [
        createLyricWord('Before', { id: 'before', startMs: 1_000, endMs: 2_000 }),
        createLyricWord('Spanning', { id: 'spanning', startMs: 4_500, endMs: 5_500 }),
        createLyricWord('Boundary', { id: 'boundary', startMs: 5_000, endMs: 6_000 }),
        createLyricWord('After', { id: 'after', startMs: 7_000, endMs: 8_000 }),
        createLyricWord('EndOnly', { id: 'end-only', startMs: null, endMs: 8_500 }),
      ],
    })
    const lineOnlySpanning = createLyricLine('Line only spanning', {
      id: 'line-only-spanning',
      startMs: 4_500,
      endMs: 5_500,
    })
    const lineOnlyBoundary = createLyricLine('Line only boundary', {
      id: 'line-only-boundary',
      startMs: 5_000,
      endMs: 6_000,
    })
    const lineOnlyEnd = createLyricLine('Line only end', {
      id: 'line-only-end',
      startMs: null,
      endMs: 6_500,
    })
    const track = createVocalTrack({
      id: 'lead',
      lines: [mixedLine, lineOnlySpanning, lineOnlyBoundary, lineOnlyEnd],
    })
    const lyricBoundary = lyricTimeAtPlayback(5_500, 500)
    const cleared = clearTrackTimingFrom(track, lyricBoundary)
    const words = cleared.lines[0].words

    expect(lyricBoundary).toBe(5_000)
    expect(words.find((word) => word.id === 'before')).toMatchObject({
      startMs: 1_000,
      endMs: 2_000,
    })
    expect(words.find((word) => word.id === 'spanning')).toMatchObject({
      startMs: 4_500,
      endMs: 5_500,
    })
    expect(words.find((word) => word.id === 'boundary')).toMatchObject({
      startMs: null,
      endMs: null,
    })
    expect(words.find((word) => word.id === 'after')).toMatchObject({
      startMs: null,
      endMs: null,
    })
    expect(words.find((word) => word.id === 'end-only')).toMatchObject({
      startMs: null,
      endMs: 8_500,
    })
    expect(cleared.lines[0].text).toBe('Keep authored punctuation — exactly.')
    expect(cleared.lines[1]).toMatchObject({ startMs: 4_500, endMs: 5_500 })
    expect(cleared.lines[2]).toMatchObject({ startMs: null, endMs: null })
    expect(cleared.lines[3]).toMatchObject({ startMs: null, endMs: 6_500 })
    expect(clearTrackTimingFrom(track, -500).lines.every((line) => (
      line.startMs === null && line.endMs === null && line.words.every((word) => (
        word.startMs === null && word.endMs === null
      ))
    ))).toBe(true)
  })
})

describe('tap-sync cursor selection', () => {
  it('skips an earlier untimed gap after its next timed anchor has passed', () => {
    const words = [
      createLyricWord('First', { startMs: 1_000, endMs: 2_000 }),
      createLyricWord('Gap', { startMs: null, endMs: null }),
      createLyricWord('Anchor', { startMs: 10_000, endMs: 11_000 }),
    ]

    expect(syncWordIndexFromLyricTime(words, 5_000)).toBe(1)
    expect(syncWordIndexFromLyricTime(words, 12_000)).toBe(-1)
    expect(syncWordIndexFromLyricTime(
      [...words, createLyricWord('Tail', { startMs: null, endMs: null })],
      12_000,
    )).toBe(3)
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
    expect(markup).toContain('Verify in Live Preview')
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
        hasLyrics={false}
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

  it('assigns playback to Shift+Space without registering bare Space globally', () => {
    const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8')
    const playbackMenu = electronMain.match(
      /label:\s*'Play\/Pause',[\s\S]{0,180}?accelerator:\s*'([^']+)'[\s\S]{0,180}?registerAccelerator:\s*(\w+)/,
    )
    const selectAllMenu = electronMain.match(
      /label:\s*'Select All',[\s\S]{0,180}?accelerator:\s*'([^']+)'[\s\S]{0,180}?sendMenuAction\('([^']+)'\)/,
    )

    expect(playbackMenu?.[1]).toBe('Shift+Space')
    expect(playbackMenu?.[2]).toBe('false')
    expect(selectAllMenu?.[1]).toBe('CommandOrControl+A')
    expect(selectAllMenu?.[2]).toBe('select-all')
    expect(electronMain).not.toMatch(/role:\s*'selectAll'/)
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

  function neighborBoundProject() {
    return createProject({
      durationMs: 10_000,
      tracks: [createVocalTrack({
        id: 'lead',
        lines: [
          createLyricLine('Before Moving', {
            id: 'first-line',
            startMs: 1_000,
            endMs: 2_200,
            words: [
              createLyricWord('Before', { id: 'before', startMs: 1_000, endMs: 1_500 }),
              createLyricWord('Moving', { id: 'moving', startMs: 2_000, endMs: 2_200 }),
            ],
          }),
          createLyricLine('Together After', {
            id: 'second-line',
            startMs: 2_400,
            endMs: 2_900,
            words: [
              createLyricWord('Together', { id: 'together', startMs: 2_400, endMs: 2_600 }),
              createLyricWord('After', { id: 'after', startMs: 2_700, endMs: 2_900 }),
            ],
          }),
        ],
      })],
    })
  }

  it('clamps single and grouped moves to lyric-order neighbors across line boundaries', () => {
    const project = neighborBoundProject()

    expect(constrainWordShiftDelta(project, new Set(['moving']), -2_000)).toBe(-500)
    expect(constrainWordShiftDelta(project, new Set(['moving']), 2_000)).toBe(200)
    expect(constrainWordShiftDelta(project, new Set(['moving', 'together']), -2_000)).toBe(-500)
    expect(constrainWordShiftDelta(project, new Set(['moving', 'together']), 2_000)).toBe(100)

    const movedEarlier = shiftWords(project, new Set(['moving']), -2_000)
    const movedLater = shiftWords(project, new Set(['moving', 'together']), 2_000)
    expect(movedEarlier.tracks[0].lines[0].words[1]).toMatchObject({
      startMs: 1_500,
      endMs: 1_700,
    })
    expect(movedLater.tracks[0].lines[0].words[1]).toMatchObject({
      startMs: 2_100,
      endMs: 2_300,
    })
    expect(movedLater.tracks[0].lines[1].words[0]).toMatchObject({
      startMs: 2_500,
      endMs: 2_700,
    })
  })

  it('preserves adjacent sub-80ms durations without creating overlap', () => {
    const line = createLyricLine('Short words', {
      id: 'short-line',
      startMs: 0,
      endMs: 100,
      words: [
        createLyricWord('Short', { id: 'short-first', startMs: 0, endMs: 50 }),
        createLyricWord('words', { id: 'short-second', startMs: 50, endMs: 100 }),
      ],
    })
    const project = createProject({
      durationMs: 1_000,
      tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
    })
    const ids = new Set(['short-first', 'short-second'])
    const gesture = {
      wordId: 'short-first',
      mode: 'move' as const,
      originalStart: 0,
      originalEnd: 50,
      ids,
      deltaMs: 100,
    }

    const preview = applyTimingDraft(project, timingDraftForGesture(project, gesture))
    const moved = shiftWords(project, ids, 100)
    const expected = [
      expect.objectContaining({ startMs: 100, endMs: 150 }),
      expect.objectContaining({ startMs: 150, endMs: 200 }),
    ]
    expect(preview.tracks[0].lines[0].words).toEqual(expected)
    expect(moved.tracks[0].lines[0].words).toEqual(expected)
    expect(constrainWordResizeTiming(project, 'short-first', 'end', 0, 200)).toEqual({
      startMs: 0,
      endMs: 50,
    })
    expect(constrainWordResizeTiming(project, 'short-second', 'start', -100, 100)).toEqual({
      startMs: 50,
      endMs: 100,
    })
  })

  it('applies positive and negative offsets to the project-duration move ceiling', () => {
    const projectAtOffset = (offsetMs: number) => createProject({
      durationMs: 1_000,
      offsetMs,
      tracks: [createVocalTrack({
        id: `lead-${offsetMs}`,
        lines: [createLyricLine('Bounded', {
          id: `line-${offsetMs}`,
          startMs: 0,
          endMs: 100,
          words: [createLyricWord('Bounded', {
            id: `word-${offsetMs}`,
            startMs: 0,
            endMs: 100,
          })],
        })],
      })],
    })

    const positive = projectAtOffset(100)
    const negative = projectAtOffset(-100)
    expect(constrainWordShiftDelta(positive, new Set(['word-100']), 10_000)).toBe(800)
    expect(constrainWordShiftDelta(negative, new Set(['word--100']), 10_000)).toBe(1_000)
  })

  it('clamps both resize edges to the nearest timed words across line boundaries', () => {
    const project = neighborBoundProject()

    expect(constrainWordResizeTiming(project, 'together', 'start', 100, 2_600)).toEqual({
      startMs: 2_200,
      endMs: 2_600,
    })
    expect(constrainWordResizeTiming(project, 'moving', 'end', 2_000, 9_000)).toEqual({
      startMs: 2_000,
      endMs: 2_400,
    })
  })

  it('uses the same cross-line clamps for gesture drafts and committed edits', () => {
    const project = neighborBoundProject()
    const moveGesture = {
      wordId: 'moving',
      mode: 'move' as const,
      originalStart: 2_000,
      originalEnd: 2_200,
      ids: new Set(['moving', 'together']),
      deltaMs: 2_000,
    }
    const movePreview = applyTimingDraft(project, timingDraftForGesture(project, moveGesture))
    const moveCommit = shiftWords(project, moveGesture.ids, moveGesture.deltaMs)
    expect(movePreview.tracks[0].lines[0].words[1]).toEqual(
      moveCommit.tracks[0].lines[0].words[1],
    )
    expect(movePreview.tracks[0].lines[1].words[0]).toEqual(
      moveCommit.tracks[0].lines[1].words[0],
    )

    const resizeGesture = {
      wordId: 'together',
      mode: 'start' as const,
      originalStart: 2_400,
      originalEnd: 2_600,
      ids: new Set(['together']),
      deltaMs: -2_000,
    }
    const resizeDraft = timingDraftForGesture(project, resizeGesture)
    const resizePreview = applyTimingDraft(project, resizeDraft)
    const constrained = constrainWordResizeTiming(project, 'together', 'start', 400, 2_600)!
    const resizeCommit = patchWord(project, 'together', constrained)
    expect(resizePreview.tracks[0].lines[1].words[0]).toEqual(
      resizeCommit.tracks[0].lines[1].words[0],
    )
  })

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
