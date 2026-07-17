// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App'
import { createDemoProject, parseProject, serializeProject } from '../src/lib/model'
import { DEFAULT_VOCAL_STYLE } from '../src/lib/video-style'

interface StudioHarness {
  studio: StudioApi
  cancelVideoExport: ReturnType<typeof vi.fn>
  exportText: ReturnType<typeof vi.fn>
  exportVideo: ReturnType<typeof vi.fn>
  importAudio: ReturnType<typeof vi.fn>
  openProject: ReturnType<typeof vi.fn>
  resetProjectScope: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
  settleProjectOpen: ReturnType<typeof vi.fn>
  sendMenuAction: (action: StudioMenuAction) => void
}

class MetadataAudio extends EventTarget {
  static instances: MetadataAudio[] = []

  currentTime = 0
  duration = 30
  playbackRate = 1
  volume = 1
  preload = ''
  play = vi.fn(async () => undefined)
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn()

  constructor(_url: string) {
    super()
    MetadataAudio.instances.push(this)
  }
}

function createStudioHarness(): StudioHarness {
  const openProject = vi.fn(async () => null)
  const settleProjectOpen = vi.fn(async () => true)
  const resetProjectScope = vi.fn(async () => true)
  const saveProject = vi.fn(async () => ({ path: '/saved/project.oks' }))
  const importAudio = vi.fn(async () => null)
  const exportText = vi.fn(async () => ({ path: '/exports/project.oks' }))
  const exportVideo = vi.fn(async () => null)
  const cancelVideoExport = vi.fn(async () => true)
  let menuActionListener: ((action: StudioMenuAction) => void) | null = null
  const onMenuAction = vi.fn((callback: (action: StudioMenuAction) => void) => {
    menuActionListener = callback
    return () => {
      if (menuActionListener === callback) menuActionListener = null
    }
  })
  const studio = {
    openProject,
    settleProjectOpen,
    resetProjectScope,
    saveProject,
    importAudio,
    resolveProjectAudio: vi.fn(async () => null),
    releaseAudio: vi.fn(async () => undefined),
    importLrc: vi.fn(async () => null),
    exportText,
    exportVideo,
    cancelVideoExport,
    onVideoExportProgress: vi.fn(() => () => undefined),
    onMenuAction,
  } as unknown as StudioApi

  return {
    studio,
    cancelVideoExport,
    exportText,
    exportVideo,
    importAudio,
    openProject,
    resetProjectScope,
    saveProject,
    settleProjectOpen,
    sendMenuAction: (action) => menuActionListener?.(action),
  }
}

async function selectValue(ariaLabel: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`[aria-label="${ariaLabel}"]`)
  if (!select) throw new Error(`Could not find select: ${ariaLabel}`)
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function buttonContaining(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Could not find button containing: ${label}`)
  return button
}

async function clickButton(label: string) {
  await act(async () => {
    buttonContaining(label).click()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

async function replaceTextarea(text: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) throw new Error('Lyrics textarea was not mounted')
  await act(async () => {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set
    if (!nativeValueSetter) throw new Error('Textarea value setter is unavailable')
    nativeValueSetter.call(textarea, text)
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
  })
}

async function replaceProjectTitle(text: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Project inspector"] input')
  if (!input) throw new Error('Project title input was not mounted')
  await act(async () => {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    if (!nativeValueSetter) throw new Error('Input value setter is unavailable')
    nativeValueSetter.call(input, text)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
  })
}

async function pressKey(code: string, init: KeyboardEventInit = {}) {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    key: code === 'Space' ? ' ' : code,
    ...init,
  })))
}

async function releaseKey(code: string, init: KeyboardEventInit = {}) {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    code,
    key: code === 'Space' ? ' ' : code,
    ...init,
  })))
}

async function tapSyncWord() {
  await pressKey('Space')
  await releaseKey('Space')
}

function timelineTimingLabels() {
  return [...document.querySelectorAll<HTMLElement>('.timeline-word')]
    .map((word) => word.getAttribute('aria-label'))
}

describe('mounted first-time workflow', () => {
  let container: HTMLDivElement
  let root: Root | null
  let harness: StudioHarness

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    harness = createStudioHarness()
    Object.defineProperty(window, 'studio', {
      configurable: true,
      value: harness.studio,
    })
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(<App />))
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    container.remove()
    Object.defineProperty(window, 'studio', { configurable: true, value: undefined })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function prepareVideoExportProject() {
    vi.stubGlobal('AudioContext', class {
      async close() {}
      async decodeAudioData() {
        return { getChannelData: () => new Float32Array([0]) }
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0),
    })))
    harness.importAudio.mockResolvedValueOnce({
      path: '/music/backing.mp3',
      name: 'backing.mp3',
      url: 'studio-media://asset/00000000-0000-0000-0000-000000000000/backing.mp3',
    })

    await clickButton('Edit text')
    await replaceTextarea('Ready to export')
    await clickButton('Apply lyrics')
    await clickButton('Workflow')
    await clickButton('Attach audio')
    await clickButton('Workflow')
    await clickButton('Choose export')
  }

  it('offers lyric editing only from Live Preview in the non-sync workspace', () => {
    const preview = document.querySelector<HTMLElement>('[aria-label="Karaoke preview"]')
    const timeline = document.querySelector<HTMLElement>('[aria-label="Lyric Timing"]')
    const editTextButtons = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.textContent?.trim() === 'Edit text')

    expect(preview).not.toBeNull()
    expect(timeline).not.toBeNull()
    expect(editTextButtons).toHaveLength(1)
    expect(preview?.contains(editTextButtons[0])).toBe(true)
    expect(timeline?.contains(editTextButtons[0])).toBe(false)
    expect(timeline?.textContent).not.toContain('Edit text')
  })

  it('starts the inspector with song details and no decorative header row', () => {
    const inspector = document.querySelector<HTMLElement>('[aria-label="Project inspector"]')

    expect(inspector).not.toBeNull()
    expect(inspector?.firstElementChild?.className).toBe('inspector__scroll')
    expect(inspector?.querySelector('.panel-header')).toBeNull()
    expect(
      inspector?.querySelector('.inspector-section:first-child .inspector-section__title')
        ?.textContent,
    ).toContain('Song details')
  })

  it('opens the real guide from TopBar and enforces the lyrics-to-sync transition', async () => {
    await clickButton('Workflow')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Make your first karaoke',
    )

    await clickButton('Open .oks')
    expect(harness.openProject).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await clickButton('Workflow')
    await clickButton('New project')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')

    await clickButton('Workflow')
    const blockedSync = buttonContaining('Add lyrics first')
    expect(blockedSync.disabled).toBe(true)
    await act(async () => blockedSync.click())
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(false)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await clickButton('Edit lyrics')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Edit Lead Vocal')
    await replaceTextarea('Hello first singer')
    await clickButton('Apply lyrics')

    await clickButton('Workflow')
    expect(buttonContaining('Arm tap sync').disabled).toBe(false)
    act(() => buttonContaining('Arm tap sync').click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(true)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Escape', key: 'Escape' }))
    })
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(false)
  })

  it('starts clean and sends the same semantic empty project through save and export', async () => {
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.body.textContent).not.toContain('Neon Afterglow')
    expect(document.body.textContent).not.toContain('Add duet track')
    expect(document.querySelectorAll('.lyric-line')).toHaveLength(0)

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenCalledWith(expect.objectContaining({
      path: undefined,
      suggestedName: 'untitled-song.oks',
    }))
    const savedContents = harness.saveProject.mock.calls[0][0].contents
    expect(parseProject(savedContents)).toMatchObject({
      title: 'Untitled Song',
      artist: 'Unknown Artist',
      audioPath: null,
      durationMs: null,
      offsetMs: 0,
      tracks: [{ name: 'Lead Vocal', lines: [] }],
    })

    await clickButton('Workflow')
    await clickButton('Choose export')
    const exportDialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(exportDialog?.textContent).toContain('Add lyrics before exporting karaoke')
    expect(exportDialog?.textContent).toContain('Editable .oks project')
    const exportOption = (label: string) => [...exportDialog!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes(label))
    expect(exportOption('Enhanced LRC')?.disabled).toBe(true)
    expect(exportOption('ASS karaoke subtitles')?.disabled).toBe(true)
    expect(exportOption('Karaoke video')?.disabled).toBe(true)
    expect(exportOption('Editable .oks project')?.disabled).toBe(false)
    await clickButton('Editable .oks project')
    expect(harness.exportText).toHaveBeenCalledWith({
      suggestedName: 'unknown-artist-untitled-song.oks',
      contents: savedContents,
      format: 'oks',
    })
  })

  it('persists the shared preview and video lyric-display options', async () => {
    const lineCount = document.querySelector<HTMLSelectElement>('[aria-label="Visible lyric lines"]')!
    const advanceMode = document.querySelector<HTMLSelectElement>('[aria-label="Lyric line advance mode"]')!
    await act(async () => {
      lineCount.value = '5'
      lineCount.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      advanceMode.value = 'scroll'
      advanceMode.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(lineCount.value).toBe('5')
    expect(advanceMode.value).toBe('scroll')
    await act(async () => harness.sendMenuAction('save'))
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).lyricDisplay).toEqual({
      lineCount: 5,
      advanceMode: 'scroll',
    })
  })

  it('stores the inspector color shortcut as a vocal sung-color override', async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Track 1 Sung color"]')!
    expect(input.closest('label')?.textContent).toContain('Sung')
    await act(async () => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      if (!nativeValueSetter) throw new Error('Input value setter is unavailable')
      nativeValueSetter.call(input, '#123456')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '#123456' }))
    })
    await act(async () => harness.sendMenuAction('save'))

    const saved = parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
    expect(saved.tracks[0].vocalStyle).toEqual({ ...DEFAULT_VOCAL_STYLE, sungColor: '#123456' })
    expect(saved.tracks[0]).not.toHaveProperty('color')
  })

  it('reserves bare Space, uses Shift+Space for playback, and wires Stop to reset transport', async () => {
    const bareSpace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    })
    await act(async () => window.dispatchEvent(bareSpace))

    expect(bareSpace.defaultPrevented).toBe(true)
    expect(document.querySelector('[aria-label="Pause"]')).toBeNull()

    const focusedButton = document.querySelector<HTMLButtonElement>('[aria-label="Play"]')
    if (!focusedButton) throw new Error('Play transport control was not mounted')
    focusedButton.focus()
    const buttonSpace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    })
    await act(async () => focusedButton.dispatchEvent(buttonSpace))

    expect(buttonSpace.defaultPrevented).toBe(false)

    const shiftedSpace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
      shiftKey: true,
    })
    await act(async () => window.dispatchEvent(shiftedSpace))

    expect(shiftedSpace.defaultPrevented).toBe(true)
    expect(document.querySelector('[aria-label="Pause"]')).not.toBeNull()

    const playingBareSpace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    })
    await act(async () => window.dispatchEvent(playingBareSpace))
    expect(playingBareSpace.defaultPrevented).toBe(true)
    expect(document.querySelector('[aria-label="Pause"]')).not.toBeNull()

    const skipForward = document.querySelector<HTMLButtonElement>(
      '[aria-label="Skip forward five seconds"]',
    )
    if (!skipForward) throw new Error('Skip-forward transport control was not mounted')
    await act(async () => skipForward.click())
    expect(document.querySelector('.time-readout strong')?.textContent).toBe('0:05.000')

    const stop = document.querySelector<HTMLButtonElement>('[aria-label="Stop"]')
    if (!stop) throw new Error('Stop transport control was not mounted')
    expect(stop.title).toBe('Stop and return to the start')
    await act(async () => stop.click())

    expect(document.querySelector('[aria-label="Play"]')).not.toBeNull()
    expect(document.querySelector('.time-readout strong')?.textContent).toBe('0:00.000')
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Playback speed"]')?.title).toBe('Set playback speed')
    expect(document.querySelector<HTMLInputElement>('[aria-label="Volume"]')?.title).toBe('Adjust playback volume')
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Track 1 Sung color"]')?.title,
    ).toBe('Choose Sung color for Lead Vocal')
  })

  it('keeps timing-block selection on bare Space while Shift+Space controls playback', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Focused')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')
    await tapSyncWord()
    await pressKey('Escape')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Stop"]')?.click()
    })

    let timingBlock = document.querySelector<HTMLButtonElement>('.timeline-word')
    if (!timingBlock) throw new Error('Timed word block was not mounted')
    timingBlock.focus()

    const bareSpace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    })
    await act(async () => timingBlock?.dispatchEvent(bareSpace))

    timingBlock = document.querySelector<HTMLButtonElement>('.timeline-word')
    expect(bareSpace.defaultPrevented).toBe(true)
    expect(timingBlock?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[aria-label="Pause"]')).toBeNull()

    const shiftedSpace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
      shiftKey: true,
    })
    await act(async () => timingBlock?.dispatchEvent(shiftedSpace))

    expect(shiftedSpace.defaultPrevented).toBe(true)
    expect(document.querySelector('[aria-label="Pause"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('.timeline-word')?.getAttribute('aria-pressed')).toBe('true')
  })

  it.each([
    { modifier: 'Control', init: { ctrlKey: true } },
    { modifier: 'Command', init: { metaKey: true } },
  ])('$modifier+A selects every active-track word outside typing fields', async ({ init }) => {
    await clickButton('Edit text')
    await replaceTextarea('Select every active word')
    await clickButton('Apply lyrics')

    const words = [...document.querySelectorAll<HTMLButtonElement>('.untimed-tray button')]
    expect(words).toHaveLength(4)
    await act(async () => words[0].click())
    expect(document.querySelectorAll('.untimed-tray button.is-selected')).toHaveLength(1)

    const selectAll = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyA',
      key: 'a',
      ...init,
    })
    await act(async () => window.dispatchEvent(selectAll))

    expect(selectAll.defaultPrevented).toBe(true)
    expect(document.querySelectorAll('.untimed-tray button.is-selected')).toHaveLength(4)
  })

  it('routes desktop Select All to track words while preserving lyric-editor text selection', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Menu selects words')
    await clickButton('Apply lyrics')
    const words = [...document.querySelectorAll<HTMLButtonElement>('.untimed-tray button')]
    expect(words).toHaveLength(3)
    await act(async () => words[0].click())
    expect(document.querySelectorAll('.untimed-tray button.is-selected')).toHaveLength(1)

    await act(async () => harness.sendMenuAction('select-all'))
    expect(document.querySelectorAll('.untimed-tray button.is-selected')).toHaveLength(3)

    await act(async () => words[0].click())
    await clickButton('Edit text')
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.focus()
    textarea.setSelectionRange(0, 0)
    await act(async () => harness.sendMenuAction('select-all'))
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(textarea.value.length)
    expect(document.querySelectorAll('.untimed-tray button.is-selected')).toHaveLength(1)
  })

  it('leaves modified Space chords alone while armed and times only exact bare Space', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Only')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    const modifiedChords = [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { ctrlKey: true, shiftKey: true },
    ]
    for (const modifiers of modifiedChords) {
      const down = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
        ...modifiers,
      })
      const up = new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
        ...modifiers,
      })
      await act(async () => {
        window.dispatchEvent(down)
        window.dispatchEvent(up)
      })
      expect(down.defaultPrevented).toBe(false)
      expect(up.defaultPrevented).toBe(false)
    }
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(0)

    const bareDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    })
    const bareUp = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    })
    await act(async () => {
      window.dispatchEvent(bareDown)
      window.dispatchEvent(bareUp)
    })

    expect(bareDown.defaultPrevented).toBe(true)
    expect(bareUp.defaultPrevented).toBe(true)
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(1)
  })

  it('uses a lightweight sync cue and backfills adjacent word timing from live onsets', async () => {
    await clickButton('Edit text')
    await replaceTextarea('First second third\nFourth fifth')
    await clickButton('Apply lyrics')

    expect(document.querySelector('.preview-panel')).not.toBeNull()
    expect(document.querySelector('.lyrics-panel')).toBeNull()
    await clickButton('Start sync')

    expect(document.querySelector('.preview-panel')).toBeNull()
    expect(document.querySelector('.sync-cue')).not.toBeNull()
    expect(document.querySelector('.sync-cue__line.is-current')?.textContent).toContain('First')
    expect(document.querySelector('.sync-cue__line.is-next')?.textContent).toContain('Fourth')

    const press = async (code: string, init: KeyboardEventInit = {}) => {
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code,
        key: code === 'Space' ? ' ' : code === 'ArrowRight' ? 'ArrowRight' : code,
        ...init,
      })))
    }
    const releaseSpace = async () => {
      await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      })))
    }

    await press('Space')
    await releaseSpace()
    await press('ArrowRight')
    await press('Space')
    await releaseSpace()
    await press('ArrowRight')
    await press('Space')
    await press('ArrowRight', { shiftKey: true })
    await releaseSpace()

    const labels = [...document.querySelectorAll<HTMLElement>('.timeline-word')]
      .map((word) => word.getAttribute('aria-label'))
    expect(labels).toEqual(expect.arrayContaining([
      'First timing block, 0:00.000–0:00.250',
      'second timing block, 0:00.250–0:00.500',
      'third timing block, 0:00.500–0:01.500',
    ]))
    expect(document.querySelector('.sync-cue__line.is-current')?.textContent).toContain('Fourth')

    await press('Escape')
    expect(document.querySelector('.preview-panel')).not.toBeNull()
    expect(document.querySelector('.sync-cue')).toBeNull()

    await act(async () => harness.sendMenuAction('save'))
    const saved = parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
    const timed = saved.tracks[0].lines[0].words
    expect(timed.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 250],
      [250, 500],
      [500, 1_500],
    ])

    await act(async () => harness.sendMenuAction('undo'))
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(0)
  })

  it('does not shrink the prior word or start the next word before it when the sync clock regresses', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Alpha beta')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    await tapSyncWord()
    await pressKey('ArrowRight')
    await pressKey('ArrowRight')
    await tapSyncWord()
    expect(timelineTimingLabels()).toEqual(expect.arrayContaining([
      'Alpha timing block, 0:00.000–0:00.500',
      'beta timing block, 0:00.500–0:00.600',
    ]))

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click()
    })
    await pressKey('ArrowRight')
    expect(document.querySelector('.time-readout strong')?.textContent).toBe('0:00.250')
    await clickButton('Start sync')
    await tapSyncWord()

    await act(async () => harness.sendMenuAction('save'))
    const saved = parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
    expect(saved.tracks[0].lines[0].words.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 500],
      [500, 600],
    ])
  })

  it('caps a held line-final word at the already-timed next word', async () => {
    await clickButton('Edit text')
    await replaceTextarea('North\nSouth')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    await tapSyncWord()
    await pressKey('ArrowRight')
    await pressKey('ArrowRight')
    await tapSyncWord()
    expect(timelineTimingLabels()).toEqual(expect.arrayContaining([
      'North timing block, 0:00.000–0:00.100',
      'South timing block, 0:00.500–0:00.600',
    ]))

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click()
    })
    await clickButton('Start sync')
    await pressKey('Space')
    await pressKey('ArrowRight')
    await pressKey('ArrowRight')
    await pressKey('ArrowRight')
    await releaseKey('Space')
    await pressKey('Escape')

    await act(async () => harness.sendMenuAction('save'))
    const saved = parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
    expect(saved.tracks[0].lines.map((line) => (
      line.words.map(({ startMs, endMs }) => [startMs, endMs])
    ))).toEqual([
      [[0, 500]],
      [[500, 600]],
    ])
  })

  it('ends an armed sync before Undo and keeps Redo and later bare Space outside that session', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Amber signal remains')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    await tapSyncWord()
    await pressKey('ArrowRight')
    await tapSyncWord()
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(2)
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(true)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()
    })
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(false)
    expect(document.querySelector('.sync-cue')).toBeNull()
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(0)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')!.click()
    })
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(false)
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(2)
    const restoredTimings = timelineTimingLabels()

    await tapSyncWord()
    expect(timelineTimingLabels()).toEqual(restoredTimings)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click()
    })
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(0)
  })

  it('ends a sync session before an unrelated Inspector edit and preserves both undo boundaries', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Copper lantern glows')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    await tapSyncWord()
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(1)
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(true)

    await replaceProjectTitle('Retitled after one tap')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Retitled after one tap')
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(false)

    await tapSyncWord()
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(1)

    await act(async () => harness.sendMenuAction('undo'))
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(1)

    await act(async () => harness.sendMenuAction('undo'))
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(0)
  })

  it('keeps a changed re-sync undoable when its first timing mutation is identical', async () => {
    await clickButton('Edit text')
    await replaceTextarea('First\nSecond')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    await tapSyncWord()
    await pressKey('ArrowRight')
    await tapSyncWord()
    expect(timelineTimingLabels()).toEqual(expect.arrayContaining([
      'First timing block, 0:00.000–0:00.100',
      'Second timing block, 0:00.250–0:00.350',
    ]))

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click()
    })
    await clickButton('Start sync')
    await tapSyncWord()
    await pressKey('ArrowRight')
    await pressKey('ArrowRight')
    await tapSyncWord()
    expect(timelineTimingLabels()).toEqual(expect.arrayContaining([
      'First timing block, 0:00.000–0:00.100',
      'Second timing block, 0:00.500–0:00.600',
    ]))

    await act(async () => harness.sendMenuAction('undo'))
    expect(timelineTimingLabels()).toEqual(expect.arrayContaining([
      'First timing block, 0:00.000–0:00.100',
      'Second timing block, 0:00.250–0:00.350',
    ]))
  })

  it('does not collapse sync taps into lyric time zero during a positive-offset pre-roll', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Wait then sing')
    await clickButton('Apply lyrics')
    const offsetInput = document.querySelector<HTMLInputElement>('.field--inline input')!
    await act(async () => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      nativeValueSetter?.call(offsetInput, '1000')
      offsetInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: '1000' }))
    })
    await clickButton('Start sync')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
      window.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
    })

    expect(document.querySelectorAll('.timeline-word')).toHaveLength(0)
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'lyric clock has not reached 0:00',
    )

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'ArrowRight',
      key: 'ArrowRight',
      shiftKey: true,
    })))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
      window.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
    })
    expect(document.querySelectorAll('.timeline-word')).toHaveLength(1)
  })

  it('does not wrap synchronization to the first word after the last timed word', async () => {
    await clickButton('Edit text')
    await replaceTextarea('Only')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
      window.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
    })
    const firstTiming = document.querySelector('.timeline-word')?.getAttribute('aria-label')
    expect(firstTiming).toContain('Only timing block')

    const stop = document.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!
    const forward = document.querySelector<HTMLButtonElement>('[aria-label="Skip forward five seconds"]')!
    await act(async () => stop.click())
    await act(async () => forward.click())
    expect(document.querySelector('.time-readout strong')?.textContent).toBe('0:05.000')

    await clickButton('Start sync')
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(false)
    expect(document.querySelector('[role="status"]')?.textContent).toContain('No words remain at or after the playhead')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
      window.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        code: 'Space',
        key: ' ',
      }))
    })
    expect(document.querySelector('.timeline-word')?.getAttribute('aria-label')).toBe(firstTiming)
  })

  it('reloads an unavailable local font only when the user retries it', async () => {
    const fontLoads = vi.fn(async () => { throw new Error('Font unavailable') })
    vi.stubGlobal('FontFace', class { load() { return fontLoads() } })
    const project = createDemoProject()
    const face = {
      fullName: 'Unavailable Test Regular', style: 'Regular',
      postscriptName: 'UnavailableTest-Regular', weight: 400 as const, slant: 'normal' as const,
    }
    project.stageStyle.lyrics.typeface = {
      kind: 'local', family: 'Unavailable Test', faces: [face],
    }
    project.stageStyle.lyrics.fontStyle = face
    harness.openProject.mockResolvedValueOnce({
      requestId: 'unavailable-font-open',
      path: '/opened/unavailable-font.oks',
      contents: serializeProject(project),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(fontLoads).toHaveBeenCalledTimes(1)

    await clickButton('Clear timing')
    expect(fontLoads).toHaveBeenCalledTimes(1)

    await clickButton('Retry')
    expect(fontLoads).toHaveBeenCalledTimes(2)
  })

  it('clears active-track timing after the offset cursor as one undoable edit', async () => {
    const demo = createDemoProject()
    const lead = demo.tracks[0]
    const duet = {
      ...lead,
      id: 'offset-duet',
      name: 'Duet Vocal',
      lines: lead.lines.map((line, lineIndex) => ({
        ...line,
        id: `offset-duet-line-${lineIndex}`,
        words: line.words.map((word, wordIndex) => ({
          ...word,
          id: `offset-duet-word-${lineIndex}-${wordIndex}`,
        })),
      })),
    }
    const openedProject = {
      ...demo,
      id: 'offset-clear-project',
      title: 'Offset Clear',
      offsetMs: 500,
      tracks: [lead, duet],
    }
    harness.openProject.mockResolvedValueOnce({
      requestId: 'offset-clear-open',
      path: '/opened/offset-clear.oks',
      contents: serializeProject(openedProject),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    const leadLane = document.querySelector<HTMLElement>('[data-track-id="demo-lead"]')!
    const duetLane = document.querySelector<HTMLElement>('[data-track-id="offset-duet"]')!
    const totalLeadWords = lead.lines.reduce((total, line) => total + line.words.length, 0)
    const retainedLeadWords = lead.lines.slice(0, 2).reduce((total, line) => total + line.words.length, 0)
    expect(leadLane.querySelectorAll('.timeline-word')).toHaveLength(totalLeadWords)
    expect(duetLane.querySelectorAll('.timeline-word')).toHaveLength(totalLeadWords)

    const forward = document.querySelector<HTMLButtonElement>('[aria-label="Skip forward five seconds"]')!
    await act(async () => forward.click())
    await act(async () => forward.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'ArrowRight',
      key: 'ArrowRight',
      shiftKey: true,
    })))
    expect(document.querySelector('.time-readout strong')?.textContent).toBe('0:11.000')

    await clickButton('Clear from cursor')
    expect(leadLane.querySelectorAll('.timeline-word')).toHaveLength(retainedLeadWords)
    expect(duetLane.querySelectorAll('.timeline-word')).toHaveLength(totalLeadWords)
    const undo = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!
    expect(undo.disabled).toBe(false)

    await act(async () => undo.click())
    expect(leadLane.querySelectorAll('.timeline-word')).toHaveLength(totalLeadWords)
    expect(duetLane.querySelectorAll('.timeline-word')).toHaveLength(totalLeadWords)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.disabled).toBe(false)
  })

  it('keeps active-track LRC disabled when only another vocal track has lyrics', async () => {
    const demo = createDemoProject()
    const populated = demo.tracks[0]
    const emptyLead = { ...populated, id: 'empty-lead', name: 'Lead Vocal', lines: [] }
    const duet = {
      ...populated,
      id: 'populated-duet',
      name: 'Duet Vocal',
      lines: populated.lines.map((line, lineIndex) => ({
        ...line,
        id: `populated-duet-line-${lineIndex}`,
        words: line.words.map((word, wordIndex) => ({
          ...word,
          id: `populated-duet-word-${lineIndex}-${wordIndex}`,
        })),
      })),
    }
    harness.openProject.mockResolvedValueOnce({
      requestId: 'duet-only-open',
      path: '/opened/duet-only.oks',
      contents: serializeProject({
        ...demo,
        id: 'duet-only-project',
        title: 'Duet Only',
        tracks: [emptyLead, duet],
      }),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    await clickButton('Workflow')
    await clickButton('Choose export')
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const option = (label: string) => [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes(label))
    expect(option('Enhanced LRC')?.disabled).toBe(true)
    expect(option('Enhanced LRC')?.textContent).toContain('add lyrics to this track first')
    expect(option('ASS karaoke subtitles')?.disabled).toBe(false)
  })

  it('forwards the default and selected video resolution and frame rate', async () => {
    await prepareVideoExportProject()

    expect(document.querySelector<HTMLSelectElement>('[aria-label="Video resolution"]')?.value)
      .toBe('720p')
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Video frame rate"]')?.value)
      .toBe('30')
    await clickButton('Karaoke video')

    expect(harness.exportVideo).toHaveBeenCalledOnce()
    expect(harness.exportVideo).toHaveBeenLastCalledWith(expect.objectContaining({
      resolution: '720p',
      fps: 30,
    }))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Export karaoke')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Karaoke video')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      'Preparing video export and checking FFmpeg',
    )

    await selectValue('Video resolution', '2160p')
    await selectValue('Video frame rate', '60')
    await clickButton('Karaoke video')
    expect(harness.exportVideo).toHaveBeenCalledTimes(2)
    expect(harness.exportVideo).toHaveBeenLastCalledWith(expect.objectContaining({
      resolution: '2160p',
      fps: 60,
    }))
  })

  it('rejects linked-image video export before IPC or progress starts', async () => {
    const project = createDemoProject(); Object.assign(project.stageStyle.background, { mode: 'image', imagePath: '/fixtures/background.png' })
    harness.openProject.mockResolvedValueOnce({
      requestId: 'image-open',
      path: '/opened/image.oks',
      contents: serializeProject(project),
    })
    await clickButton('Workflow'); await clickButton('Open .oks'); await prepareVideoExportProject()
    await clickButton('Karaoke video')
    expect(harness.exportVideo).not.toHaveBeenCalled()
    expect(document.querySelector('[aria-label="Karaoke video export progress"]')).toBeNull()
    expect(document.querySelector('.toast')?.textContent).toContain('Linked-image video export is deferred until Live Preview can verify the same image.')
  })

  it('confirms cancellation from both the cancel action and the export-dialog close action', async () => {
    const videoExport = deferred<StudioVideoExportResult | null>()
    harness.exportVideo.mockImplementationOnce(() => videoExport.promise)
    await prepareVideoExportProject()
    await clickButton('Karaoke video')

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cancel video export')
    await clickButton('Cancel video export')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Cancel video export?',
    )

    await clickButton('Keep exporting')
    expect(harness.cancelVideoExport).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Export karaoke')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Cancel video export?',
    )

    await clickButton('Cancel export')
    expect(harness.cancelVideoExport).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      videoExport.reject(new Error('Video export canceled'))
      await videoExport.promise.catch(() => undefined)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  })

  it('keeps the progress surface open until cancellation is accepted', async () => {
    const videoExport = deferred<StudioVideoExportResult | null>()
    const cancellation = deferred<boolean>()
    harness.exportVideo.mockImplementationOnce(() => videoExport.promise)
    harness.cancelVideoExport.mockImplementationOnce(() => cancellation.promise)
    await prepareVideoExportProject()
    await clickButton('Karaoke video')
    await clickButton('Cancel video export')
    await clickButton('Cancel export')

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(buttonContaining('Canceling…').disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')?.disabled).toBe(true)

    await act(async () => {
      cancellation.resolve(true)
      await cancellation.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      videoExport.reject(new Error('Video export canceled'))
      await videoExport.promise.catch(() => undefined)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  })

  it.each([
    {
      label: 'a declined cancellation request',
      cancel: () => Promise.resolve(false),
      message: 'The export could not be canceled. If it is still running, try again.',
    },
    {
      label: 'a failed cancellation request',
      cancel: () => Promise.reject(new Error('Cancellation IPC failed')),
      message: 'Cancellation IPC failed',
    },
  ])('restores the export UI after $label', async ({ cancel, message }) => {
    const videoExport = deferred<StudioVideoExportResult | null>()
    harness.exportVideo.mockImplementationOnce(() => videoExport.promise)
    harness.cancelVideoExport.mockImplementationOnce(cancel)
    await prepareVideoExportProject()
    await clickButton('Karaoke video')
    await clickButton('Cancel video export')
    await clickButton('Cancel export')

    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cancel video export')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(message)

    await act(async () => {
      videoExport.reject(new Error('Video export canceled'))
      await videoExport.promise.catch(() => undefined)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  })

  it('warns on a rejected desktop open without changing current project state', async () => {
    vi.stubGlobal('AudioContext', class {
      async close() {}
      async decodeAudioData() {
        return { getChannelData: () => new Float32Array([0]) }
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0),
    })))
    harness.importAudio.mockResolvedValueOnce({
      path: '/music/current.mp3',
      name: 'current.mp3',
      url: 'studio-media://asset/00000000-0000-0000-0000-000000000000/current.mp3',
    })

    await clickButton('Workflow')
    await clickButton('Attach audio')
    await replaceProjectTitle('Saved baseline')
    await clickButton('Workflow')
    await clickButton('Save .oks')

    await replaceProjectTitle('First unsaved edit')
    await replaceProjectTitle('Second unsaved edit')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click()
    })
    expect(document.querySelector('.topbar__document')?.textContent).toContain(
      'First unsaved edit',
    )
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.disabled).toBe(false)
    expect(document.body.textContent).toContain('Audio linked')

    harness.openProject.mockRejectedValueOnce(new Error('Desktop project dialog failed'))
    await clickButton('Workflow')
    await clickButton('Open .oks')

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'Desktop project dialog failed',
    )
    expect(window.confirm).not.toHaveBeenCalled()
    expect(harness.studio.releaseAudio).not.toHaveBeenCalled()
    expect(document.querySelector('.topbar__document')?.textContent).toContain(
      'First unsaved edit',
    )
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.disabled).toBe(false)
    expect(document.body.textContent).toContain('Audio linked')

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/saved/project.oks',
    }))
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)).toMatchObject({
      title: 'First unsaved edit',
      audioPath: '/music/current.mp3',
    })
  })

  it('uses a safe warning when desktop open rejects without an Error', async () => {
    harness.openProject.mockRejectedValueOnce({ reason: 'private IPC detail' })

    await clickButton('Workflow')
    await clickButton('Open .oks')

    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'Project could not be opened.',
    )
    expect(document.body.textContent).not.toContain('private IPC detail')
  })

  it('does not replace A until main acknowledges B and blocks lifecycle actions meanwhile', async () => {
    await replaceProjectTitle('Project A')
    await clickButton('Edit text')
    await replaceTextarea('Held')
    await clickButton('Apply lyrics')
    await clickButton('Start sync')
    await pressKey('Space')
    const heldTiming = timelineTimingLabels()
    expect(heldTiming).toEqual(['Held timing block, 0:00.000–0:00.100'])

    const settlement = deferred<boolean>()
    harness.settleProjectOpen.mockImplementationOnce(() => settlement.promise)
    harness.openProject.mockResolvedValueOnce({
      requestId: 'pending-project-b',
      path: '/opened/project-b.oks',
      contents: serializeProject({ ...createDemoProject(), title: 'Pending Project B' }),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(harness.settleProjectOpen).toHaveBeenCalledWith('pending-project-b', true)
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')

    await replaceProjectTitle('Post-confirm edit')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')
    const pendingOpenUndo = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')
    if (!pendingOpenUndo) throw new Error('Undo control was not mounted')
    expect(pendingOpenUndo.disabled).toBe(false)
    await act(async () => {
      pendingOpenUndo.click()
    })
    expect(timelineTimingLabels()).toEqual(heldTiming)
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(true)

    await pressKey('ArrowRight')
    await releaseKey('Space')
    expect(timelineTimingLabels()).toEqual(heldTiming)
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(true)

    await tapSyncWord()
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')
    expect(timelineTimingLabels()).toEqual(heldTiming)
    expect(document.querySelector('.transport')?.classList.contains('is-syncing')).toBe(true)

    await clickButton('Workflow')
    await clickButton('Save .oks')
    await clickButton('Workflow')
    await clickButton('Attach audio')
    await clickButton('Workflow')
    await clickButton('New project')
    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(harness.importAudio).not.toHaveBeenCalled()
    expect(harness.resetProjectScope).not.toHaveBeenCalled()
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')

    await act(async () => {
      settlement.resolve(true)
      await settlement.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Pending Project B')
    expect(harness.studio.releaseAudio).not.toHaveBeenCalled()
  })

  it('settles malformed renderer data and a dirty decline as false without changing A', async () => {
    await replaceProjectTitle('Dirty Project A')
    harness.openProject.mockResolvedValueOnce({
      requestId: 'malformed-project-b',
      path: '/opened/malformed.oks',
      contents: JSON.stringify({ schemaVersion: '0' }),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(harness.settleProjectOpen).toHaveBeenLastCalledWith('malformed-project-b', false)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Dirty Project A')
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()

    ;(window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    harness.openProject.mockResolvedValueOnce({
      requestId: 'declined-project-b',
      path: '/opened/declined.oks',
      contents: serializeProject({ ...createDemoProject(), title: 'Declined Project B' }),
    })
    await clickButton('Workflow')
    await clickButton('Open .oks')

    expect(harness.settleProjectOpen).toHaveBeenLastCalledWith('declined-project-b', false)
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Dirty Project A')
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
    expect(harness.studio.releaseAudio).not.toHaveBeenCalled()
  })

  it('preserves A when B settlement returns false and leaves A usable', async () => {
    harness.settleProjectOpen.mockResolvedValueOnce(false)
    harness.openProject.mockResolvedValueOnce({
      requestId: 'stale-project-b',
      path: '/opened/stale.oks',
      contents: serializeProject({ ...createDemoProject(), title: 'Stale Project B' }),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'selected project is no longer pending',
    )
    expect(document.querySelector('[role="alert"]')).toBeNull()

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenCalledOnce()
  })

  it('fails closed when the B acknowledgement is lost after a possible commit', async () => {
    harness.settleProjectOpen.mockRejectedValueOnce(new Error('IPC response lost after commit'))
    harness.openProject.mockResolvedValueOnce({
      requestId: 'possibly-committed-project-b',
      path: '/opened/possibly-committed.oks',
      contents: serializeProject({ ...createDemoProject(), title: 'Possibly Committed B' }),
    })

    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Reopen a project or start New',
    )

    await clickButton('Workflow')
    await clickButton('Save .oks')
    await clickButton('Workflow')
    await clickButton('Attach audio')
    expect(harness.saveProject).not.toHaveBeenCalled()
    expect(harness.importAudio).not.toHaveBeenCalled()

    await clickButton('Workflow')
    await clickButton('New project')
    expect(harness.resetProjectScope).toHaveBeenCalledOnce()
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('locks edits and history until a deferred successful New reset applies cleanly', async () => {
    await replaceProjectTitle('Previous Project A')
    await replaceProjectTitle('Redo Project A')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.click()
    })
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Previous Project A')

    const pendingReset = deferred<boolean>()
    harness.resetProjectScope.mockImplementationOnce(() => pendingReset.promise)
    await clickButton('Workflow')
    await clickButton('New project')

    await replaceProjectTitle('Post-confirm reset edit')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Previous Project A')

    const pendingResetUndo = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')
    const pendingResetRedo = document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')
    if (!pendingResetUndo || !pendingResetRedo) {
      throw new Error('History controls were not mounted')
    }
    expect(pendingResetUndo.disabled).toBe(false)
    expect(pendingResetRedo.disabled).toBe(false)

    await act(async () => pendingResetRedo.click())
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Previous Project A')

    await act(async () => pendingResetUndo.click())
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Previous Project A')

    await act(async () => {
      pendingReset.resolve(true)
      await pendingReset.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.querySelector('[title="Unsaved changes"]')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Undo"]')?.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Redo"]')?.disabled).toBe(true)
  })

  it('preserves A and rejects a metadata duration mutation while reset returns false', async () => {
    MetadataAudio.instances = []
    vi.stubGlobal('Audio', MetadataAudio)
    vi.stubGlobal(
      'AudioContext',
      class {
        async close() {}
        async decodeAudioData() {
          return { getChannelData: () => new Float32Array([0]) }
        }
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    )
    harness.importAudio.mockResolvedValueOnce({
      path: '/music/transition.mp3',
      name: 'transition.mp3',
      url: 'studio-media://asset/00000000-0000-0000-0000-000000000000/transition.mp3',
    })

    await replaceProjectTitle('Project A')
    await clickButton('Workflow')
    await clickButton('Attach audio')
    expect(MetadataAudio.instances).toHaveLength(1)

    const pendingReset = deferred<boolean>()
    harness.resetProjectScope.mockImplementationOnce(() => pendingReset.promise)
    await clickButton('Workflow')
    await clickButton('New project')

    const audio = MetadataAudio.instances[0]
    audio.duration = 12.345
    await act(async () => audio.dispatchEvent(new Event('loadedmetadata')))
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')

    await act(async () => {
      pendingReset.resolve(false)
      await pendingReset.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()

    await replaceProjectTitle('Project A after false reset')
    expect(document.querySelector('.topbar__document')?.textContent).toContain(
      'Project A after false reset',
    )
    await act(async () => harness.sendMenuAction('save'))
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)).toMatchObject({
      audioPath: '/music/transition.mp3',
      durationMs: null,
      title: 'Project A after false reset',
    })
  })

  it('fails closed on a rejected reset and recovers after an acknowledged New', async () => {
    await replaceProjectTitle('Project A')
    harness.resetProjectScope.mockRejectedValueOnce(new Error('reset response lost'))

    await clickButton('Workflow')
    await clickButton('New project')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Project A')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Project access could not be confirmed',
    )
    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).not.toHaveBeenCalled()

    await clickButton('Workflow')
    await clickButton('New project')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')
    expect(document.querySelector('[title="Unsaved changes"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('ignores a previous project save that completes after New project', async () => {
    const previousProjectSave = deferred<{ path: string }>()
    harness.saveProject.mockImplementationOnce(() => previousProjectSave.promise)

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenCalledOnce()

    await clickButton('Workflow')
    await clickButton('New project')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Untitled Song')

    await act(async () => {
      previousProjectSave.resolve({ path: '/saved/previous-project.oks' })
      await previousProjectSave.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(document.querySelector('[title="Unsaved changes"]')).toBeNull()

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenLastCalledWith(expect.objectContaining({
      path: undefined,
      suggestedName: 'untitled-song.oks',
    }))
  })

  it('allows only the newest concurrent save completion to choose the active project path', async () => {
    const firstSave = deferred<{ path: string }>()
    const secondSave = deferred<{ path: string }>()
    harness.saveProject
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)

    await clickButton('Workflow')
    await clickButton('Save .oks')
    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondSave.resolve({ path: '/saved/newest.oks' })
      await secondSave.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await act(async () => {
      firstSave.resolve({ path: '/saved/stale.oks' })
      await firstSave.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/saved/newest.oks',
    }))
  })

  it('ignores stale save completions after Open and retains the opened project path', async () => {
    const previousProjectSave = deferred<{ path: string }>()
    harness.saveProject.mockImplementationOnce(() => previousProjectSave.promise)
    harness.openProject.mockResolvedValueOnce({
      requestId: 'stale-save-project-b-open',
      path: '/opened/project-b.oks',
      contents: serializeProject({ ...createDemoProject(), title: 'Opened Project B' }),
    })

    await clickButton('Workflow')
    await clickButton('Save .oks')
    await clickButton('Workflow')
    await clickButton('Open .oks')
    expect(document.querySelector('.topbar__document')?.textContent).toContain('Opened Project B')

    await act(async () => {
      previousProjectSave.resolve({ path: '/saved/stale-project-a.oks' })
      await previousProjectSave.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenLastCalledWith(expect.objectContaining({
      path: '/opened/project-b.oks',
    }))
  })

  it('does not surface a stale save rejection after the user starts a new project', async () => {
    const previousProjectSave = deferred<{ path: string }>()
    harness.saveProject.mockImplementationOnce(() => previousProjectSave.promise)

    await clickButton('Workflow')
    await clickButton('Save .oks')
    await clickButton('Workflow')
    await clickButton('New project')

    await act(async () => {
      previousProjectSave.reject(new Error('stale cloud write failed'))
      await previousProjectSave.promise.catch(() => undefined)
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(document.body.textContent).not.toContain('stale cloud write failed')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[title="Unsaved changes"]')).toBeNull()
  })

  it('keeps edits made during a save dirty when the older revision completes', async () => {
    const pendingSave = deferred<{ path: string }>()
    harness.saveProject.mockImplementationOnce(() => pendingSave.promise)

    await clickButton('Workflow')
    await clickButton('Save .oks')
    await replaceProjectTitle('Edited while save was pending')
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()

    await act(async () => {
      pendingSave.resolve({ path: '/saved/older-revision.oks' })
      await pendingSave.promise
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(document.querySelector('.topbar__document')?.textContent).toContain(
      'Edited while save was pending',
    )
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()
  })
})
