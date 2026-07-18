import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createProject, serializeProject } from '../src/lib/model'

const require = createRequire(import.meta.url)
const {
  classifyBackgroundPath,
  createMediaCapabilityRegistry,
  normalizeBackgroundCapabilityState,
  normalizeBackgroundMutationRequest,
  normalizeMediaCapabilityReference,
  prepareProjectMedia,
} = require('../electron/media-capabilities.cjs') as {
  classifyBackgroundPath(
    value: string,
    platform?: string,
  ): { nativePath: string | null; syntax: string }
  createMediaCapabilityRegistry(options?: Record<string, unknown>): any
  normalizeBackgroundCapabilityState(
    value: unknown,
    scheme?: string,
  ): { activeToken: string | null; revision: string | null; valid: boolean }
  normalizeBackgroundMutationRequest(
    value: unknown,
    targetMode?: 'none' | 'nullable' | 'required',
    scheme?: string,
  ): {
    expectedRevision: string | null
    expectedToken: string | null
    targetToken: string | null
    valid: boolean
  }
  normalizeMediaCapabilityReference(
    value: unknown,
    options?: { allowNull?: boolean; scheme?: string },
  ): { valid: boolean; token: string | null }
  prepareProjectMedia(
    projectPath: string,
    project: ReturnType<typeof createProject>,
    audioExtensions: Set<string>,
    platform?: string,
  ): { audioPath: string | null; backgroundPath: string | null; projectPath: string }
}
const { createProjectOpenCoordinator } = require('../electron/project-open.cjs') as {
  createProjectOpenCoordinator(options?: Record<string, unknown>): any
}

function tokenFactory() {
  let next = 1
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
}

function registry() {
  return createMediaCapabilityRegistry({ createToken: tokenFactory() })
}

function image(byte = 1, mime: 'image/png' | 'image/jpeg' = 'image/png') {
  return { bytes: Buffer.from([byte, byte + 1, byte + 2]), mime }
}

function retainedBackground(capabilities: any, ownerId: number, linkedPath: string, media: object) {
  const sequence = capabilities.beginRequest(ownerId, 'background')
  const token = capabilities.registerBackgroundCandidate(ownerId, linkedPath, media, sequence)
  if (!capabilities.settleBackgroundCandidate(ownerId, token, true)) throw new Error('setup failed')
  return token
}

function retainCurrent(capabilities: any, ownerId: number, expected: string | null, target: any) {
  const state = capabilities.backgroundState(ownerId)
  return capabilities.retainBackground(ownerId, state.revision, expected, target)
}

function releaseCurrent(capabilities: any, ownerId: number, expected: string | null) {
  const state = capabilities.backgroundState(ownerId)
  return capabilities.releaseKind(ownerId, 'background', state.revision, expected)
}

function pruneCurrent(capabilities: any, ownerId: number, token: string) {
  const state = capabilities.backgroundState(ownerId)
  return capabilities.releaseBackgroundSnapshot(ownerId, state.revision, state.activeToken, token)
}

function projectWithBackground(title: string, imagePath: string, audioPath: string | null = null) {
  const project = createProject({ title, audioPath })
  project.stageStyle.background.mode = 'image'
  project.stageStyle.background.imagePath = imagePath
  return project
}

describe('media capability boundary normalization', () => {
  const token = '00000000-0000-4000-8000-000000000123'

  it('distinguishes the null CAS sentinel from malformed non-null URLs', () => {
    expect(normalizeMediaCapabilityReference(null, { allowNull: true })).toEqual({
      token: null,
      valid: true,
    })
    expect(normalizeMediaCapabilityReference('not-a-capability', { allowNull: true })).toEqual({
      token: null,
      valid: false,
    })
    expect(
      normalizeMediaCapabilityReference(`studio-media://asset/${'-'.repeat(36)}`, {
        allowNull: true,
      }).valid,
    ).toBe(false)
    expect(
      normalizeMediaCapabilityReference(`studio-media://asset/${token}/ignored-name.png`),
    ).toEqual({ token, valid: true })
    const url = `studio-media://asset/${token}`
    const expected = { activeUrl: url, revision: '00000000-0000-4000-8000-000000000456' }
    expect(normalizeBackgroundCapabilityState(expected)).toEqual({
      activeToken: token,
      revision: expected.revision,
      valid: true,
    })
    expect(normalizeBackgroundMutationRequest({ expected, url: null }, 'nullable')).toEqual({
      expectedRevision: expected.revision,
      expectedToken: token,
      targetToken: null,
      valid: true,
    })
    expect(
      normalizeBackgroundMutationRequest(
        { expected: { ...expected, activeUrl: null }, url },
        'nullable',
      ).valid,
    ).toBe(true)
    expect(normalizeBackgroundMutationRequest({ expected, url }, 'required').valid).toBe(true)
    expect(normalizeBackgroundMutationRequest({ expected, url: null }, 'required').valid).toBe(
      false,
    )
    expect(
      normalizeBackgroundMutationRequest({ expected, url: 'malformed' }, 'nullable').valid,
    ).toBe(false)
    expect(
      normalizeBackgroundMutationRequest({ expected: { ...expected, revision: 'malformed' }, url })
        .valid,
    ).toBe(false)
  })

  it('composes the tested handler payload with revision-checked registry mutation', () => {
    const capabilities = registry()
    const active = retainedBackground(capabilities, 17, '/media/active.png', image(17))
    const state = capabilities.backgroundState(17)
    const request = normalizeBackgroundMutationRequest(
      {
        expected: {
          activeUrl: `studio-media://asset/${active}`,
          revision: state.revision,
        },
        url: null,
      },
      'nullable',
    )
    expect(request.valid).toBe(true)
    expect(
      capabilities.retainBackground(
        17,
        request.expectedRevision,
        request.expectedToken,
        request.targetToken,
      ),
    ).toBe(true)
    expect(capabilities.backgroundState(17).activeToken).toBeNull()
    expect(
      capabilities.retainBackground(
        17,
        request.expectedRevision,
        request.expectedToken,
        request.targetToken,
      ),
    ).toBe(false)
  })

  it('classifies POSIX, Windows-drive, and UNC paths without rebasing foreign syntax', () => {
    const cases = [
      ['/media/background.png', 'posix', 'linux', '/media/background.png'],
      ['/media/background.png', 'posix', 'win32', null],
      ['C:\\media\\background.jpg', 'windows-drive', 'win32', 'C:\\media\\background.jpg'],
      ['C:\\media\\background.jpg', 'windows-drive', 'linux', null],
      [
        '\\\\server\\share\\background.png',
        'windows-unc',
        'win32',
        '\\\\server\\share\\background.png',
      ],
      ['\\\\server\\share\\background.png', 'windows-unc', 'linux', null],
      ['background.png', 'relative', 'linux', null],
    ] as const
    for (const [value, syntax, platform, nativePath] of cases) {
      expect(classifyBackgroundPath(value, platform)).toEqual({ nativePath, syntax })
    }

    const foreignPath = 'C:\\media\\round-trip.jpg'
    const project = projectWithBackground('Foreign', foreignPath)
    const scope = prepareProjectMedia('/projects/foreign.oks', project, new Set(['.mp3']), 'linux')
    expect(scope.backgroundPath).toBeNull()
    expect(project.stageStyle.background.imagePath).toBe(foreignPath)
    expect(JSON.parse(serializeProject(project)).stageStyle.background.imagePath).toBe(foreignPath)
    const capabilities = registry()
    capabilities.replaceProjectScope(15, scope.projectPath, { background: scope.backgroundPath })
    expect(capabilities.beginRestore(15, 'background', scope.projectPath).filePath).toBeNull()
  })
})

describe('owner-and-kind media capabilities', () => {
  it('keeps background requests isolated from the active audio capability', () => {
    const capabilities = registry()
    const audioSequence = capabilities.beginRequest(1, 'audio')
    const audioToken = capabilities.registerAudio(1, '/media/song.mp3', audioSequence)
    const backgroundSequence = capabilities.beginRequest(1, 'background')
    const candidate = capabilities.registerBackgroundCandidate(
      1,
      '/media/background.png',
      image(),
      backgroundSequence,
    )

    expect(capabilities.activeToken(1, 'audio')).toBe(audioToken)
    expect(capabilities.settleBackgroundCandidate(1, candidate, true)).toBe(true)
    expect(capabilities.activeToken(1, 'audio')).toBe(audioToken)
    expect(capabilities.get(audioToken)).toMatchObject({
      filePath: resolve('/media/song.mp3'),
      kind: 'audio',
      ownerId: 1,
    })

    expect(releaseCurrent(capabilities, 1, candidate)).toBe(true)
    expect(capabilities.get(candidate)).toBeNull()
    expect(capabilities.get(audioToken)).not.toBeNull()
  })

  it('preserves active state when a chooser is cancelled or validation fails', () => {
    const capabilities = registry()
    const active = retainedBackground(capabilities, 2, '/media/active.jpg', image(4, 'image/jpeg'))

    capabilities.beginRequest(2, 'background')
    expect(capabilities.activeToken(2, 'background')).toBe(active)
    expect(capabilities.get(active)?.bytes).toEqual(Buffer.from([4, 5, 6]))

    capabilities.beginRequest(2, 'background')
    expect(capabilities.activeToken(2, 'background')).toBe(active)
    expect(capabilities.get(active)).not.toBeNull()
  })

  it('preserves a draft candidate until a validated replacement atomically succeeds', () => {
    const capabilities = registry()
    const active = retainedBackground(capabilities, 20, '/media/active.png', image(20))
    const first = capabilities.registerBackgroundCandidate(
      20,
      '/media/first-draft.png',
      image(21),
      capabilities.beginRequest(20, 'background'),
    )

    const cancelled = capabilities.beginRequest(20, 'background')
    expect(capabilities.get(first)).not.toBeNull()
    expect(capabilities.settleBackgroundCandidate(20, first, true)).toBe(false)
    expect(capabilities.finishRequest(20, 'background', cancelled)).toBe(true)
    expect(capabilities.get(first)).not.toBeNull()
    expect(capabilities.activeToken(20, 'background')).toBe(active)

    const invalid = capabilities.beginRequest(20, 'background')
    expect(() =>
      capabilities.registerBackgroundCandidate(
        20,
        '/media/invalid.png',
        { bytes: Buffer.from([1]), mime: 'image/webp' },
        invalid,
      ),
    ).toThrow('A validated PNG or JPEG snapshot is required')
    expect(capabilities.finishRequest(20, 'background', invalid)).toBe(true)
    expect(capabilities.get(first)).not.toBeNull()

    const replacement = capabilities.registerBackgroundCandidate(
      20,
      '/media/replacement.png',
      image(22),
      capabilities.beginRequest(20, 'background'),
    )
    expect(capabilities.get(first)).toBeNull()
    expect(capabilities.settleBackgroundCandidate(20, first, true)).toBe(false)
    expect(capabilities.settleBackgroundCandidate(20, replacement, true)).toBe(true)
    expect(capabilities.activeToken(20, 'background')).toBe(replacement)
  })

  it('settles only the current candidate and retains the prior active capability', () => {
    const capabilities = registry()
    const first = retainedBackground(capabilities, 3, '/media/first.png', image(10))
    const declinedSequence = capabilities.beginRequest(3, 'background')
    const declined = capabilities.registerBackgroundCandidate(
      3,
      '/media/declined.png',
      image(20),
      declinedSequence,
    )
    const beforeDecline = capabilities.backgroundState(3).revision
    expect(capabilities.settleBackgroundCandidate(3, declined, false)).toBe(true)
    expect(capabilities.backgroundState(3).revision).toBe(beforeDecline)
    expect(capabilities.activeToken(3, 'background')).toBe(first)
    expect(capabilities.get(declined)).toBeNull()

    const staleSequence = capabilities.beginRequest(3, 'background')
    const stale = capabilities.registerBackgroundCandidate(
      3,
      '/media/stale.png',
      image(30),
      staleSequence,
    )
    const newestSequence = capabilities.beginRequest(3, 'background')
    const newest = capabilities.registerBackgroundCandidate(
      3,
      '/media/newest.png',
      image(40),
      newestSequence,
    )

    expect(releaseCurrent(capabilities, 3, first)).toBe(false)
    expect(capabilities.settleBackgroundCandidate(3, stale, true)).toBe(false)
    expect(capabilities.activeToken(3, 'background')).toBe(first)
    const beforeAccept = capabilities.backgroundState(3).revision
    expect(capabilities.settleBackgroundCandidate(3, newest, true)).toBe(true)
    expect(capabilities.backgroundState(3).revision).not.toBe(beforeAccept)
    expect(capabilities.activeToken(3, 'background')).toBe(newest)
    expect(capabilities.get(first)).not.toBeNull()
  })

  it('uses active-token compare-and-swap for retention and release', () => {
    const capabilities = registry()
    const initialNull = capabilities.backgroundState(4)
    const tokenA = retainedBackground(capabilities, 4, '/media/a.png', image(50))
    const sequenceB = capabilities.beginRequest(4, 'background')
    const tokenB = capabilities.registerBackgroundCandidate(4, '/media/b.png', image(60), sequenceB)
    expect(capabilities.settleBackgroundCandidate(4, tokenB, true)).toBe(true)

    expect(releaseCurrent(capabilities, 4, tokenA)).toBe(false)
    expect(retainCurrent(capabilities, 4, tokenA, tokenA)).toBe(false)
    expect(capabilities.activeToken(4, 'background')).toBe(tokenB)
    expect(capabilities.requestIsCurrent(4, 'background', sequenceB + 1)).toBe(true)
    expect(retainCurrent(capabilities, 4, tokenB, null)).toBe(true)
    expect(capabilities.requestIsCurrent(4, 'background', sequenceB + 1)).toBe(false)
    expect(capabilities.activeToken(4, 'background')).toBeNull()
    expect(capabilities.get(tokenB)).not.toBeNull()
    const firstNull = capabilities.backgroundState(4)
    expect(firstNull.revision).not.toBe(initialNull.revision)
    expect(capabilities.releaseKind(4, 'background', initialNull.revision, null)).toBe(false)
    expect(retainCurrent(capabilities, 4, tokenB, tokenA)).toBe(false)
    expect(retainCurrent(capabilities, 4, null, tokenA)).toBe(true)
    expect(retainCurrent(capabilities, 4, tokenA, null)).toBe(true)
    expect(capabilities.retainBackground(4, firstNull.revision, null, tokenA)).toBe(false)
    expect(capabilities.releaseBackgroundSnapshot(4, firstNull.revision, null, tokenA)).toBe(false)
    expect(retainCurrent(capabilities, 4, null, tokenB)).toBe(true)
    expect(retainCurrent(capabilities, 4, tokenB, null)).toBe(true)
    expect(retainCurrent(capabilities, 4, null, tokenA)).toBe(true)
    expect(capabilities.activeToken(4, 'background')).toBe(tokenA)
    expect(releaseCurrent(capabilities, 4, tokenB)).toBe(false)
    expect(retainCurrent(capabilities, 4, tokenA, null)).toBe(true)
    expect(pruneCurrent(capabilities, 4, tokenB)).toBe(true)
    expect(pruneCurrent(capabilities, 4, tokenA)).toBe(true)
    expect(releaseCurrent(capabilities, 4, null)).toBe(true)
    expect(capabilities.get(tokenA)).toBeNull()
    expect(capabilities.get(tokenB)).toBeNull()
  })

  it('reclaims only exact inactive retained background snapshots across rotations', () => {
    const capabilities = registry()
    const audioSequence = capabilities.beginRequest(11, 'audio')
    const audio = capabilities.registerAudio(11, '/media/song.mp3', audioSequence)
    const other = retainedBackground(capabilities, 12, '/media/other.png', image(120))
    let active = retainedBackground(capabilities, 11, '/media/first.png', image(121))
    for (let byte = 122; byte < 126; byte += 1) {
      const previous = active
      const stale = capabilities.backgroundState(11)
      const candidate = capabilities.registerBackgroundCandidate(
        11,
        `/media/${byte}.png`,
        image(byte),
        capabilities.beginRequest(11, 'background'),
      )
      expect(pruneCurrent(capabilities, 11, candidate)).toBe(false)
      expect(capabilities.settleBackgroundCandidate(11, candidate, true)).toBe(true)
      active = candidate
      expect(
        capabilities.releaseBackgroundSnapshot(11, stale.revision, stale.activeToken, previous),
      ).toBe(false)
      expect(capabilities.activeToken(11, 'background')).toBe(active)
      expect(capabilities.get(audio)).not.toBeNull()
      expect(retainCurrent(capabilities, 11, active, null)).toBe(true)
      expect(capabilities.activeToken(11, 'background')).toBeNull()
      expect(retainCurrent(capabilities, 11, null, active)).toBe(true)
      expect(pruneCurrent(capabilities, 11, previous)).toBe(true)
      expect(capabilities.get(previous)).toBeNull()
    }
    expect(pruneCurrent(capabilities, 11, active)).toBe(false)
    expect(retainCurrent(capabilities, 11, active, null)).toBe(true)
    expect(pruneCurrent(capabilities, 11, active)).toBe(true)
    expect(pruneCurrent(capabilities, 11, audio)).toBe(false)
    expect(pruneCurrent(capabilities, 11, other)).toBe(false)
    expect(capabilities.get(audio)).not.toBeNull()
    expect(capabilities.get(other)).not.toBeNull()
  })

  it('owns a private immutable snapshot with a validated decoder MIME', () => {
    const capabilities = registry()
    const source = image(70, 'image/jpeg')
    const sequence = capabilities.beginRequest(5, 'background')
    const token = capabilities.registerBackgroundCandidate(
      5,
      '/private/background.png',
      source,
      sequence,
    )
    source.bytes.fill(0)
    const firstRead = capabilities.get(token)
    expect(firstRead).toMatchObject({ kind: 'background', mime: 'image/jpeg', ownerId: 5 })
    expect(firstRead.bytes).toEqual(Buffer.from([70, 71, 72]))
    firstRead.bytes.fill(1)
    expect(capabilities.get(token).bytes).toEqual(Buffer.from([70, 71, 72]))

    const next = capabilities.beginRequest(5, 'background')
    expect(() =>
      capabilities.registerBackgroundCandidate(
        5,
        '/private/background.webp',
        { bytes: Buffer.from([1]), mime: 'image/webp' },
        next,
      ),
    ).toThrow('validated PNG or JPEG snapshot')
  })

  it('cleans only the exact owner and kind, then cleans all owner state on destruction', () => {
    const capabilities = registry()
    const ownerOneAudio = capabilities.beginRequest(6, 'audio')
    const audio = capabilities.registerAudio(6, '/media/audio.mp3', ownerOneAudio)
    const background = retainedBackground(capabilities, 6, '/media/background.png', image(80))
    const other = retainedBackground(capabilities, 7, '/media/other.png', image(90))

    capabilities.resetKind(6, 'background')
    expect(capabilities.get(background)).toBeNull()
    expect(capabilities.get(audio)).not.toBeNull()
    expect(capabilities.get(other)).not.toBeNull()
    capabilities.releaseOwner(6)
    expect(capabilities.get(audio)).toBeNull()
    expect(capabilities.get(other)).not.toBeNull()
    const newAudioSequence = capabilities.beginRequest(6, 'audio')
    expect(capabilities.registerAudio(6, '/media/stale.mp3', ownerOneAudio)).toBeNull()
    expect(capabilities.registerAudio(6, '/media/new.mp3', newAudioSequence)).not.toBeNull()
  })
})

describe('project-open media authorization', () => {
  function coordinator(options: { validateScope?: () => boolean } = {}) {
    const capabilities = registry()
    const commits = vi.fn((ownerId: number, scope: ReturnType<typeof prepareProjectMedia>) =>
      capabilities.replaceProjectScope(ownerId, scope.projectPath, {
        audio: scope.audioPath,
        background: scope.backgroundPath,
      }),
    )
    const opens = createProjectOpenCoordinator({
      createRequestId: tokenFactory(),
      prepareScope: (
        _ownerId: number,
        scope: { path: string; project: ReturnType<typeof createProject> },
      ) => prepareProjectMedia(scope.path, scope.project, new Set(['.mp3'])),
      validateScope: options.validateScope ?? (() => true),
      commitScope: commits,
      resetScope: (ownerId: number) => {
        capabilities.releaseOwner(ownerId)
        return true
      },
    })
    return { capabilities, commits, opens }
  }

  async function stageAndAccept(
    opens: any,
    ownerId: number,
    projectPath: string,
    project: ReturnType<typeof createProject>,
  ) {
    const requestId = opens.beginOpen(ownerId)
    opens.stageOpen(ownerId, requestId, projectPath, serializeProject(project))
    return opens.settleOpen(ownerId, requestId, true)
  }

  it('grants no media authority for malformed, declined, or failed-revalidation opens', async () => {
    const malformed = coordinator()
    const malformedRequest = malformed.opens.beginOpen(8)
    expect(() =>
      malformed.opens.stageOpen(8, malformedRequest, '/projects/bad.oks', '{bad'),
    ).toThrow('Invalid project JSON')
    expect(
      malformed.capabilities.beginRestore(8, 'background', '/projects/bad.oks').authorized,
    ).toBe(false)

    const declined = coordinator()
    const declinedRequest = declined.opens.beginOpen(8)
    declined.opens.stageOpen(
      8,
      declinedRequest,
      '/projects/declined.oks',
      serializeProject(projectWithBackground('Declined', '/media/declined.png')),
    )
    expect(await declined.opens.settleOpen(8, declinedRequest, false)).toBe(true)
    expect(
      declined.capabilities.beginRestore(8, 'background', '/projects/declined.oks').authorized,
    ).toBe(false)

    const changed = coordinator({ validateScope: () => false })
    expect(
      await stageAndAccept(
        changed.opens,
        8,
        '/projects/changed.oks',
        projectWithBackground('Changed', '/media/changed.png'),
      ),
    ).toBe(false)
    expect(changed.commits).not.toHaveBeenCalled()
    expect(
      changed.capabilities.beginRestore(8, 'background', '/projects/changed.oks').authorized,
    ).toBe(false)
  })

  it('authorizes only accepted B and ignores late A restoration without consuming B', async () => {
    const { capabilities, opens } = coordinator()
    const imagePathA = resolve('/media/a.png')
    const imagePathB = resolve('/media/b.jpg')
    const projectA = projectWithBackground('A', imagePathA, 'a.mp3')
    const projectB = projectWithBackground('B', imagePathB, 'b.mp3')
    const initialRevision = capabilities.backgroundState(9).revision
    expect(await stageAndAccept(opens, 9, '/projects/a.oks', projectA)).toBe(true)
    expect(capabilities.backgroundState(9).revision).not.toBe(initialRevision)
    const restoreA = capabilities.beginRestore(9, 'background', '/projects/a.oks')
    expect(restoreA).toMatchObject({ authorized: true, filePath: imagePathA })

    expect(await stageAndAccept(opens, 9, '/projects/b.oks', projectB)).toBe(true)
    const projectBRevision = capabilities.backgroundState(9).revision
    expect(
      capabilities.registerRestoredBackground(9, restoreA.filePath, image(100), restoreA.sequence),
    ).toBeNull()
    const staleA = capabilities.beginRestore(9, 'background', '/projects/a.oks')
    expect(staleA.authorized).toBe(false)

    const restoreB = capabilities.beginRestore(9, 'background', '/projects/b.oks')
    expect(restoreB).toMatchObject({ authorized: true, filePath: imagePathB })
    expect(releaseCurrent(capabilities, 9, null)).toBe(false)
    const backgroundB = capabilities.registerRestoredBackground(
      9,
      restoreB.filePath,
      image(110, 'image/jpeg'),
      restoreB.sequence,
    )
    expect(capabilities.activeToken(9, 'background')).toBe(backgroundB)
    expect(capabilities.backgroundState(9).revision).not.toBe(projectBRevision)
    const audioB = capabilities.beginRestore(9, 'audio', '/projects/b.oks')
    expect(audioB).toMatchObject({ authorized: true, filePath: resolve('/projects/b.mp3') })
    expect(capabilities.beginRestore(9, 'audio', '/projects/b.oks').authorized).toBe(false)
  })

  it('preserves project audio through chooser failure and consumes it on replacement', async () => {
    const { capabilities, opens } = coordinator()
    const projectPath = '/projects/audio-chooser.oks'
    const project = projectWithBackground('Audio chooser', '/media/background.png', 'project.mp3')
    const acceptProject = () => stageAndAccept(opens, 16, projectPath, project)

    expect(await acceptProject()).toBe(true)
    const cancelled = capabilities.beginRequest(16, 'audio')
    expect(capabilities.finishRequest(16, 'audio', cancelled)).toBe(true)
    expect(capabilities.beginRestore(16, 'audio', projectPath).authorized).toBe(true)

    expect(await acceptProject()).toBe(true)
    const invalid = capabilities.beginRequest(16, 'audio')
    expect(capabilities.finishRequest(16, 'audio', invalid)).toBe(true)
    expect(capabilities.beginRestore(16, 'audio', projectPath).authorized).toBe(true)

    expect(await acceptProject()).toBe(true)
    const replacement = capabilities.beginRequest(16, 'audio')
    expect(capabilities.registerAudio(16, '/media/replacement.mp3', replacement)).not.toBeNull()
    expect(capabilities.beginRestore(16, 'audio', projectPath).authorized).toBe(false)
    expect(capabilities.beginRestore(16, 'background', projectPath).authorized).toBe(true)
  })

  it('lets only the exact current generation settle prepared restoration by whole release', async () => {
    const { capabilities, opens } = coordinator()
    const ownerId = 18
    const projectPath = '/projects/clear-restoration.oks'
    const project = projectWithBackground('Clear restoration', '/media/project.png', 'project.mp3')
    const other = retainedBackground(capabilities, 19, '/media/other.png', image(180))
    const acceptProject = () => stageAndAccept(opens, ownerId, projectPath, project)
    const releaseFrom = (state: { activeToken: string | null; revision: string }) => {
      const request = normalizeBackgroundMutationRequest(
        {
          expected: {
            activeUrl: state.activeToken ? `studio-media://asset/${state.activeToken}` : null,
            revision: state.revision,
          },
        },
        'none',
      )
      expect(request.valid).toBe(true)
      return capabilities.releaseKind(
        ownerId,
        'background',
        request.expectedRevision,
        request.expectedToken,
      )
    }

    const beforeProject = capabilities.backgroundState(ownerId)
    expect(await acceptProject()).toBe(true)
    const prepared = capabilities.backgroundState(ownerId)
    expect(releaseFrom(beforeProject)).toBe(false)
    expect(releaseFrom(prepared)).toBe(true)
    expect(capabilities.beginRestore(ownerId, 'background', projectPath).authorized).toBe(false)

    expect(await acceptProject()).toBe(true)
    const pendingState = capabilities.backgroundState(ownerId)
    const pending = capabilities.beginRestore(ownerId, 'background', projectPath)
    expect(releaseFrom(pendingState)).toBe(false)
    expect(capabilities.finishRequest(ownerId, 'background', pending.sequence)).toBe(true)
    expect(releaseFrom(pendingState)).toBe(true)
    expect(capabilities.beginRestore(ownerId, 'background', projectPath).authorized).toBe(false)

    expect(await acceptProject()).toBe(true)
    const candidateState = capabilities.backgroundState(ownerId)
    expect(
      normalizeBackgroundMutationRequest(
        { expected: { activeUrl: null, revision: 'malformed' } },
        'none',
      ).valid,
    ).toBe(false)
    const audioSequence = capabilities.beginRequest(ownerId, 'audio')
    const audio = capabilities.registerAudio(ownerId, '/media/replacement.mp3', audioSequence)
    const candidateSequence = capabilities.beginRequest(ownerId, 'background')
    const candidate = capabilities.registerBackgroundCandidate(
      ownerId,
      '/media/candidate.png',
      image(181),
      candidateSequence,
    )
    expect(releaseFrom(candidateState)).toBe(false)
    expect(capabilities.settleBackgroundCandidate(ownerId, candidate, false)).toBe(true)
    expect(releaseFrom(candidateState)).toBe(true)
    expect(capabilities.get(audio)).not.toBeNull()
    expect(capabilities.get(other)).not.toBeNull()
  })

  it('preserves exact restoration through chooser failures and blocks stale null release', async () => {
    const { capabilities, opens } = coordinator()
    const projectPath = '/projects/rearm.oks'
    const imagePath = resolve('/media/rearm.png')
    const staleNull = capabilities.backgroundState(13)
    expect(
      await stageAndAccept(opens, 13, projectPath, projectWithBackground('Rearm', imagePath)),
    ).toBe(true)
    expect(capabilities.releaseKind(13, 'background', staleNull.revision, null)).toBe(false)
    expect(retainCurrent(capabilities, 13, null, null)).toBe(false)

    const cancelled = capabilities.beginRequest(13, 'background')
    expect(capabilities.finishRequest(13, 'background', cancelled)).toBe(true)
    const staleRestore = capabilities.beginRestore(13, 'background', projectPath)
    const invalidChooser = capabilities.beginRequest(13, 'background')
    expect(capabilities.finishRequest(13, 'background', invalidChooser)).toBe(true)
    expect(
      capabilities.registerRestoredBackground(
        13,
        staleRestore.filePath,
        image(130),
        staleRestore.sequence,
      ),
    ).toBeNull()

    const declinedSequence = capabilities.beginRequest(13, 'background')
    const declined = capabilities.registerBackgroundCandidate(
      13,
      '/media/declined.png',
      image(131),
      declinedSequence,
    )
    expect(capabilities.settleBackgroundCandidate(13, declined, false)).toBe(true)
    const restored = capabilities.beginRestore(13, 'background', projectPath)
    expect(restored).toMatchObject({ authorized: true, filePath: imagePath })
    expect(
      capabilities.registerRestoredBackground(13, restored.filePath, image(132), restored.sequence),
    ).not.toBeNull()
    expect(capabilities.beginRestore(13, 'background', projectPath).authorized).toBe(false)
  })

  it('consumes only current authorization when a candidate is accepted', async () => {
    const { capabilities, opens } = coordinator()
    const projectPath = '/projects/candidate.oks'
    expect(
      await stageAndAccept(
        opens,
        14,
        projectPath,
        projectWithBackground('Candidate', '/media/project.png'),
      ),
    ).toBe(true)
    const sequence = capabilities.beginRequest(14, 'background')
    const candidate = capabilities.registerBackgroundCandidate(
      14,
      '/media/chosen.png',
      image(140),
      sequence,
    )
    expect(capabilities.settleBackgroundCandidate(14, candidate, true)).toBe(true)
    expect(capabilities.beginRestore(14, 'background', projectPath).authorized).toBe(false)
  })

  it('authorizes an exact missing image path without rejecting the valid project', async () => {
    const { capabilities, opens } = coordinator()
    const missingPath = resolve('/private/missing-background.png')
    expect(
      await stageAndAccept(
        opens,
        10,
        '/projects/missing.oks',
        projectWithBackground('Missing', missingPath),
      ),
    ).toBe(true)
    const restoration = capabilities.beginRestore(10, 'background', '/projects/missing.oks')
    expect(restoration).toMatchObject({
      authorized: true,
      filePath: missingPath,
    })
    expect(capabilities.requestIsCurrent(10, 'background', restoration.sequence)).toBe(true)
  })
})
