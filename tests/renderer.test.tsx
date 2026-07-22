import { readFileSync } from 'node:fs'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowGuideActions,
  EDITABLE_PROJECT_EXPORT_FORMAT,
  lyricTimeAtPlayback,
  syncWordIndexFromLyricTime,
} from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { LyricsPanel } from '../src/components/LyricsPanel'
import { timelineTime } from '../src/components/timeline-geometry'
import { WorkflowGuideDialog } from '../src/components/Dialogs'
import { TopBar } from '../src/components/TopBar'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
  retimeLine,
} from '../src/lib/karaoke'
import { clearTrackTimingFrom } from '../src/utils'

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
    const normalized =
      value.length === 4
        ? value
            .slice(1)
            .split('')
            .map((digit) => digit.repeat(2))
            .join('')
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
    Object.assign(project.stageStyle.background, {
      mode: 'image',
      imagePath: '/fixtures/background.png',
    })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_500}
        lyricMs={1_000}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toMatch(/karaoke-stage__time"[^>]*>00:01\.500/u)
    expect(markup).toContain('--word-progress:0%')
    expect(markup).toContain('Linked background is missing; using the gradient fallback.')
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
    const markup = renderToStaticMarkup(
      <LyricsPanel
        tracks={project.tracks}
        stageStyle={project.stageStyle}
        activeTrackId=""
        lyricMs={0}
        selectedWordIds={new Set()}
        syncWordId={null}
        onSelectTrack={() => undefined}
        onSelectWord={() => undefined}
        onEditLyrics={() => undefined}
      />,
    )

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
describe('Timeline and Sync Focus styling regressions', () => {
  it('keeps split resize handles exposed for compact timing blocks', () => {
    const styles = readFileSync(new URL('../src/timeline.css', import.meta.url), 'utf8')

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
      const match = identity.match(
        new RegExp(`${escaped}\\s*\\{[^}]*color:\\s*(#[\\da-f]{3,6})`, 'i'),
      )
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
    expect(
      clearTrackTimingFrom(track, -500).lines.every(
        (line) =>
          line.startMs === null &&
          line.endMs === null &&
          line.words.every((word) => word.startMs === null && word.endMs === null),
      ),
    ).toBe(true)
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
    expect(
      syncWordIndexFromLyricTime(
        [...words, createLyricWord('Tail', { startMs: null, endMs: null })],
        12_000,
      ),
    ).toBe(3)
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
    expect(markup).toContain('Correct timing in the Lyric Timing area')
    expect(markup).toContain('Verify in Live Preview')
    expect(markup).toContain('Save and export')
    expect(markup).toContain(
      'system file pickers only appear when you choose a file or destination',
    )
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
      'Show Lyric Timing',
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
        styleDisabledReason={null}
        workflowDisabled={false}
        validationDisabled={false}
        onStyle={() => undefined}
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
    expect(markup).toMatch(/topbar__brand[\s\S]*Style[\s\S]*topbar__document/u)
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
    const identity = readFileSync(new URL('../src/identity.css', import.meta.url), 'utf8')
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
    expect(styles).toMatch(
      /\.inspector__scroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
    )
    expect(styles).not.toContain('.inspector > .panel-header')
    expect(identity).not.toContain('.inspector > .panel-header')
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
