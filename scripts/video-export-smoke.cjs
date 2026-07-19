'use strict'

const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const presets = require('../electron/video-export-presets.json')
const { exportKaraokeVideo, findFfmpeg } = require('../electron/video-export.cjs')

const ROOT_ENVIRONMENT_KEY = 'OKS_VIDEO_SMOKE_ROOT'
const FIXTURE_DURATION_MS = 1_000
const AUDIO_DURATION_SECONDS = 0.5
const CASE_TIMEOUT_MS = 2 * 60 * 1_000
const PROCESS_TIMEOUT_MS = 30_000
const MAX_DIAGNOSTIC_CHARACTERS = 400
const MATRIX = Object.freeze(
  presets.resolutions
    .flatMap((preset) =>
      presets.frameRates.map((fps, index) => Object.freeze({ ...preset, fps, ordinal: index + 1 })),
    )
    .map((entry, index) => Object.freeze({ ...entry, ordinal: index + 1 })),
)

function silentWav(durationSeconds, sampleRate = 48_000) {
  const channels = 2
  const bytesPerSample = 2
  const dataLength = durationSeconds * sampleRate * channels * bytesPerSample
  const wav = Buffer.alloc(44 + dataLength)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataLength, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  wav.writeUInt16LE(channels * bytesPerSample, 32)
  wav.writeUInt16LE(bytesPerSample * 8, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataLength, 40)
  return wav
}

function probeExecutable(ffmpegPath) {
  if (path.basename(ffmpegPath).toLowerCase().startsWith('ffmpeg')) {
    return path.join(
      path.dirname(ffmpegPath),
      process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
    )
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
}

function sanitizedDiagnostic(value, root) {
  const diagnostic = String(value || 'unknown failure')
  return (root ? diagnostic.split(root).join('<smoke-root>') : diagnostic)
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .slice(0, MAX_DIAGNOSTIC_CHARACTERS)
}

function checkedSpawn(executable, args, options, label, root) {
  const result = spawnSync(executable, args, {
    ...options,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label}: ${sanitizedDiagnostic(result.error?.message || result.stderr, root)}`,
    )
  }
  return result
}

function rationalValue(value) {
  const [numerator, denominator = '1'] = String(value).split('/')
  const numeratorValue = Number(numerator)
  const denominatorValue = Number(denominator)
  if (
    !Number.isFinite(numeratorValue) ||
    !Number.isFinite(denominatorValue) ||
    denominatorValue === 0
  ) {
    return Number.NaN
  }
  return numeratorValue / denominatorValue
}

function cropFor(width, height) {
  const cropWidth = Math.min(1_024, Math.floor((width * 0.68) / 2) * 2)
  const cropHeight = Math.min(320, Math.floor((height * 0.28) / 2) * 2)
  return {
    height: cropHeight,
    width: cropWidth,
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor(height * 0.36),
  }
}

function decodeLyricCrop(ffmpegPath, videoPath, frameIndex, width, height, root) {
  const crop = cropFor(width, height)
  const frameBytes = crop.width * crop.height * 3
  const decoded = checkedSpawn(
    ffmpegPath,
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-an',
      '-vf',
      `select=eq(n\\,${frameIndex}),crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: frameBytes + 1_024 },
    `decode frame ${frameIndex}`,
    root,
  )
  if (!Buffer.isBuffer(decoded.stdout) || decoded.stdout.length !== frameBytes) {
    throw new Error(`decode frame ${frameIndex}: expected ${frameBytes} bytes`)
  }
  return decoded.stdout
}

function lyricDifference(before, after) {
  let changedPixels = 0
  let totalDifference = 0
  for (let pixel = 0; pixel < before.length; pixel += 3) {
    const red = Math.abs(after[pixel] - before[pixel])
    const green = Math.abs(after[pixel + 1] - before[pixel + 1])
    const blue = Math.abs(after[pixel + 2] - before[pixel + 2])
    if (Math.max(red, green, blue) >= 12) changedPixels += 1
    totalDifference += red + green + blue
  }
  return { changedPixels, totalDifference }
}

function lyricEvidence({ ffmpegPath, videoPath, width, height, fps, startMs, root }) {
  const boundaryFrame = (startMs * fps) / 1_000
  if (!Number.isInteger(boundaryFrame)) throw new Error('transition is not frame-aligned')
  const before = decodeLyricCrop(ffmpegPath, videoPath, boundaryFrame, width, height, root)
  const crop = cropFor(width, height)
  const minimumChangedPixels = Math.max(8, Math.round((crop.width * crop.height) / 10_000))
  const maximumOffset = Math.ceil(fps * 0.15)
  for (let offset = 1; offset <= maximumOffset; offset += 1) {
    const after = decodeLyricCrop(
      ffmpegPath,
      videoPath,
      boundaryFrame + offset,
      width,
      height,
      root,
    )
    const difference = lyricDifference(before, after)
    if (difference.changedPixels >= minimumChangedPixels) {
      return { boundaryFrame, firstProgressFrame: boundaryFrame + offset, ...difference }
    }
  }
  throw new Error(`transition did not appear within 150ms of frame ${boundaryFrame}`)
}

function projectFixture(project, audioPath) {
  Object.assign(project, {
    id: 'video-export-smoke',
    title: 'Video export smoke test',
    artist: 'Okay Karaoke Studio',
    audioPath,
    durationMs: FIXTURE_DURATION_MS,
    offsetMs: 0,
  })
  Object.assign(project.stageStyle.background, { mode: 'gradient', imagePath: null })
  Object.assign(project.tracks[0], {
    id: 'smoke-track',
    lines: [
      {
        id: 'smoke-line',
        text: 'Smoke test',
        startMs: 300,
        endMs: 800,
        words: [
          { id: 'smoke-word-1', text: 'Smoke', startMs: 300, endMs: 500 },
          { id: 'smoke-word-2', text: 'test', startMs: 500, endMs: 700 },
        ],
      },
    ],
  })
  return project
}

function failCase(entry, phase, error) {
  const failure = new Error(error?.message || String(error))
  failure.case = {
    ordinal: entry?.ordinal ?? 0,
    preset: entry?.value ?? 'setup',
    fps: entry?.fps ?? 0,
    phase,
  }
  return failure
}

async function probeCase(entry, ffmpegPath, outputPath, root) {
  const probe = checkedSpawn(
    probeExecutable(ffmpegPath),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,start_time:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,start_time',
      '-of',
      'json',
      outputPath,
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1_024 },
    'ffprobe',
    root,
  )
  const report = JSON.parse(probe.stdout)
  const streams = Array.isArray(report.streams) ? report.streams : []
  const videos = streams.filter((stream) => stream.codec_type === 'video')
  const audios = streams.filter((stream) => stream.codec_type === 'audio')
  const video = videos[0]
  const audio = audios[0]
  const durationSeconds = Number(report.format?.duration)
  const videoStartSeconds = Number(video?.start_time)
  const audioStartSeconds = Number(audio?.start_time)
  const renderedRate = rationalValue(video?.r_frame_rate)
  const averageRate = rationalValue(video?.avg_frame_rate)
  if (
    streams.length !== 2 ||
    videos.length !== 1 ||
    audios.length !== 1 ||
    video.codec_name !== 'h264' ||
    audio.codec_name !== 'aac' ||
    video.width !== entry.width ||
    video.height !== entry.height ||
    !Number.isFinite(renderedRate) ||
    !Number.isFinite(averageRate) ||
    Math.abs(renderedRate - entry.fps) > 0.001 ||
    Math.abs(averageRate - entry.fps) > 0.001 ||
    !Number.isFinite(videoStartSeconds) ||
    !Number.isFinite(audioStartSeconds) ||
    Math.abs(videoStartSeconds) > 0.001 ||
    Math.abs(audioStartSeconds) > 0.001 ||
    Math.abs(videoStartSeconds - audioStartSeconds) > 0.001 ||
    !Number.isFinite(durationSeconds) ||
    Math.abs(durationSeconds - FIXTURE_DURATION_MS / 1_000) > 0.05
  ) {
    throw new Error('observed stream contract does not match requested output')
  }
  return {
    observedDimensions: { width: video.width, height: video.height },
    rationalRate: { average: video.avg_frame_rate, rendered: video.r_frame_rate },
    codecs: { audio: audio.codec_name, video: video.codec_name },
    streamStarts: { audioSeconds: audioStartSeconds, videoSeconds: videoStartSeconds },
    durationSeconds,
  }
}

async function exportCase(entry, context) {
  const outputPath = path.join(context.root, `${entry.ordinal}-${entry.value}-${entry.fps}.mp4`)
  let exported
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CASE_TIMEOUT_MS)
  try {
    exported = await exportKaraokeVideo({
      BrowserWindow,
      projectJson: context.projectJson,
      durationMs: FIXTURE_DURATION_MS,
      audioPath: context.audioPath,
      outputPath,
      ffmpegPath: context.ffmpegPath,
      resolution: entry.value,
      fps: entry.fps,
      signal: controller.signal,
    })
  } catch (error) {
    throw failCase(entry, timedOut ? 'export-timeout' : 'export', error)
  } finally {
    clearTimeout(timeout)
  }
  let probe
  try {
    probe = await probeCase(entry, context.ffmpegPath, outputPath, context.root)
  } catch (error) {
    throw failCase(entry, 'probe', error)
  }
  let decodedLyricEvidence
  try {
    const starts = entry.ordinal <= 2 ? [300, 500] : [300]
    decodedLyricEvidence = starts.map((startMs) =>
      lyricEvidence({
        ...entry,
        ffmpegPath: context.ffmpegPath,
        videoPath: outputPath,
        startMs,
        root: context.root,
      }),
    )
    if (
      entry.ordinal <= 2 &&
      decodedLyricEvidence.some(
        (evidence) => evidence.firstProgressFrame !== evidence.boundaryFrame + 1,
      )
    ) {
      throw new Error('representative highlight did not appear on its first progress frame')
    }
  } catch (error) {
    throw failCase(entry, 'decode', error)
  }
  const file = await fs.readFile(outputPath)
  const expectedFrameCount = (FIXTURE_DURATION_MS * entry.fps) / 1_000
  if (exported.frameCount !== expectedFrameCount || file.length < 1) {
    throw failCase(entry, 'validate', new Error('export result or output size is invalid'))
  }
  return {
    ordinal: entry.ordinal,
    preset: entry.value,
    fps: entry.fps,
    ...probe,
    decodedLyricEvidence,
    bytes: file.length,
    sha256: createHash('sha256').update(file).digest('hex'),
  }
}

async function verifyCancellation(context) {
  const outputPath = path.join(context.root, 'canceled.mp4')
  const controller = new AbortController()
  let observed = false
  let scheduled = false
  try {
    await exportKaraokeVideo({
      BrowserWindow,
      projectJson: context.projectJson,
      durationMs: FIXTURE_DURATION_MS,
      audioPath: context.audioPath,
      outputPath,
      ffmpegPath: context.ffmpegPath,
      resolution: '240p',
      fps: 30,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'frames' && progress.completed >= 8 && !scheduled) {
          scheduled = true
          setImmediate(() => controller.abort())
        }
      },
    })
  } catch (error) {
    if (error?.name !== 'AbortError') throw failCase(null, 'cancellation', error)
    observed = true
  }
  const entries = await fs.readdir(context.root)
  const partials = entries.filter((name) => /^canceled\.partial-[0-9a-f-]{36}\.mp4$/iu.test(name))
  const destinationExists = await fs.stat(outputPath).then(
    () => true,
    () => false,
  )
  if (!observed || destinationExists || partials.length !== 1) {
    throw failCase(null, 'cancellation', new Error('partial-output contract failed'))
  }
  return { cancellationPartialPreserved: true }
}

async function writeJson(root, name, value) {
  const temporary = path.join(root, `${name}.partial`)
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx' })
  await fs.rename(temporary, path.join(root, name))
}

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const root = process.env[ROOT_ENVIRONMENT_KEY]
  try {
    if (!root || !path.isAbsolute(root)) throw failCase(null, 'setup', new Error('invalid root'))
    const audioPath = path.join(root, 'silence.wav')
    await fs.writeFile(audioPath, silentWav(AUDIO_DURATION_SECONDS), { flag: 'wx' })
    const ffmpegPath = await findFfmpeg()
    const fixture = JSON.parse(
      await fs.readFile(path.join(__dirname, '..', 'tests', 'fixtures', 'current-project-v0.json')),
    )
    const context = {
      root,
      audioPath,
      ffmpegPath,
      projectJson: JSON.stringify(projectFixture(fixture, audioPath)),
    }
    const cases = []
    for (const entry of MATRIX) cases.push(await exportCase(entry, context))
    const cancellation = await verifyCancellation(context)
    await writeJson(root, 'result.json', {
      ok: true,
      fixture: { audioSeconds: AUDIO_DURATION_SECONDS, videoSeconds: FIXTURE_DURATION_MS / 1_000 },
      cases,
      ...cancellation,
    })
  } catch (error) {
    try {
      await writeJson(root, 'failure.json', {
        ok: false,
        code: 'VIDEO_SMOKE_CHILD_FAILED',
        case: error?.case || { ordinal: 0, preset: 'setup', fps: 0, phase: 'setup' },
        diagnostic: sanitizedDiagnostic(error?.message, root || ''),
      })
    } catch {}
    process.exitCode = 1
  } finally {
    app.exit(process.exitCode || 0)
  }
})
