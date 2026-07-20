/**
 * @vitest-environment happy-dom
 */

import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { projectForTimingPreview, type ActiveTimingDraft } from '../../src/App'
import { KaraokePreview } from '../../src/components/KaraokePreview'
import { Timeline } from '../../src/components/Timeline'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../../src/lib/karaoke'
import type { KaraokeProject } from '../../src/lib/model'
import { patchWord, shiftWords, type ProjectTimingDraft } from '../../src/utils'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export const captures = new WeakMap<HTMLElement, Set<number>>()
export const rejectedCaptureIds = new Set<number>()
export const ignoredCaptureIds = new Set<number>()
let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        if (rejectedCaptureIds.delete(pointerId)) throw new DOMException('Pointer capture rejected')
        if (ignoredCaptureIds.delete(pointerId)) return
        const pointers = captures.get(this) ?? new Set<number>()
        pointers.add(pointerId)
        captures.set(this, pointers)
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(pointerId: number) {
        return captures.get(this)?.has(pointerId) ?? false
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(pointerId: number) {
        captures.get(this)?.delete(pointerId)
      },
    },
    scrollTo: { configurable: true, value() {} },
    scrollBy: { configurable: true, value() {} },
  })
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  rejectedCaptureIds.clear()
  ignoredCaptureIds.clear()
  root = null
  container = null
})

export function initialProject() {
  const line = createLyricLine('Hold Next', {
    id: 'line',
    startMs: 1_000,
    endMs: 4_000,
    words: [
      createLyricWord('Hold', { id: 'hold', startMs: 1_000, endMs: 2_000 }),
      createLyricWord('Next', { id: 'next', startMs: 3_000, endMs: 4_000 }),
    ],
  })
  return createProject({
    durationMs: 30_000,
    tracks: [createVocalTrack({ id: 'lead', lines: [line] })],
  })
}

function Harness({ onGestureActiveChange }: { onGestureActiveChange?: (active: boolean) => void }) {
  const [project, setProject] = useState<KaraokeProject>(initialProject)
  const [activeTrackId, setActiveTrackId] = useState('lead')
  const [revision, setRevision] = useState(0)
  const [draft, setDraft] = useState<ActiveTimingDraft | null>(null)
  const previewProject = projectForTimingPreview(project, revision, draft)
  const heldWord = project.tracks[0].lines[0].words[0]

  const replaceProject = (updater: (current: KaraokeProject) => KaraokeProject) => {
    setProject(updater)
    setRevision((current) => current + 1)
  }

  return (
    <>
      <KaraokePreview
        project={previewProject}
        playbackMs={1_500}
        lyricMs={1_500}
        selectedWordIds={new Set(['hold'])}
      />
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={30_000}
        currentMs={1_500}
        zoom={1}
        activeTrackId={activeTrackId}
        selectedWordIds={new Set(['hold'])}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={() => undefined}
        onShiftWords={(ids, deltaMs) =>
          replaceProject((current) => shiftWords(current, ids, deltaMs))
        }
        onResizeWord={(wordId, startMs, endMs) =>
          replaceProject((current) => patchWord(current, wordId, { startMs, endMs }))
        }
        onTimingDraftChange={(timings: ProjectTimingDraft | null) =>
          setDraft(timings ? { revision, timings } : null)
        }
        onGestureActiveChange={onGestureActiveChange}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="saved-timing">{`${heldWord.startMs}:${heldWord.endMs}`}</output>
      <output data-testid="draft-state">{draft ? 'draft' : 'committed'}</output>
      <button
        data-testid="untime-held-word"
        onClick={() =>
          replaceProject((current) => patchWord(current, 'hold', { startMs: null, endMs: null }))
        }
      >
        Untime held word
      </button>
      <button
        data-testid="refresh-metadata"
        onClick={() =>
          replaceProject((current) => ({
            ...current,
            durationMs: (current.durationMs ?? 0) + 1,
          }))
        }
      >
        Refresh metadata
      </button>
      <button
        data-testid="change-held-timing"
        onClick={() => replaceProject((current) => patchWord(current, 'hold', { startMs: 1_100 }))}
      >
        Change held timing
      </button>
      <button
        data-testid="replace-project"
        onClick={() =>
          replaceProject((current) => ({ ...current, id: `${current.id}-replacement` }))
        }
      >
        Replace project
      </button>
      <button
        data-testid="replace-line"
        onClick={() =>
          replaceProject((current) => ({
            ...current,
            tracks: current.tracks.map((track) => ({
              ...track,
              lines: track.lines.map((line) => ({ ...line, id: `${line.id}-replacement` })),
            })),
          }))
        }
      >
        Replace line
      </button>
      <button data-testid="replace-active-track" onClick={() => setActiveTrackId('missing-track')}>
        Replace active track
      </button>
    </>
  )
}

function ShortBlockHarness() {
  const [project, setProject] = useState<KaraokeProject>(() =>
    createProject({
      durationMs: 30_000,
      tracks: [
        createVocalTrack({
          id: 'lead',
          lines: [
            createLyricLine('Short Next', {
              id: 'short-line',
              startMs: 1_000,
              endMs: 2_100,
              words: [
                createLyricWord('Short', { id: 'short', startMs: 1_000, endMs: 1_050 }),
                createLyricWord('Next', { id: 'short-next', startMs: 2_000, endMs: 2_100 }),
              ],
            }),
          ],
        }),
      ],
    }),
  )
  const shortWord = project.tracks[0].lines[0].words[0]

  return (
    <>
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={30_000}
        currentMs={1_000}
        zoom={3.5}
        activeTrackId="lead"
        selectedWordIds={new Set(['short'])}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={() => undefined}
        onShiftWords={(ids, deltaMs) => setProject((current) => shiftWords(current, ids, deltaMs))}
        onResizeWord={(wordId, startMs, endMs) =>
          setProject((current) => patchWord(current, wordId, { startMs, endMs }))
        }
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="short-saved-timing">{`${shortWord.startMs}:${shortWord.endMs}`}</output>
    </>
  )
}

function MarqueeHarness({
  onGestureActiveChange,
}: {
  onGestureActiveChange?: (active: boolean) => void
}) {
  const [project, setProject] = useState<KaraokeProject>(initialProject)
  const [activeTrackId, setActiveTrackId] = useState('lead')
  const [selectedWordIds, setSelectedWordIds] = useState(new Set(['hold']))
  return (
    <>
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={30_000}
        currentMs={0}
        zoom={1}
        activeTrackId={activeTrackId}
        selectedWordIds={selectedWordIds}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={setSelectedWordIds}
        onShiftWords={() => undefined}
        onResizeWord={() => undefined}
        onTimingDraftChange={() => undefined}
        onGestureActiveChange={onGestureActiveChange}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="marquee-selection">{[...selectedWordIds].sort().join(',')}</output>
      <button
        data-testid="replace-project"
        onClick={() => setProject((current) => ({ ...current, id: `${current.id}-replacement` }))}
      >
        Replace project
      </button>
      <button
        data-testid="replace-line"
        onClick={() =>
          setProject((current) => ({
            ...current,
            tracks: current.tracks.map((track) => ({
              ...track,
              lines: track.lines.map((line) => ({ ...line, id: `${line.id}-replacement` })),
            })),
          }))
        }
      >
        Replace line
      </button>
      <button data-testid="replace-active-track" onClick={() => setActiveTrackId('missing-track')}>
        Replace active track
      </button>
    </>
  )
}

function CaptureFailureHarness({
  onGestureActiveChange,
  onTimingDraftChange,
  onShiftWords,
  onResizeWord,
}: {
  onGestureActiveChange: (active: boolean) => void
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
}) {
  const [project] = useState<KaraokeProject>(initialProject)
  const [selectedWordIds, setSelectedWordIds] = useState(new Set<string>())
  const heldWord = project.tracks[0].lines[0].words[0]

  return (
    <>
      <Timeline
        project={project}
        peaks={[]}
        isAnalyzing={false}
        durationMs={30_000}
        currentMs={1_500}
        zoom={1}
        activeTrackId="lead"
        selectedWordIds={selectedWordIds}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={(wordId, add) =>
          setSelectedWordIds((current) => {
            const next = add ? new Set(current) : new Set<string>()
            next.add(wordId)
            return next
          })
        }
        onSelectWords={setSelectedWordIds}
        onShiftWords={onShiftWords}
        onResizeWord={onResizeWord}
        onTimingDraftChange={onTimingDraftChange}
        onGestureActiveChange={onGestureActiveChange}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="capture-selection">{[...selectedWordIds].sort().join(',')}</output>
      <output data-testid="capture-saved-timing">{`${heldWord.startMs}:${heldWord.endMs}`}</output>
    </>
  )
}

function KeyboardSelectionHarness({ syncMode = false }: { syncMode?: boolean }) {
  const [selectedWordIds, setSelectedWordIds] = useState(new Set<string>())
  return (
    <>
      <Timeline
        project={initialProject()}
        peaks={[]}
        isAnalyzing={false}
        durationMs={30_000}
        currentMs={0}
        zoom={1}
        activeTrackId="lead"
        selectedWordIds={selectedWordIds}
        syncWordId={null}
        syncMode={syncMode}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={(wordId, add) =>
          setSelectedWordIds((current) => {
            const next = add ? new Set(current) : new Set<string>()
            if (add && next.has(wordId)) next.delete(wordId)
            else next.add(wordId)
            return next
          })
        }
        onSelectWords={setSelectedWordIds}
        onShiftWords={() => undefined}
        onResizeWord={() => undefined}
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="keyboard-selection">{[...selectedWordIds].sort().join(',')}</output>
    </>
  )
}

export function mountTimeline(node: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(node))
  return container
}

export function unmountTimelineRoot() {
  act(() => root!.unmount())
  root = null
}

export function renderHarness(onGestureActiveChange?: (active: boolean) => void) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Harness onGestureActiveChange={onGestureActiveChange} />))
  return container
}

export function renderMarqueeHarness(onGestureActiveChange?: (active: boolean) => void) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<MarqueeHarness onGestureActiveChange={onGestureActiveChange} />))
  return container
}

export function renderCaptureFailureHarness(props: Parameters<typeof CaptureFailureHarness>[0]) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<CaptureFailureHarness {...props} />))
  return container
}

export function renderShortBlockHarness() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<ShortBlockHarness />))
  return container
}

export function renderKeyboardSelectionHarness(syncMode = false) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<KeyboardSelectionHarness syncMode={syncMode} />))
  return container
}

function pointerEvent(
  type: string,
  pointerId: number,
  clientX: number,
  clientY = 0,
  modifiers: PointerEventInit = {},
) {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId,
    clientX,
    clientY,
    ...modifiers,
  })
}

export function dispatchPointer(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY = 0,
  modifiers: PointerEventInit = {},
) {
  act(() => target.dispatchEvent(pointerEvent(type, pointerId, clientX, clientY, modifiers)))
}

export function previewProgress(scope: HTMLElement, word = 'Hold') {
  const stageWord = [...scope.querySelectorAll<HTMLElement>('.stage-word')].find(
    (element) => element.textContent?.trim() === word,
  )
  return stageWord?.style.getPropertyValue('--word-progress')
}

export function timelineWord(scope: HTMLElement, word = 'Hold') {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('.timeline-word')].find((element) =>
    element.getAttribute('aria-label')?.startsWith(`${word} timing block,`),
  )
  if (!button) throw new Error(`Missing timeline word: ${word}`)
  return button
}
