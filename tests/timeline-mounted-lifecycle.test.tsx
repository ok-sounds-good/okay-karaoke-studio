/**
 * @vitest-environment happy-dom
 */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  captures,
  dispatchPointer,
  ignoredCaptureIds,
  previewProgress,
  rejectedCaptureIds,
  renderCaptureFailureHarness,
  renderHarness,
  renderMarqueeHarness,
  timelineWord,
  unmountTimelineRoot,
} from './support/timeline-mounted-harness'

describe('mounted Timeline gesture lifecycle', () => {
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
    expect(scope.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointerup', 71, 300, 50)
    expect(scope.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('next')
    expect(captures.get(lane)?.has(71)).toBe(false)
    expect(activity).toEqual([true, false])

    dispatchPointer(lane, 'pointerdown', 72, 60, 20, { shiftKey: true })
    dispatchPointer(lane, 'pointermove', 72, 150, 50)
    dispatchPointer(lane, 'pointerup', 72, 150, 50)
    expect(selection()).toBe('hold,next')

    dispatchPointer(lane, 'pointerdown', 73, 400, 10)
    dispatchPointer(lane, 'pointermove', 73, 500, 50)
    expect(scope.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointercancel', 73, 500, 50)
    expect(scope.querySelector('.timeline-marquee')).toBeNull()
    expect(selection()).toBe('hold,next')
    expect(activity.slice(-2)).toEqual([true, false])

    dispatchPointer(lane, 'pointerdown', 74, 400, 10)
    dispatchPointer(lane, 'pointermove', 74, 500, 50)
    captures.get(lane)?.delete(74)
    dispatchPointer(lane, 'lostpointercapture', 74, 500, 50)
    expect(scope.querySelector('.timeline-marquee')).toBeNull()
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
    unmountTimelineRoot()
    expect(activity).toEqual([true, false])
  })

  it('ends active marquee once on unmount without a post-unmount render', () => {
    const activity: boolean[] = []
    const scope = renderMarqueeHarness((active) => activity.push(active))
    const lane = scope.querySelector<HTMLElement>('.timeline-lane')!

    dispatchPointer(lane, 'pointerdown', 104, 100, 20)
    dispatchPointer(lane, 'pointermove', 104, 200, 50)
    expect(activity).toEqual([true])
    unmountTimelineRoot()
    expect(activity).toEqual([true, false])
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
