/**
 * @vitest-environment happy-dom
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

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
        onSeek={() => undefined}
        onZoom={() => undefined}
        onSelectWord={() => undefined}
        onShiftWords={(ids, deltaMs) => replaceProject((current) => shiftWords(current, ids, deltaMs))}
        onResizeWord={(wordId, startMs, endMs) => (
          replaceProject((current) => patchWord(current, wordId, { startMs, endMs }))
        )}
        onTimingDraftChange={(timings: ProjectTimingDraft | null) => (
          setDraft(timings ? { revision, timings } : null)
        )}
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

function renderHarness() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Harness />))
  return container
}

function pointerEvent(type: string, pointerId: number, clientX: number) {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    pointerId,
    clientX,
  })
}

function dispatchPointer(target: EventTarget, type: string, pointerId: number, clientX: number) {
  act(() => target.dispatchEvent(pointerEvent(type, pointerId, clientX)))
}

function previewProgress(scope: HTMLElement, word = 'Hold') {
  const stageWord = [...scope.querySelectorAll<HTMLElement>('.stage-word')]
    .find((element) => element.textContent?.trim() === word)
  return stageWord?.style.getPropertyValue('--word-progress')
}

function timelineWord(scope: HTMLElement, word = 'Hold') {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('.timeline-word')]
    .find((element) => element.textContent?.trim() === word)
  if (!button) throw new Error(`Missing timeline word: ${word}`)
  return button
}

describe('mounted Timeline live-preview wiring', () => {
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
