// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { createDemoProject, parseProject, serializeProject } from '../src/lib/model'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const captures = new WeakMap<HTMLElement, Set<number>>()

interface StudioHarness {
  studio: StudioApi
  emitClose: (request: StudioWindowCloseRequest) => void
  importAudio: ReturnType<typeof vi.fn>
  importLrc: ReturnType<typeof vi.fn>
  openProject: ReturnType<typeof vi.fn>
  resetProjectScope: ReturnType<typeof vi.fn>
  resolveWindowClose: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
}

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

function createStudioHarness(): StudioHarness {
  let closeListener: ((request: StudioWindowCloseRequest) => void) | null = null
  let pendingClose: StudioWindowCloseRequest | null = null
  const openProject = vi.fn(async () => null)
  const importAudio = vi.fn(async () => null)
  const importLrc = vi.fn(async () => null)
  const resetProjectScope = vi.fn(async () => true)
  const saveProject = vi.fn(async () => ({ path: '/saved/project.oks' }))
  const resolveWindowClose = vi.fn(async (requestId: string) => {
    if (pendingClose?.requestId !== requestId) return false
    pendingClose = null
    return true
  })
  const studio = {
    openProject,
    settleProjectOpen: vi.fn(async () => true),
    resetProjectScope,
    saveProject,
    importAudio,
    resolveProjectAudio: vi.fn(async () => null),
    releaseAudio: vi.fn(async () => undefined),
    importLrc,
    exportText: vi.fn(async () => ({ path: '/exports/project.oks' })),
    exportVideo: vi.fn(async () => null),
    cancelVideoExport: vi.fn(async () => true),
    onVideoExportProgress: vi.fn(() => () => undefined),
    onMenuAction: vi.fn(() => () => undefined),
    onWindowCloseRequest: vi.fn((callback: typeof closeListener) => {
      closeListener = callback
      return () => {
        if (closeListener === callback) closeListener = null
      }
    }),
    getPendingWindowClose: vi.fn(async () => pendingClose),
    resolveWindowClose,
  } as unknown as StudioApi

  return {
    studio,
    emitClose(request) {
      pendingClose = request
      closeListener?.(request)
    },
    importAudio,
    importLrc,
    openProject,
    resetProjectScope,
    resolveWindowClose,
    saveProject,
  }
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

class TestAudio extends EventTarget {
  preload = ''
  playbackRate = 1
  volume = 1
  duration = Number.NaN
  currentTime = 0

  constructor(readonly src: string) {
    super()
  }

  pause() {}

  play() {
    return Promise.resolve()
  }

  removeAttribute() {}

  load() {}

  publishDuration(durationMs: number) {
    this.duration = durationMs / 1_000
    this.dispatchEvent(new Event('loadedmetadata'))
  }
}

function buttonByText(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`Could not find button: ${label}`)
  return button
}

function buttonByLabel(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Could not find labelled button: ${label}`)
  return button
}

function fileInputByAccept(accept: string) {
  const input = document.querySelector<HTMLInputElement>(`input[type="file"][accept="${accept}"]`)
  if (!input) throw new Error(`Could not find file input: ${accept}`)
  return input
}

function audioImportButton() {
  const button = document.querySelector<HTMLButtonElement>('.audio-source')
  if (!button) throw new Error('Could not find audio import button')
  return button
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click())
  await settle()
}

async function chooseSize(value: string) {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="Project lyric font size"]')
  if (!select) throw new Error('Project lyric font size was not mounted')
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function chooseBackgroundMode(mode: 'solid' | 'gradient') {
  const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${mode}"]`)
  if (!radio) throw new Error(`Background mode was not mounted: ${mode}`)
  await act(async () => radio.click())
}

async function chooseColor(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!input || !setter) throw new Error(`Color input was not mounted: ${label}`)
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
  })
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  pointerId: number,
  clientX: number,
  clientY = 0,
) {
  act(() =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        button: 0,
        pointerId,
        clientX,
        clientY,
      }),
    ),
  )
}

function dispatchKey(target: EventTarget, init: KeyboardEventInit) {
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })))
}

describe('project Style App integration', () => {
  let container: HTMLDivElement
  let root: Root
  let harness: StudioHarness
  let queryLocalFonts: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    harness = createStudioHarness()
    queryLocalFonts = vi.fn(async () => [])
    Object.defineProperty(window, 'studio', { configurable: true, value: harness.studio })
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: queryLocalFonts,
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
    await act(async () => root.render(<App />))
    await settle()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(window, 'studio', { configurable: true, value: undefined })
    Reflect.deleteProperty(window, 'queryLocalFonts')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function openDemo() {
    harness.openProject.mockResolvedValueOnce({
      requestId: 'demo-open-request',
      path: '/projects/demo.oks',
      contents: serializeProject(createDemoProject()),
    })
    await click(buttonByLabel('Open project'))
    expect(document.querySelectorAll('.timeline-word').length).toBeGreaterThan(0)
  }

  async function renderBrowserApp() {
    await act(async () => root.unmount())
    Object.defineProperty(window, 'studio', { configurable: true, value: undefined })
    root = createRoot(container)
    await act(async () => root.render(<App />))
    await settle()
  }

  async function chooseBrowserFile(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
  }

  async function cancelBrowserFileSelection(input: HTMLInputElement) {
    await act(async () => {
      input.dispatchEvent(new Event('cancel', { bubbles: true }))
    })
    await settle()
  }

  async function expectStyleBlocked(reason: string) {
    const style = buttonByText('Style')
    expect(style.disabled).toBe(false)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    expect(style.getAttribute('aria-label')).toBe(`Style unavailable: ${reason}`)
    style.focus()
    expect(document.activeElement).toBe(style)
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()
  }

  function expectStyleAvailable() {
    const style = buttonByText('Style')
    expect(style.disabled).toBe(false)
    expect(style.getAttribute('aria-disabled')).toBe('false')
    expect(style.getAttribute('aria-label')).toBe('Edit project Style')
  }

  it('opens beside the identity, replaces the editing workspace, and keeps playback available', async () => {
    await openDemo()
    const style = buttonByText('Style')
    const selectedWord = document.querySelector<HTMLButtonElement>('.timeline-word')!
    dispatchPointer(selectedWord, 'pointerdown', 40, 100)
    dispatchPointer(selectedWord, 'pointerup', 40, 100)
    expect(selectedWord.getAttribute('aria-pressed')).toBe('true')
    expect(style.closest('.topbar__brand')).not.toBeNull()
    expect(style.getAttribute('aria-disabled')).toBe('false')
    await click(document.querySelector<HTMLButtonElement>('.sync-button')!)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    expect(style.getAttribute('aria-label')).toContain('Exit lyric synchronization first')
    await click(document.querySelector<HTMLButtonElement>('.sync-button')!)
    expect(style.getAttribute('aria-disabled')).toBe('false')
    await click(buttonByLabel('Stop'))
    style.focus()

    await click(style)

    expect(queryLocalFonts).toHaveBeenCalledOnce()
    expect(style.getAttribute('aria-label')).toContain('Style editor is already open')
    expect(document.querySelector('.style-workspace')).not.toBeNull()
    expect(document.querySelector('[aria-label="Project inspector"]')).toBeNull()
    expect(document.querySelector('[aria-label="Lyric Timing"]')).toBeNull()
    expect(document.querySelector('[aria-label="Project lyrics design preview"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Sing the first words and see the rest')
    expect(document.body.textContent).not.toContain('This is')
    expect(document.querySelector<HTMLButtonElement>('.sync-button')?.disabled).toBe(true)
    expect(buttonByLabel('Play').disabled).toBe(false)
    expect(buttonByLabel('Stop').disabled).toBe(false)
    expect(
      document.querySelector<HTMLSelectElement>('[aria-label="Playback speed"]')?.disabled,
    ).toBe(false)
    expect(document.querySelector<HTMLInputElement>('[aria-label="Volume"]')?.disabled).toBe(false)

    const timeBeforeTabs = document.querySelector('.time-readout strong')?.textContent
    const projectLyricsTab = buttonByText('Project lyrics')
    projectLyricsTab.focus()
    dispatchKey(projectLyricsTab, { code: 'ArrowRight', key: 'ArrowRight' })
    await settle()
    expect(document.activeElement).toBe(buttonByText('Background'))
    expect(document.querySelector('.time-readout strong')?.textContent).toBe(timeBeforeTabs)

    await click(buttonByLabel('Play'))
    expect(buttonByLabel('Pause')).not.toBeNull()
    expect(document.querySelector('.style-workspace')).not.toBeNull()
    const stop = buttonByLabel('Stop')
    stop.focus()
    dispatchKey(stop, { code: 'Space', key: ' ', shiftKey: true })
    expect(buttonByLabel('Play')).not.toBeNull()
    dispatchKey(document, { code: 'Delete', key: 'Delete' })
    expect(buttonByLabel('Undo').disabled).toBe(true)
    await click(buttonByText('Cancel'))

    expect(document.querySelector('.style-workspace')).toBeNull()
    expect(document.activeElement).toBe(style)
    expect(buttonByLabel('Undo').disabled).toBe(true)
  })

  it('preserves semantic no-op state and applies one undoable project Style step', async () => {
    const style = buttonByText('Style')
    await click(style)
    await click(buttonByText('Background'))
    await chooseBackgroundMode('solid')
    expect(document.querySelector('.karaoke-stage')?.getAttribute('data-background-mode')).toBe(
      'solid',
    )
    await click(buttonByText('Cancel'))
    expect(document.querySelector('.karaoke-stage')?.getAttribute('data-background-mode')).toBe(
      'gradient',
    )
    expect(buttonByLabel('Undo').disabled).toBe(true)

    await click(style)
    await click(buttonByText('Background'))
    await chooseBackgroundMode('solid')
    await chooseBackgroundMode('gradient')
    await click(buttonByText('Apply & close'))
    expect(buttonByLabel('Undo').disabled).toBe(true)
    expect(document.querySelector('[title="Unsaved changes"]')).toBeNull()

    await click(style)
    await chooseSize('96')
    await click(buttonByText('Apply & close'))
    expect(buttonByLabel('Undo').disabled).toBe(false)
    expect(document.querySelector('[title="Unsaved changes"]')).not.toBeNull()

    await click(buttonByLabel('Save project'))
    expect(
      parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).stageStyle.lyrics.sizePx,
    ).toBe(96)
    await click(buttonByLabel('Undo'))
    await click(buttonByLabel('Save project'))
    expect(
      parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).stageStyle.lyrics.sizePx,
    ).toBe(82)
    expect(buttonByLabel('Redo').disabled).toBe(false)
  })

  it('applies, saves, reopens, undoes, and redoes the complete accepted background once', async () => {
    const style = buttonByText('Style')
    await click(style)
    await click(buttonByText('Background'))
    await chooseColor('Background gradient start color', '#112233')
    await chooseColor('Background gradient end color', '#445566')
    await chooseBackgroundMode('solid')
    await chooseColor('Background solid color', '#778899')
    await click(buttonByText('Apply & close'))

    expect(buttonByLabel('Undo').disabled).toBe(false)
    await click(buttonByLabel('Save project'))
    const acceptedContents = harness.saveProject.mock.calls.at(-1)?.[0].contents
    const accepted = parseProject(acceptedContents).stageStyle.background
    expect(accepted).toEqual({
      mode: 'solid',
      solidColor: '#778899',
      gradientStartColor: '#112233',
      gradientEndColor: '#445566',
      imagePath: null,
    })

    await click(buttonByLabel('Undo'))
    await click(buttonByLabel('Save project'))
    expect(
      parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).stageStyle.background,
    ).toMatchObject({ mode: 'gradient', solidColor: '#21182D' })
    await click(buttonByLabel('Redo'))
    await click(buttonByLabel('Save project'))
    expect(
      parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).stageStyle.background,
    ).toEqual(accepted)

    harness.openProject.mockResolvedValueOnce({
      requestId: 'reopen-applied-background',
      path: '/projects/reopened-background.oks',
      contents: acceptedContents,
    })
    await click(buttonByLabel('Open project'))
    expect(document.querySelector('.karaoke-stage')?.getAttribute('data-background-mode')).toBe(
      'solid',
    )
    expect(document.querySelector<HTMLElement>('.karaoke-stage')?.style.background).toBe('#778899')
  })

  it('replaces only the latest StageStyle and preserves newer non-style state', async () => {
    const audioInstances: TestAudio[] = []
    vi.stubGlobal(
      'AudioContext',
      class {
        close() {
          return Promise.resolve()
        }
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('Skip waveform decoding'))),
    )
    vi.stubGlobal(
      'Audio',
      class extends TestAudio {
        constructor(src: string) {
          super(src)
          audioInstances.push(this)
        }
      },
    )
    const opened = createDemoProject()
    opened.audioPath = '/music/latest-state.mp3'
    harness.openProject.mockResolvedValueOnce({
      requestId: 'latest-state-open',
      path: '/projects/latest-state.oks',
      contents: serializeProject(opened),
    })
    vi.mocked(harness.studio.resolveProjectAudio).mockResolvedValueOnce({
      path: opened.audioPath,
      name: 'latest-state.mp3',
      url: 'file:///music/latest-state.mp3',
    })
    await click(buttonByLabel('Open project'))
    expect(audioInstances).toHaveLength(1)

    await click(buttonByText('Style'))
    await chooseSize('96')
    await act(async () => audioInstances[0]!.publishDuration(45_678))
    await settle()
    await click(buttonByText('Apply & close'))
    await click(buttonByLabel('Save project'))

    const applied = parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
    expect(applied.durationMs).toBe(45_678)
    expect(applied.stageStyle.lyrics.sizePx).toBe(96)
    expect(applied.tracks).toEqual(opened.tracks)

    await click(buttonByLabel('Undo'))
    await click(buttonByLabel('Save project'))
    const undone = parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents)
    expect(undone.durationMs).toBe(45_678)
    expect(undone.stageStyle.lyrics.sizePx).toBe(82)
    expect(buttonByLabel('Redo').disabled).toBe(false)
  })

  it('offers Keep, Discard, and Apply before ordinary actions and never opens Export behind Style', async () => {
    await click(buttonByText('Style'))
    await chooseSize('96')
    await click(buttonByLabel('Save project'))

    expect(document.querySelector('.style-workspace')).not.toBeNull()
    expect(buttonByText('Keep editing')).not.toBeNull()
    expect(buttonByText('Discard changes')).not.toBeNull()
    expect(buttonByText('Apply changes')).not.toBeNull()
    expect(harness.saveProject).not.toHaveBeenCalled()
    await click(buttonByText('Keep editing'))
    expect(document.querySelector('.style-workspace')).not.toBeNull()

    await click(buttonByLabel('Save project'))
    await click(buttonByText('Discard changes'))
    expect(harness.saveProject).toHaveBeenCalledOnce()
    expect(
      parseProject(harness.saveProject.mock.calls[0][0].contents).stageStyle.lyrics.sizePx,
    ).toBe(82)

    await click(buttonByText('Style'))
    await chooseSize('96')
    await click(buttonByText('Export'))
    expect(document.body.textContent).toContain('Finish editing project Style?')
    expect(document.body.textContent).not.toContain('Export karaoke')
    await click(buttonByText('Apply changes'))
    expect(document.body.textContent).toContain('Export karaoke')
    expect(document.querySelector('.style-workspace')).toBeNull()
  })

  it('refuses Style entry while lyrics or Export already owns a dialog', async () => {
    const style = buttonByText('Style')
    await click(buttonByText('Edit text'))
    expect(style.getAttribute('aria-label')).toContain('Close the lyric editor first')
    dispatchKey(buttonByText('Cancel'), { code: 'Space', key: ' ', shiftKey: true })
    expect(buttonByLabel('Play')).not.toBeNull()
    await click(style)
    expect(document.body.textContent).toContain('Edit Lead Vocal')
    expect(document.querySelector('.style-workspace')).toBeNull()
    await click(buttonByText('Cancel'))

    await click(buttonByText('Export'))
    expect(style.getAttribute('aria-label')).toContain('Close Export first')
    await click(style)
    expect(document.body.textContent).toContain('Export karaoke')
    expect(document.querySelector('.style-workspace')).toBeNull()
    await click(buttonByLabel('Close dialog'))
  })

  it('reactively explains pending project transitions and active video exports', async () => {
    let finishReset!: (value: boolean) => void
    harness.resetProjectScope.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finishReset = resolve)),
    )
    await click(buttonByLabel('New project'))
    const style = buttonByText('Style')
    expect(style.getAttribute('aria-label')).toContain('current project action')
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()

    await act(async () => finishReset(true))
    await settle()
    expect(style.getAttribute('aria-disabled')).toBe('false')

    const progress = vi.mocked(harness.studio.onVideoExportProgress).mock.calls[0][0]
    act(() => progress({ phase: 'preparing', completed: 0, total: 1 }))
    expect(style.getAttribute('aria-label')).toContain('active video export')
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()
  })

  it('owns deferred desktop Open before reactive paint and clears on cancel or completion', async () => {
    const canceled = deferred<StudioOpenProjectResult | null>()
    harness.openProject.mockImplementationOnce(() => canceled.promise)
    const style = buttonByText('Style')
    await act(async () => {
      buttonByLabel('Open project').click()
      style.click()
    })
    await settle()

    expect(document.querySelector('.style-workspace')).toBeNull()
    await expectStyleBlocked('Wait for project selection and opening to finish.')
    await act(async () => canceled.resolve(null))
    await settle()
    expectStyleAvailable()

    const completed = deferred<StudioOpenProjectResult | null>()
    const openedProject = {
      ...createDemoProject(),
      title: 'Deferred desktop project',
      audioPath: null,
    }
    harness.openProject.mockImplementationOnce(() => completed.promise)
    await click(buttonByLabel('Open project'))
    await expectStyleBlocked('Wait for project selection and opening to finish.')
    expect(document.querySelector('.topbar__document')?.textContent).not.toContain(
      openedProject.title,
    )

    await act(async () => {
      completed.resolve({
        requestId: 'deferred-desktop-open',
        path: '/projects/deferred.oks',
        contents: serializeProject(openedProject),
      })
      await completed.promise
    })
    await settle()

    expect(document.querySelector('.topbar__document')?.textContent).toContain(openedProject.title)
    expectStyleAvailable()
  })

  it('owns deferred desktop audio import through failure and successful apply', async () => {
    const failed = deferred<StudioAudioImportResult | null>()
    harness.importAudio.mockImplementationOnce(() => failed.promise)
    await click(audioImportButton())
    await expectStyleBlocked('Wait for audio selection and import to finish.')

    await act(async () => {
      failed.reject(new Error('Desktop audio picker failed'))
      await failed.promise.catch(() => undefined)
    })
    await settle()
    expectStyleAvailable()

    const completed = deferred<StudioAudioImportResult | null>()
    harness.importAudio.mockImplementationOnce(() => completed.promise)
    await click(audioImportButton())
    await expectStyleBlocked('Wait for audio selection and import to finish.')
    await act(async () => {
      completed.resolve({ path: '/music/deferred.mp3', name: 'deferred.mp3', url: '' })
      await completed.promise
    })
    await settle()

    expectStyleAvailable()
    await click(buttonByLabel('Save project'))
    expect(parseProject(harness.saveProject.mock.calls.at(-1)?.[0].contents).audioPath).toBe(
      '/music/deferred.mp3',
    )
  })

  it('owns deferred desktop LRC import until its lyrics are applied', async () => {
    const completed = deferred<StudioLrcImportResult | null>()
    harness.importLrc.mockImplementationOnce(() => completed.promise)
    await click(buttonByText('Import LRC lyrics'))
    await expectStyleBlocked('Wait for LRC selection and import to finish.')
    expect(document.body.textContent).not.toContain('Desktop deferred lyric')

    await act(async () => {
      completed.resolve({
        path: '/lyrics/deferred.lrc',
        name: 'deferred.lrc',
        contents: '[00:01.00]Desktop deferred lyric',
      })
      await completed.promise
    })
    await settle()

    expect(document.body.textContent).toContain('Desktop deferred lyric')
    expectStyleAvailable()
  })

  it('owns browser project File.text through read failure and successful replacement', async () => {
    await renderBrowserApp()
    const failedRead = deferred<string>()
    await click(buttonByLabel('Open project'))
    await chooseBrowserFile(fileInputByAccept('.oks,.json,application/json'), {
      name: 'failed.oks',
      text: vi.fn(() => failedRead.promise),
    } as unknown as File)
    await expectStyleBlocked('Wait for project selection and opening to finish.')

    await act(async () => {
      failedRead.reject(new Error('Browser project read failed'))
      await failedRead.promise.catch(() => undefined)
    })
    await settle()
    expectStyleAvailable()

    const completedRead = deferred<string>()
    const openedProject = {
      ...createDemoProject(),
      title: 'Deferred browser project',
      audioPath: null,
    }
    await click(buttonByLabel('Open project'))
    await chooseBrowserFile(fileInputByAccept('.oks,.json,application/json'), {
      name: 'browser.oks',
      text: vi.fn(() => completedRead.promise),
    } as unknown as File)
    await expectStyleBlocked('Wait for project selection and opening to finish.')
    expect(document.querySelector('.topbar__document')?.textContent).not.toContain(
      openedProject.title,
    )

    await act(async () => {
      completedRead.resolve(serializeProject(openedProject))
      await completedRead.promise
    })
    await settle()

    expect(document.querySelector('.topbar__document')?.textContent).toContain(openedProject.title)
    expectStyleAvailable()
  })

  it('owns browser LRC File.text and clears a canceled picker without applying data', async () => {
    await renderBrowserApp()
    const completedRead = deferred<string>()
    await click(buttonByText('Import LRC lyrics'))
    await chooseBrowserFile(fileInputByAccept('.lrc,text/plain'), {
      name: 'browser.lrc',
      text: vi.fn(() => completedRead.promise),
    } as unknown as File)
    await expectStyleBlocked('Wait for LRC selection and import to finish.')
    expect(document.body.textContent).not.toContain('Browser deferred lyric')

    await act(async () => {
      completedRead.resolve('[00:01.00]Browser deferred lyric')
      await completedRead.promise
    })
    await settle()

    expect(document.body.textContent).toContain('Browser deferred lyric')
    expectStyleAvailable()

    await click(buttonByText('Import LRC lyrics'))
    await expectStyleBlocked('Wait for LRC selection and import to finish.')
    await cancelBrowserFileSelection(fileInputByAccept('.lrc,text/plain'))
    expectStyleAvailable()
    expect(document.body.textContent).toContain('Browser deferred lyric')
  })

  it('preserves exact native request IDs for Keep and Discard', async () => {
    await click(buttonByText('Style'))
    await chooseSize('96')
    const windowRequest = {
      requestId: '11111111-1111-4111-8111-111111111111',
      action: 'window',
    } as const
    await act(async () => harness.emitClose(windowRequest))

    expect(document.body.textContent).toContain('close this window')
    expect(harness.resolveWindowClose).not.toHaveBeenCalled()
    await click(buttonByText('Keep editing'))
    expect(harness.resolveWindowClose).toHaveBeenCalledWith(windowRequest.requestId, false)
    expect(document.querySelector('.style-workspace')).not.toBeNull()

    const appRequest = {
      requestId: '22222222-2222-4222-8222-222222222222',
      action: 'app',
    } as const
    await act(async () => harness.emitClose(appRequest))
    expect(document.body.textContent).toContain('quit the Studio')
    await click(buttonByText('Discard changes'))
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(appRequest.requestId, true)
    expect(document.querySelector('.style-workspace')).toBeNull()

    await click(buttonByText('Style'))
    await chooseSize('104')
    const appliedRequest = {
      requestId: '33333333-3333-4333-8333-333333333333',
      action: 'window',
    } as const
    await act(async () => harness.emitClose(appliedRequest))
    await click(buttonByText('Apply changes'))
    expect(harness.resolveWindowClose).toHaveBeenLastCalledWith(appliedRequest.requestId, true)
    expect(document.querySelector('.style-workspace')).toBeNull()
  })

  it('blocks Style from pointer acquisition through timing and marquee completion', async () => {
    await openDemo()
    const style = buttonByText('Style')
    const word = document.querySelector<HTMLButtonElement>('.timeline-word')!
    dispatchPointer(word, 'pointerdown', 41, 100)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    await click(style)
    expect(document.querySelector('.style-workspace')).toBeNull()
    dispatchPointer(word, 'pointerup', 41, 100)
    expect(style.getAttribute('aria-disabled')).toBe('false')

    const lane = document.querySelector<HTMLElement>('.timeline-lane.is-active')!
    dispatchPointer(lane, 'pointerdown', 42, 300, 30)
    expect(style.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelector('.timeline-marquee')).not.toBeNull()
    dispatchPointer(lane, 'pointercancel', 42, 300, 30)
    expect(style.getAttribute('aria-disabled')).toBe('false')
    await click(style)
    expect(document.querySelector('.style-workspace')).not.toBeNull()
  })
})
