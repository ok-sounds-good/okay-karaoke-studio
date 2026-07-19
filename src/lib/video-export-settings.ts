import presets from '../../electron/video-export-presets.json'

export type VideoResolution = '240p' | '360p' | '480p' | '720p' | '1080p' | '1440p' | '2160p'
export type VideoFps = 30 | 60

export interface VideoExportDefaults {
  resolution: VideoResolution
  fps: VideoFps
}

export interface VideoResolutionOption {
  value: VideoResolution
  label: string
  width: number
  height: number
}

export const VIDEO_RESOLUTION_OPTIONS = Object.freeze(
  presets.resolutions.map((preset) => Object.freeze({ ...preset }) as VideoResolutionOption),
)
export const VIDEO_FRAME_RATES = Object.freeze([...presets.frameRates] as VideoFps[])
export const DEFAULT_VIDEO_EXPORT_SETTINGS = Object.freeze({
  ...presets.defaults,
}) as VideoExportDefaults

const VIDEO_RESOLUTION_SET = new Set<string>(VIDEO_RESOLUTION_OPTIONS.map(({ value }) => value))
const VIDEO_FRAME_RATE_SET = new Set<number>(VIDEO_FRAME_RATES)

export function isVideoResolution(value: unknown): value is VideoResolution {
  return typeof value === 'string' && VIDEO_RESOLUTION_SET.has(value)
}

export function isVideoFps(value: unknown): value is VideoFps {
  return typeof value === 'number' && VIDEO_FRAME_RATE_SET.has(value)
}
