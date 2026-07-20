import type { KaraokeProject, VocalTrack } from '../lib/model'
import {
  constrainWordResizeTiming,
  constrainWordShiftDelta,
  type ProjectTimingDraft,
} from '../utils'

type TimelineGestureSource = 'timing' | 'marquee'

export function createTimelineGestureActivity(
  getOnChange: () => ((active: boolean) => void) | undefined,
) {
  let activeSource: TimelineGestureSource | null = null

  return {
    begin(source: TimelineGestureSource) {
      if (activeSource !== null) return false
      activeSource = source
      getOnChange()?.(true)
      return true
    },
    end(source: TimelineGestureSource) {
      if (activeSource !== source) return false
      activeSource = null
      getOnChange()?.(false)
      return true
    },
    clear() {
      if (activeSource === null) return false
      activeSource = null
      getOnChange()?.(false)
      return true
    },
  }
}

export function timelineGestureScopeKey(
  projectId: string,
  activeTrackId: string,
  track: VocalTrack | undefined,
) {
  return JSON.stringify([
    projectId,
    activeTrackId,
    track?.lines.map((line) => [line.id, line.words.map((word) => word.id)]) ?? null,
  ])
}

export interface TimelineTimingGesture {
  wordId: string
  mode: 'move' | 'start' | 'end'
  originalStart: number
  originalEnd: number
  ids: Set<string>
  deltaMs: number
}

export interface TimelinePointerGesture extends TimelineTimingGesture {
  clientX: number
  pointerId: number
  captureTarget: EventTarget
}

export interface TimelineGestureContext {
  project: KaraokeProject
  pixelsPerSecond: number
  onTimingDraftChange: (draft: ProjectTimingDraft | null) => void
  onShiftWords: (wordIds: Set<string>, deltaMs: number) => void
  onResizeWord: (wordId: string, startMs: number, endMs: number) => void
}

export function timingDraftForGesture(
  project: KaraokeProject,
  gesture: TimelineTimingGesture,
): ProjectTimingDraft {
  const timingDraft = new Map<string, { startMs: number; endMs: number }>()

  if (gesture.mode === 'move') {
    const constrainedDeltaMs = constrainWordShiftDelta(project, gesture.ids, gesture.deltaMs)
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (!gesture.ids.has(word.id) || word.startMs === null) return
          const duration = Math.max(1, (word.endMs ?? word.startMs + 300) - word.startMs)
          const startMs = Math.max(0, Math.round(word.startMs + constrainedDeltaMs))
          timingDraft.set(word.id, { startMs, endMs: startMs + duration })
        })
      })
    })
    return timingDraft
  }

  const constrained = constrainWordResizeTiming(
    project,
    gesture.wordId,
    gesture.mode,
    gesture.mode === 'start' ? gesture.originalStart + gesture.deltaMs : gesture.originalStart,
    gesture.mode === 'end' ? gesture.originalEnd + gesture.deltaMs : gesture.originalEnd,
  )
  if (constrained) timingDraft.set(gesture.wordId, constrained)
  return timingDraft
}

export function createTimelineGestureSession(getContext: () => TimelineGestureContext) {
  let active: TimelinePointerGesture | null = null
  let activeProject: KaraokeProject | null = null
  let affectedTimingSnapshot = new Map<string, { startMs: number; endMs: number | null }>()
  let draftPublished = false

  const snapshotAffectedTimings = (project: KaraokeProject, gesture: TimelinePointerGesture) => {
    const affectedIds = gesture.mode === 'move' ? gesture.ids : new Set([gesture.wordId])
    const snapshot = new Map<string, { startMs: number; endMs: number | null }>()
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          if (affectedIds.has(word.id) && word.startMs !== null) {
            snapshot.set(word.id, { startMs: word.startMs, endMs: word.endMs })
          }
        })
      })
    })
    return snapshot
  }

  const affectedTimingsUnchanged = (project: KaraokeProject) => {
    if (!activeProject || project.id !== activeProject.id || affectedTimingSnapshot.size === 0)
      return false
    const remaining = new Map(affectedTimingSnapshot)
    project.tracks.forEach((track) => {
      track.lines.forEach((line) => {
        line.words.forEach((word) => {
          const timing = remaining.get(word.id)
          if (timing && word.startMs === timing.startMs && word.endMs === timing.endMs)
            remaining.delete(word.id)
        })
      })
    })
    return remaining.size === 0
  }

  const clear = (pointerId: number, captureTarget: EventTarget) => {
    if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return null
    const gesture = active
    active = null
    activeProject = null
    affectedTimingSnapshot = new Map()
    draftPublished = false
    getContext().onTimingDraftChange(null)
    return gesture
  }

  return {
    begin(gesture: TimelinePointerGesture) {
      if (active) return false
      active = gesture
      activeProject = getContext().project
      affectedTimingSnapshot = snapshotAffectedTimings(activeProject, gesture)
      draftPublished = false
      return true
    },
    move(pointerId: number, captureTarget: EventTarget, clientX: number) {
      if (active?.pointerId !== pointerId || active.captureTarget !== captureTarget) return false
      const context = getContext()
      if (context.project !== activeProject) {
        if (!affectedTimingsUnchanged(context.project)) {
          clear(pointerId, captureTarget)
          return false
        }
        activeProject = context.project
      }
      const deltaMs = Math.round(((clientX - active.clientX) / context.pixelsPerSecond) * 1000)
      active = { ...active, deltaMs }
      context.onTimingDraftChange(timingDraftForGesture(context.project, active))
      draftPublished = true
      return true
    },
    finish(pointerId: number, captureTarget: EventTarget) {
      const currentProject = getContext().project
      if (
        active?.pointerId === pointerId &&
        active.captureTarget === captureTarget &&
        currentProject !== activeProject
      ) {
        if (!affectedTimingsUnchanged(currentProject)) {
          clear(pointerId, captureTarget)
          return false
        }
        activeProject = currentProject
      }
      const gesture = clear(pointerId, captureTarget)
      if (!gesture) return false

      const context = getContext()
      if (gesture.mode === 'move') {
        const constrainedDeltaMs = constrainWordShiftDelta(
          context.project,
          gesture.ids,
          gesture.deltaMs,
        )
        if (constrainedDeltaMs !== 0) context.onShiftWords(gesture.ids, constrainedDeltaMs)
        return true
      }

      if (gesture.deltaMs === 0) return true

      const constrained = constrainWordResizeTiming(
        context.project,
        gesture.wordId,
        gesture.mode,
        gesture.mode === 'start' ? gesture.originalStart + gesture.deltaMs : gesture.originalStart,
        gesture.mode === 'end' ? gesture.originalEnd + gesture.deltaMs : gesture.originalEnd,
      )
      if (!constrained) return true
      const { startMs, endMs } = constrained
      if (startMs !== gesture.originalStart || endMs !== gesture.originalEnd) {
        context.onResizeWord(gesture.wordId, startMs, endMs)
      }
      return true
    },
    cancel(pointerId: number, captureTarget: EventTarget) {
      return clear(pointerId, captureTarget) !== null
    },
    owns(pointerId: number, captureTarget: EventTarget) {
      return active?.pointerId === pointerId && active.captureTarget === captureTarget
    },
    captureLost(pointerId: number, eventTarget: EventTarget | null) {
      if (active?.pointerId !== pointerId) return false
      const targetDisconnected =
        active.captureTarget instanceof Node && !active.captureTarget.isConnected
      if (eventTarget !== active.captureTarget && !targetDisconnected) return false
      return clear(pointerId, active.captureTarget) !== null
    },
    invalidateProject(project: KaraokeProject) {
      if (!active) return false
      if (project === activeProject) return false
      if (!affectedTimingsUnchanged(project)) {
        return clear(active.pointerId, active.captureTarget) !== null
      }
      activeProject = project
      if (draftPublished) {
        getContext().onTimingDraftChange(timingDraftForGesture(project, active))
      }
      return false
    },
    abandon() {
      const hadActiveGesture = active !== null
      active = null
      activeProject = null
      affectedTimingSnapshot = new Map()
      draftPublished = false
      return hadActiveGesture
    },
  }
}

export function safelyHasPointerCapture(element: HTMLElement, pointerId: number) {
  try {
    return element.hasPointerCapture(pointerId)
  } catch {
    return false
  }
}

export function safelyReleasePointerCapture(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
  } catch {
    // Capture may already have been released by the browser during cancellation.
  }
}
