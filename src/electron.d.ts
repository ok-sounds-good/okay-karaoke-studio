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
  type StudioVideoResolution = '240p' | '360p' | '480p' | '720p' | '1080p' | '1440p' | '2160p'
  type StudioVideoFps = 30 | 60

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

  interface StudioApi {
    openProject(): Promise<StudioOpenProjectResult | null>
    settleProjectOpen(requestId: string, accepted: boolean): Promise<boolean>
    resetProjectScope(): Promise<boolean>
    saveProject(options: StudioSaveProjectOptions): Promise<StudioPathResult | null>
    importAudio(): Promise<StudioAudioImportResult | null>
    resolveProjectAudio(projectPath: string): Promise<StudioAudioImportResult | null>
    releaseAudio(): Promise<void>
    importLrc(): Promise<StudioLrcImportResult | null>
    exportText(options: StudioExportTextOptions): Promise<StudioPathResult | null>
    exportVideo(options: StudioVideoExportOptions): Promise<StudioVideoExportResult | null>
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
    queryLocalFonts?: (
      options?: StudioLocalFontQueryOptions
    ) => Promise<StudioLocalFontRecord[]>
  }
}
