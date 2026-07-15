import type { KaraokeProject } from './karaoke'
import type { ResolvedVocalStyle, StageStyle } from './video-style'
import '../../electron/stage-frame-state.cjs'

export interface StageFrameWord {
  id: string; text: string; progress: number
}

export interface StageFrameLine {
  id: string; trackId: string
  text: string
  style: ResolvedVocalStyle
  words: StageFrameWord[]
}

export interface StageFrameSyncAid {
  lineId: string; trackId: string
  startMs: number; endMs: number; durationMs: number; progress: number
  style: ResolvedVocalStyle
}

export interface StageFrameState {
  title: string; artist: string
  playbackMs: number; showTitle: boolean
  stageStyle: StageStyle
  lines: StageFrameLine[]; syncAids: StageFrameSyncAid[]
}

const planner = Reflect.get(
  globalThis,
  Symbol.for('studio.okay-karaoke.stage-frame-state'),
) as undefined | {
  frameStateAt(project: KaraokeProject, playbackMs: number): StageFrameState
}
if (!planner || !Object.isFrozen(planner)) throw new Error('Shared stage planner was not installed.')

export function previewFrameStateAt(project: KaraokeProject, playbackMs: number): StageFrameState {
  return planner!.frameStateAt(project, playbackMs)
}
