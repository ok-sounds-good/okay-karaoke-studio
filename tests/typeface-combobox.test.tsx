// @vitest-environment happy-dom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TypefaceCombobox } from '../src/components/TypefaceCombobox'
import {
  SYSTEM_MONOSPACE_TYPEFACE,
  SYSTEM_UI_TYPEFACE,
  fontFaceKey,
  fontTypefaceKey,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
} from '../src/lib/video-style'

type ComboboxProps = ComponentProps<typeof TypefaceCombobox>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function localTypeface(index: number): FontTypefaceDescriptor {
  const suffix = String(index).padStart(4, '0')
  return {
    kind: 'local',
    family: `Family ${suffix}`,
    faces: [
      {
        fullName: `Family ${suffix} Regular`,
        style: 'Regular',
        postscriptName: `FoundationFace-${suffix}`,
        weight: 400,
        slant: 'normal',
      },
    ],
  }
}

function extraFace(
  typeface: FontTypefaceDescriptor,
  style: string,
  weight: number,
): FontFaceDescriptor {
  return {
    fullName: `${typeface.family} ${style}`,
    style,
    postscriptName: `${typeface.faces[0]?.postscriptName}-${style}`,
    weight,
    slant: 'normal',
  }
}

function replaceInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Input value setter is unavailable')
  setter.call(input, value)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
}

function press(input: HTMLInputElement, key: string) {
  return input.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: key,
      key,
    }),
  )
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('typeface combobox', () => {
  let container: HTMLDivElement
  let root: Root
  const loadedFaces: string[] = []

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    loadedFaces.length = 0
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(public family: string) {
          loadedFaces.push(family)
        }

        async load() {
          return this
        }
      },
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const renderCombobox = async (overrides: Partial<ComboboxProps> = {}) => {
    const props: ComboboxProps = {
      value: SYSTEM_UI_TYPEFACE,
      selectedFace: SYSTEM_UI_TYPEFACE.faces[0]!,
      typefaces: [],
      status: 'ready',
      message: null,
      onChange: () => undefined,
      onRetry: () => undefined,
      ...overrides,
    }
    await act(async () => root.render(<TypefaceCombobox {...props} />))
  }

  it('searches and reaches every keyboard bound while rendering only a small font window', async () => {
    const onChange = vi.fn()
    const typefaces = Array.from({ length: 1_000 }, (_, index) => localTypeface(index))
    await renderCombobox({ typefaces, onChange })

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    await act(async () => input.focus())
    await settle()
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(36)
    expect(loadedFaces).toHaveLength(34)
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-font-family^="Family"] span')].every(
        (option) => option.style.fontFamily.includes('OKSLocalFont'),
      ),
    ).toBe(true)

    const loadedBeforeEnd = loadedFaces.length
    await act(async () => press(input, 'End'))
    await settle()
    expect(input.getAttribute('aria-activedescendant')).toMatch(/option-1001$/u)
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(36)
    expect(
      container.querySelector<HTMLElement>('.typeface-option.is-active')?.dataset.fontFamily,
    ).toBe('Family 0999')
    expect(loadedFaces.length - loadedBeforeEnd).toBeLessThanOrEqual(36)

    await act(async () => press(input, 'ArrowUp'))
    expect(
      container.querySelector<HTMLElement>('.typeface-option.is-active')?.dataset.fontFamily,
    ).toBe('Family 0998')
    await act(async () => press(input, 'Home'))
    await act(async () => press(input, 'ArrowDown'))
    expect(
      container.querySelector<HTMLElement>('.typeface-option.is-active')?.dataset.fontFamily,
    ).toBe(SYSTEM_MONOSPACE_TYPEFACE.family)
    await act(async () => press(input, 'Enter'))
    expect(onChange).toHaveBeenLastCalledWith(SYSTEM_MONOSPACE_TYPEFACE)
    expect(input.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      input.click()
      replaceInput(input, 'Family 0999')
    })
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1)
    await act(async () => press(input, 'Enter'))
    expect(onChange).toHaveBeenLastCalledWith(typefaces[999])
  })

  it('keeps active and selected options distinct and preserves Escape and Tab semantics', async () => {
    const onChange = vi.fn()
    const typefaces = Array.from({ length: 20 }, (_, index) => localTypeface(index + 1_000))
    const selected = typefaces[10]!
    await act(async () => {
      root.render(
        <>
          <TypefaceCombobox
            value={selected}
            selectedFace={selected.faces[0]!}
            typefaces={typefaces}
            status="ready"
            message={null}
            onChange={onChange}
            onRetry={() => undefined}
          />
          <button data-testid="after">After combobox</button>
        </>,
      )
    })
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    await act(async () => input.focus())
    expect(
      container.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.dataset
        .fontFamily,
    ).toBe(selected.family)

    await act(async () => press(input, 'ArrowDown'))
    expect(
      container.querySelector<HTMLElement>('.typeface-option.is-active')?.dataset.fontFamily,
    ).toBe(typefaces[11]!.family)
    expect(
      container.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.dataset
        .fontFamily,
    ).toBe(selected.family)
    await act(async () => press(input, 'Escape'))
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.value).toBe(selected.family)
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => press(input, 'ArrowDown'))
    expect(press(input, 'Tab')).toBe(true)
    const after = container.querySelector<HTMLButtonElement>('[data-testid="after"]')!
    await act(async () => after.focus())
    expect(document.activeElement).toBe(after)
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a saved descriptor selected and labels an installed catalog replacement', async () => {
    const onChange = vi.fn()
    const saved = localTypeface(2_000)
    const installed: FontTypefaceDescriptor = {
      ...saved,
      faces: [...saved.faces, extraFace(saved, 'Bold', 700)],
    }
    const typefaceBefore = fontTypefaceKey(saved)
    await renderCombobox({
      value: saved,
      selectedFace: saved.faces[0]!,
      typefaces: [installed],
      onChange,
    })
    await settle()

    expect(container.textContent).toContain(
      `Saved typeface ${saved.family} differs from the installed catalog and remains selected`,
    )
    expect(container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe(saved.family)
    expect(onChange).not.toHaveBeenCalled()
    expect(fontTypefaceKey(saved)).toBe(typefaceBefore)

    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    await act(async () => input.focus())
    await settle()
    const sameFamily = [
      ...container.querySelectorAll<HTMLElement>(`[data-font-family="${saved.family}"]`),
    ]
    expect(sameFamily).toHaveLength(2)
    expect(sameFamily.map(({ textContent }) => textContent)).toEqual([
      `${saved.family}Saved`,
      `${saved.family}Installed · replacement`,
    ])
    expect(sameFamily[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('announces a pending effective face and retries its failure without rewriting the request', async () => {
    const firstAttempt = deferred<void>()
    let attempts = 0
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(public family: string) {
          loadedFaces.push(family)
        }

        load() {
          attempts += 1
          return attempts === 1 ? firstAttempt.promise.then(() => this) : Promise.resolve(this)
        }
      },
    )
    const onChange = vi.fn()
    const original = localTypeface(3_000)
    const requested = original.faces[0]!
    const replacement: FontTypefaceDescriptor = {
      kind: 'local',
      family: original.family,
      faces: [extraFace(original, 'Bold', 700)],
    }
    const typefaceBefore = fontTypefaceKey(replacement)
    const faceBefore = fontFaceKey(requested)
    await renderCombobox({
      value: replacement,
      selectedFace: requested,
      typefaces: [replacement],
      onChange,
    })

    expect(container.textContent).toContain(
      `Requested face ${requested.fullName} resolves to ${replacement.faces[0]!.fullName}`,
    )
    expect(container.textContent).toContain('Loading')
    await act(async () => {
      firstAttempt.reject(new Error('Font failed to load'))
      await Promise.allSettled([firstAttempt.promise])
    })
    expect(container.textContent).toContain('Preview and MP4 use System UI')
    expect(container.textContent).toContain('The requested Face remains selected')

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry font preview',
    )!
    await act(async () => {
      retry.click()
      await Promise.resolve()
    })
    expect(attempts).toBe(2)
    expect(container.textContent).not.toContain('could not be loaded')
    expect(fontTypefaceKey(replacement)).toBe(typefaceBefore)
    expect(fontFaceKey(requested)).toBe(faceBefore)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('makes pending and failed option previews accessible', async () => {
    const pending = deferred<void>()
    const loadingTypeface = localTypeface(4_100)
    const failedTypeface = localTypeface(4_101)
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          public family: string,
          private source: string,
        ) {
          loadedFaces.push(family)
        }

        load() {
          if (this.source.includes(failedTypeface.faces[0]!.postscriptName!)) {
            return Promise.reject(new Error('Font failed to load'))
          }
          return pending.promise.then(() => this)
        }
      },
    )
    await renderCombobox({ typefaces: [loadingTypeface, failedTypeface] })
    const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!
    await act(async () => input.focus())
    await settle()

    const loading = container.querySelector<HTMLElement>(
      `[data-font-family="${loadingTypeface.family}"]`,
    )!
    const failed = container.querySelector<HTMLElement>(
      `[data-font-family="${failedTypeface.family}"]`,
    )!
    expect(loading.dataset.fontLoadState).toBe('loading')
    expect(loading.getAttribute('aria-busy')).toBe('true')
    expect(loading.getAttribute('aria-label')).toContain('font preview loading')
    expect(loading.textContent).toContain('Loading font preview')
    expect(failed.dataset.fontLoadState).toBe('failed')
    expect(failed.getAttribute('aria-label')).toContain('font preview unavailable')
    expect(failed.textContent).toContain('Font preview unavailable')

    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(loading.dataset.fontLoadState).toBe('ready')
    expect(loading.hasAttribute('aria-busy')).toBe(false)
  })

  it('ignores an old face load after the requested descriptor changes', async () => {
    const oldLoad = deferred<void>()
    const nextLoad = deferred<void>()
    const oldTypeface = localTypeface(4_200)
    const nextTypeface = localTypeface(4_201)
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          public family: string,
          private source: string,
        ) {
          loadedFaces.push(family)
        }

        load() {
          const pending = this.source.includes(oldTypeface.faces[0]!.postscriptName!)
            ? oldLoad
            : nextLoad
          return pending.promise.then(() => this)
        }
      },
    )
    const shared = {
      typefaces: [oldTypeface, nextTypeface],
      status: 'ready' as const,
      message: null,
    }
    await renderCombobox({
      ...shared,
      value: oldTypeface,
      selectedFace: oldTypeface.faces[0]!,
    })
    expect(container.textContent).toContain(oldTypeface.faces[0]!.fullName)

    await renderCombobox({
      ...shared,
      value: nextTypeface,
      selectedFace: nextTypeface.faces[0]!,
    })
    expect(container.textContent).toContain(nextTypeface.faces[0]!.fullName)
    expect(container.textContent).not.toContain(oldTypeface.faces[0]!.fullName)
    await act(async () => {
      oldLoad.reject(new Error('Stale font failure'))
      await Promise.allSettled([oldLoad.promise])
    })
    expect(container.textContent).toContain(nextTypeface.faces[0]!.fullName)
    expect(container.textContent).not.toContain('could not be loaded')

    await act(async () => {
      nextLoad.resolve()
      await nextLoad.promise
    })
    expect(container.textContent).not.toContain('could not be loaded')
    expect(container.textContent).not.toContain('Loading requested')
  })

  it('offers an explicit installed-font retry without changing the selection', async () => {
    const onRetry = vi.fn()
    await renderCombobox({
      status: 'error',
      message: 'Installed fonts could not be read. Retry font access.',
      onRetry,
    })
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry font access',
    )!
    await act(async () => retry.click())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('[role="combobox"]')?.value).toBe(
      SYSTEM_UI_TYPEFACE.family,
    )
  })
})
