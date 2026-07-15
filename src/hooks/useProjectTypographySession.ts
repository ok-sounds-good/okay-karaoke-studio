import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  fontTypefaceKey,
  type LyricTextStyle,
} from '../lib/video-style'

export interface ProjectTypographyOwnerKey {
  readonly projectId: string
  /** Changes only when project authority is replaced, never for history edits. */
  readonly lifecycle: number
}

export type ProjectTypographyCommitResult = 'applied' | 'noop' | 'blocked' | 'stale'

export type ProjectTypographyDraftChange =
  LyricTextStyle | ((draft: LyricTextStyle) => LyricTextStyle)

export interface ProjectTypographySessionOptions {
  ownerKey: ProjectTypographyOwnerKey
  source: LyricTextStyle
  canInteract: () => boolean
  requestFonts: () => void
  commitDraft: (
    ownerKey: ProjectTypographyOwnerKey,
    draft: LyricTextStyle,
  ) => ProjectTypographyCommitResult
}

export interface ProjectTypographySession {
  readonly draft: LyricTextStyle | null
  readonly isOpen: boolean
  readonly blocksProjectActions: boolean
  readonly isDirty: boolean
  start: (trigger: HTMLElement) => void
  change: (change: ProjectTypographyDraftChange) => void
  apply: () => void
  cancel: () => void
}

interface ActiveSession {
  ownerKey: ProjectTypographyOwnerKey
  baseline: LyricTextStyle
  draft: LyricTextStyle
  trigger: HTMLElement
}

export function sameLyricTextStyle(left: LyricTextStyle, right: LyricTextStyle): boolean {
  return (
    fontTypefaceKey(left.typeface) === fontTypefaceKey(right.typeface) &&
    fontFaceKey(left.fontStyle) === fontFaceKey(right.fontStyle) &&
    left.sizePx === right.sizePx &&
    left.unsungColor.toLowerCase() === right.unsungColor.toLowerCase() &&
    left.sungColor.toLowerCase() === right.sungColor.toLowerCase()
  )
}

function cloneLyrics(style: LyricTextStyle): LyricTextStyle {
  return {
    ...style,
    typeface: cloneTypeface(style.typeface),
    fontStyle: cloneFontFace(style.fontStyle),
  }
}

function cloneOwnerKey(ownerKey: ProjectTypographyOwnerKey): ProjectTypographyOwnerKey {
  return { projectId: ownerKey.projectId, lifecycle: ownerKey.lifecycle }
}

function sameOwnerKey(left: ProjectTypographyOwnerKey, right: ProjectTypographyOwnerKey): boolean {
  return left.projectId === right.projectId && left.lifecycle === right.lifecycle
}

export function useProjectTypographySession({
  ownerKey,
  source,
  canInteract,
  requestFonts,
  commitDraft,
}: ProjectTypographySessionOptions): ProjectTypographySession {
  const [storedSession, setStoredSession] = useState<ActiveSession | null>(null)
  const sessionRef = useRef<ActiveSession | null>(storedSession)
  const applyingRef = useRef<ActiveSession | null>(null)
  const ownerRef = useRef<ProjectTypographyOwnerKey>(cloneOwnerKey(ownerKey))
  const sourceRef = useRef(cloneLyrics(source))
  const canInteractRef = useRef(canInteract)
  const requestFontsRef = useRef(requestFonts)
  const commitDraftRef = useRef(commitDraft)

  sessionRef.current = storedSession
  ownerRef.current = cloneOwnerKey(ownerKey)
  sourceRef.current = cloneLyrics(source)
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
      const baseline = cloneLyrics(sourceRef.current)
      // Chromium requires this request to remain in the authorized user action.
      requestFontsRef.current()
      if (!sameOwnerKey(openingOwner, ownerRef.current)) return

      const next: ActiveSession = {
        ownerKey: openingOwner,
        baseline,
        draft: cloneLyrics(baseline),
        trigger,
      }
      sessionRef.current = next
      setStoredSession(next)
    },
    [abandon],
  )

  const change = useCallback(
    (update: ProjectTypographyDraftChange) => {
      const active = currentSession()
      if (!active || !canInteractRef.current()) return

      const candidate = typeof update === 'function' ? update(cloneLyrics(active.draft)) : update
      const next: ActiveSession = {
        ...active,
        draft: cloneLyrics(candidate),
      }
      sessionRef.current = next
      setStoredSession((current) => (current === active ? next : current))
    },
    [currentSession],
  )

  const apply = useCallback(() => {
    const active = currentSession()
    if (!active || applyingRef.current === active || !canInteractRef.current()) {
      return
    }

    applyingRef.current = active
    let result: ProjectTypographyCommitResult
    try {
      result = commitDraftRef.current(cloneOwnerKey(active.ownerKey), cloneLyrics(active.draft))
    } catch (error) {
      if (applyingRef.current === active) applyingRef.current = null
      throw error
    }

    if (result === 'applied' || result === 'noop') {
      if (abandon(active)) restoreFocus(active)
      return
    }
    if (result === 'stale') {
      abandon(active)
      return
    }
    if (applyingRef.current === active) applyingRef.current = null
  }, [abandon, currentSession, restoreFocus])

  const cancel = useCallback(() => {
    const active = currentSession()
    if (!active) return
    if (abandon(active)) restoreFocus(active)
  }, [abandon, currentSession, restoreFocus])

  const active =
    storedSession && sameOwnerKey(storedSession.ownerKey, ownerKey) ? storedSession : null

  return {
    draft: active ? cloneLyrics(active.draft) : null,
    isOpen: active !== null,
    blocksProjectActions: active !== null,
    isDirty: active ? !sameLyricTextStyle(active.baseline, active.draft) : false,
    start,
    change,
    apply,
    cancel,
  }
}
