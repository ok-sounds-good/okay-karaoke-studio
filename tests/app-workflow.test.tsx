// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App'
import { createDemoProject, serializeProject } from '../src/lib/model'

interface StudioHarness {
  studio: StudioApi
  exportText: ReturnType<typeof vi.fn>
  exportVideo: ReturnType<typeof vi.fn>
  importAudio: ReturnType<typeof vi.fn>
  openProject: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
}

function createStudioHarness(): StudioHarness {
  const openProject = vi.fn(async () => null)
  const saveProject = vi.fn(async () => ({ path: '/saved/project.oks' }))
  const importAudio = vi.fn(async () => null)
  const exportText = vi.fn(async () => ({ path: '/exports/project.oks' }))
  const exportVideo = vi.fn(async () => null)
  const studio = {
    openProject,
    saveProject,
    importAudio,
    resolveProjectAudio: vi.fn(async () => null),
    releaseAudio: vi.fn(async () => undefined),
    importLrc: vi.fn(async () => null),
    exportText,
    exportVideo,
    cancelVideoExport: vi.fn(async () => undefined),
    onVideoExportProgress: vi.fn(() => () => undefined),
    onMenuAction: vi.fn(() => () => undefined),
  } as unknown as StudioApi

  return { studio, exportText, exportVideo, importAudio, openProject, saveProject }
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

  it('sends exact serialized .oks save and export payloads through the desktop bridge', async () => {
    const expectedContents = serializeProject(createDemoProject())

    await clickButton('Workflow')
    await clickButton('Save .oks')
    expect(harness.saveProject).toHaveBeenCalledWith({
      path: undefined,
      suggestedName: 'neon-afterglow.oks',
      contents: expectedContents,
    })

    await clickButton('Workflow')
    await clickButton('Choose export')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Editable .oks project')
    await clickButton('Editable .oks project')
    expect(harness.exportText).toHaveBeenCalledWith({
      suggestedName: 'okay-karaoke-neon-afterglow.oks',
      contents: expectedContents,
      format: 'oks',
    })
  })

  it('keeps export choices open when guided FFmpeg setup is postponed', async () => {
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

    await clickButton('Workflow')
    await clickButton('Attach audio')
    await clickButton('Workflow')
    await clickButton('Choose export')
    await clickButton('Karaoke video')

    expect(harness.exportVideo).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Export karaoke')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Karaoke video')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      'Preparing video export and checking FFmpeg',
    )
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
