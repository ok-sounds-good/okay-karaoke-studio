// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../src/App'
import { createDemoProject, serializeProject } from '../src/lib/model'

interface StudioHarness {
  studio: StudioApi
  exportText: ReturnType<typeof vi.fn>
  importAudio: ReturnType<typeof vi.fn>
  openProject: ReturnType<typeof vi.fn>
  saveProject: ReturnType<typeof vi.fn>
}

function createStudioHarness(): StudioHarness {
  const openProject = vi.fn(async () => null)
  const saveProject = vi.fn(async () => ({ path: '/saved/project.oks' }))
  const importAudio = vi.fn(async () => null)
  const exportText = vi.fn(async () => ({ path: '/exports/project.oks' }))
  const studio = {
    openProject,
    saveProject,
    importAudio,
    resolveProjectAudio: vi.fn(async () => null),
    releaseAudio: vi.fn(async () => undefined),
    importLrc: vi.fn(async () => null),
    exportText,
    exportVideo: vi.fn(async () => null),
    cancelVideoExport: vi.fn(async () => undefined),
    onVideoExportProgress: vi.fn(() => () => undefined),
    onMenuAction: vi.fn(() => () => undefined),
  } as unknown as StudioApi

  return { studio, exportText, importAudio, openProject, saveProject }
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
})
