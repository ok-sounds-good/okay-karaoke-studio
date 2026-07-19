'use strict'

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { ffmpegExecutableCandidates } = require('./ffmpeg-setup.cjs')
const { decodeProject, parseProjectJson } = require('./project-schema.cjs')
const {
  createStageFramePlanner,
  frameStateAt: styleFrameStateAt,
  resolveVocalStyle,
} = require('./stage-frame-state.cjs')
const {
  FRAME_MARKER_BITS,
  assetInvocation,
  frameInvocation,
  renderDocument: renderStyleDocument,
} = require('./video-style-document.cjs')
const STAGE_LAYOUT = require('./stage-layout.json')
const SYNC_AID_GEOMETRY = require('./sync-aid-geometry.json')
const VIDEO_EXPORT_PRESETS = require('./video-export-presets.json')

const VIDEO_RESOLUTION_PRESETS = Object.freeze(
  Object.fromEntries(
    VIDEO_EXPORT_PRESETS.resolutions.map(({ value, width, height }) => [
      value,
      Object.freeze({ width, height }),
    ]),
  ),
)
const VIDEO_FRAME_RATES = Object.freeze([...VIDEO_EXPORT_PRESETS.frameRates])
const DEFAULT_VIDEO_RESOLUTION = VIDEO_EXPORT_PRESETS.defaults.resolution
const DEFAULT_VIDEO_FPS = VIDEO_EXPORT_PRESETS.defaults.fps
// This controls only the hidden export compositor. Project and FFmpeg rates
// remain the authored 30 or 60 fps selected above.
const OFFSCREEN_CAPTURE_FPS = 240
const MAX_VIDEO_DURATION_MS = 30 * 60 * 1000
const MAX_VIDEO_FRAMES = Math.ceil((MAX_VIDEO_DURATION_MS * Math.max(...VIDEO_FRAME_RATES)) / 1_000)
function normalizeVideoSettings(value = {}) {
  if (!isRecord(value)) throw new TypeError('Video settings must be an object')
  const resolution = value.resolution ?? DEFAULT_VIDEO_RESOLUTION
  const fps = value.fps ?? DEFAULT_VIDEO_FPS
  if (typeof resolution !== 'string' || !Object.hasOwn(VIDEO_RESOLUTION_PRESETS, resolution)) {
    throw new RangeError('Video resolution preset is not supported')
  }
  const dimensions = VIDEO_RESOLUTION_PRESETS[resolution]
  if (!VIDEO_FRAME_RATES.includes(fps))
    throw new RangeError('Video frame rate must be 30 or 60 fps')
  return { resolution, fps, ...dimensions }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback
}

function limitedText(value, fallback, maximumLength = 500) {
  if (typeof value !== 'string') return fallback
  return value.replaceAll('\0', '').slice(0, maximumLength)
}

function normalizeProjectForVideo(value) {
  return decodeProject(value)
}

function parseProjectForVideo(json) {
  if (typeof json !== 'string') throw new TypeError('projectJson must be a string')
  if (Buffer.byteLength(json, 'utf8') > 50 * 1024 * 1024) {
    throw new RangeError('The project is too large to render as video')
  }
  return parseProjectJson(json)
}

function rawLineRange(line) {
  const timedWords = line.words.filter((word) => word.startMs !== null && word.endMs !== null)
  const startMs = line.startMs ?? timedWords[0]?.startMs ?? null
  const endMs = line.endMs ?? timedWords.at(-1)?.endMs ?? null
  if (startMs === null || endMs === null || endMs <= startMs) return null
  return { startMs, endMs }
}

function adjustedLineRange(line, offsetMs) {
  const range = rawLineRange(line)
  if (!range) return null
  const startMs = Math.max(0, range.startMs + offsetMs)
  const endMs = range.endMs + offsetMs
  if (endMs <= startMs) return null
  return { startMs, endMs }
}

function visibleTracks(project) {
  const hasSolo = project.tracks.some((track) => track.solo && !track.muted)
  return project.tracks.filter((track) => !track.muted && (!hasSolo || track.solo))
}

function effectiveVideoDurationForProject(project, requestedDurationMs) {
  const latestLyricMs = visibleTracks(project).reduce((latestTrack, track) => {
    const latestLine = track.lines.reduce((latest, line) => {
      const range = adjustedLineRange(line, project.offsetMs)
      return range ? Math.max(latest, range.endMs) : latest
    }, 0)
    return Math.max(latestTrack, latestLine)
  }, 0)
  const requested = finiteInteger(requestedDurationMs)
  const durationMs = Math.max(project.durationMs, requested, latestLyricMs, 1_000)
  if (durationMs > MAX_VIDEO_DURATION_MS) {
    throw new RangeError('Video export is limited to thirty minutes')
  }
  return durationMs
}

function effectiveVideoDuration(projectValue, requestedDurationMs) {
  return effectiveVideoDurationForProject(
    normalizeProjectForVideo(projectValue),
    requestedDurationMs,
  )
}

function createTrackDisplayIndex(track, offsetMs) {
  const positions = []
  let section = []
  const appendSection = () => {
    section.forEach((line, lineIndex) => {
      positions.push({ line, lineIndex, section })
    })
    section = []
  }

  track.lines.forEach((line) => {
    if (!line.text.trim() && line.words.length === 0) appendSection()
    else section.push(line)
  })
  appendSection()

  const timedPositions = positions.flatMap((position) => {
    const rawRange = rawLineRange(position.line)
    return rawRange ? [{ position, rawRange }] : []
  })
  const adjustedLines = timedPositions.flatMap(({ position, rawRange }) => {
    const range = adjustedLineRange(position.line, offsetMs)
    return range ? [{ line: position.line, range, rawRange }] : []
  })
  return { track, timedPositions, adjustedLines }
}

function createVideoIndex(project) {
  const tracks = visibleTracks(project).map((track) =>
    createTrackDisplayIndex(track, project.offsetMs),
  )
  const upcomingLines = tracks
    .flatMap(({ track, adjustedLines }) => adjustedLines.map((entry) => ({ ...entry, track })))
    .sort((left, right) => left.range.startMs - right.range.startMs)
  return {
    project,
    tracks,
    upcomingLines,
    firstStart: upcomingLines[0]?.range.startMs ?? Number.POSITIVE_INFINITY,
  }
}

function buildFrameTimelineForProject(project, requestedDurationMs, fps = DEFAULT_VIDEO_FPS) {
  if (!VIDEO_FRAME_RATES.includes(fps)) {
    throw new RangeError('Video frame rate must be 30 or 60 fps')
  }
  const durationMs = effectiveVideoDurationForProject(project, requestedDurationMs)
  const frameCount = Math.ceil((durationMs * fps) / 1_000)
  if (frameCount > MAX_VIDEO_FRAMES) {
    throw new RangeError(`Video export would require more than ${MAX_VIDEO_FRAMES} lyric frames`)
  }
  const times = Array.from({ length: frameCount }, (_unused, index) =>
    Math.round((index * 1_000) / fps),
  )
  return { project, durationMs, fps, times }
}

function buildFrameTimeline(projectValue, requestedDurationMs, settings = {}) {
  const { fps } = normalizeVideoSettings(settings)
  return buildFrameTimelineForProject(
    normalizeProjectForVideo(projectValue),
    requestedDurationMs,
    fps,
  )
}

function wordProgress(word, lyricMs) {
  if (word.startMs === null || word.endMs === null) return 0
  if (lyricMs <= word.startMs) return 0
  if (lyricMs >= word.endMs) return 1
  return Math.max(0, Math.min(1, (lyricMs - word.startMs) / Math.max(1, word.endMs - word.startMs)))
}

function vocalSungColor(project, track) {
  return track.vocalStyle.sungColor ?? project.stageStyle.lyrics.sungColor
}

function createFrameCursor(index) {
  return {
    trackPositions: index.tracks.map(() => 0),
  }
}

function plannedTrackLines(trackIndex, lyricMs, settings, cursorPosition) {
  let position = cursorPosition
  if (position === undefined) {
    position = trackIndex.timedPositions.findIndex((entry) => lyricMs < entry.rawRange.endMs)
  }
  const target = position >= 0 ? trackIndex.timedPositions[position]?.position : undefined
  if (!target) return []
  const startIndex =
    settings.advanceMode === 'scroll'
      ? Math.min(target.lineIndex, Math.max(0, target.section.length - settings.lineCount))
      : Math.floor(target.lineIndex / settings.lineCount) * settings.lineCount
  return target.section.slice(startIndex, startIndex + settings.lineCount)
}

function frameStateAtIndex(index, playbackMs, cursor) {
  const { project } = index
  const lyricMs = playbackMs - project.offsetMs
  const showTitle =
    !Number.isFinite(index.firstStart) || playbackMs < Math.max(0, index.firstStart - 1_500)
  const lines = []

  const trackWindows = index.tracks.map((trackIndex, trackPosition) => {
    let timedPosition
    if (cursor) {
      timedPosition = cursor.trackPositions[trackPosition]
      while (
        timedPosition < trackIndex.timedPositions.length &&
        lyricMs >= trackIndex.timedPositions[timedPosition].rawRange.endMs
      ) {
        timedPosition += 1
      }
      cursor.trackPositions[trackPosition] = timedPosition
    }
    return {
      track: trackIndex.track,
      lines: plannedTrackLines(trackIndex, lyricMs, project.lyricDisplay, timedPosition),
    }
  })
  for (
    let lineIndex = 0;
    lineIndex < project.lyricDisplay.lineCount && lines.length < project.lyricDisplay.lineCount;
    lineIndex += 1
  ) {
    trackWindows.forEach(({ track, lines: trackLines }) => {
      const line = trackLines[lineIndex]
      if (line && lines.length < project.lyricDisplay.lineCount) {
        lines.push({
          color: vocalSungColor(project, track),
          text: line.text.replaceAll('/', '·'),
          words: line.words
            .filter((word) => word.text)
            .map((word) => ({
              text: word.text.replaceAll('/', '·'),
              progress: wordProgress(word, lyricMs),
            })),
        })
      }
    })
  }

  return {
    title: project.title || 'Untitled song',
    artist: project.artist || 'Unknown artist',
    playbackMs,
    showTitle,
    lines,
  }
}

function frameStateAt(projectValue, playbackMs) {
  const project = normalizeProjectForVideo(projectValue)
  return styleFrameStateAt(project, playbackMs)
}

function renderDocument(settings = {}) {
  const { width, height } = normalizeVideoSettings(settings)
  return renderStyleDocument({ width, height })
}

function createAbortError() {
  const error = new Error('Video export canceled')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

function createVideoExportCommitState() {
  let state = 'cancellable'

  return {
    get state() {
      return state
    },
    tryBeginCancellation() {
      if (state !== 'cancellable') return false
      state = 'canceling'
      return true
    },
    beginPromotion() {
      if (state !== 'cancellable') return false
      state = 'promoting'
      return true
    },
    finishPromotion() {
      if (state !== 'promoting') {
        throw new Error('Video export cannot be committed before promotion begins')
      }
      state = 'committed'
    },
  }
}

async function promoteVideoOutput(
  partialPath,
  outputPath,
  { renameFile = fs.rename, onPromotionStart, onPromotionComplete } = {},
) {
  if (onPromotionStart?.() === false) throw createAbortError()
  await renameFile(partialPath, outputPath)
  onPromotionComplete?.()
}

function paintedFrameSequence(image, settings) {
  const size = image.getSize()
  const scaleX = size.width / (settings.width + FRAME_MARKER_BITS)
  const y = Math.floor(size.height / 2)
  const bitmap = image.toBitmap()
  const rowBytes = bitmap.length / size.height
  if (!Number.isSafeInteger(rowBytes) || rowBytes < size.width * 4) return null
  let sequence = 0
  for (let bit = 0; bit < FRAME_MARKER_BITS; bit += 1) {
    const x = Math.floor((settings.width + bit + 0.5) * scaleX)
    const offset = y * rowBytes + x * 4
    let brightChannels = 0
    for (let channel = 0; channel < 4; channel += 1) {
      if (bitmap[offset + channel] >= 128) brightChannels += 1
    }
    if (brightChannels >= 3) sequence += 2 ** bit
  }
  return sequence
}

function encodeJpegFrame(image, settings, cropMarker = false) {
  const imageSize = image.getSize()
  const source = cropMarker
    ? image.crop({
        x: 0,
        y: 0,
        width: Math.round(
          (settings.width * imageSize.width) / (settings.width + FRAME_MARKER_BITS),
        ),
        height: imageSize.height,
      })
    : image
  const size = source.getSize()
  const frame =
    size.width === settings.width && size.height === settings.height
      ? source
      : source.resize({ width: settings.width, height: settings.height, quality: 'best' })
  return frame.toJPEG(95)
}

function presentRequestedFrame(contents, update, settings, signal, expectedSequence = null) {
  return new Promise((resolve, reject) => {
    let paintingStarted = false
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      contents.off('paint', onPaint)
      signal?.removeEventListener('abort', onAbort)
    }
    const stopPainting = () => {
      if (!paintingStarted) return null
      paintingStarted = false
      try {
        contents.stopPainting()
        return null
      } catch (error) {
        return error
      }
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      stopPainting()
      cleanup()
      reject(error)
    }
    const timeout = setTimeout(() => {
      fail(new Error('Timed out while rendering a video frame'))
    }, 10_000)
    const onPaint = (_event, _dirtyRect, image) => {
      if (settled || image.isEmpty()) return
      try {
        if (expectedSequence !== null && paintedFrameSequence(image, settings) !== expectedSequence)
          return
        const frame = encodeJpegFrame(image, settings, expectedSequence !== null)
        settled = true
        const stopError = stopPainting()
        cleanup()
        if (stopError) reject(stopError)
        else resolve(frame)
      } catch (error) {
        fail(error)
      }
    }
    const onAbort = () => fail(createAbortError())
    if (signal?.aborted) {
      fail(createAbortError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(() => (settled ? undefined : update()))
      .then(() => {
        if (settled) return
        try {
          contents.on('paint', onPaint)
          paintingStarted = true
          contents.startPainting()
        } catch (error) {
          fail(error)
        }
      }, fail)
  })
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return null
  // FFmpeg handles SIGINT by finalizing the container trailer before exiting,
  // which leaves a useful partial artifact after an explicit cancellation.
  child.kill('SIGINT')
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 2_000)
  timeout.unref?.()
  return timeout
}

function runProcess(executable, args, { signal, inputWriter } = {}) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: [inputWriter ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    let spawnError
    let writerError
    let killTimeout
    let abortGraceTimer
    const finishAbort = () => {
      if (child.exitCode === null && child.signalCode === null) {
        killTimeout ||= terminateChild(child)
      }
    }
    const requestAbort = () => {
      if (inputWriter && child.stdin && !child.stdin.destroyed) {
        child.stdin.end()
        if (!abortGraceTimer) {
          abortGraceTimer = setTimeout(finishAbort, 350)
          abortGraceTimer.unref?.()
        }
      } else {
        finishAbort()
      }
    }
    const onAbort = () => {
      writerError ||= createAbortError()
      requestAbort()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64_000) stderr += chunk.toString()
    })
    child.stdin?.on('error', (error) => {
      writerError ||= error
    })
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', (code, terminationSignal) => {
      if (abortGraceTimer) clearTimeout(abortGraceTimer)
      if (killTimeout) clearTimeout(killTimeout)
      signal?.removeEventListener?.('abort', onAbort)
      if (spawnError) reject(spawnError)
      else if (writerError?.name === 'AbortError' || signal?.aborted) reject(createAbortError())
      else if (code === 0 && !writerError) resolve()
      else if (code === 0) reject(writerError)
      else
        reject(
          new Error(
            `FFmpeg failed${terminationSignal ? ` (${terminationSignal})` : ''}: ${stderr.trim() || `exit code ${code}`}`,
          ),
        )
    })

    if (inputWriter) {
      Promise.resolve()
        .then(() => inputWriter(child.stdin))
        .then(() => {
          throwIfAborted(signal)
          child.stdin.end()
        })
        .catch((error) => {
          writerError ||= error
          if (error?.name === 'AbortError' || signal?.aborted) requestAbort()
          else {
            child.stdin.destroy(error)
            finishAbort()
          }
        })
    }
  })
}

async function findFfmpeg(preferredPath, signal) {
  for (const candidate of ffmpegExecutableCandidates({ preferredPath })) {
    try {
      await runProcess(candidate, ['-hide_banner', '-loglevel', 'error', '-version'], { signal })
      return candidate
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      // Try the next explicit or PATH-based candidate.
    }
  }
  throw new Error('FFmpeg was not found. Install FFmpeg or set OKAY_KARAOKE_FFMPEG to its path.')
}

function projectFonts(project) {
  const stage = project.stageStyle
  const fonts = [
    stage.lyrics,
    stage.titleCard.eyebrow,
    stage.titleCard.title,
    stage.titleCard.artist,
    stage.stageFrame.brand,
    stage.stageFrame.clock,
    stage.stageFrame.footer,
    ...project.tracks.map((track) => resolveVocalStyle(stage.lyrics, track.vocalStyle)),
  ]
  return [
    ...new Map(
      fonts.map(({ typeface, fontStyle }) => [
        JSON.stringify([typeface, fontStyle]),
        { typeface, fontStyle },
      ]),
    ).values(),
  ]
}

async function prepareStyleRuntime(project, backgroundImage) {
  const runtime = {
    backgroundDataUrl: '',
    fonts: projectFonts(project),
    stageLayout: STAGE_LAYOUT,
    syncAidGeometry: SYNC_AID_GEOMETRY,
  }
  const background = project.stageStyle.background
  if (background.mode !== 'image') return runtime
  if (
    !backgroundImage ||
    !Buffer.isBuffer(backgroundImage.bytes) ||
    (backgroundImage.mime !== 'image/png' && backgroundImage.mime !== 'image/jpeg')
  ) {
    throw new Error('The linked background image snapshot is unavailable')
  }
  runtime.backgroundDataUrl = `data:${backgroundImage.mime};base64,${backgroundImage.bytes.toString('base64')}`
  return runtime
}

async function writeJpegFrame(stream, frame, signal) {
  throwIfAborted(signal)
  if (stream.destroyed) throw new Error('FFmpeg stopped accepting video frames')
  if (!stream.write(frame)) {
    await once(stream, 'drain', signal ? { signal } : undefined)
  }
  throwIfAborted(signal)
}

async function renderVideoFrames(
  BrowserWindow,
  project,
  timeline,
  stream,
  settings,
  runtime,
  onProgress,
  signal,
  platform = process.platform,
) {
  throwIfAborted(signal)
  const window = new BrowserWindow({
    show: false,
    width: settings.width + (platform === 'win32' ? FRAME_MARKER_BITS : 0),
    height: settings.height,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setFrameRate(OFFSCREEN_CAPTURE_FPS)
  const onAbort = () => {
    if (!window.isDestroyed()) window.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(renderDocument(settings))}`
    await window.loadURL(documentUrl)
    throwIfAborted(signal)
    window.webContents.stopPainting()
    const assetResult = await window.webContents.executeJavaScript(assetInvocation(runtime))
    throwIfAborted(signal)
    const planFrame = createStageFramePlanner(project)
    let lastProgressMs = Number.NEGATIVE_INFINITY

    for (let frameIndex = 0; frameIndex < timeline.times.length; frameIndex += 1) {
      throwIfAborted(signal)
      const currentMs = timeline.times[frameIndex]
      const state = planFrame(currentMs)
      const frame = await presentRequestedFrame(
        window.webContents,
        () => window.webContents.executeJavaScript(frameInvocation(state, frameIndex)),
        settings,
        signal,
        platform === 'win32' ? frameIndex + 1 : null,
      )
      await writeJpegFrame(stream, frame, signal)
      if (
        frameIndex === 0 ||
        frameIndex === timeline.times.length - 1 ||
        currentMs - lastProgressMs >= 100
      ) {
        lastProgressMs = currentMs
        onProgress?.({ phase: 'frames', completed: frameIndex + 1, total: timeline.times.length })
      }
    }
    return assetResult
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!window.isDestroyed()) window.destroy()
  }
}

function buildFfmpegArguments(audioPath, outputPath, durationMs, settings = {}) {
  const { fps } = normalizeVideoSettings(settings)
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-probesize',
    '32768',
    '-analyzeduration',
    '0',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
    '-vcodec',
    'mjpeg',
    '-i',
    'pipe:0',
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    `setpts=N/(${fps}*TB),format=yuv420p`,
    '-fps_mode:v',
    'passthrough',
    '-enc_time_base:v',
    `1:${fps}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-bf',
    '0',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-af',
    'apad',
    '-t',
    (durationMs / 1000).toFixed(3),
    '-movflags',
    '+faststart',
    outputPath,
  ]
}

async function exportKaraokeVideo({
  BrowserWindow,
  projectJson,
  durationMs,
  audioPath,
  outputPath,
  ffmpegPath,
  backgroundImage,
  resolution = DEFAULT_VIDEO_RESOLUTION,
  fps = DEFAULT_VIDEO_FPS,
  onProgress,
  onPromotionStart,
  onPromotionComplete,
  signal,
}) {
  throwIfAborted(signal)
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required')
  const project = parseProjectForVideo(projectJson)
  const requestedAudioPath = limitedText(audioPath || project.audioPath, '', 8_192).trim()
  const requestedOutputPath = limitedText(outputPath, '', 8_192).trim()
  if (!requestedAudioPath || !requestedOutputPath)
    throw new TypeError('Audio and output paths are required')
  const resolvedAudioPath = path.resolve(requestedAudioPath)
  const resolvedOutputPath = path.resolve(requestedOutputPath)
  const settings = normalizeVideoSettings({ resolution, fps })

  const audioStats = await fs.stat(resolvedAudioPath).catch(() => null)
  if (!audioStats?.isFile()) throw new Error('The linked audio file could not be read')
  const timeline = buildFrameTimelineForProject(project, durationMs, settings.fps)
  throwIfAborted(signal)
  const runtime = await prepareStyleRuntime(project, backgroundImage)
  throwIfAborted(signal)
  const executable = ffmpegPath || (await findFfmpeg(undefined, signal))
  const parsedOutput = path.parse(resolvedOutputPath)
  const partialPath = path.join(
    parsedOutput.dir,
    `${parsedOutput.name}.partial-${randomUUID()}${parsedOutput.ext || '.mp4'}`,
  )
  let preservePartial = false
  let fontFallbacks = []

  try {
    throwIfAborted(signal)
    onProgress?.({ phase: 'preparing', completed: 0, total: 1 })
    await runProcess(
      executable,
      buildFfmpegArguments(resolvedAudioPath, partialPath, timeline.durationMs, settings),
      {
        signal,
        inputWriter: async (stream) => {
          const assets = await renderVideoFrames(
            BrowserWindow,
            project,
            timeline,
            stream,
            settings,
            runtime,
            onProgress,
            signal,
          )
          fontFallbacks = Array.isArray(assets?.fontFallbacks) ? assets.fontFallbacks : []
          throwIfAborted(signal)
          onProgress?.({ phase: 'encoding', completed: 0, total: 1 })
        },
      },
    )
    throwIfAborted(signal)
    await promoteVideoOutput(partialPath, resolvedOutputPath, {
      onPromotionStart,
      onPromotionComplete,
    })
    onProgress?.({ phase: 'complete', completed: 1, total: 1 })
    return {
      path: resolvedOutputPath,
      durationMs: timeline.durationMs,
      frameCount: timeline.times.length,
      resolution: settings.resolution,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      fontFallbacks,
    }
  } catch (error) {
    preservePartial = error?.name === 'AbortError' || signal?.aborted === true
    if (preservePartial && error instanceof Error) {
      error.message = `Video export canceled. Partial output was kept beside the destination as ${path.basename(partialPath)}`
    }
    throw error
  } finally {
    if (!preservePartial) await fs.rm(partialPath, { force: true }).catch(() => {})
  }
}

module.exports = {
  MAX_VIDEO_DURATION_MS,
  MAX_VIDEO_FRAMES,
  VIDEO_FRAME_RATES,
  VIDEO_RESOLUTION_PRESETS,
  buildFfmpegArguments,
  buildFrameTimeline,
  createVideoExportCommitState,
  effectiveVideoDuration,
  exportKaraokeVideo,
  findFfmpeg,
  frameStateAt,
  normalizeProjectForVideo,
  normalizeVideoSettings,
  parseProjectForVideo,
  prepareStyleRuntime,
  promoteVideoOutput,
  renderVideoFrames,
  renderDocument,
}
