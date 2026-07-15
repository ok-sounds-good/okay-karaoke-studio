// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sameLyricTextStyle,
  useProjectTypographySession,
  type ProjectTypographyCommitResult,
  type ProjectTypographyOwnerKey,
  type ProjectTypographySession,
  type ProjectTypographySessionOptions,
} from '../src/hooks/useProjectTypographySession'
import type { FontFaceDescriptor, LyricTextStyle } from '../src/lib/video-style'

function lyricStyle(
  family = 'Studio Sans',
  unsungColor = '#72687D',
  sungColor = '#FF8A2B',
): LyricTextStyle {
  const face: FontFaceDescriptor = {
    fullName: `${family} Regular`,
    style: 'Regular',
    postscriptName: `${family.replaceAll(' ', '')}-Regular`,
    weight: 400,
    slant: 'normal',
  }
  return {
    typeface: { kind: 'local', family, faces: [{ ...face }] },
    fontStyle: { ...face },
    sizePx: 82,
    unsungColor,
    sungColor,
  }
}

function copyStyle(style: LyricTextStyle): LyricTextStyle {
  return JSON.parse(JSON.stringify(style)) as LyricTextStyle
}

function Probe({ options }: { options: ProjectTypographySessionOptions }) {
  currentSession = useProjectTypographySession(options)
  renderSnapshots.push({
    draftFamily: currentSession.draft?.typeface.family ?? null,
    isOpen: currentSession.isOpen,
    blocksProjectActions: currentSession.blocksProjectActions,
  })
  return null
}

let currentSession: ProjectTypographySession
let renderSnapshots: Array<{
  draftFamily: string | null
  isOpen: boolean
  blocksProjectActions: boolean
}>

describe('project typography session', () => {
  let container: HTMLDivElement
  let root: Root
  let source: LyricTextStyle
  let ownerKey: ProjectTypographyOwnerKey
  let allowed: boolean
  let requestFonts: ReturnType<typeof vi.fn>
  let commitDraft: ReturnType<typeof vi.fn>
  let options: ProjectTypographySessionOptions

  const render = async (changes: Partial<ProjectTypographySessionOptions> = {}) => {
    options = { ...options, ...changes }
    await act(async () => root.render(<Probe options={options} />))
  }

  const trigger = () => {
    const button = document.createElement('button')
    button.textContent = 'Style'
    document.body.append(button)
    return button
  }

  const start = async (element = trigger()) => {
    await act(async () => currentSession.start(element))
    return element
  }

  const change = async (next: LyricTextStyle) => {
    await act(async () => currentSession.change(next))
  }

  const flushFocus = async () => {
    await act(async () => vi.runOnlyPendingTimers())
  }

  beforeEach(async () => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    source = lyricStyle()
    ownerKey = { projectId: 'project-a', lifecycle: 1 }
    allowed = true
    requestFonts = vi.fn()
    commitDraft = vi.fn(() => 'applied' as const)
    renderSnapshots = []
    options = {
      ownerKey,
      source,
      canInteract: () => allowed,
      requestFonts,
      commitDraft,
    }
    await render()
  })

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers()
      root.unmount()
    })
    document.querySelectorAll('button').forEach((button) => button.remove())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requests fonts synchronously only after an authorized start', async () => {
    const button = trigger()
    allowed = false
    await act(async () => currentSession.start(button))

    expect(requestFonts).not.toHaveBeenCalled()
    expect(currentSession).toMatchObject({
      draft: null,
      isOpen: false,
      blocksProjectActions: false,
      isDirty: false,
    })

    let insideStart = false
    requestFonts.mockImplementationOnce(() => {
      expect(insideStart).toBe(true)
    })
    allowed = true
    source.typeface.faces[0].fullName = 'Changed after render'
    source.fontStyle.fullName = 'Changed after render'
    await act(async () => {
      insideStart = true
      currentSession.start(button)
      insideStart = false
    })

    expect(requestFonts).toHaveBeenCalledOnce()
    expect(currentSession).toMatchObject({
      isOpen: true,
      blocksProjectActions: true,
      isDirty: false,
    })
    expect(currentSession.draft?.typeface.faces[0].fullName).toBe('Studio Sans Regular')
    expect(currentSession.draft?.fontStyle.fullName).toBe('Studio Sans Regular')
  })

  it('clones source, exposed drafts, values, and updater results', async () => {
    await start()

    expect(currentSession.draft).toEqual(source)
    expect(currentSession.draft).not.toBe(source)
    expect(currentSession.draft?.typeface).not.toBe(source.typeface)
    expect(currentSession.draft?.typeface.faces[0]).not.toBe(source.typeface.faces[0])
    expect(currentSession.draft?.fontStyle).not.toBe(source.fontStyle)

    currentSession.draft!.typeface.faces[0].fullName = 'Exposed mutation'
    await render()
    expect(currentSession.draft?.typeface.faces[0].fullName).toBe('Studio Sans Regular')

    const replacement = lyricStyle('Value Sans')
    await change(replacement)
    replacement.typeface.family = 'Mutated after change'
    replacement.typeface.faces[0].fullName = 'Mutated after change'
    replacement.fontStyle.fullName = 'Mutated after change'
    expect(currentSession.draft?.typeface.family).toBe('Value Sans')
    expect(currentSession.draft?.fontStyle.fullName).toBe('Value Sans Regular')

    let updaterInput: LyricTextStyle | null = null
    await act(async () => {
      currentSession.change((draft) => {
        updaterInput = draft
        draft.sungColor = '#123456'
        draft.typeface.faces[0].fullName = 'Updater result'
        return draft
      })
    })
    updaterInput!.sungColor = '#654321'
    updaterInput!.typeface.faces[0].fullName = 'Mutated callback result'
    await render()

    expect(currentSession.draft?.sungColor).toBe('#123456')
    expect(currentSession.draft?.typeface.faces[0].fullName).toBe('Updater result')
    expect(source).toEqual(lyricStyle())
  })

  it('freezes guarded changes and apply, then resumes the same draft', async () => {
    await start()
    await change({ ...lyricStyle(), sungColor: '#123456' })
    const heldDraft = copyStyle(currentSession.draft!)

    allowed = false
    await change(lyricStyle('Blocked replacement'))
    await act(async () => currentSession.apply())

    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.blocksProjectActions).toBe(true)
    expect(commitDraft).not.toHaveBeenCalled()

    allowed = true
    await act(async () => {
      currentSession.change((draft) => ({
        ...draft,
        unsungColor: '#ABCDEF',
      }))
    })
    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(commitDraft.mock.calls[0]?.[1]).toMatchObject({
      sungColor: '#123456',
      unsungColor: '#ABCDEF',
    })
    expect(currentSession.isOpen).toBe(false)
  })

  it.each<ProjectTypographyCommitResult>(['applied', 'noop'])(
    'closes and restores focus once after a %s acknowledgement',
    async (result) => {
      const button = trigger()
      const focus = vi.spyOn(button, 'focus')
      await start(button)
      if (result === 'applied') {
        await change({ ...lyricStyle(), sizePx: 96 })
      }
      commitDraft.mockImplementationOnce(() => {
        currentSession.apply()
        return result
      })

      await act(async () => {
        currentSession.apply()
        currentSession.apply()
      })

      expect(commitDraft).toHaveBeenCalledOnce()
      expect(commitDraft).toHaveBeenCalledWith(ownerKey, expect.any(Object))
      expect(currentSession).toMatchObject({
        draft: null,
        isOpen: false,
        blocksProjectActions: false,
      })
      expect(focus).not.toHaveBeenCalled()
      await flushFocus()
      expect(focus).toHaveBeenCalledOnce()
    },
  )

  it('retains the exact draft when a blocked callback mutates its copy', async () => {
    const button = await start()
    const focus = vi.spyOn(button, 'focus')
    await change(lyricStyle('Held Sans', '#010203', '#A0B0C0'))
    const heldDraft = copyStyle(currentSession.draft!)
    commitDraft.mockImplementationOnce((_key, draft: LyricTextStyle) => {
      draft.typeface.family = 'Callback mutation'
      draft.typeface.faces[0].fullName = 'Callback mutation'
      draft.fontStyle.fullName = 'Callback mutation'
      draft.sungColor = '#FFFFFF'
      return 'blocked'
    })

    await act(async () => currentSession.apply())
    await flushFocus()

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.isDirty).toBe(true)
    expect(focus).not.toHaveBeenCalled()
    expect(source).toEqual(lyricStyle())
  })

  it('abandons a stale acknowledgement without restoring focus', async () => {
    const button = await start()
    const focus = vi.spyOn(button, 'focus')
    commitDraft.mockReturnValueOnce('stale')

    await act(async () => currentSession.apply())
    await flushFocus()

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
    expect(currentSession.draft).toBeNull()
    expect(focus).not.toHaveBeenCalled()
  })

  it('abandons A immediately when lifecycle ownership changes, even for a reused project id', async () => {
    const buttonA = await start()
    const focusA = vi.spyOn(buttonA, 'focus')
    await change(lyricStyle('Draft A'))

    const laterRevision = lyricStyle('History revision source')
    await render({ source: laterRevision })
    expect(currentSession.draft?.typeface.family).toBe('Draft A')
    expect(currentSession.isOpen).toBe(true)

    allowed = false
    const ownerB = { projectId: ownerKey.projectId, lifecycle: 2 }
    const firstOwnerBRender = renderSnapshots.length
    await render({ ownerKey: ownerB, source: lyricStyle('Project B') })
    expect(renderSnapshots[firstOwnerBRender]).toEqual({
      draftFamily: null,
      isOpen: false,
      blocksProjectActions: false,
    })
    expect(currentSession).toMatchObject({
      draft: null,
      isOpen: false,
      blocksProjectActions: false,
      isDirty: false,
    })

    await act(async () => {
      currentSession.apply()
      currentSession.cancel()
    })
    await flushFocus()
    expect(commitDraft).not.toHaveBeenCalled()
    expect(focusA).not.toHaveBeenCalled()

    const buttonB = trigger()
    await act(async () => currentSession.start(buttonB))
    expect(requestFonts).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)

    allowed = true
    await act(async () => currentSession.start(buttonB))
    expect(requestFonts).toHaveBeenCalledTimes(2)
    expect(currentSession.draft?.typeface.family).toBe('Project B')
  })

  it('cancel never commits and focuses only a connected same-owner trigger', async () => {
    const connected = await start()
    const connectedFocus = vi.spyOn(connected, 'focus')
    await act(async () => currentSession.cancel())
    expect(connectedFocus).not.toHaveBeenCalled()
    await flushFocus()
    expect(connectedFocus).toHaveBeenCalledOnce()

    const disconnected = await start()
    const disconnectedFocus = vi.spyOn(disconnected, 'focus')
    disconnected.remove()
    await act(async () => currentSession.cancel())
    await flushFocus()
    expect(disconnectedFocus).not.toHaveBeenCalled()

    const changedOwner = await start()
    const changedOwnerFocus = vi.spyOn(changedOwner, 'focus')
    await act(async () => currentSession.cancel())
    await render({
      ownerKey: { projectId: 'project-b', lifecycle: 2 },
      source: lyricStyle('Project B'),
    })
    await flushFocus()

    expect(changedOwnerFocus).not.toHaveBeenCalled()
    expect(commitDraft).not.toHaveBeenCalled()
  })

  it('treats case-only color changes as semantically equal and noop-ready', async () => {
    const caseOnly = {
      ...lyricStyle(),
      unsungColor: source.unsungColor.toLowerCase(),
      sungColor: source.sungColor.toLowerCase(),
    }
    expect(sameLyricTextStyle(source, caseOnly)).toBe(true)

    await start()
    await change(caseOnly)
    expect(currentSession.isDirty).toBe(false)
    commitDraft.mockReturnValueOnce('noop')

    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
  })
})
