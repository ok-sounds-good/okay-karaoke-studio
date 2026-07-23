import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cloneStageStyle,
  cloneVocalStyle,
  fontFaceKey,
  fontTypefaceKey,
  type FontSizeStyle,
  type LyricTextStyle,
  type StageStyle,
  type TextStyle,
  type VisibleTextStyle,
  type VocalStyle,
} from '../lib/video-style'
import type { LyricDisplaySettings } from '../lib/model'
import type { VideoExportDefaults } from '../lib/video-export-settings'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../lib/video-export-settings'
import {
  VOCAL_STYLE_TIMING_ERROR,
  vocalStyleTimingDraft,
  vocalStyleWithTiming,
  type VocalStyleTimingDraft,
} from '../lib/vocal-style-timing'

export interface ProjectStyleOwnerKey {
  readonly projectId: string
  /** Changes only when project authority is replaced, never for history edits. */
  readonly lifecycle: number
  readonly trackId: string | null
}

export type ProjectStyleCommitResult = 'applied' | 'noop' | 'blocked' | 'stale'

export interface ProjectStyleDraft {
  stageStyle: StageStyle
  lyricDisplay: LyricDisplaySettings
  vocalStyle: VocalStyle
  vocalTiming: VocalStyleTimingDraft
  videoExportDefaults: VideoExportDefaults
}

export type ProjectStyleDraftChange =
  ProjectStyleDraft | ((draft: ProjectStyleDraft) => ProjectStyleDraft)

export type StageStyleDraftChange = StageStyle | ((draft: StageStyle) => StageStyle)

export interface ProjectStyleSessionOptions {
  ownerKey: ProjectStyleOwnerKey
  source: ProjectStyleDraft
  canInteract: () => boolean
  requestFonts: () => void
  commitDraft: (
    ownerKey: ProjectStyleOwnerKey,
    draft: ProjectStyleDraft,
  ) => ProjectStyleCommitResult
}

export interface ProjectStyleSession {
  readonly draft: ProjectStyleDraft | null
  readonly isOpen: boolean
  readonly blocksProjectActions: boolean
  readonly isDirty: boolean
  readonly canApply: boolean
  readonly applyBlockedReason: string | null
  start: (trigger: HTMLElement) => void
  change: (change: ProjectStyleDraftChange) => void
  apply: () => boolean
  cancel: () => boolean
}

interface ActiveSession {
  ownerKey: ProjectStyleOwnerKey
  baseline: ProjectStyleDraft
  draft: ProjectStyleDraft
  trigger: HTMLElement
}

function sameFontSizeStyle(left: FontSizeStyle, right: FontSizeStyle): boolean {
  return (
    fontTypefaceKey(left.typeface) === fontTypefaceKey(right.typeface) &&
    fontFaceKey(left.fontStyle) === fontFaceKey(right.fontStyle) &&
    left.sizePx === right.sizePx
  )
}

function sameColor(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function sameTextStyle(left: TextStyle, right: TextStyle): boolean {
  return sameFontSizeStyle(left, right) && sameColor(left.color, right.color)
}

function sameVisibleTextStyle(left: VisibleTextStyle, right: VisibleTextStyle): boolean {
  return sameTextStyle(left, right) && left.visible === right.visible
}

function sameLyricTextStyle(left: LyricTextStyle, right: LyricTextStyle): boolean {
  return (
    sameFontSizeStyle(left, right) &&
    sameColor(left.unsungColor, right.unsungColor) &&
    sameColor(left.sungColor, right.sungColor)
  )
}

export function sameStageStyle(left: StageStyle, right: StageStyle): boolean {
  return (
    left.background.mode === right.background.mode &&
    sameColor(left.background.solidColor, right.background.solidColor) &&
    sameColor(left.background.gradientStartColor, right.background.gradientStartColor) &&
    sameColor(left.background.gradientEndColor, right.background.gradientEndColor) &&
    left.background.imagePath === right.background.imagePath &&
    sameLyricTextStyle(left.lyrics, right.lyrics) &&
    sameVisibleTextStyle(left.titleCard.eyebrow, right.titleCard.eyebrow) &&
    sameVisibleTextStyle(left.titleCard.title, right.titleCard.title) &&
    sameVisibleTextStyle(left.titleCard.artist, right.titleCard.artist) &&
    left.stageFrame.enabled === right.stageFrame.enabled &&
    sameColor(left.stageFrame.lineColor, right.stageFrame.lineColor) &&
    left.stageFrame.lineWidthPx === right.stageFrame.lineWidthPx &&
    sameVisibleTextStyle(left.stageFrame.brand, right.stageFrame.brand) &&
    sameVisibleTextStyle(left.stageFrame.clock, right.stageFrame.clock) &&
    sameVisibleTextStyle(left.stageFrame.footer, right.stageFrame.footer)
  )
}

function sameNullableTypeface(
  left: VocalStyle['typeface'],
  right: VocalStyle['typeface'],
): boolean {
  return left === null || right === null
    ? left === right
    : fontTypefaceKey(left) === fontTypefaceKey(right)
}

function sameNullableFace(left: VocalStyle['fontStyle'], right: VocalStyle['fontStyle']): boolean {
  return left === null || right === null ? left === right : fontFaceKey(left) === fontFaceKey(right)
}

function sameNullableColor(left: string | null, right: string | null): boolean {
  return left === null || right === null ? left === right : sameColor(left, right)
}

export function sameVocalStyle(left: VocalStyle, right: VocalStyle): boolean {
  return (
    sameNullableTypeface(left.typeface, right.typeface) &&
    sameNullableFace(left.fontStyle, right.fontStyle) &&
    left.sizePx === right.sizePx &&
    sameNullableColor(left.sungColor, right.sungColor) &&
    sameNullableColor(left.unsungColor, right.unsungColor) &&
    left.alignment === right.alignment &&
    left.previewMs === right.previewMs &&
    left.syncAid.enabled === right.syncAid.enabled &&
    left.syncAid.minLeadMs === right.syncAid.minLeadMs &&
    left.syncAid.maxLeadMs === right.syncAid.maxLeadMs
  )
}

export function cloneProjectStyleDraft(draft: ProjectStyleDraft): ProjectStyleDraft {
  return {
    stageStyle: cloneStageStyle(draft.stageStyle),
    lyricDisplay: { ...draft.lyricDisplay },
    vocalStyle: cloneVocalStyle(draft.vocalStyle),
    vocalTiming: { ...draft.vocalTiming },
    videoExportDefaults: { ...draft.videoExportDefaults },
  }
}

export function createProjectStyleDraft(
  stageStyle: StageStyle,
  vocalStyle: VocalStyle,
  lyricDisplay: LyricDisplaySettings = { lineCount: 2, advanceMode: 'clear' },
  videoExportDefaults: VideoExportDefaults = DEFAULT_VIDEO_EXPORT_SETTINGS,
): ProjectStyleDraft {
  return {
    stageStyle,
    lyricDisplay,
    vocalStyle,
    vocalTiming: vocalStyleTimingDraft(vocalStyle),
    videoExportDefaults,
  }
}

export function canonicalVocalStyle(draft: ProjectStyleDraft): VocalStyle | null {
  return vocalStyleWithTiming(draft.vocalStyle, draft.vocalTiming)
}

export function sameProjectStyleDraft(left: ProjectStyleDraft, right: ProjectStyleDraft): boolean {
  return (
    sameStageStyle(left.stageStyle, right.stageStyle) &&
    left.lyricDisplay.lineCount === right.lyricDisplay.lineCount &&
    left.lyricDisplay.advanceMode === right.lyricDisplay.advanceMode &&
    sameVocalStyle(left.vocalStyle, right.vocalStyle) &&
    left.vocalTiming.previewMs === right.vocalTiming.previewMs &&
    left.vocalTiming.minLeadMs === right.vocalTiming.minLeadMs &&
    left.vocalTiming.maxLeadMs === right.vocalTiming.maxLeadMs &&
    left.videoExportDefaults.resolution === right.videoExportDefaults.resolution &&
    left.videoExportDefaults.fps === right.videoExportDefaults.fps
  )
}

function cloneOwnerKey(ownerKey: ProjectStyleOwnerKey): ProjectStyleOwnerKey {
  return {
    projectId: ownerKey.projectId,
    lifecycle: ownerKey.lifecycle,
    trackId: ownerKey.trackId,
  }
}

function sameOwnerKey(left: ProjectStyleOwnerKey, right: ProjectStyleOwnerKey): boolean {
  return (
    left.projectId === right.projectId &&
    left.lifecycle === right.lifecycle &&
    left.trackId === right.trackId
  )
}

export function useProjectStyleSession({
  ownerKey,
  source,
  canInteract,
  requestFonts,
  commitDraft,
}: ProjectStyleSessionOptions): ProjectStyleSession {
  const sourceSnapshot = useMemo(() => cloneProjectStyleDraft(source), [source])
  const [storedSession, setStoredSession] = useState<ActiveSession | null>(null)
  const sessionRef = useRef<ActiveSession | null>(storedSession)
  const applyingRef = useRef<ActiveSession | null>(null)
  const ownerRef = useRef<ProjectStyleOwnerKey>(cloneOwnerKey(ownerKey))
  const sourceRef = useRef(sourceSnapshot)
  const canInteractRef = useRef(canInteract)
  const requestFontsRef = useRef(requestFonts)
  const commitDraftRef = useRef(commitDraft)

  sessionRef.current = storedSession
  ownerRef.current = cloneOwnerKey(ownerKey)
  sourceRef.current = sourceSnapshot
  canInteractRef.current = canInteract
  requestFontsRef.current = requestFonts
  commitDraftRef.current = commitDraft

  const abandon = useCallback((expected: ActiveSession) => {
    if (sessionRef.current !== expected) return false
    sessionRef.current = null
    if (applyingRef.current === expected) applyingRef.current = null
    setStoredSession((current) => (current === expected ? null : current))
    return true
  }, [])

  const restoreFocus = useCallback((closed: ActiveSession) => {
    window.setTimeout(() => {
      if (!sameOwnerKey(ownerRef.current, closed.ownerKey)) return
      if (sessionRef.current) return
      if (closed.trigger.isConnected) closed.trigger.focus()
    }, 0)
  }, [])

  const currentSession = useCallback(() => {
    const active = sessionRef.current
    if (!active) return null
    if (sameOwnerKey(active.ownerKey, ownerRef.current)) return active
    abandon(active)
    return null
  }, [abandon])

  useEffect(() => {
    const active = sessionRef.current
    if (active && !sameOwnerKey(active.ownerKey, ownerRef.current)) {
      abandon(active)
    }
  }, [abandon, ownerKey.lifecycle, ownerKey.projectId, ownerKey.trackId])

  const start = useCallback(
    (trigger: HTMLElement) => {
      const active = sessionRef.current
      if (active) {
        if (sameOwnerKey(active.ownerKey, ownerRef.current)) return
        abandon(active)
      }
      if (!canInteractRef.current()) return

      const openingOwner = cloneOwnerKey(ownerRef.current)
      const baseline = cloneProjectStyleDraft(sourceRef.current)
      // Chromium requires this request to remain in the authorized user action.
      requestFontsRef.current()
      if (!sameOwnerKey(openingOwner, ownerRef.current)) return

      const next: ActiveSession = {
        ownerKey: openingOwner,
        baseline,
        draft: cloneProjectStyleDraft(baseline),
        trigger,
      }
      sessionRef.current = next
      setStoredSession(next)
    },
    [abandon],
  )

  const change = useCallback(
    (update: ProjectStyleDraftChange) => {
      const active = currentSession()
      if (!active || !canInteractRef.current()) return

      const candidate =
        typeof update === 'function' ? update(cloneProjectStyleDraft(active.draft)) : update
      const next: ActiveSession = {
        ...active,
        draft: cloneProjectStyleDraft(candidate),
      }
      sessionRef.current = next
      setStoredSession((current) => (current === active ? next : current))
    },
    [currentSession],
  )

  const apply = useCallback(() => {
    const active = currentSession()
    if (!active || applyingRef.current === active || !canInteractRef.current()) {
      return false
    }
    const canonicalVocal = canonicalVocalStyle(active.draft)
    if (!canonicalVocal) return false
    const canonicalDraft = { ...active.draft, vocalStyle: canonicalVocal }

    applyingRef.current = active
    let result: ProjectStyleCommitResult
    try {
      result = commitDraftRef.current(
        cloneOwnerKey(active.ownerKey),
        cloneProjectStyleDraft(canonicalDraft),
      )
    } catch (error) {
      if (applyingRef.current === active) applyingRef.current = null
      throw error
    }

    if (result === 'applied' || result === 'noop') {
      const settled = abandon(active)
      if (settled) restoreFocus(active)
      return settled
    }
    if (result === 'stale') {
      abandon(active)
      return false
    }
    if (applyingRef.current === active) applyingRef.current = null
    return false
  }, [abandon, currentSession, restoreFocus])

  const cancel = useCallback(() => {
    const active = currentSession()
    if (!active) return false
    const settled = abandon(active)
    if (settled) restoreFocus(active)
    return settled
  }, [abandon, currentSession, restoreFocus])

  const active =
    storedSession && sameOwnerKey(storedSession.ownerKey, ownerKey) ? storedSession : null
  const canApply = Boolean(active && canonicalVocalStyle(active.draft))

  return {
    draft: active ? cloneProjectStyleDraft(active.draft) : null,
    isOpen: active !== null,
    blocksProjectActions: active !== null,
    isDirty: active ? !sameProjectStyleDraft(active.baseline, active.draft) : false,
    canApply,
    applyBlockedReason: active && !canApply ? VOCAL_STYLE_TIMING_ERROR : null,
    start,
    change,
    apply,
    cancel,
  }
}
