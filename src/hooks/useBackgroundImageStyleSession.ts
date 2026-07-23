import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundStyle } from '../lib/video-style'
import type { ProjectStyleSession } from './useProjectStyleSession'
import type {
  BackgroundImageLoadStatus,
  BackgroundImagePreviewSource,
  ProjectBackgroundImageController,
} from './useProjectBackgroundImage'

interface StyleBackgroundBaseline {
  readonly background: BackgroundStyle
  readonly capability: StudioBackgroundCapabilityState | null
}

interface BackgroundCandidate {
  readonly generation: number
  readonly loadStatus: Exclude<BackgroundImageLoadStatus, 'idle'>
  readonly path: string
  readonly previousUrl: string | null
  readonly reloadKey: number
  readonly url: string
}

type BackgroundOperation = 'apply' | 'cancel' | 'choose' | 'clear' | 'load-template'

export type StyleTemplateBackgroundPreparationResult =
  | { readonly status: 'success' | 'missing'; readonly path: string }
  | { readonly status: 'cleared' }
  | { readonly status: 'stale' }

export interface BackgroundImageStyleControls {
  readonly applyBlockedReason: string | null
  readonly available: boolean
  readonly busy: boolean
  readonly canRetryPreview: boolean
  readonly message: string | null
  choose(): Promise<void>
  clear(): Promise<void>
  retryPreview(): void
}

export interface BackgroundImageStyleSession {
  readonly controls: BackgroundImageStyleControls
  readonly preview: BackgroundImagePreviewSource
  apply(): Promise<boolean>
  cancel(): Promise<boolean>
  prepareTemplateBackground(
    templateId: string | null,
  ): Promise<StyleTemplateBackgroundPreparationResult>
  start(trigger: HTMLElement): void
}

function isAbsoluteLinkedPath(value: string): boolean {
  return value.startsWith('/') || /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\')
}

export function useBackgroundImageStyleSession({
  backgroundImages,
  session,
  sourceBackground,
}: {
  backgroundImages: ProjectBackgroundImageController
  session: ProjectStyleSession
  sourceBackground: BackgroundStyle
}): BackgroundImageStyleSession {
  const studio = window.studio
  const [candidate, setStoredCandidate] = useState<BackgroundCandidate | null>(null)
  const [operation, setStoredOperation] = useState<BackgroundOperation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const candidateRef = useRef(candidate)
  const operationRef = useRef<BackgroundOperation | null>(operation)
  const baselineRef = useRef<StyleBackgroundBaseline | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const sessionRef = useRef(session)
  const sourceBackgroundRef = useRef(sourceBackground)
  sessionRef.current = session
  sourceBackgroundRef.current = sourceBackground

  const publishCandidate = useCallback((next: BackgroundCandidate | null) => {
    candidateRef.current = next
    if (mountedRef.current) setStoredCandidate(next)
  }, [])

  const beginOperation = useCallback((next: BackgroundOperation) => {
    if (operationRef.current) return null
    operationRef.current = next
    const generation = generationRef.current + 1
    generationRef.current = generation
    if (mountedRef.current) setStoredOperation(next)
    return generation
  }, [])

  const finishOperation = useCallback((expected: BackgroundOperation, generation: number) => {
    if (operationRef.current !== expected || generationRef.current !== generation) return
    operationRef.current = null
    if (mountedRef.current) setStoredOperation(null)
  }, [])

  const abandonCandidate = useCallback(
    (staleCandidate: BackgroundCandidate | null) => {
      if (!staleCandidate || !studio?.settleBackgroundImage) return
      void studio.settleBackgroundImage(staleCandidate.url, false).catch(() => null)
    },
    [studio],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      operationRef.current = null
      abandonCandidate(candidateRef.current)
      candidateRef.current = null
    }
  }, [abandonCandidate])

  const wasOpenRef = useRef(session.isOpen)
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = session.isOpen
    if (session.isOpen || !wasOpen) return
    generationRef.current += 1
    if (operationRef.current !== 'apply' && operationRef.current !== 'cancel') {
      abandonCandidate(candidateRef.current)
    }
    candidateRef.current = null
    baselineRef.current = null
    operationRef.current = null
    setStoredCandidate(null)
    setStoredOperation(null)
    setMessage(null)
  }, [abandonCandidate, session.isOpen])

  const start = useCallback(
    (trigger: HTMLElement) => {
      if (!backgroundImages.ready || operationRef.current) return
      generationRef.current += 1
      abandonCandidate(candidateRef.current)
      publishCandidate(null)
      setMessage(null)
      baselineRef.current = {
        background: { ...sourceBackgroundRef.current },
        capability: backgroundImages.getCapability(),
      }
      sessionRef.current.start(trigger)
    },
    [abandonCandidate, backgroundImages, publishCandidate],
  )

  const restoreCandidateDraft = useCallback((baseline: StyleBackgroundBaseline) => {
    if (!sessionRef.current.isOpen) return
    sessionRef.current.change((current) => {
      const background = current.stageStyle.background
      return {
        ...current,
        stageStyle: {
          ...current.stageStyle,
          background: {
            ...background,
            imagePath: baseline.background.imagePath,
            mode: background.mode === 'image' ? baseline.background.mode : background.mode,
          },
        },
      }
    })
  }, [])

  const rejectCandidate = useCallback(
    async (selected: BackgroundCandidate) => {
      if (!studio?.settleBackgroundImage) return false
      try {
        const state = await studio.settleBackgroundImage(selected.url, false)
        if (state) {
          backgroundImages.setCapability(state)
          return true
        }
        return Boolean(await backgroundImages.reconcileCapability())
      } catch {
        return false
      }
    },
    [backgroundImages, studio],
  )

  const choose = useCallback(async () => {
    if (
      !sessionRef.current.isOpen ||
      !baselineRef.current ||
      !studio?.chooseBackgroundImage ||
      !studio.settleBackgroundImage
    )
      return
    const generation = beginOperation('choose')
    if (generation === null) return
    setMessage(null)
    try {
      const result = await studio.chooseBackgroundImage()
      if (
        generation !== generationRef.current ||
        !mountedRef.current ||
        !sessionRef.current.isOpen
      ) {
        if (result) void studio.settleBackgroundImage(result.url, false).catch(() => null)
        return
      }
      if (!result) return
      if (!isAbsoluteLinkedPath(result.path)) {
        await studio.settleBackgroundImage(result.url, false).catch(() => null)
        setMessage('The image could not be linked. Choose a PNG or JPEG and try again.')
        return
      }
      const next: BackgroundCandidate = {
        generation,
        loadStatus: 'loading',
        path: result.path,
        previousUrl: backgroundImages.urlForPath(result.path),
        reloadKey: 0,
        url: result.url,
      }
      publishCandidate(next)
      sessionRef.current.change((current) => ({
        ...current,
        stageStyle: {
          ...current.stageStyle,
          background: { ...current.stageStyle.background, imagePath: result.path, mode: 'image' },
        },
      }))
    } catch {
      if (generation === generationRef.current && mountedRef.current) {
        setMessage('The image could not be linked. Choose a PNG or JPEG and try again.')
      }
    } finally {
      finishOperation('choose', generation)
    }
  }, [backgroundImages, beginOperation, finishOperation, publishCandidate, studio])

  const prepareTemplateBackground = useCallback(
    async (templateId: string | null): Promise<StyleTemplateBackgroundPreparationResult> => {
      if (
        !sessionRef.current.isOpen ||
        !baselineRef.current ||
        (templateId !== null && !studio?.resolveStyleTemplateBackground)
      ) {
        return { status: 'stale' }
      }
      const generation = beginOperation('load-template')
      if (generation === null) return { status: 'stale' }
      const previous = candidateRef.current
      setMessage(null)
      try {
        if (previous && !(await rejectCandidate(previous))) {
          throw new Error('Candidate rejection could not be verified')
        }
        if (
          generation !== generationRef.current ||
          !mountedRef.current ||
          !sessionRef.current.isOpen
        ) {
          return { status: 'stale' }
        }
        publishCandidate(null)
        if (templateId === null) return { status: 'cleared' }
        if (!studio?.resolveStyleTemplateBackground) return { status: 'stale' }
        const result = await studio.resolveStyleTemplateBackground(templateId)
        if (
          generation !== generationRef.current ||
          !mountedRef.current ||
          !sessionRef.current.isOpen
        ) {
          if (result.status === 'success') {
            void studio.settleBackgroundImage?.(result.media.url, false).catch(() => null)
          }
          return { status: 'stale' }
        }
        if (result.status === 'stale') return result
        if (result.status === 'missing') {
          // A fresh main-process read failed. Do not let an older retained
          // snapshot for this path make the linked template export-ready.
          const priorUrl = backgroundImages.urlForPath(result.path)
          if (priorUrl) backgroundImages.forgetSnapshot(result.path, priorUrl)
          return result
        }
        const next: BackgroundCandidate = {
          generation,
          loadStatus: 'loading',
          path: result.media.path,
          previousUrl: backgroundImages.urlForPath(result.media.path),
          reloadKey: 0,
          url: result.media.url,
        }
        publishCandidate(next)
        return { status: 'success', path: result.media.path }
      } catch {
        if (generation === generationRef.current && mountedRef.current) {
          setMessage(
            'The saved template image could not be linked. Try loading the template again.',
          )
        }
        return { status: 'stale' }
      } finally {
        finishOperation('load-template', generation)
      }
    },
    [backgroundImages, beginOperation, finishOperation, publishCandidate, rejectCandidate, studio],
  )

  const clear = useCallback(async () => {
    if (!sessionRef.current.isOpen) return
    const generation = beginOperation('clear')
    if (generation === null) return
    const selected = candidateRef.current
    setMessage(null)
    try {
      if (selected && !(await rejectCandidate(selected))) {
        throw new Error('Candidate rejection could not be verified')
      }
      if (generation !== generationRef.current || !sessionRef.current.isOpen) return
      publishCandidate(null)
      sessionRef.current.change((current) => {
        const background = current.stageStyle.background
        return {
          ...current,
          stageStyle: {
            ...current.stageStyle,
            background: {
              ...background,
              imagePath: null,
              mode: background.mode === 'image' ? 'gradient' : background.mode,
            },
          },
        }
      })
    } catch {
      if (generation === generationRef.current && mountedRef.current) {
        setMessage('The image change could not be cleared. Try again before closing Style.')
      }
    } finally {
      finishOperation('clear', generation)
    }
  }, [beginOperation, finishOperation, publishCandidate, rejectCandidate])

  const retryPreview = useCallback(() => {
    if (operationRef.current) return
    const current = candidateRef.current
    if (!current) return
    publishCandidate({ ...current, loadStatus: 'loading', reloadKey: current.reloadKey + 1 })
    setMessage(null)
  }, [publishCandidate])

  const draftBackground = session.draft?.stageStyle.background ?? sourceBackground
  const candidateIsTarget = Boolean(
    candidate && draftBackground.mode === 'image' && draftBackground.imagePath === candidate.path,
  )
  const candidatePreview =
    candidate && candidateIsTarget
      ? {
          url: candidate.url,
          resolutionStatus: 'available' as const,
          reloadKey: candidate.reloadKey,
          onRetryLoad: retryPreview,
          onLoadStatusChange: (
            loadedUrl: string,
            status: Exclude<BackgroundImageLoadStatus, 'idle'>,
          ) => {
            const current = candidateRef.current
            if (
              !current ||
              current.generation !== candidate.generation ||
              current.url !== loadedUrl
            )
              return
            publishCandidate({ ...current, loadStatus: status })
          },
        }
      : null
  const preview = candidatePreview ?? backgroundImages.sourceFor(draftBackground)

  const transitionCapability = useCallback(
    async (
      initial: StudioBackgroundCapabilityState | null,
      targetUrl: string | null,
    ): Promise<StudioBackgroundCapabilityState | null> => {
      if (!studio?.retainBackground) return initial?.activeUrl === targetUrl ? initial : null
      let current = initial ?? (await backgroundImages.reconcileCapability())
      for (let attempt = 0; attempt < 2 && current; attempt += 1) {
        if (current.activeUrl === targetUrl) return current
        try {
          const next = await studio.retainBackground(current, targetUrl)
          if (next) {
            backgroundImages.setCapability(next)
            return next
          }
        } catch {
          // Reconcile a failed compare-and-swap before one bounded retry.
        }
        current = await backgroundImages.reconcileCapability()
      }
      return current?.activeUrl === targetUrl ? current : null
    },
    [backgroundImages, studio],
  )

  const releaseSnapshot = useCallback(
    async (initial: StudioBackgroundCapabilityState | null, snapshotUrl: string) => {
      if (!studio?.releaseBackgroundSnapshot) return initial
      let current = initial ?? (await backgroundImages.reconcileCapability())
      for (let attempt = 0; attempt < 2 && current; attempt += 1) {
        if (current.activeUrl === snapshotUrl) return null
        try {
          const next = await studio.releaseBackgroundSnapshot(current, snapshotUrl)
          if (next) {
            backgroundImages.setCapability(next)
            return next
          }
        } catch {
          // Reconcile a failed compare-and-swap before one bounded retry.
        }
        current = await backgroundImages.reconcileCapability()
      }
      return null
    },
    [backgroundImages, studio],
  )

  const restorePromotedCandidate = useCallback(
    async (
      baseline: StyleBackgroundBaseline,
      promoted: BackgroundCandidate,
      current: StudioBackgroundCapabilityState | null,
    ) => {
      const restored = await transitionCapability(current, baseline.capability?.activeUrl ?? null)
      const released = restored ? await releaseSnapshot(restored, promoted.url) : null
      if (released) {
        backgroundImages.forgetSnapshot(promoted.path, promoted.url)
        if (promoted.previousUrl) {
          backgroundImages.rememberSnapshot(promoted.path, promoted.previousUrl, released)
        }
      }
      return restored
    },
    [backgroundImages, releaseSnapshot, transitionCapability],
  )

  const apply = useCallback(async () => {
    const activeSession = sessionRef.current
    const baseline = baselineRef.current
    if (!activeSession.isOpen || !baseline) return false
    const selected = candidateRef.current
    const initialDraft = activeSession.draft
    if (!initialDraft) return false
    const targetCandidate =
      selected &&
      initialDraft.stageStyle.background.mode === 'image' &&
      initialDraft.stageStyle.background.imagePath === selected.path
        ? selected
        : null
    if (targetCandidate && targetCandidate.loadStatus !== 'ready') {
      setMessage(
        targetCandidate.loadStatus === 'error'
          ? 'The selected image could not be previewed. Retry or choose another image.'
          : 'Wait for the selected image preview to finish loading.',
      )
      return false
    }
    const generation = beginOperation('apply')
    if (generation === null) return false
    const settlement = backgroundImages.beginSettlement()
    if (settlement === null) {
      finishOperation('apply', generation)
      return false
    }
    let currentCapability = backgroundImages.getCapability()
    let promoted: BackgroundCandidate | null = null
    let discardVerified = !selected
    setMessage(null)

    try {
      if (targetCandidate) {
        if (!studio?.settleBackgroundImage) throw new Error('Background bridge unavailable')
        const next = await studio.settleBackgroundImage(targetCandidate.url, true)
        if (!next) {
          discardVerified = Boolean(await backgroundImages.reconcileCapability())
          throw new Error('Background candidate is stale')
        }
        currentCapability = next
        promoted = targetCandidate
        discardVerified = true
        publishCandidate(null)
        backgroundImages.rememberSnapshot(targetCandidate.path, targetCandidate.url, next)
      } else if (selected) {
        discardVerified = await rejectCandidate(selected)
        if (!discardVerified) throw new Error('Candidate rejection could not be verified')
        publishCandidate(null)
        restoreCandidateDraft(baseline)
      }

      const draft = sessionRef.current.draft
      if (!draft) throw new Error('Style draft is stale')
      const background = draft.stageStyle.background
      const targetUrl =
        background.mode === 'image' ? backgroundImages.urlForPath(background.imagePath) : null
      if (studio?.retainBackground) {
        currentCapability = await transitionCapability(currentCapability, targetUrl)
        if (!currentCapability) throw new Error('Background capability could not be settled')
      }

      if (!sessionRef.current.apply()) {
        if (promoted) {
          currentCapability = await restorePromotedCandidate(baseline, promoted, currentCapability)
          restoreCandidateDraft(baseline)
        } else if (studio?.retainBackground) {
          currentCapability = await transitionCapability(
            currentCapability,
            baseline.capability?.activeUrl ?? null,
          )
        }
        setMessage('The image change could not be applied. The project Style was not changed.')
        return false
      }

      baselineRef.current = null
      if (promoted?.previousUrl && promoted.previousUrl !== promoted.url && currentCapability) {
        await releaseSnapshot(currentCapability, promoted.previousUrl)
      }
      return true
    } catch {
      if (promoted) {
        await restorePromotedCandidate(baseline, promoted, currentCapability)
        restoreCandidateDraft(baseline)
        publishCandidate(null)
      } else if (selected && !discardVerified) {
        discardVerified = await rejectCandidate(selected)
        if (discardVerified) {
          restoreCandidateDraft(baseline)
          publishCandidate(null)
        }
      } else if (selected) {
        restoreCandidateDraft(baseline)
        publishCandidate(null)
      }
      if (generation === generationRef.current && mountedRef.current) {
        setMessage('The image change could not be applied. The project Style was not changed.')
      }
      return false
    } finally {
      backgroundImages.endSettlement(settlement)
      finishOperation('apply', generation)
    }
  }, [
    backgroundImages,
    beginOperation,
    finishOperation,
    publishCandidate,
    rejectCandidate,
    releaseSnapshot,
    restoreCandidateDraft,
    restorePromotedCandidate,
    studio,
    transitionCapability,
  ])

  const cancel = useCallback(async () => {
    if (!sessionRef.current.isOpen) return false
    const generation = beginOperation('cancel')
    if (generation === null) return false
    const selected = candidateRef.current
    setMessage(null)
    try {
      if (selected && !(await rejectCandidate(selected))) {
        throw new Error('Candidate rejection could not be verified')
      }
      if (generation !== generationRef.current) return false
      publishCandidate(null)
      const settled = sessionRef.current.cancel()
      if (settled) baselineRef.current = null
      return settled
    } catch {
      if (generation === generationRef.current && mountedRef.current) {
        setMessage('The image change could not be discarded. Try again before closing Style.')
      }
      return false
    } finally {
      finishOperation('cancel', generation)
    }
  }, [beginOperation, finishOperation, publishCandidate, rejectCandidate])

  const applyBlockedReason = !backgroundImages.ready
    ? 'Wait for the linked background to finish restoring.'
    : operation !== null
      ? 'Wait for the current image action to finish.'
      : draftBackground.mode === 'image' && !draftBackground.imagePath
        ? 'Choose a linked image before applying Image background mode.'
        : candidateIsTarget && candidate?.loadStatus === 'loading'
          ? 'Wait for the selected image preview to finish loading.'
          : candidateIsTarget && candidate?.loadStatus === 'error'
            ? 'Retry the selected image preview or choose another image.'
            : null
  const available = Boolean(
    studio &&
    typeof studio.chooseBackgroundImage === 'function' &&
    typeof studio.settleBackgroundImage === 'function' &&
    typeof studio.getBackgroundState === 'function' &&
    typeof studio.retainBackground === 'function' &&
    typeof studio.releaseBackgroundSnapshot === 'function',
  )

  return {
    controls: {
      applyBlockedReason,
      available,
      busy: operation !== null,
      canRetryPreview: Boolean(candidateIsTarget && candidate?.loadStatus === 'error'),
      message,
      choose,
      clear,
      retryPreview,
    },
    preview,
    apply,
    cancel,
    prepareTemplateBackground,
    start,
  }
}
