// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sameStageStyle,
  useProjectStyleSession,
  type ProjectStyleCommitResult,
  type ProjectStyleOwnerKey,
  type ProjectStyleSession,
  type ProjectStyleSessionOptions,
} from '../src/hooks/useProjectStyleSession'
import {
  cloneStageStyle,
  type FontFaceDescriptor,
  type LyricTextStyle,
  type StageStyle,
} from '../src/lib/video-style'

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

function stageStyle(
  family = 'Studio Sans',
  unsungColor = '#72687D',
  sungColor = '#FF8A2B',
): StageStyle {
  const style = cloneStageStyle()
  style.lyrics = lyricStyle(family, unsungColor, sungColor)
  return style
}

function visibleTextStyles(style: StageStyle) {
  return [
    style.titleCard.eyebrow,
    style.titleCard.title,
    style.titleCard.artist,
    style.stageFrame.brand,
    style.stageFrame.clock,
    style.stageFrame.footer,
  ]
}

function expectIsolatedClone(actual: StageStyle, expected: StageStyle) {
  expect(actual).toEqual(expected)
  expect(actual).not.toBe(expected)
  expect(actual.background).not.toBe(expected.background)
  expect(actual.lyrics).not.toBe(expected.lyrics)
  expect(actual.lyrics.typeface).not.toBe(expected.lyrics.typeface)
  expect(actual.lyrics.typeface.faces[0]).not.toBe(expected.lyrics.typeface.faces[0])
  expect(actual.lyrics.fontStyle).not.toBe(expected.lyrics.fontStyle)
  expect(actual.titleCard).not.toBe(expected.titleCard)
  expect(actual.stageFrame).not.toBe(expected.stageFrame)
  visibleTextStyles(actual).forEach((role, index) => {
    const expectedRole = visibleTextStyles(expected)[index]!
    expect(role).not.toBe(expectedRole)
    expect(role.typeface).not.toBe(expectedRole.typeface)
    expect(role.typeface.faces[0]).not.toBe(expectedRole.typeface.faces[0])
    expect(role.fontStyle).not.toBe(expectedRole.fontStyle)
  })
}

function Probe({ options }: { options: ProjectStyleSessionOptions }) {
  currentSession = useProjectStyleSession(options)
  renderSnapshots.push({
    draftFamily: currentSession.draft?.lyrics.typeface.family ?? null,
    isOpen: currentSession.isOpen,
    blocksProjectActions: currentSession.blocksProjectActions,
  })
  return null
}

let currentSession: ProjectStyleSession
let renderSnapshots: Array<{
  draftFamily: string | null
  isOpen: boolean
  blocksProjectActions: boolean
}>

describe('project Style session', () => {
  let container: HTMLDivElement
  let root: Root
  let source: StageStyle
  let ownerKey: ProjectStyleOwnerKey
  let allowed: boolean
  let requestFonts: ReturnType<typeof vi.fn>
  let commitDraft: ReturnType<typeof vi.fn>
  let options: ProjectStyleSessionOptions

  const render = async (changes: Partial<ProjectStyleSessionOptions> = {}) => {
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

  const change = async (next: StageStyle) => {
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
    source = stageStyle()
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
    source.lyrics.typeface.faces[0].fullName = 'Changed after render'
    source.lyrics.fontStyle.fullName = 'Changed after render'
    source.background.imagePath = '/changed-after-render.png'
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
    expect(currentSession.draft?.lyrics.typeface.faces[0].fullName).toBe('Studio Sans Regular')
    expect(currentSession.draft?.lyrics.fontStyle.fullName).toBe('Studio Sans Regular')
    expect(currentSession.draft?.background.imagePath).toBeNull()
  })

  it('deep-clones the complete source, exposed drafts, values, and updater results', async () => {
    await start()

    expectIsolatedClone(currentSession.draft!, source)

    currentSession.draft!.lyrics.typeface.faces[0].fullName = 'Exposed mutation'
    currentSession.draft!.titleCard.title.typeface.faces[0].fullName = 'Exposed title mutation'
    currentSession.draft!.background.solidColor = '#010203'
    await render()
    expect(currentSession.draft?.lyrics.typeface.faces[0].fullName).toBe('Studio Sans Regular')
    expect(currentSession.draft?.titleCard.title.typeface.faces[0].fullName).not.toBe(
      'Exposed title mutation',
    )
    expect(currentSession.draft?.background.solidColor).not.toBe('#010203')

    const replacement = stageStyle('Value Sans')
    replacement.background.imagePath = '/replacement.png'
    await change(replacement)
    replacement.lyrics.typeface.family = 'Mutated after change'
    replacement.lyrics.typeface.faces[0].fullName = 'Mutated after change'
    replacement.lyrics.fontStyle.fullName = 'Mutated after change'
    replacement.background.imagePath = '/mutated.png'
    expect(currentSession.draft?.lyrics.typeface.family).toBe('Value Sans')
    expect(currentSession.draft?.lyrics.fontStyle.fullName).toBe('Value Sans Regular')
    expect(currentSession.draft?.background.imagePath).toBe('/replacement.png')

    let updaterInput: StageStyle | null = null
    await act(async () => {
      currentSession.change((draft) => {
        updaterInput = draft
        draft.lyrics.sungColor = '#123456'
        draft.lyrics.typeface.faces[0].fullName = 'Updater result'
        draft.titleCard.title.visible = false
        return draft
      })
    })
    updaterInput!.lyrics.sungColor = '#654321'
    updaterInput!.lyrics.typeface.faces[0].fullName = 'Mutated callback result'
    updaterInput!.titleCard.title.visible = true
    await render()

    expect(currentSession.draft?.lyrics.sungColor).toBe('#123456')
    expect(currentSession.draft?.lyrics.typeface.faces[0].fullName).toBe('Updater result')
    expect(currentSession.draft?.titleCard.title.visible).toBe(false)
    expect(source).toEqual(stageStyle())
  })

  it('freezes guarded changes and apply, then resumes the same draft', async () => {
    await start()
    await change(stageStyle('Studio Sans', '#72687D', '#123456'))
    const heldDraft = cloneStageStyle(currentSession.draft!)

    allowed = false
    await change(stageStyle('Blocked replacement'))
    let settled = true
    await act(async () => {
      settled = currentSession.apply()
    })

    expect(settled).toBe(false)
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.blocksProjectActions).toBe(true)
    expect(commitDraft).not.toHaveBeenCalled()

    allowed = true
    await act(async () => {
      currentSession.change((draft) => ({
        ...draft,
        lyrics: { ...draft.lyrics, unsungColor: '#ABCDEF' },
      }))
    })
    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(commitDraft.mock.calls[0]?.[1].lyrics).toMatchObject({
      sungColor: '#123456',
      unsungColor: '#ABCDEF',
    })
    expect(currentSession.isOpen).toBe(false)
  })

  it.each<ProjectStyleCommitResult>(['applied', 'noop'])(
    'closes and restores focus once after a %s acknowledgement',
    async (result) => {
      const button = trigger()
      const focus = vi.spyOn(button, 'focus')
      await start(button)
      if (result === 'applied') {
        const changed = stageStyle()
        changed.lyrics.sizePx = 96
        await change(changed)
      }
      commitDraft.mockImplementationOnce(() => {
        currentSession.apply()
        return result
      })

      let firstResult = false
      let repeatedResult = true
      await act(async () => {
        firstResult = currentSession.apply()
        repeatedResult = currentSession.apply()
      })

      expect(firstResult).toBe(true)
      expect(repeatedResult).toBe(false)
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
    await change(stageStyle('Held Sans', '#010203', '#A0B0C0'))
    const heldDraft = cloneStageStyle(currentSession.draft!)
    commitDraft.mockImplementationOnce((_key, draft: StageStyle) => {
      draft.lyrics.typeface.family = 'Callback mutation'
      draft.lyrics.typeface.faces[0].fullName = 'Callback mutation'
      draft.lyrics.fontStyle.fullName = 'Callback mutation'
      draft.lyrics.sungColor = '#FFFFFF'
      draft.background.imagePath = '/callback-mutation.png'
      return 'blocked'
    })

    let settled = true
    await act(async () => {
      settled = currentSession.apply()
    })
    await flushFocus()

    expect(settled).toBe(false)
    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.isDirty).toBe(true)
    expect(focus).not.toHaveBeenCalled()
    expect(source).toEqual(stageStyle())
  })

  it('retains the draft and releases the apply guard when the commit callback throws', async () => {
    await start()
    const changed = stageStyle('Retry Sans')
    changed.background.imagePath = '/latent-retry.png'
    await change(changed)
    const heldDraft = cloneStageStyle(currentSession.draft!)
    commitDraft.mockImplementationOnce(() => {
      throw new Error('Commit callback failed')
    })

    expect(() => currentSession.apply()).toThrow('Commit callback failed')
    expect(currentSession.draft).toEqual(heldDraft)
    expect(currentSession.isOpen).toBe(true)
    expect(currentSession.isDirty).toBe(true)

    commitDraft.mockReturnValueOnce('applied')
    let settled = false
    await act(async () => {
      settled = currentSession.apply()
    })
    expect(settled).toBe(true)
    expect(commitDraft).toHaveBeenCalledTimes(2)
    expect(currentSession.isOpen).toBe(false)
  })

  it('abandons a stale acknowledgement without restoring focus', async () => {
    const button = await start()
    const focus = vi.spyOn(button, 'focus')
    commitDraft.mockReturnValueOnce('stale')

    let settled = true
    await act(async () => {
      settled = currentSession.apply()
    })
    await flushFocus()

    expect(settled).toBe(false)
    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
    expect(currentSession.draft).toBeNull()
    expect(focus).not.toHaveBeenCalled()
  })

  it('abandons A immediately when lifecycle ownership changes, even for a reused project id', async () => {
    const buttonA = await start()
    const focusA = vi.spyOn(buttonA, 'focus')
    await change(stageStyle('Draft A'))

    const laterRevision = stageStyle('History revision source')
    await render({ source: laterRevision })
    expect(currentSession.draft?.lyrics.typeface.family).toBe('Draft A')
    expect(currentSession.isOpen).toBe(true)

    allowed = false
    const ownerB = { projectId: ownerKey.projectId, lifecycle: 2 }
    const firstOwnerBRender = renderSnapshots.length
    await render({ ownerKey: ownerB, source: stageStyle('Project B') })
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
    expect(currentSession.draft?.lyrics.typeface.family).toBe('Project B')
  })

  it('cancel never commits and focuses only a connected same-owner trigger', async () => {
    const connected = await start()
    const connectedFocus = vi.spyOn(connected, 'focus')
    let canceled = false
    await act(async () => {
      canceled = currentSession.cancel()
    })
    expect(canceled).toBe(true)
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
      source: stageStyle('Project B'),
    })
    await flushFocus()

    expect(changedOwnerFocus).not.toHaveBeenCalled()
    expect(commitDraft).not.toHaveBeenCalled()
  })

  it('compares every active and latent StageStyle field semantically', () => {
    const mutations: Record<string, (style: StageStyle) => void> = {
      'background mode': (style) => {
        style.background.mode = 'solid'
      },
      'background solid color': (style) => {
        style.background.solidColor = '#000001'
      },
      'background gradient start': (style) => {
        style.background.gradientStartColor = '#000002'
      },
      'background gradient end': (style) => {
        style.background.gradientEndColor = '#000003'
      },
      'background image path': (style) => {
        style.background.imagePath = '/latent-background.png'
      },
      'lyrics typeface': (style) => {
        style.lyrics.typeface.family = 'Changed lyric family'
      },
      'lyrics face': (style) => {
        style.lyrics.fontStyle.fullName = 'Changed lyric face'
      },
      'lyrics size': (style) => {
        style.lyrics.sizePx = 96
      },
      'lyrics unsung color': (style) => {
        style.lyrics.unsungColor = '#000004'
      },
      'lyrics sung color': (style) => {
        style.lyrics.sungColor = '#000005'
      },
      'Stage frame enabled': (style) => {
        style.stageFrame.enabled = !style.stageFrame.enabled
      },
      'Stage frame line color': (style) => {
        style.stageFrame.lineColor = '#000006'
      },
      'Stage frame line width': (style) => {
        style.stageFrame.lineWidthPx += 1
      },
    }
    const roles = {
      'title eyebrow': (style: StageStyle) => style.titleCard.eyebrow,
      'title title': (style: StageStyle) => style.titleCard.title,
      'title artist': (style: StageStyle) => style.titleCard.artist,
      'Stage frame brand': (style: StageStyle) => style.stageFrame.brand,
      'Stage frame clock': (style: StageStyle) => style.stageFrame.clock,
      'Stage frame footer': (style: StageStyle) => style.stageFrame.footer,
    }
    Object.entries(roles).forEach(([name, role]) => {
      mutations[`${name} typeface`] = (style) => {
        role(style).typeface.family = `Changed ${name} family`
      }
      mutations[`${name} face`] = (style) => {
        role(style).fontStyle.fullName = `Changed ${name} face`
      }
      mutations[`${name} size`] = (style) => {
        role(style).sizePx = role(style).sizePx === 96 ? 104 : 96
      }
      mutations[`${name} color`] = (style) => {
        role(style).color = '#000007'
      }
      mutations[`${name} visible`] = (style) => {
        role(style).visible = !role(style).visible
      }
    })

    Object.entries(mutations).forEach(([name, mutate]) => {
      const changed = cloneStageStyle(source)
      mutate(changed)
      expect(sameStageStyle(source, changed), name).toBe(false)
    })
  })

  it('normalizes every saved color and preserves semantic font keys for no-op readiness', async () => {
    const caseOnly = cloneStageStyle(source)
    caseOnly.background.solidColor = caseOnly.background.solidColor.toLowerCase()
    caseOnly.background.gradientStartColor = caseOnly.background.gradientStartColor.toLowerCase()
    caseOnly.background.gradientEndColor = caseOnly.background.gradientEndColor.toLowerCase()
    caseOnly.lyrics.unsungColor = caseOnly.lyrics.unsungColor.toLowerCase()
    caseOnly.lyrics.sungColor = caseOnly.lyrics.sungColor.toLowerCase()
    visibleTextStyles(caseOnly).forEach((role) => {
      role.color = role.color.toLowerCase()
      role.typeface.faces.reverse()
    })
    caseOnly.stageFrame.lineColor = caseOnly.stageFrame.lineColor.toLowerCase()
    caseOnly.lyrics.typeface.faces.reverse()
    expect(sameStageStyle(source, caseOnly)).toBe(true)

    await start()
    await change(caseOnly)
    expect(currentSession.isDirty).toBe(false)
    commitDraft.mockReturnValueOnce('noop')

    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
  })
})
