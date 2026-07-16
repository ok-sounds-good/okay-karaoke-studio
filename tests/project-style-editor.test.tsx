// @vitest-environment happy-dom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStyleEditor } from '../src/components/ProjectStyleEditor'
import type {
  ProjectStyleDraftChange,
  ProjectStyleSession,
} from '../src/hooks/useProjectStyleSession'
import { createProject } from '../src/lib/model'
import {
  FONT_SIZE_OPTIONS,
  SYSTEM_MONOSPACE_TYPEFACE,
  resolveFontFace,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
  type StageStyle,
} from '../src/lib/video-style'

type EditorProps = ComponentProps<typeof ProjectStyleEditor>

const READY_FONTS: EditorProps['fonts'] = {
  typefaces: [],
  status: 'ready',
  message: null,
}

function applyChange(change: ProjectStyleDraftChange | undefined, current: StageStyle) {
  expect(change).toBeTypeOf('function')
  if (typeof change !== 'function') throw new Error('Expected a functional draft update')
  return change(current)
}

function replaceInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Input value setter is unavailable')
  setter.call(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
}

function keyDown(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

function findButton(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!match) throw new Error(`Could not find button: ${label}`)
  return match
}

function testFace(style: string, weight: number): FontFaceDescriptor {
  return {
    fullName: `Enumerated Sans ${style}`,
    style,
    postscriptName: `EnumeratedSans-${style}`,
    weight,
    slant: 'normal',
  }
}

describe('ProjectStyleEditor', () => {
  let container: HTMLDivElement
  let root: Root
  let originalFonts: PropertyDescriptor | undefined

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    vi.stubGlobal(
      'FontFace',
      class {
        async load() {
          return this
        }
      },
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else Reflect.deleteProperty(document, 'fonts')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const renderEditor = async (overrides: Partial<EditorProps> = {}) => {
    const project = overrides.project ?? createProject({ id: 'style-project' })
    const props: EditorProps = {
      project,
      playbackMs: 1_250,
      draft: project.stageStyle,
      fonts: READY_FONTS,
      onDraftChange: vi.fn(),
      onRetryFonts: vi.fn(),
      onTogglePlayback: vi.fn(),
      onCancel: vi.fn(),
      onApply: vi.fn(),
      ...overrides,
    }
    await act(async () => {
      root.render(<ProjectStyleEditor {...props} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    return props
  }

  it('focuses the labelled heading and handles Escape beside the design preview', async () => {
    const onCancel = vi.fn()
    const { draft } = await renderEditor({ onCancel })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const heading = container.querySelector<HTMLHeadingElement>('h2')!
    const preview = container.querySelector<HTMLElement>(
      '[aria-label="Project lyrics design preview"]',
    )!
    const stage = preview.querySelector<HTMLElement>('[data-logical-stage="1920x1080"]')!
    const designLine = stage.querySelector<HTMLElement>('[data-design-preview="project-lyrics"]')!

    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(heading.textContent).toBe('Style')
    expect(heading.tabIndex).toBe(-1)
    expect(container.textContent).toContain('Project lyrics')
    expect(document.activeElement).toBe(heading)
    expect(dialog.children[1]).toBe(preview)
    expect(designLine.textContent).toBe('Sing the first words and see the rest')
    expect(container.textContent).not.toContain('This is')
    expect(container.textContent).not.toContain(draft.lyrics.typeface.family)
    expect(container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe(
      draft.lyrics.typeface.family,
    )

    await act(async () => {
      keyDown(heading, { code: 'Escape', key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('replaces only the typeface through an immutable functional update', async () => {
    const onDraftChange = vi.fn<ProjectStyleSession['change']>()
    const { draft } = await renderEditor({ onDraftChange })
    const snapshot = structuredClone(draft)
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!

    await act(async () => input.focus())
    const option = container.querySelector<HTMLElement>('[data-font-family="System Monospace"]')!
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    })

    const next = applyChange(onDraftChange.mock.calls.at(-1)?.[0], draft)
    expect(next.lyrics.typeface).toEqual(SYSTEM_MONOSPACE_TYPEFACE)
    expect(next.lyrics.typeface).not.toBe(SYSTEM_MONOSPACE_TYPEFACE)
    expect(next.lyrics.typeface.faces[0]).not.toBe(SYSTEM_MONOSPACE_TYPEFACE.faces[0])
    expect(next.lyrics.fontStyle).toBe(draft.lyrics.fontStyle)
    expect(next.lyrics.sizePx).toBe(draft.lyrics.sizePx)
    expect(next.background).toBe(draft.background)
    expect(next.titleCard).toBe(draft.titleCard)
    expect(next.stageFrame).toBe(draft.stageFrame)
    expect(draft).toEqual(snapshot)
  })

  it('offers only enumerated faces, marks the resolved face, and clones a chosen face', async () => {
    const faces = [testFace('Regular', 400), testFace('Black', 900)]
    const typeface: FontTypefaceDescriptor = {
      kind: 'local',
      family: 'Enumerated Sans',
      faces,
    }
    const requested = { ...testFace('Legacy Heavy', 850), postscriptName: null }
    const project = createProject({ id: 'enumerated-faces' })
    const draft = {
      ...project.stageStyle,
      lyrics: { ...project.stageStyle.lyrics, typeface, fontStyle: requested },
    }
    const onDraftChange = vi.fn<ProjectStyleSession['change']>()
    await renderEditor({ project, draft, onDraftChange })

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.font-face-button')]
    const effectiveStyle = resolveFontFace(typeface, requested).style
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Regular', 'Black'])
    expect(
      buttons.find((button) => button.textContent === effectiveStyle)?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(
      1,
    )

    await act(async () => buttons[0].click())
    const next = applyChange(onDraftChange.mock.calls.at(-1)?.[0], draft)
    expect(next.lyrics.fontStyle).toEqual(faces[0])
    expect(next.lyrics.fontStyle).not.toBe(faces[0])
    expect(next.lyrics.typeface).toBe(draft.lyrics.typeface)
    expect(draft.lyrics.fontStyle).toBe(requested)
  })

  it('uses the exact size options and rejects an injected unsupported value', async () => {
    const onDraftChange = vi.fn<ProjectStyleSession['change']>()
    const { draft } = await renderEditor({ onDraftChange })
    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Project lyric font size"]',
    )!
    expect([...select.options].map((option) => Number(option.value))).toEqual(FONT_SIZE_OPTIONS)

    const unsupported = document.createElement('option')
    unsupported.value = '15'
    unsupported.textContent = '15 px'
    select.append(unsupported)
    await act(async () => {
      select.value = '15'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onDraftChange).not.toHaveBeenCalled()

    await act(async () => {
      select.value = '96'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const next = applyChange(onDraftChange.mock.calls.at(-1)?.[0], draft)
    expect(next.lyrics.sizePx).toBe(96)
    expect(draft.lyrics.sizePx).not.toBe(96)
  })

  it('keeps Sung before Unsung and projects independent draft colors without project mutation', async () => {
    const project = createProject({ id: 'color-draft' })
    const snapshot = structuredClone(project)
    const onDraftChange = vi.fn<ProjectStyleSession['change']>()
    let draft: StageStyle = {
      ...project.stageStyle,
      background: {
        ...project.stageStyle.background,
        mode: 'solid',
        solidColor: '#345678',
      },
      stageFrame: { ...project.stageStyle.stageFrame, lineColor: '#456789' },
    }
    await renderEditor({ project, draft, onDraftChange })

    expect(
      [...container.querySelectorAll('.style-color-field > span')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['Sung', 'Unsung'])
    expect(
      [...container.querySelectorAll('.style-color-field output')].map(
        (output) => output.textContent,
      ),
    ).toEqual([draft.lyrics.sungColor.toUpperCase(), draft.lyrics.unsungColor.toUpperCase()])
    const stage = container.querySelector<HTMLElement>('.karaoke-stage')!
    expect(stage.style.background).toBe('#345678')
    expect(stage.style.getPropertyValue('--stage-frame-color')).toBe('#456789')

    const sung = container.querySelector<HTMLInputElement>(
      '[aria-label="Project lyric sung color"]',
    )!
    await act(async () => replaceInput(sung, '#123456'))
    draft = applyChange(onDraftChange.mock.calls.at(-1)?.[0], draft)
    expect(draft.lyrics.unsungColor).toBe(project.stageStyle.lyrics.unsungColor)
    await renderEditor({ project, draft, onDraftChange })
    expect(
      container.querySelector<HTMLElement>('.stage-line')?.style.getPropertyValue('--track-color'),
    ).toBe('#123456')
    expect(project).toEqual(snapshot)

    onDraftChange.mockClear()
    const unsung = container.querySelector<HTMLInputElement>(
      '[aria-label="Project lyric unsung color"]',
    )!
    await act(async () => replaceInput(unsung, '#654321'))
    draft = applyChange(onDraftChange.mock.calls.at(-1)?.[0], draft)
    expect(draft.lyrics.sungColor).toBe('#123456')
    await renderEditor({ project, draft, onDraftChange })
    expect(
      container.querySelector<HTMLElement>('.stage-line')?.style.getPropertyValue('--unsung-color'),
    ).toBe('#654321')
    expect(
      [...container.querySelectorAll('.style-color-field output')].map(
        (output) => output.textContent,
      ),
    ).toEqual(['#123456', '#654321'])
    expect(project).toEqual(snapshot)
  })

  it('lets the combobox consume its first Escape before dialog cancellation', async () => {
    const onCancel = vi.fn()
    await renderEditor({ onCancel })
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    await act(async () => input.focus())
    expect(input.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      keyDown(input, { code: 'Escape', key: 'Escape' })
    })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(onCancel).not.toHaveBeenCalled()

    await act(async () => {
      keyDown(input, { code: 'Escape', key: 'Escape' })
    })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('owns exact Shift+Space without repeats, editable targets, or ordinary Space', async () => {
    const onTogglePlayback = vi.fn()
    await renderEditor({ onTogglePlayback })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!

    const toggleEvent = keyDown(dialog, { code: 'Space', key: ' ', shiftKey: true })
    expect(onTogglePlayback).toHaveBeenCalledOnce()
    expect(toggleEvent.defaultPrevented).toBe(true)

    const repeatEvent = keyDown(dialog, {
      code: 'Space',
      key: ' ',
      shiftKey: true,
      repeat: true,
    })
    expect(onTogglePlayback).toHaveBeenCalledOnce()
    expect(repeatEvent.defaultPrevented).toBe(false)

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    const editableEvent = keyDown(input, { code: 'Space', key: ' ', shiftKey: true })
    expect(onTogglePlayback).toHaveBeenCalledOnce()
    expect(editableEvent.defaultPrevented).toBe(false)

    const ordinaryEvent = keyDown(dialog, { code: 'Space', key: ' ' })
    expect(onTogglePlayback).toHaveBeenCalledOnce()
    expect(ordinaryEvent.defaultPrevented).toBe(false)
  })

  it('wires retry, Cancel, and Apply & close controls', async () => {
    const onRetryFonts = vi.fn()
    const onCancel = vi.fn()
    const onApply = vi.fn()
    await renderEditor({
      fonts: {
        typefaces: [],
        status: 'unavailable',
        message: 'Installed-font access is unavailable in this environment.',
      },
      onRetryFonts,
      onCancel,
      onApply,
    })

    await act(async () => findButton(container, 'Retry font access').click())
    await act(async () => findButton(container, 'Cancel').click())
    await act(async () => findButton(container, 'Apply & close').click())
    expect(onRetryFonts).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledOnce()
  })
})
