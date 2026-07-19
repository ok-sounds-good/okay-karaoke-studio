import type { VideoFps, VideoResolution } from './lib/video-export-settings'

export {}

declare global {
  type StudioExportFormat = 'lrc' | 'ass' | 'oks'

  type StudioMenuAction =
    | 'new'
    | 'open'
    | 'save'
    | 'save-as'
    | 'import-audio'
    | 'import-lrc'
    | 'export'
    | 'play-toggle'
    | 'select-all'
    | 'undo'
    | 'redo'

  type StudioWindowCloseAction = 'window' | 'app'

  interface StudioWindowCloseRequest {
    readonly requestId: string
    readonly action: StudioWindowCloseAction
  }

  interface StudioOpenProjectResult {
    requestId: string
    path: string
    contents: string
  }

  interface StudioSaveProjectOptions {
    path?: string
    suggestedName: string
    contents: string
  }

  interface StudioPathResult {
    path: string
  }

  interface StudioAudioImportResult {
    path: string
    name: string
    url: string
  }

  interface StudioBackgroundImageResult {
    path: string
    name: string
    url: string
  }

  interface StudioBackgroundCapabilityState {
    activeUrl: string | null
    revision: string
  }

  type StudioBackgroundRestoreResult =
    | {
        status: 'success'
        media: StudioBackgroundImageResult
        state: StudioBackgroundCapabilityState
      }
    | { status: 'missing'; state: StudioBackgroundCapabilityState }
    | { status: 'stale' }

  interface StudioLrcImportResult {
    path: string
    name: string
    contents: string
  }

  interface StudioExportTextOptions {
    suggestedName: string
    contents: string
    format: StudioExportFormat
  }

  type StudioVideoExportPhase = 'preparing' | 'frames' | 'encoding' | 'complete'
  type StudioVideoResolution = VideoResolution
  type StudioVideoFps = VideoFps

  interface StudioVideoExportProgress {
    phase: StudioVideoExportPhase
    completed: number
    total: number
  }

  interface StudioVideoExportOptions {
    suggestedName: string
    projectJson: string
    audioPath: string
    durationMs: number
    resolution: StudioVideoResolution
    fps: StudioVideoFps
    background: StudioBackgroundCapabilityState | null
  }

  interface StudioVideoExportResult extends StudioPathResult {
    durationMs: number
    frameCount: number
    resolution: StudioVideoResolution
    width: number
    height: number
    fps: StudioVideoFps
    fontFallbacks: Array<{
      requested: string
      effective: string
    }>
  }

  interface StudioVideoExportBackgroundFailure {
    status: 'background-invalid'
    background: StudioBackgroundCapabilityState
    message: string
  }

  interface StudioApi {
    openProject(): Promise<StudioOpenProjectResult | null>
    settleProjectOpen(requestId: string, accepted: boolean): Promise<boolean>
    resetProjectScope(): Promise<boolean>
    saveProject(options: StudioSaveProjectOptions): Promise<StudioPathResult | null>
    importAudio(): Promise<StudioAudioImportResult | null>
    resolveProjectAudio(projectPath: string): Promise<StudioAudioImportResult | null>
    releaseAudio(): Promise<void>
    getBackgroundState(): Promise<StudioBackgroundCapabilityState>
    chooseBackgroundImage(): Promise<StudioBackgroundImageResult | null>
    resolveProjectBackground(projectPath: string): Promise<StudioBackgroundRestoreResult>
    settleBackgroundImage(
      url: string,
      accepted: boolean,
    ): Promise<StudioBackgroundCapabilityState | null>
    retainBackground(
      expected: StudioBackgroundCapabilityState,
      url: string | null,
    ): Promise<StudioBackgroundCapabilityState | null>
    releaseBackground(
      expected: StudioBackgroundCapabilityState,
    ): Promise<StudioBackgroundCapabilityState | null>
    releaseBackgroundSnapshot(
      expected: StudioBackgroundCapabilityState,
      url: string,
    ): Promise<StudioBackgroundCapabilityState | null>
    importLrc(): Promise<StudioLrcImportResult | null>
    exportText(options: StudioExportTextOptions): Promise<StudioPathResult | null>
    exportVideo(
      options: StudioVideoExportOptions,
    ): Promise<StudioVideoExportResult | StudioVideoExportBackgroundFailure | null>
    cancelVideoExport(): Promise<boolean>
    getPendingWindowClose(): Promise<StudioWindowCloseRequest | null>
    resolveWindowClose(requestId: string, proceed: boolean): Promise<boolean>
    onWindowCloseRequest(callback: (request: StudioWindowCloseRequest) => void): () => void
    onVideoExportProgress(callback: (progress: StudioVideoExportProgress) => void): () => void
    onMenuAction(callback: (action: StudioMenuAction) => void): () => void
  }

  interface StudioLocalFontRecord {
    readonly family: string
    readonly fullName: string
    readonly postscriptName: string
    readonly style: string
  }

  interface StudioLocalFontQueryOptions {
    readonly postscriptNames?: readonly string[]
  }

  interface Window {
    /** Undefined in the regular browser/Vite preview. */
    readonly studio?: StudioApi
    /** Chromium Local Font Access; available only in a secure, permissioned renderer. */
    queryLocalFonts?: (options?: StudioLocalFontQueryOptions) => Promise<StudioLocalFontRecord[]>
  }
}
