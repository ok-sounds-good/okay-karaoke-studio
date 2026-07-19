/**
 * @vitest-environment happy-dom
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { projectForTimingPreview, type ActiveTimingDraft } from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { Timeline } from '../src/components/Timeline'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import type { KaraokeProject } from '../src/lib/model'
import { patchWord, shiftWords, type ProjectTimingDraft } from '../src/utils'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const captures = new WeakMap<HTMLElement, Set<number>>()
const rejectedCaptureIds = new Set<number>()
const ignoredCaptureIds = new Set<number>()
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

function initialProject() {
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

function renderHarness(onGestureActiveChange?: (active: boolean) => void) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Harness onGestureActiveChange={onGestureActiveChange} />))
  return container
}

function renderMarqueeHarness(onGestureActiveChange?: (active: boolean) => void) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<MarqueeHarness onGestureActiveChange={onGestureActiveChange} />))
  return container
}

function renderCaptureFailureHarness(props: Parameters<typeof CaptureFailureHarness>[0]) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<CaptureFailureHarness {...props} />))
  return container
}

function renderShortBlockHarness() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<ShortBlockHarness />))
  return container
}

function renderKeyboardSelectionHarness(syncMode = false) {
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

function dispatchPointer(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY = 0,
  modifiers: PointerEventInit = {},
) {
  act(() => target.dispatchEvent(pointerEvent(type, pointerId, clientX, clientY, modifiers)))
}

function previewProgress(scope: HTMLElement, word = 'Hold') {
  const stageWord = [...scope.querySelectorAll<HTMLElement>('.stage-word')].find(
    (element) => element.textContent?.trim() === word,
  )
  return stageWord?.style.getPropertyValue('--word-progress')
}

function timelineWord(scope: HTMLElement, word = 'Hold') {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('.timeline-word')].find((element) =>
    element.getAttribute('aria-label')?.startsWith(`${word} timing block,`),
  )
  if (!button) throw new Error(`Missing timeline word: ${word}`)
  return button
}

describe('mounted Timeline live-preview wiring', () => {
  it('selects and toggles a timed word from the keyboard without starting a pointer gesture', () => {
    const scope = renderKeyboardSelectionHarness()
    let word = timelineWord(scope)
    expect(word.getAttribute('aria-pressed')).toBe('false')

    act(() =>
      word.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Enter',
          key: 'Enter',
        }),
      ),
    )
    word = timelineWord(scope)
    expect(scope.querySelector('[data-testid="keyboard-selection"]')?.textContent).toBe('hold')
    expect(word.getAttribute('aria-pressed')).toBe('true')
    expect(captures.get(word)?.size ?? 0).toBe(0)

    act(() =>
      word.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Space',
          key: ' ',
        }),
      ),
    )
    word = timelineWord(scope)
    expect(scope.querySelector('[data-testid="keyboard-selection"]')?.textContent).toBe('')
    expect(word.getAttribute('aria-pressed')).toBe('false')
    expect(captures.get(word)?.size ?? 0).toBe(0)
  })

  it('leaves bare Space available to the global tap-sync handler while sync is active', () => {
    const scope = renderKeyboardSelectionHarness(true)
    const word = timelineWord(scope)
    const globalKeyDown = vi.fn()
    window.addEventListener('keydown', globalKeyDown)
    try {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      })
      act(() => word.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(false)
      expect(globalKeyDown).toHaveBeenCalledOnce()
      expect(scope.querySelector('[data-testid="keyboard-selection"]')?.textContent).toBe('')
    } finally {
      window.removeEventListener('keydown', globalKeyDown)
    }
  })

  it('leaves modified Space chords available to app-level shortcuts', () => {
    const scope = renderKeyboardSelectionHarness()
    const word = timelineWord(scope)
    const globalKeyDown = vi.fn()
    window.addEventListener('keydown', globalKeyDown)
    try {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
        shiftKey: true,
      })
      act(() => word.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(false)
      expect(globalKeyDown).toHaveBeenCalledOnce()
      expect(scope.querySelector('[data-testid="keyboard-selection"]')?.textContent).toBe('')
    } finally {
      window.removeEventListener('keydown', globalKeyDown)
    }
  })

  it('keeps both edge-resize targets usable on a very short timing block', () => {
    const scope = renderShortBlockHarness()
    const word = timelineWord(scope, 'Short')
    expect(word.classList.contains('is-compact')).toBe(true)

    const startHandle = word.querySelector<HTMLElement>('.timeline-word__handle--start')!
    const endHandle = word.querySelector<HTMLElement>('.timeline-word__handle--end')!
    expect(startHandle).not.toBeNull()
    expect(endHandle).not.toBeNull()

    dispatchPointer(endHandle, 'pointerdown', 81, 100, 14)
    dispatchPointer(word, 'pointermove', 81, 110, 14)
    dispatchPointer(word, 'pointerup', 81, 110, 14)

    expect(scope.querySelector('[data-testid="short-saved-timing"]')?.textContent).toBe('1000:1090')
  })

  it('selects by visible marquee, adds with a modifier, and cleans up cancelled capture', () => {
    const activity: boolean[] = []
    let capturedBeforeActivation = false
    let marqueeVisibleAtActivation = false
    const scope = renderMarqueeHarness((active) => {
      activity.push(active)
      if (!active) return
      const activeLane = scope.querySelector<HTMLElement>('.timeline-lane')!
      capturedBeforeActivation = captures.get(activeLane)?.has(71) ?? false
      marqueeVisibleAtActivation = scope.querySelector('.timeline-marquee') !== null
    })
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!
    const selection = () => scope.querySelector('[data-testid="marquee-selection"]')?.textContent

    dispatchPointer(lane, 'pointerdown', 71, 200, 20)
    expect(activity).toEqual([true])
    expect(capturedBeforeActivation).toBe(true)
    expect(marqueeVisibleAtActivation).toBe(false)
    dispatchPointer(lane, 'pointermove', 71, 300, 50)
    expect(activity).toEqual([true])
    expect(container.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointerup', 71, 300, 50)
    expect(container.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('next')
    expect(captures.get(lane)?.has(71)).toBe(false)
    expect(activity).toEqual([true, false])

    dispatchPointer(lane, 'pointerdown', 72, 60, 20, { shiftKey: true })
    dispatchPointer(lane, 'pointermove', 72, 150, 50)
    dispatchPointer(lane, 'pointerup', 72, 150, 50)
    expect(selection()).toBe('hold,next')

    dispatchPointer(lane, 'pointerdown', 73, 400, 10)
    dispatchPointer(lane, 'pointermove', 73, 500, 50)
    expect(container.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointercancel', 73, 500, 50)
    expect(container.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('hold,next')
    expect(activity.slice(-2)).toEqual([true, false])

    dispatchPointer(lane, 'pointerdown', 74, 400, 10)
    dispatchPointer(lane, 'pointermove', 74, 500, 50)
    captures.get(lane)?.delete(74)
    dispatchPointer(lane, 'lostpointercapture', 74, 500, 50)
    expect(container.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('hold,next')
    expect(activity.slice(-2)).toEqual([true, false])
  })

  it('reports timing activity after capture and once across movement and pointer-up', () => {
    const activity: boolean[] = []
    let capturedBeforeActivation = false
    let draftAtActivation = ''
    const scope = renderHarness((active) => {
      activity.push(active)
      if (!active) return
      const activeWord = timelineWord(scope)
      capturedBeforeActivation = captures.get(activeWord)?.has(91) ?? false
      draftAtActivation = scope.querySelector('[data-testid="draft-state"]')?.textContent ?? ''
    })
    const word = timelineWord(scope)

    dispatchPointer(word, 'pointerdown', 91, 100)
    expect(activity).toEqual([true])
    expect(capturedBeforeActivation).toBe(true)
    expect(draftAtActivation).toBe('committed')
    dispatchPointer(word, 'pointermove', 91, 120)
    dispatchPointer(word, 'pointermove', 91, 136)
    expect(activity).toEqual([true])
    dispatchPointer(word, 'pointerup', 91, 136)
    dispatchPointer(word, 'pointerup', 91, 136)
    expect(activity).toEqual([true, false])
  })

  it.each([
    { failure: 'throws', failedIds: rejectedCaptureIds },
    { failure: 'does not retain capture', failedIds: ignoredCaptureIds },
  ])('selects without timing activity when pointer capture $failure', ({ failedIds }) => {
    const activity: boolean[] = []
    const timingDraftChange = vi.fn()
    const shift = vi.fn()
    const resize = vi.fn()
    const scope = renderCaptureFailureHarness({
      onGestureActiveChange: (active) => activity.push(active),
      onTimingDraftChange: timingDraftChange,
      onShiftWords: shift,
      onResizeWord: resize,
    })
    let word = timelineWord(scope)
    expect(word.getAttribute('aria-pressed')).toBe('false')
    expect(scope.querySelector('[data-testid="capture-selection"]')?.textContent).toBe('')

    failedIds.add(92)
    dispatchPointer(word, 'pointerdown', 92, 100)
    dispatchPointer(word, 'pointermove', 92, 136)
    dispatchPointer(word, 'pointerup', 92, 136)
    word = timelineWord(scope)
    expect(word.getAttribute('aria-pressed')).toBe('true')
    expect(scope.querySelector('[data-testid="capture-selection"]')?.textContent).toBe('hold')
    expect(activity).toEqual([])
    expect(captures.get(word)?.has(92) ?? false).toBe(false)
    expect(timingDraftChange).not.toHaveBeenCalled()
    expect(shift).not.toHaveBeenCalled()
    expect(resize).not.toHaveBeenCalled()
    expect(scope.querySelector('[data-testid="capture-saved-timing"]')?.textContent).toBe(
      '1000:2000',
    )

    word = timelineWord(scope)
    dispatchPointer(word, 'pointerdown', 93, 100)
    dispatchPointer(word, 'pointerup', 93, 100)
    expect(activity).toEqual([true, false])
  })

  it('does not activate marquee when pointer capture fails and remains usable afterward', () => {
    const activity: boolean[] = []
    const scope = renderMarqueeHarness((active) => activity.push(active))
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!

    ignoredCaptureIds.add(94)
    dispatchPointer(lane, 'pointerdown', 94, 100, 20)
    dispatchPointer(lane, 'pointermove', 94, 200, 50)
    expect(activity).toEqual([])
    expect(captures.get(lane)?.has(94) ?? false).toBe(false)
    expect(scope.querySelector('.timeline-marquee')).toBeNull()

    dispatchPointer(lane, 'pointerdown', 95, 100, 20)
    dispatchPointer(lane, 'pointercancel', 95, 100, 20)
    expect(activity).toEqual([true, false])
  })

  it('does not allow timing and marquee gestures to overlap', () => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    let word = timelineWord(scope)
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!

    dispatchPointer(word, 'pointerdown', 96, 100)
    dispatchPointer(lane, 'pointerdown', 97, 300, 30)
    expect(activity).toEqual([true])
    expect(scope.querySelector('.timeline-marquee')).toBeNull()
    expect(captures.get(lane)?.has(97) ?? false).toBe(false)
    dispatchPointer(word, 'pointercancel', 96, 100)
    expect(activity).toEqual([true, false])

    word = timelineWord(scope)
    dispatchPointer(lane, 'pointerdown', 98, 300, 30)
    dispatchPointer(word, 'pointerdown', 99, 100)
    expect(activity).toEqual([true, false, true])
    expect(captures.get(word)?.has(99) ?? false).toBe(false)
    dispatchPointer(lane, 'pointercancel', 98, 300, 30)
    expect(activity).toEqual([true, false, true, false])
  })

  it.each([
    ['project', 'replace-project'],
    ['active track', 'replace-active-track'],
    ['line', 'replace-line'],
  ])('ends timing activity once on incompatible %s replacement', (_scopeName, controlId) => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    const word = timelineWord(scope)

    dispatchPointer(word, 'pointerdown', 101, 100)
    dispatchPointer(word, 'pointermove', 101, 136)
    expect(activity).toEqual([true])
    act(() => scope.querySelector<HTMLButtonElement>(`[data-testid="${controlId}"]`)!.click())
    expect(activity).toEqual([true, false])
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
  })

  it.each([
    ['project', 'replace-project'],
    ['active track', 'replace-active-track'],
    ['line', 'replace-line'],
  ])('ends marquee activity once on incompatible %s replacement', (_scopeName, controlId) => {
    const activity: boolean[] = []
    const scope = renderMarqueeHarness((active) => activity.push(active))
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!

    dispatchPointer(lane, 'pointerdown', 102, 100, 20)
    dispatchPointer(lane, 'pointermove', 102, 200, 50)
    expect(activity).toEqual([true])
    act(() => scope.querySelector<HTMLButtonElement>(`[data-testid="${controlId}"]`)!.click())
    expect(activity).toEqual([true, false])
    expect(scope.querySelector('.timeline-marquee')).toBeNull()
  })

  it('ends active timing once on unmount without publishing another draft', () => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    const word = timelineWord(scope)

    dispatchPointer(word, 'pointerdown', 103, 100)
    dispatchPointer(word, 'pointermove', 103, 136)
    expect(activity).toEqual([true])
    act(() => root!.unmount())
    root = null
    expect(activity).toEqual([true, false])
  })

  it('ends active marquee once on unmount without a post-unmount render', () => {
    const activity: boolean[] = []
    const scope = renderMarqueeHarness((active) => activity.push(active))
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!

    dispatchPointer(lane, 'pointerdown', 104, 100, 20)
    dispatchPointer(lane, 'pointermove', 104, 200, 50)
    expect(activity).toEqual([true])
    act(() => root!.unmount())
    root = null
    expect(activity).toEqual([true, false])
  })

  it('wires discoverable timing controls and orders timeline navigation by intent', () => {
    const onToggleSync = vi.fn()
    const onClearTiming = vi.fn()
    const onClearTimingAfterCursor = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() =>
      root!.render(
        <Timeline
          project={initialProject()}
          peaks={[]}
          isAnalyzing={false}
          durationMs={30_000}
          currentMs={1_500}
          zoom={1}
          activeTrackId="lead"
          selectedWordIds={new Set()}
          syncWordId={null}
          syncMode={false}
          onSeek={() => undefined}
          onZoom={() => undefined}
          onSelectWord={() => undefined}
          onSelectWords={() => undefined}
          onShiftWords={() => undefined}
          onResizeWord={() => undefined}
          onTimingDraftChange={() => undefined}
          onToggleSync={onToggleSync}
          onClearTiming={onClearTiming}
          onClearTimingAfterCursor={onClearTimingAfterCursor}
        />,
      ),
    )

    const controls = [
      ...container.querySelectorAll<HTMLButtonElement>('.timeline-sync-tools button'),
    ]
    expect(controls.map((button) => button.textContent?.trim())).toEqual([
      'Start sync',
      'Clear timing',
      'Clear from cursor',
    ])
    expect(controls.map((button) => button.title)).toEqual([
      'Start lyric synchronization from the playhead',
      'Clear every timing in the active track; lyric text is preserved',
      'Clear active-track timings that begin at or after the playhead',
    ])
    act(() => controls.forEach((button) => button.click()))
    expect(onToggleSync).toHaveBeenCalledOnce()
    expect(onClearTiming).toHaveBeenCalledOnce()
    expect(onClearTimingAfterCursor).toHaveBeenCalledOnce()

    const navigation = [
      ...container.querySelectorAll<HTMLButtonElement>('.timeline-navigation button'),
    ]
    expect(navigation.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Jump timeline view to start',
      'Scroll timeline backward',
      'Scroll timeline forward',
    ])
    expect(navigation.map((button) => button.title)).toEqual([
      'Jump timeline view to start',
      'Scroll timeline backward',
      'Scroll timeline forward',
    ])
  })

  it.each([
    { mode: 'move', selector: null, moveX: 136, expectedProgress: '0%', committed: '1500:2500' },
    {
      mode: 'start resize',
      selector: '.timeline-word__handle--start',
      moveX: 136,
      expectedProgress: '0%',
      committed: '1500:2000',
    },
    {
      mode: 'end resize',
      selector: '.timeline-word__handle--end',
      moveX: 172,
      expectedProgress: '25%',
      committed: '1000:3000',
    },
  ])(
    'updates preview during $mode while committed project stays unchanged',
    ({ selector, moveX, expectedProgress, committed }) => {
      const scope = renderHarness()
      const word = timelineWord(scope)
      const pointerDownTarget = selector ? word.querySelector<HTMLElement>(selector)! : word

      expect(previewProgress(scope)).toBe('50%')
      dispatchPointer(pointerDownTarget, 'pointerdown', 21, 100)
      dispatchPointer(word, 'pointermove', 21, moveX)

      expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')
      expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')
      expect(previewProgress(scope)).toBe(expectedProgress)

      dispatchPointer(word, 'pointerup', 21, moveX)
      expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
      expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe(committed)
    },
  )

  it('clears draft state on pointer cancel and target-level capture loss', () => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    const word = timelineWord(scope)

    dispatchPointer(word, 'pointerdown', 31, 100)
    dispatchPointer(word, 'pointermove', 31, 136)
    expect(previewProgress(scope)).toBe('0%')
    dispatchPointer(word, 'pointercancel', 31, 136)
    expect(previewProgress(scope)).toBe('50%')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')
    expect(activity).toEqual([true, false])

    dispatchPointer(word, 'pointerdown', 32, 100)
    dispatchPointer(word, 'pointermove', 32, 136)
    captures.get(word)?.delete(32)
    dispatchPointer(word, 'lostpointercapture', 32, 136)
    expect(previewProgress(scope)).toBe('50%')
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(activity).toEqual([true, false, true, false])
  })

  it('clears a disconnected capture from document and permits another gesture', () => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 41, 100)
    dispatchPointer(held, 'pointermove', 41, 136)
    expect(previewProgress(scope)).toBe('0%')

    held.remove()
    captures.get(held)?.delete(41)
    dispatchPointer(document, 'lostpointercapture', 41, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')
    expect(activity).toEqual([true, false])

    const next = timelineWord(scope, 'Next')
    dispatchPointer(next, 'pointerdown', 42, 100)
    dispatchPointer(next, 'pointermove', 42, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')
    dispatchPointer(next, 'pointercancel', 42, 136)
    expect(activity).toEqual([true, false, true, false])
  })

  it('invalidates an active gesture when the project makes its word untimed', () => {
    const scope = renderHarness()
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 51, 100)
    dispatchPointer(held, 'pointermove', 51, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')

    const untime = scope.querySelector<HTMLButtonElement>('[data-testid="untime-held-word"]')!
    act(() => untime.click())
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('null:null')

    const next = timelineWord(scope, 'Next')
    dispatchPointer(next, 'pointerdown', 52, 100)
    dispatchPointer(next, 'pointermove', 52, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')
  })

  it('keeps a draft through metadata-only project replacement and commits on pointer-up', () => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 61, 100)
    dispatchPointer(held, 'pointermove', 61, 136)
    expect(previewProgress(scope)).toBe('0%')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')

    const refreshMetadata = scope.querySelector<HTMLButtonElement>(
      '[data-testid="refresh-metadata"]',
    )!
    act(() => refreshMetadata.click())
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')
    expect(previewProgress(scope)).toBe('0%')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')
    expect(activity).toEqual([true])

    dispatchPointer(held, 'pointerup', 61, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1500:2500')
    expect(activity).toEqual([true, false])
  })

  it('cancels when an affected timing changes during the gesture', () => {
    const activity: boolean[] = []
    const scope = renderHarness((active) => activity.push(active))
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 62, 100)
    dispatchPointer(held, 'pointermove', 62, 136)
    expect(previewProgress(scope)).toBe('0%')

    const changeTiming = scope.querySelector<HTMLButtonElement>(
      '[data-testid="change-held-timing"]',
    )!
    act(() => changeTiming.click())
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1100:2000')
    expect(activity).toEqual([true, false])

    dispatchPointer(held, 'pointerup', 62, 136)
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1100:2000')
    expect(activity).toEqual([true, false])
  })
})
