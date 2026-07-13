/**
 * @vitest-environment happy-dom
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { projectForTimingPreview, type ActiveTimingDraft } from '../src/App'
import { KaraokePreview } from '../src/components/KaraokePreview'
import { Timeline } from '../src/components/Timeline'
import { createLyricLine, createLyricWord, createProject, createVocalTrack } from '../src/lib/karaoke'
import type { KaraokeProject } from '../src/lib/model'
import { patchWord, shiftWords, type ProjectTimingDraft } from '../src/utils'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const captures = new WeakMap<HTMLElement, Set<number>>()
let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(pointerId: number) {
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

function Harness() {
  const [project, setProject] = useState<KaraokeProject>(initialProject)
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
        activeTrackId="lead"
        selectedWordIds={new Set(['hold'])}
        syncWordId={null}
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={() => undefined}
        onShiftWords={(ids, deltaMs) => replaceProject((current) => shiftWords(current, ids, deltaMs))}
        onResizeWord={(wordId, startMs, endMs) => (
          replaceProject((current) => patchWord(current, wordId, { startMs, endMs }))
        )}
        onTimingDraftChange={(timings: ProjectTimingDraft | null) => (
          setDraft(timings ? { revision, timings } : null)
        )}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="saved-timing">{`${heldWord.startMs}:${heldWord.endMs}`}</output>
      <output data-testid="draft-state">{draft ? 'draft' : 'committed'}</output>
      <button
        data-testid="untime-held-word"
        onClick={() => replaceProject((current) => patchWord(current, 'hold', { startMs: null, endMs: null }))}
      >Untime held word</button>
      <button
        data-testid="refresh-metadata"
        onClick={() => replaceProject((current) => ({
          ...current,
          durationMs: (current.durationMs ?? 0) + 1,
        }))}
      >Refresh metadata</button>
      <button
        data-testid="change-held-timing"
        onClick={() => replaceProject((current) => patchWord(current, 'hold', { startMs: 1_100 }))}
      >Change held timing</button>
    </>
  )
}

function ShortBlockHarness() {
  const [project, setProject] = useState<KaraokeProject>(() => createProject({
    durationMs: 30_000,
    tracks: [createVocalTrack({
      id: 'lead',
      lines: [createLyricLine('Short Next', {
        id: 'short-line',
        startMs: 1_000,
        endMs: 2_100,
        words: [
          createLyricWord('Short', { id: 'short', startMs: 1_000, endMs: 1_050 }),
          createLyricWord('Next', { id: 'short-next', startMs: 2_000, endMs: 2_100 }),
        ],
      })],
    })],
  }))
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
        onResizeWord={(wordId, startMs, endMs) => (
          setProject((current) => patchWord(current, wordId, { startMs, endMs }))
        )}
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="short-saved-timing">{`${shortWord.startMs}:${shortWord.endMs}`}</output>
    </>
  )
}

function MarqueeHarness() {
  const [selectedWordIds, setSelectedWordIds] = useState(new Set(['hold']))
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
        syncMode={false}
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onSelectWords={setSelectedWordIds}
        onShiftWords={() => undefined}
        onResizeWord={() => undefined}
        onTimingDraftChange={() => undefined}
        onToggleSync={() => undefined}
        onClearTiming={() => undefined}
        onClearTimingAfterCursor={() => undefined}
      />
      <output data-testid="marquee-selection">{[...selectedWordIds].sort().join(',')}</output>
    </>
  )
}

function renderHarness() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Harness />))
  return container
}

function renderShortBlockHarness() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<ShortBlockHarness />))
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
  const stageWord = [...scope.querySelectorAll<HTMLElement>('.stage-word')]
    .find((element) => element.textContent?.trim() === word)
  return stageWord?.style.getPropertyValue('--word-progress')
}

function timelineWord(scope: HTMLElement, word = 'Hold') {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('.timeline-word')]
    .find((element) => element.getAttribute('aria-label')?.startsWith(`${word} timing block,`))
  if (!button) throw new Error(`Missing timeline word: ${word}`)
  return button
}

describe('mounted Timeline live-preview wiring', () => {
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
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root!.render(<MarqueeHarness />))
    const lane = container.querySelector<HTMLElement>('.timeline-lane')!
    const selection = () => container!.querySelector('[data-testid="marquee-selection"]')?.textContent

    dispatchPointer(lane, 'pointerdown', 71, 200, 20)
    dispatchPointer(lane, 'pointermove', 71, 300, 50)
    expect(container.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointerup', 71, 300, 50)
    expect(container.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('next')
    expect(captures.get(lane)?.has(71)).toBe(false)

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

    dispatchPointer(lane, 'pointerdown', 74, 400, 10)
    dispatchPointer(lane, 'pointermove', 74, 500, 50)
    captures.get(lane)?.delete(74)
    dispatchPointer(lane, 'lostpointercapture', 74, 500, 50)
    expect(container.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('hold,next')
  })

  it('wires discoverable timing controls and orders timeline navigation by intent', () => {
    const onToggleSync = vi.fn()
    const onClearTiming = vi.fn()
    const onClearTimingAfterCursor = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root!.render(
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
    ))

    const controls = [...container.querySelectorAll<HTMLButtonElement>('.timeline-sync-tools button')]
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

    const navigation = [...container.querySelectorAll<HTMLButtonElement>('.timeline-navigation button')]
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
    { mode: 'start resize', selector: '.timeline-word__handle--start', moveX: 136, expectedProgress: '0%', committed: '1500:2000' },
    { mode: 'end resize', selector: '.timeline-word__handle--end', moveX: 172, expectedProgress: '25%', committed: '1000:3000' },
  ])('updates preview during $mode while committed project stays unchanged', ({ selector, moveX, expectedProgress, committed }) => {
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
  })

  it('clears draft state on pointer cancel and target-level capture loss', () => {
    const scope = renderHarness()
    const word = timelineWord(scope)

    dispatchPointer(word, 'pointerdown', 31, 100)
    dispatchPointer(word, 'pointermove', 31, 136)
    expect(previewProgress(scope)).toBe('0%')
    dispatchPointer(word, 'pointercancel', 31, 136)
    expect(previewProgress(scope)).toBe('50%')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')

    dispatchPointer(word, 'pointerdown', 32, 100)
    dispatchPointer(word, 'pointermove', 32, 136)
    captures.get(word)?.delete(32)
    dispatchPointer(word, 'lostpointercapture', 32, 136)
    expect(previewProgress(scope)).toBe('50%')
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
  })

  it('clears a disconnected capture from document and permits another gesture', () => {
    const scope = renderHarness()
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 41, 100)
    dispatchPointer(held, 'pointermove', 41, 136)
    expect(previewProgress(scope)).toBe('0%')

    held.remove()
    captures.get(held)?.delete(41)
    dispatchPointer(document, 'lostpointercapture', 41, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')

    const next = timelineWord(scope, 'Next')
    dispatchPointer(next, 'pointerdown', 42, 100)
    dispatchPointer(next, 'pointermove', 42, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')
    dispatchPointer(next, 'pointercancel', 42, 136)
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
    const scope = renderHarness()
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 61, 100)
    dispatchPointer(held, 'pointermove', 61, 136)
    expect(previewProgress(scope)).toBe('0%')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')

    const refreshMetadata = scope.querySelector<HTMLButtonElement>('[data-testid="refresh-metadata"]')!
    act(() => refreshMetadata.click())
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('draft')
    expect(previewProgress(scope)).toBe('0%')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1000:2000')

    dispatchPointer(held, 'pointerup', 61, 136)
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1500:2500')
  })

  it('cancels when an affected timing changes during the gesture', () => {
    const scope = renderHarness()
    const held = timelineWord(scope)

    dispatchPointer(held, 'pointerdown', 62, 100)
    dispatchPointer(held, 'pointermove', 62, 136)
    expect(previewProgress(scope)).toBe('0%')

    const changeTiming = scope.querySelector<HTMLButtonElement>('[data-testid="change-held-timing"]')!
    act(() => changeTiming.click())
    expect(scope.querySelector('[data-testid="draft-state"]')?.textContent).toBe('committed')
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1100:2000')

    dispatchPointer(held, 'pointerup', 62, 136)
    expect(scope.querySelector('[data-testid="saved-timing"]')?.textContent).toBe('1100:2000')
  })
})
