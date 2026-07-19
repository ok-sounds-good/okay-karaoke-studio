// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInstalledFonts } from '../src/hooks/useInstalledFonts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function fontRecord(family: string): StudioLocalFontRecord[] {
  return [
    {
      family,
      fullName: `${family} Regular`,
      postscriptName: `${family.replaceAll(' ', '')}-Regular`,
      style: 'Regular',
    },
  ]
}

function FontAccessProbe() {
  const fonts = useInstalledFonts()
  return (
    <div>
      <button onClick={fonts.request}>Read fonts</button>
      <output>
        {fonts.status}:{fonts.typefaces.map(({ family }) => family).join(',')}
      </output>
    </div>
  )
}

describe('installed font access', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'queryLocalFonts')
  })

  it('queries only from an explicit action and reports denial or unavailable access', async () => {
    const query = vi.fn(async () => [
      {
        family: 'Studio Sans',
        fullName: 'Studio Sans Regular',
        postscriptName: 'StudioSans-Regular',
        style: 'Regular',
      },
    ])
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: query,
    })
    await act(async () => root.render(<FontAccessProbe />))

    expect(query).not.toHaveBeenCalled()
    const button = container.querySelector('button')!
    button.click()
    expect(query).toHaveBeenCalledOnce()
    await act(async () => Promise.resolve())
    expect(container.querySelector('output')?.textContent).toBe('ready:Studio Sans')

    query.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    await act(async () => button.click())
    expect(container.querySelector('output')?.textContent).toBe('denied:')

    Reflect.deleteProperty(window, 'queryLocalFonts')
    await act(async () => button.click())
    expect(container.querySelector('output')?.textContent).toBe('unavailable:')
  })

  it('reports a fulfilled malformed catalog as an error instead of remaining loading', async () => {
    const query = vi.fn(async () => null)
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: query,
    })
    await act(async () => root.render(<FontAccessProbe />))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')!.click()
    })

    expect(query).toHaveBeenCalledOnce()
    expect(container.querySelector('output')?.textContent).toBe('error:')
  })

  it('ignores older success and rejection after every newer terminal state', async () => {
    await act(async () => root.render(<FontAccessProbe />))
    const button = container.querySelector<HTMLButtonElement>('button')!
    const output = () => container.querySelector('output')?.textContent

    const settleStalePair = async (
      success: ReturnType<typeof deferred<StudioLocalFontRecord[]>>,
      failure: ReturnType<typeof deferred<StudioLocalFontRecord[]>>,
    ) => {
      await act(async () => {
        success.resolve(fontRecord('Stale Success'))
        failure.reject(new Error('stale rejection'))
        await Promise.allSettled([success.promise, failure.promise])
      })
    }

    const readySuccess = deferred<StudioLocalFontRecord[]>()
    const readyFailure = deferred<StudioLocalFontRecord[]>()
    let query = vi
      .fn()
      .mockImplementationOnce(() => readySuccess.promise)
      .mockImplementationOnce(() => readyFailure.promise)
      .mockResolvedValueOnce(fontRecord('Latest Ready'))
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: query,
    })
    await act(async () => {
      button.click()
      button.click()
      button.click()
    })
    expect(output()).toBe('ready:Latest Ready')
    await settleStalePair(readySuccess, readyFailure)
    expect(output()).toBe('ready:Latest Ready')

    const errorSuccess = deferred<StudioLocalFontRecord[]>()
    const errorFailure = deferred<StudioLocalFontRecord[]>()
    query = vi
      .fn()
      .mockImplementationOnce(() => errorSuccess.promise)
      .mockImplementationOnce(() => errorFailure.promise)
      .mockRejectedValueOnce(new Error('latest failure'))
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: query,
    })
    await act(async () => {
      button.click()
      button.click()
      button.click()
    })
    expect(output()).toBe('error:')
    await settleStalePair(errorSuccess, errorFailure)
    expect(output()).toBe('error:')

    const unavailableSuccess = deferred<StudioLocalFontRecord[]>()
    const unavailableFailure = deferred<StudioLocalFontRecord[]>()
    query = vi
      .fn()
      .mockImplementationOnce(() => unavailableSuccess.promise)
      .mockImplementationOnce(() => unavailableFailure.promise)
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: query,
    })
    await act(async () => {
      button.click()
      button.click()
    })
    Reflect.deleteProperty(window, 'queryLocalFonts')
    await act(async () => {
      button.click()
    })
    expect(output()).toBe('unavailable:')
    await settleStalePair(unavailableSuccess, unavailableFailure)
    expect(output()).toBe('unavailable:')
  })
})
