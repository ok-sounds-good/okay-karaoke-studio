import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackgroundStyle } from '../lib/video-style'

export type BackgroundImageResolutionStatus = 'none' | 'loading' | 'available' | 'missing' | 'error'
export type BackgroundImageLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface BackgroundImagePreviewSource {
  readonly url: string | null
  readonly resolutionStatus: BackgroundImageResolutionStatus
  readonly reloadKey?: number
  readonly onLoadStatusChange?: (
    url: string,
    status: Exclude<BackgroundImageLoadStatus, 'idle'>,
  ) => void
  readonly onRetryLoad?: () => void
  readonly onRetryResolution?: () => void
}

interface RetainedBackgroundSnapshot {
  readonly path: string
  readonly url: string
}

interface ProjectBackgroundResource {
  readonly capability: StudioBackgroundCapabilityState | null
  readonly failedIntent?: string
  readonly lifecycle: number
  readonly linkedPath: string | null
  readonly ready: boolean
  readonly resolutionStatus: BackgroundImageResolutionStatus
  readonly retained: readonly RetainedBackgroundSnapshot[]
}

export interface ProjectBackgroundImageController {
  readonly preview: BackgroundImagePreviewSource
  readonly ready: boolean
  beginSettlement(): number | null
  endSettlement(settlement: number): boolean
  forgetSnapshot(path: string, url: string): boolean
  getCapability(): StudioBackgroundCapabilityState | null
  reconcileCapability(): Promise<StudioBackgroundCapabilityState | null>
  rememberSnapshot(path: string, url: string, capability?: StudioBackgroundCapabilityState): boolean
  setCapability(capability: StudioBackgroundCapabilityState): boolean
  sourceFor(background: BackgroundStyle): BackgroundImagePreviewSource
  urlForPath(path: string | null): string | null
}

export type ProjectBackgroundImagePreview = ProjectBackgroundImageController

function retainedForPath(
  retained: readonly RetainedBackgroundSnapshot[],
  path: string | null,
): RetainedBackgroundSnapshot | null {
  return path ? (retained.find((snapshot) => snapshot.path === path) ?? null) : null
}

function withRetainedSnapshot(
  retained: readonly RetainedBackgroundSnapshot[],
  snapshot: RetainedBackgroundSnapshot,
): readonly RetainedBackgroundSnapshot[] {
  return [...retained.filter(({ path }) => path !== snapshot.path), snapshot]
}

function previewStatus(
  background: BackgroundStyle,
  url: string | null,
  fallback: BackgroundImageResolutionStatus,
): BackgroundImageResolutionStatus {
  if (background.mode !== 'image') return 'none'
  if (!background.imagePath) return 'missing'
  if (url) return 'available'
  return fallback === 'loading' || fallback === 'error' ? fallback : 'missing'
}

function backgroundIntent(background: BackgroundStyle): string {
  return background.mode === 'image' ? `image:${background.imagePath ?? ''}` : 'no-image'
}

export function useProjectBackgroundImage({
  acceptedProjectPath,
  background,
  lifecycle,
  reachableImagePaths,
}: {
  acceptedProjectPath: string | null
  background: BackgroundStyle
  lifecycle: number
  reachableImagePaths: readonly string[]
}): ProjectBackgroundImageController {
  const studio = window.studio
  const initialReady = !studio?.getBackgroundState
  const [resource, setStoredResource] = useState<ProjectBackgroundResource>({
    capability: null,
    lifecycle,
    linkedPath: acceptedProjectPath && background.mode === 'image' ? background.imagePath : null,
    ready: initialReady,
    resolutionStatus:
      initialReady && background.mode === 'image' ? 'missing' : initialReady ? 'none' : 'loading',
    retained: [],
  })
  const resourceRef = useRef(resource)
  const requestGenerationRef = useRef(0)
  const reconciliationGenerationRef = useRef(0)
  const reconciliationInFlightRef = useRef<number | null>(null)
  const snapshotReleaseRef = useRef<{ lifecycle: number; path: string; url: string } | null>(null)
  const snapshotReleaseFailuresRef = useRef(new Map<string, string>())
  const settlementRef = useRef<{ id: number; lifecycle: number } | null>(null)
  const settlementSequenceRef = useRef(0)
  const currentRef = useRef({ acceptedProjectPath, background, lifecycle })
  currentRef.current = { acceptedProjectPath, background, lifecycle }
  const reachableImagePathsRef = useRef<ReadonlySet<string>>(new Set())
  reachableImagePathsRef.current = new Set(reachableImagePaths)

  const publish = useCallback((next: ProjectBackgroundResource) => {
    resourceRef.current = next
    setStoredResource(next)
  }, [])

  const resolveCurrentProjectBackground = useCallback(
    async (resetRetained: boolean) => {
      const request = currentRef.current
      const generation = requestGenerationRef.current + 1
      requestGenerationRef.current = generation
      reconciliationGenerationRef.current += 1
      reconciliationInFlightRef.current = null
      const retained = resetRetained ? [] : resourceRef.current.retained
      const linkedPath = resetRetained
        ? request.acceptedProjectPath && request.background.mode === 'image'
          ? request.background.imagePath
          : null
        : resourceRef.current.linkedPath
      const isCurrent = () =>
        generation === requestGenerationRef.current &&
        request.lifecycle === currentRef.current.lifecycle
      const finish = (
        capability: StudioBackgroundCapabilityState | null,
        resolutionStatus: BackgroundImageResolutionStatus,
        nextRetained: readonly RetainedBackgroundSnapshot[] = retained,
      ) => {
        if (!isCurrent()) return false
        publish({
          capability,
          lifecycle: request.lifecycle,
          linkedPath,
          ready: true,
          resolutionStatus,
          retained: nextRetained,
        })
        return true
      }
      publish({
        capability: resetRetained ? null : resourceRef.current.capability,
        lifecycle: request.lifecycle,
        linkedPath,
        ready: false,
        resolutionStatus: request.background.mode === 'image' ? 'loading' : 'none',
        retained,
      })

      if (!studio?.getBackgroundState) {
        finish(null, request.background.mode === 'image' ? 'missing' : 'none')
        return
      }

      try {
        if (
          request.background.mode === 'image' &&
          request.background.imagePath &&
          request.acceptedProjectPath &&
          studio.resolveProjectBackground
        ) {
          const restored = await studio.resolveProjectBackground(request.acceptedProjectPath)
          if (!isCurrent()) return
          if (restored.status === 'success') {
            // Main authorizes this result from the accepted project scope and may
            // native-normalize its path. Bind the URL to the serialized intent
            // whose trusted restore produced it instead of comparing raw strings.
            finish(
              restored.state,
              'available',
              withRetainedSnapshot(retained, {
                path: request.background.imagePath,
                url: restored.media.url,
              }),
            )
            return
          }
          if (restored.status === 'missing') {
            finish(restored.state, 'missing')
            return
          }
        }

        const capability = await studio.getBackgroundState()
        finish(capability, request.background.mode === 'image' ? 'missing' : 'none')
      } catch {
        if (!isCurrent()) return
        try {
          const capability = await studio.getBackgroundState()
          finish(capability, 'error')
        } catch {
          finish(null, 'error')
        }
      }
    },
    [publish, studio],
  )

  useEffect(() => {
    void resolveCurrentProjectBackground(true)
    return () => {
      requestGenerationRef.current += 1
      reconciliationGenerationRef.current += 1
      reconciliationInFlightRef.current = null
      snapshotReleaseRef.current = null
      snapshotReleaseFailuresRef.current.clear()
      settlementRef.current = null
    }
  }, [acceptedProjectPath, lifecycle, resolveCurrentProjectBackground])

  const retryResolution = useCallback(() => {
    void resolveCurrentProjectBackground(false)
  }, [resolveCurrentProjectBackground])

  const reconciliationIsCurrent = useCallback(
    (generation: number) =>
      generation === reconciliationGenerationRef.current &&
      currentRef.current.lifecycle === lifecycle,
    [lifecycle],
  )

  const refreshCapability = useCallback(
    async (generation: number, pauseAfterRefresh: boolean, attemptedIntent: string) => {
      if (!studio?.getBackgroundState) return
      try {
        const capability = await studio.getBackgroundState()
        if (!reconciliationIsCurrent(generation)) return
        reconciliationInFlightRef.current = null
        const current = resourceRef.current
        const currentBackground = currentRef.current.background
        const url = retainedForPath(current.retained, currentBackground.imagePath)?.url ?? null
        publish({
          ...current,
          capability,
          failedIntent: pauseAfterRefresh ? attemptedIntent : undefined,
          lifecycle,
          ready: true,
          resolutionStatus:
            pauseAfterRefresh && currentBackground.mode === 'image'
              ? 'error'
              : previewStatus(
                  currentBackground,
                  url,
                  current.linkedPath === currentBackground.imagePath
                    ? current.resolutionStatus
                    : 'missing',
                ),
        })
      } catch {
        if (!reconciliationIsCurrent(generation)) return
        reconciliationInFlightRef.current = null
        const current = resourceRef.current
        publish({
          ...current,
          failedIntent: attemptedIntent,
          lifecycle,
          ready: true,
          resolutionStatus: currentRef.current.background.mode === 'image' ? 'error' : 'none',
        })
      }
    },
    [lifecycle, publish, reconciliationIsCurrent, studio],
  )

  const refreshForIntent = useCallback(
    (retriedIntent: string) => {
      const generation = reconciliationGenerationRef.current + 1
      reconciliationGenerationRef.current = generation
      reconciliationInFlightRef.current = generation
      const current = resourceRef.current
      publish({
        ...current,
        failedIntent: undefined,
        lifecycle,
        ready: false,
        resolutionStatus: currentRef.current.background.mode === 'image' ? 'loading' : 'none',
      })
      void refreshCapability(generation, false, retriedIntent)
    },
    [lifecycle, publish, refreshCapability],
  )

  const retryCapability = useCallback(() => {
    refreshForIntent(backgroundIntent(currentRef.current.background))
  }, [refreshForIntent])

  useEffect(() => {
    const desiredIntent = backgroundIntent(background)
    if (
      !resource.ready ||
      resource.lifecycle !== lifecycle ||
      !resource.capability ||
      reconciliationInFlightRef.current !== null ||
      snapshotReleaseRef.current !== null ||
      settlementRef.current !== null ||
      !studio?.retainBackground
    )
      return

    if (resource.failedIntent) {
      if (resource.failedIntent === desiredIntent) return
      refreshForIntent(desiredIntent)
      return
    }

    const targetUrl =
      background.mode === 'image'
        ? (retainedForPath(resource.retained, background.imagePath)?.url ?? null)
        : null
    const status = previewStatus(
      background,
      targetUrl,
      resource.linkedPath === background.imagePath ? resource.resolutionStatus : 'missing',
    )
    if (resource.capability.activeUrl === targetUrl) {
      return
    }
    const generation = reconciliationGenerationRef.current + 1
    reconciliationGenerationRef.current = generation
    reconciliationInFlightRef.current = generation
    const expected = resource.capability
    publish({
      ...resource,
      failedIntent: undefined,
      resolutionStatus: background.mode === 'image' ? 'loading' : status,
    })

    const pauseForRetry = () => {
      if (!reconciliationIsCurrent(generation)) return
      void refreshCapability(generation, true, desiredIntent)
    }

    void studio.retainBackground(expected, targetUrl).then((next) => {
      if (!reconciliationIsCurrent(generation)) return
      if (next) {
        reconciliationInFlightRef.current = null
        publish({
          ...resourceRef.current,
          capability: next,
          lifecycle,
          ready: true,
          resolutionStatus: status,
        })
      } else {
        pauseForRetry()
      }
    }, pauseForRetry)
  }, [
    background.imagePath,
    background.mode,
    lifecycle,
    publish,
    reconciliationIsCurrent,
    refreshCapability,
    refreshForIntent,
    resource,
    studio,
  ])

  const resourceIsCurrent = resource.ready && resource.lifecycle === lifecycle
  const retained =
    resourceIsCurrent && background.mode === 'image'
      ? retainedForPath(resource.retained, background.imagePath)
      : null
  const capabilityPaused = resource.failedIntent === backgroundIntent(background)
  const retainedIsActive = Boolean(retained && resource.capability?.activeUrl === retained.url)
  const url = !resource.failedIntent && retainedIsActive ? (retained?.url ?? null) : null
  const resolutionStatus = !resourceIsCurrent
    ? background.mode === 'image'
      ? 'loading'
      : 'none'
    : resource.failedIntent && !capabilityPaused
      ? background.mode === 'image'
        ? 'loading'
        : 'none'
      : !capabilityPaused && background.mode === 'image' && retained && !retainedIsActive
        ? 'loading'
        : previewStatus(background, url, resource.resolutionStatus)
  const canRetry =
    (resolutionStatus === 'missing' || resolutionStatus === 'error') &&
    Boolean(
      studio?.resolveProjectBackground &&
      acceptedProjectPath &&
      background.mode === 'image' &&
      background.imagePath &&
      resource.linkedPath === background.imagePath,
    )
  const acceptedPreview: BackgroundImagePreviewSource = {
    url,
    resolutionStatus,
    ...(capabilityPaused
      ? { onRetryResolution: retryCapability }
      : canRetry
        ? { onRetryResolution: retryResolution }
        : {}),
  }

  const isOwnedLifecycle = useCallback(
    () => currentRef.current.lifecycle === lifecycle && resourceRef.current.lifecycle === lifecycle,
    [lifecycle],
  )

  const getCapability = useCallback(
    () => (isOwnedLifecycle() ? resourceRef.current.capability : null),
    [isOwnedLifecycle],
  )

  const setCapability = useCallback(
    (capability: StudioBackgroundCapabilityState) => {
      if (!isOwnedLifecycle()) return false
      publish({
        ...resourceRef.current,
        capability,
        failedIntent: undefined,
        ready: true,
      })
      return true
    },
    [isOwnedLifecycle, publish],
  )

  const reconcileCapability = useCallback(async () => {
    if (!isOwnedLifecycle() || !studio?.getBackgroundState) return null
    try {
      const capability = await studio.getBackgroundState()
      if (!isOwnedLifecycle()) return null
      publish({ ...resourceRef.current, capability, ready: true })
      return capability
    } catch {
      return null
    }
  }, [isOwnedLifecycle, publish, studio])

  useEffect(() => {
    if (
      !resource.ready ||
      resource.lifecycle !== lifecycle ||
      !resource.capability ||
      reconciliationInFlightRef.current !== null ||
      snapshotReleaseRef.current !== null ||
      settlementRef.current !== null ||
      !studio?.releaseBackgroundSnapshot
    )
      return

    const snapshot = resource.retained.find(
      ({ path, url }) =>
        !reachableImagePathsRef.current.has(path) &&
        resource.capability?.activeUrl !== url &&
        snapshotReleaseFailuresRef.current.get(url) !== resource.capability?.revision,
    )
    if (!snapshot) return

    snapshotReleaseRef.current = { lifecycle, path: snapshot.path, url: snapshot.url }
    const release = async () => {
      let capability: StudioBackgroundCapabilityState | null = resource.capability
      for (let attempt = 0; attempt < 2 && capability; attempt += 1) {
        if (
          !isOwnedLifecycle() ||
          reachableImagePathsRef.current.has(snapshot.path) ||
          resourceRef.current.retained.find(
            ({ path, url }) => path === snapshot.path && url === snapshot.url,
          ) === undefined ||
          capability.activeUrl === snapshot.url
        )
          return
        try {
          const next = await studio.releaseBackgroundSnapshot(capability, snapshot.url)
          if (!isOwnedLifecycle()) return
          if (next) {
            const current = resourceRef.current
            snapshotReleaseFailuresRef.current.delete(snapshot.url)
            publish({
              ...current,
              capability: next,
              retained: current.retained.filter(
                ({ path, url }) => path !== snapshot.path || url !== snapshot.url,
              ),
            })
            return
          }
        } catch {
          // Refresh the capability before one bounded compare-and-swap retry.
        }
        capability = await reconcileCapability()
      }
      const currentCapability = resourceRef.current.capability
      if (currentCapability) {
        snapshotReleaseFailuresRef.current.set(snapshot.url, currentCapability.revision)
      }
    }

    void release().finally(() => {
      const pending = snapshotReleaseRef.current
      if (
        pending?.lifecycle !== lifecycle ||
        pending.path !== snapshot.path ||
        pending.url !== snapshot.url
      )
        return
      snapshotReleaseRef.current = null
      if (isOwnedLifecycle()) publish({ ...resourceRef.current })
    })
  }, [
    isOwnedLifecycle,
    lifecycle,
    publish,
    reachableImagePaths,
    reconcileCapability,
    resource,
    studio,
  ])

  const rememberSnapshot = useCallback(
    (path: string, snapshotUrl: string, capability?: StudioBackgroundCapabilityState) => {
      if (!isOwnedLifecycle()) return false
      const current = resourceRef.current
      publish({
        ...current,
        capability: capability ?? current.capability,
        failedIntent: undefined,
        ready: true,
        retained: withRetainedSnapshot(current.retained, { path, url: snapshotUrl }),
      })
      return true
    },
    [isOwnedLifecycle, publish],
  )

  const forgetSnapshot = useCallback(
    (path: string, snapshotUrl: string) => {
      if (!isOwnedLifecycle()) return false
      const current = resourceRef.current
      const snapshot = retainedForPath(current.retained, path)
      if (snapshot?.url !== snapshotUrl) return false
      publish({
        ...current,
        retained: current.retained.filter((candidate) => candidate !== snapshot),
      })
      return true
    },
    [isOwnedLifecycle, publish],
  )

  const urlForPath = useCallback(
    (path: string | null) =>
      isOwnedLifecycle()
        ? (retainedForPath(resourceRef.current.retained, path)?.url ?? null)
        : null,
    [isOwnedLifecycle],
  )

  const sourceFor = useCallback(
    (target: BackgroundStyle): BackgroundImagePreviewSource => {
      if (!isOwnedLifecycle()) {
        return { url: null, resolutionStatus: target.mode === 'image' ? 'loading' : 'none' }
      }
      if (target.mode !== 'image') return { url: null, resolutionStatus: 'none' }
      if (!target.imagePath) return { url: null, resolutionStatus: 'missing' }
      const current = resourceRef.current
      const accepted = currentRef.current.background
      if (accepted.mode === 'image' && accepted.imagePath === target.imagePath) {
        return acceptedPreview
      }
      const snapshot = retainedForPath(current.retained, target.imagePath)
      if (snapshot) return { url: snapshot.url, resolutionStatus: 'available' }
      return { url: null, resolutionStatus: 'missing' }
    },
    [acceptedPreview, isOwnedLifecycle],
  )

  const beginSettlement = useCallback(() => {
    if (!isOwnedLifecycle() || snapshotReleaseRef.current || settlementRef.current) return null
    const id = settlementSequenceRef.current + 1
    settlementSequenceRef.current = id
    settlementRef.current = { id, lifecycle }
    reconciliationGenerationRef.current += 1
    reconciliationInFlightRef.current = null
    return id
  }, [isOwnedLifecycle, lifecycle])

  const endSettlement = useCallback(
    (settlement: number) => {
      const owned = settlementRef.current
      if (!owned || owned.id !== settlement || owned.lifecycle !== lifecycle) return false
      settlementRef.current = null
      if (!isOwnedLifecycle()) return false
      publish({ ...resourceRef.current })
      return true
    },
    [isOwnedLifecycle, lifecycle, publish],
  )

  return {
    preview: acceptedPreview,
    ready: resource.ready && resource.lifecycle === lifecycle,
    beginSettlement,
    endSettlement,
    forgetSnapshot,
    getCapability,
    reconcileCapability,
    rememberSnapshot,
    setCapability,
    sourceFor,
    urlForPath,
  }
}
