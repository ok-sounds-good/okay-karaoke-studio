/**
 * @vitest-environment happy-dom
 */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Timeline } from '../src/components/Timeline'
import {
  captures,
  dispatchPointer,
  ignoredCaptureIds,
  initialProject,
  mountTimeline,
  rejectedCaptureIds,
  renderKeyboardSelectionHarness,
  renderShortBlockHarness,
  timelineWord,
} from './support/timeline-mounted-harness'

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

  it('wires discoverable timing controls and orders timeline navigation by intent', () => {
    const onToggleSync = vi.fn()
    const onClearTiming = vi.fn()
    const onClearTimingAfterCursor = vi.fn()
    const scope = mountTimeline(
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
    )

    const controls = [...scope.querySelectorAll<HTMLButtonElement>('.timeline-sync-tools button')]
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

    const navigation = [...scope.querySelectorAll<HTMLButtonElement>('.timeline-navigation button')]
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
})
