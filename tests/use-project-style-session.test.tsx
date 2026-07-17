// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sameStageStyle,
  sameVocalStyle,
  useProjectStyleSession,
  type ProjectStyleCommitResult,
  type ProjectStyleDraft,
  type ProjectStyleOwnerKey,
  type ProjectStyleSession,
  type ProjectStyleSessionOptions,
} from '../src/hooks/useProjectStyleSession'
import {
  cloneStageStyle,
  cloneVocalStyle,
  type FontFaceDescriptor,
  type LyricTextStyle,
  type StageStyle,
  type VocalStyle,
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

function projectStyleDraft(
  family = 'Studio Sans',
  unsungColor = '#72687D',
  sungColor = '#FF8A2B',
): ProjectStyleDraft {
  return {
    stageStyle: stageStyle(family, unsungColor, sungColor),
    vocalStyle: cloneVocalStyle(),
  }
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

function expectIsolatedClone(actual: ProjectStyleDraft, expected: ProjectStyleDraft) {
  expect(actual).toEqual(expected)
  expect(actual).not.toBe(expected)
  expect(actual.stageStyle).not.toBe(expected.stageStyle)
  expect(actual.vocalStyle).not.toBe(expected.vocalStyle)
  expect(actual.vocalStyle.syncAid).not.toBe(expected.vocalStyle.syncAid)
  const actualStage = actual.stageStyle
  const expectedStage = expected.stageStyle
  expect(actualStage.background).not.toBe(expectedStage.background)
  expect(actualStage.lyrics).not.toBe(expectedStage.lyrics)
  expect(actualStage.lyrics.typeface).not.toBe(expectedStage.lyrics.typeface)
  expect(actualStage.lyrics.typeface.faces[0]).not.toBe(expectedStage.lyrics.typeface.faces[0])
  expect(actualStage.lyrics.fontStyle).not.toBe(expectedStage.lyrics.fontStyle)
  expect(actualStage.titleCard).not.toBe(expectedStage.titleCard)
  expect(actualStage.stageFrame).not.toBe(expectedStage.stageFrame)
  visibleTextStyles(actualStage).forEach((role, index) => {
    const expectedRole = visibleTextStyles(expectedStage)[index]!
    expect(role).not.toBe(expectedRole)
    expect(role.typeface).not.toBe(expectedRole.typeface)
    expect(role.typeface.faces[0]).not.toBe(expectedRole.typeface.faces[0])
    expect(role.fontStyle).not.toBe(expectedRole.fontStyle)
  })
}

function Probe({ options }: { options: ProjectStyleSessionOptions }) {
  currentSession = useProjectStyleSession(options)
  renderSnapshots.push({
    draftFamily: currentSession.draft?.stageStyle.lyrics.typeface.family ?? null,
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
  let source: ProjectStyleDraft
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

  const change = async (next: ProjectStyleDraft) => {
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
    source = projectStyleDraft()
    ownerKey = { projectId: 'project-a', lifecycle: 1, trackId: 'lead-a' }
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
    source.stageStyle.lyrics.typeface.faces[0].fullName = 'Changed after render'
    source.stageStyle.lyrics.fontStyle.fullName = 'Changed after render'
    source.stageStyle.background.imagePath = '/changed-after-render.png'
    source.vocalStyle.syncAid.maxLeadMs = 9_000
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
    expect(currentSession.draft?.stageStyle.lyrics.typeface.faces[0].fullName).toBe(
      'Studio Sans Regular',
    )
    expect(currentSession.draft?.stageStyle.lyrics.fontStyle.fullName).toBe('Studio Sans Regular')
    expect(currentSession.draft?.stageStyle.background.imagePath).toBeNull()
    expect(currentSession.draft?.vocalStyle.syncAid.maxLeadMs).toBe(3_000)
  })

  it('deep-clones the complete source, exposed drafts, values, and updater results', async () => {
    await start()

    expectIsolatedClone(currentSession.draft!, source)

    currentSession.draft!.stageStyle.lyrics.typeface.faces[0].fullName = 'Exposed mutation'
    currentSession.draft!.stageStyle.titleCard.title.typeface.faces[0].fullName =
      'Exposed title mutation'
    currentSession.draft!.stageStyle.background.solidColor = '#010203'
    currentSession.draft!.vocalStyle.syncAid.enabled = true
    await render()
    expect(currentSession.draft?.stageStyle.lyrics.typeface.faces[0].fullName).toBe(
      'Studio Sans Regular',
    )
    expect(currentSession.draft?.stageStyle.titleCard.title.typeface.faces[0].fullName).not.toBe(
      'Exposed title mutation',
    )
    expect(currentSession.draft?.stageStyle.background.solidColor).not.toBe('#010203')
    expect(currentSession.draft?.vocalStyle.syncAid.enabled).toBe(false)

    const replacement = projectStyleDraft('Value Sans')
    replacement.stageStyle.background.imagePath = '/replacement.png'
    replacement.vocalStyle.previewMs = 4_500
    await change(replacement)
    replacement.stageStyle.lyrics.typeface.family = 'Mutated after change'
    replacement.stageStyle.lyrics.typeface.faces[0].fullName = 'Mutated after change'
    replacement.stageStyle.lyrics.fontStyle.fullName = 'Mutated after change'
    replacement.stageStyle.background.imagePath = '/mutated.png'
    replacement.vocalStyle.previewMs = 1
    expect(currentSession.draft?.stageStyle.lyrics.typeface.family).toBe('Value Sans')
    expect(currentSession.draft?.stageStyle.lyrics.fontStyle.fullName).toBe('Value Sans Regular')
    expect(currentSession.draft?.stageStyle.background.imagePath).toBe('/replacement.png')
    expect(currentSession.draft?.vocalStyle.previewMs).toBe(4_500)

    let updaterInput: ProjectStyleDraft | null = null
    await act(async () => {
      currentSession.change((draft) => {
        updaterInput = draft
        draft.stageStyle.lyrics.sungColor = '#123456'
        draft.stageStyle.lyrics.typeface.faces[0].fullName = 'Updater result'
        draft.stageStyle.titleCard.title.visible = false
        draft.vocalStyle.syncAid.minLeadMs = 2_500
        return draft
      })
    })
    updaterInput!.stageStyle.lyrics.sungColor = '#654321'
    updaterInput!.stageStyle.lyrics.typeface.faces[0].fullName = 'Mutated callback result'
    updaterInput!.stageStyle.titleCard.title.visible = true
    updaterInput!.vocalStyle.syncAid.minLeadMs = 1
    await render()

    expect(currentSession.draft?.stageStyle.lyrics.sungColor).toBe('#123456')
    expect(currentSession.draft?.stageStyle.lyrics.typeface.faces[0].fullName).toBe(
      'Updater result',
    )
    expect(currentSession.draft?.stageStyle.titleCard.title.visible).toBe(false)
    expect(currentSession.draft?.vocalStyle.syncAid.minLeadMs).toBe(2_500)
    expect(source).toEqual(projectStyleDraft())
  })

  it('freezes guarded changes and apply, then resumes the same draft', async () => {
    await start()
    await change(projectStyleDraft('Studio Sans', '#72687D', '#123456'))
    const heldDraft = structuredClone(currentSession.draft!)

    allowed = false
    await change(projectStyleDraft('Blocked replacement'))
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
        stageStyle: {
          ...draft.stageStyle,
          lyrics: { ...draft.stageStyle.lyrics, unsungColor: '#ABCDEF' },
        },
      }))
    })
    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(commitDraft.mock.calls[0]?.[1].stageStyle.lyrics).toMatchObject({
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
        const changed = projectStyleDraft()
        changed.stageStyle.lyrics.sizePx = 96
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
    await change(projectStyleDraft('Held Sans', '#010203', '#A0B0C0'))
    const heldDraft = structuredClone(currentSession.draft!)
    commitDraft.mockImplementationOnce((_key, draft: ProjectStyleDraft) => {
      draft.stageStyle.lyrics.typeface.family = 'Callback mutation'
      draft.stageStyle.lyrics.typeface.faces[0].fullName = 'Callback mutation'
      draft.stageStyle.lyrics.fontStyle.fullName = 'Callback mutation'
      draft.stageStyle.lyrics.sungColor = '#FFFFFF'
      draft.stageStyle.background.imagePath = '/callback-mutation.png'
      draft.vocalStyle.syncAid.enabled = true
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
    expect(source).toEqual(projectStyleDraft())
  })

  it('retains the draft and releases the apply guard when the commit callback throws', async () => {
    await start()
    const changed = projectStyleDraft('Retry Sans')
    changed.stageStyle.background.imagePath = '/latent-retry.png'
    changed.vocalStyle.previewMs = 7_000
    await change(changed)
    const heldDraft = structuredClone(currentSession.draft!)
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
    await change(projectStyleDraft('Draft A'))

    const laterRevision = projectStyleDraft('History revision source')
    await render({ source: laterRevision })
    expect(currentSession.draft?.stageStyle.lyrics.typeface.family).toBe('Draft A')
    expect(currentSession.isOpen).toBe(true)

    allowed = false
    const ownerB = { projectId: ownerKey.projectId, lifecycle: 2, trackId: 'lead-b' }
    const firstOwnerBRender = renderSnapshots.length
    await render({ ownerKey: ownerB, source: projectStyleDraft('Project B') })
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
    expect(currentSession.draft?.stageStyle.lyrics.typeface.family).toBe('Project B')
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
      ownerKey: { projectId: 'project-b', lifecycle: 2, trackId: 'lead-b' },
      source: projectStyleDraft('Project B'),
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
      const changed = cloneStageStyle(source.stageStyle)
      mutate(changed)
      expect(sameStageStyle(source.stageStyle, changed), name).toBe(false)
    })
  })

  it('compares complete vocal overrides semantically, including unexposed timing fields', () => {
    const baseline = cloneVocalStyle(source.vocalStyle)
    baseline.typeface = lyricStyle().typeface
    baseline.fontStyle = lyricStyle().fontStyle
    baseline.sizePx = 82
    baseline.sungColor = '#ABCDEF'
    baseline.unsungColor = '#123456'
    const equivalent = cloneVocalStyle(baseline)
    equivalent.typeface!.faces.reverse()
    equivalent.sungColor = '#abcdef'
    equivalent.unsungColor = '#123456'
    expect(sameVocalStyle(baseline, equivalent)).toBe(true)

    const mutations: Array<(style: VocalStyle) => void> = [
      (style) => {
        style.typeface = null
      },
      (style) => {
        style.fontStyle = null
      },
      (style) => {
        style.sizePx = null
      },
      (style) => {
        style.sungColor = null
      },
      (style) => {
        style.unsungColor = null
      },
      (style) => {
        style.alignment = 'left'
      },
      (style) => {
        style.previewMs += 1
      },
      (style) => {
        style.syncAid.enabled = !style.syncAid.enabled
      },
      (style) => {
        style.syncAid.minLeadMs += 1
      },
      (style) => {
        style.syncAid.maxLeadMs += 1
      },
    ]
    mutations.forEach((mutate) => {
      const changed = cloneVocalStyle(baseline)
      mutate(changed)
      expect(sameVocalStyle(baseline, changed)).toBe(false)
    })
  })

  it('normalizes every saved color and preserves semantic font keys for no-op readiness', async () => {
    const caseOnly = structuredClone(source)
    caseOnly.stageStyle.background.solidColor =
      caseOnly.stageStyle.background.solidColor.toLowerCase()
    caseOnly.stageStyle.background.gradientStartColor =
      caseOnly.stageStyle.background.gradientStartColor.toLowerCase()
    caseOnly.stageStyle.background.gradientEndColor =
      caseOnly.stageStyle.background.gradientEndColor.toLowerCase()
    caseOnly.stageStyle.lyrics.unsungColor = caseOnly.stageStyle.lyrics.unsungColor.toLowerCase()
    caseOnly.stageStyle.lyrics.sungColor = caseOnly.stageStyle.lyrics.sungColor.toLowerCase()
    visibleTextStyles(caseOnly.stageStyle).forEach((role) => {
      role.color = role.color.toLowerCase()
      role.typeface.faces.reverse()
    })
    caseOnly.stageStyle.stageFrame.lineColor =
      caseOnly.stageStyle.stageFrame.lineColor.toLowerCase()
    caseOnly.stageStyle.lyrics.typeface.faces.reverse()
    expect(sameStageStyle(source.stageStyle, caseOnly.stageStyle)).toBe(true)

    await start()
    await change(caseOnly)
    expect(currentSession.isDirty).toBe(false)
    commitDraft.mockReturnValueOnce('noop')

    await act(async () => currentSession.apply())

    expect(commitDraft).toHaveBeenCalledOnce()
    expect(currentSession.isOpen).toBe(false)
  })
})
