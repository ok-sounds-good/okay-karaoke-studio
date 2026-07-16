import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cloneStageStyle,
  fontFaceKey,
  fontTypefaceKey,
  type FontSizeStyle,
  type LyricTextStyle,
  type StageStyle,
  type TextStyle,
  type VisibleTextStyle,
} from '../lib/video-style'

export interface ProjectStyleOwnerKey {
  readonly projectId: string
  /** Changes only when project authority is replaced, never for history edits. */
  readonly lifecycle: number
}

export type ProjectStyleCommitResult = 'applied' | 'noop' | 'blocked' | 'stale'

export type ProjectStyleDraftChange = StageStyle | ((draft: StageStyle) => StageStyle)

export interface ProjectStyleSessionOptions {
  ownerKey: ProjectStyleOwnerKey
  source: StageStyle
  canInteract: () => boolean
  requestFonts: () => void
  commitDraft: (ownerKey: ProjectStyleOwnerKey, draft: StageStyle) => ProjectStyleCommitResult
}

export interface ProjectStyleSession {
  readonly draft: StageStyle | null
  readonly isOpen: boolean
  readonly blocksProjectActions: boolean
  readonly isDirty: boolean
  start: (trigger: HTMLElement) => void
  change: (change: ProjectStyleDraftChange) => void
  apply: () => boolean
  cancel: () => boolean
}

interface ActiveSession {
  ownerKey: ProjectStyleOwnerKey
  baseline: StageStyle
  draft: StageStyle
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

function cloneOwnerKey(ownerKey: ProjectStyleOwnerKey): ProjectStyleOwnerKey {
  return { projectId: ownerKey.projectId, lifecycle: ownerKey.lifecycle }
}

function sameOwnerKey(left: ProjectStyleOwnerKey, right: ProjectStyleOwnerKey): boolean {
  return left.projectId === right.projectId && left.lifecycle === right.lifecycle
}

export function useProjectStyleSession({
  ownerKey,
  source,
  canInteract,
  requestFonts,
  commitDraft,
}: ProjectStyleSessionOptions): ProjectStyleSession {
  const sourceSnapshot = useMemo(() => cloneStageStyle(source), [source])
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
  }, [abandon, ownerKey.lifecycle, ownerKey.projectId])

  const start = useCallback(
    (trigger: HTMLElement) => {
      const active = sessionRef.current
      if (active) {
        if (sameOwnerKey(active.ownerKey, ownerRef.current)) return
        abandon(active)
      }
      if (!canInteractRef.current()) return

      const openingOwner = cloneOwnerKey(ownerRef.current)
      const baseline = cloneStageStyle(sourceRef.current)
      // Chromium requires this request to remain in the authorized user action.
      requestFontsRef.current()
      if (!sameOwnerKey(openingOwner, ownerRef.current)) return

      const next: ActiveSession = {
        ownerKey: openingOwner,
        baseline,
        draft: cloneStageStyle(baseline),
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
        typeof update === 'function' ? update(cloneStageStyle(active.draft)) : update
      const next: ActiveSession = {
        ...active,
        draft: cloneStageStyle(candidate),
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

    applyingRef.current = active
    let result: ProjectStyleCommitResult
    try {
      result = commitDraftRef.current(cloneOwnerKey(active.ownerKey), cloneStageStyle(active.draft))
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

  return {
    draft: active ? cloneStageStyle(active.draft) : null,
    isOpen: active !== null,
    blocksProjectActions: active !== null,
    isDirty: active ? !sameStageStyle(active.baseline, active.draft) : false,
    start,
    change,
    apply,
    cancel,
  }
}
