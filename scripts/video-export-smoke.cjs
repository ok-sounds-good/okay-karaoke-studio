'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { exportKaraokeVideo, findFfmpeg } = require('../electron/video-export.cjs')

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

function rationalValue(value) {
  const [numerator, denominator = '1'] = String(value).split('/')
  return Number(numerator) / Number(denominator)
}

function decodeRgbFrame(ffmpegPath, videoPath, frameIndex, width, height) {
  const frameBytes = width * height * 3
  const decoded = spawnSync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-an',
      '-vf',
      `select=eq(n\\,${frameIndex})`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: frameBytes * 2 },
  )
  if (decoded.status !== 0) {
    throw new Error(decoded.stderr?.toString() || `Could not decode video frame ${frameIndex}`)
  }
  if (!Buffer.isBuffer(decoded.stdout) || decoded.stdout.length !== frameBytes) {
    throw new Error(
      `Expected ${frameBytes} RGB bytes for frame ${frameIndex}, received ${decoded.stdout?.length ?? 0}`,
    )
  }
  return decoded.stdout
}

function lyricFrameDifference(before, after, width, height) {
  // The lyric text is centered in this crop. Excluding the header keeps the
  // clock and brand from masking a missing word transition.
  const left = Math.floor(width * 0.16)
  const right = Math.ceil(width * 0.84)
  const top = Math.floor(height * 0.36)
  const bottom = Math.ceil(height * 0.64)
  let changedPixels = 0
  let totalDifference = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const pixel = (y * width + x) * 3
      const redDifference = Math.abs(after[pixel] - before[pixel])
      const greenDifference = Math.abs(after[pixel + 1] - before[pixel + 1])
      const blueDifference = Math.abs(after[pixel + 2] - before[pixel + 2])
      const strongestDifference = Math.max(redDifference, greenDifference, blueDifference)
      if (strongestDifference >= 12) changedPixels += 1
      totalDifference += redDifference + greenDifference + blueDifference
    }
  }
  return { changedPixels, totalDifference }
}

function assertHighlightStartsOnPlannedFrame({
  ffmpegPath,
  videoPath,
  width,
  height,
  fps,
  startMs,
  label,
}) {
  const boundaryFrame = (startMs * fps) / 1_000
  if (!Number.isInteger(boundaryFrame)) {
    throw new Error(`${label} must start on an exact ${fps} fps frame boundary`)
  }
  const boundaryRgb = decodeRgbFrame(ffmpegPath, videoPath, boundaryFrame, width, height)
  const firstProgressRgb = decodeRgbFrame(ffmpegPath, videoPath, boundaryFrame + 1, width, height)
  const difference = lyricFrameDifference(boundaryRgb, firstProgressRgb, width, height)
  const minimumChangedPixels = Math.max(8, Math.round((width * height) / 10_000))
  if (difference.changedPixels < minimumChangedPixels) {
    let firstObservedChange
    for (let frameOffset = 2; frameOffset <= 4; frameOffset += 1) {
      const laterRgb = decodeRgbFrame(
        ffmpegPath,
        videoPath,
        boundaryFrame + frameOffset,
        width,
        height,
      )
      const laterDifference = lyricFrameDifference(boundaryRgb, laterRgb, width, height)
      if (laterDifference.changedPixels >= minimumChangedPixels) {
        firstObservedChange = {
          frame: boundaryFrame + frameOffset,
          ...laterDifference,
        }
        break
      }
    }
    throw new Error(
      `${label} highlight did not appear on frame ${boundaryFrame + 1} at ${fps} fps: ` +
        `changed-pixels=${difference.changedPixels}, total-difference=${difference.totalDifference}, ` +
        `minimum-changed-pixels=${minimumChangedPixels}, ` +
        `first-observed-change=${JSON.stringify(firstObservedChange ?? null)}`,
    )
  }
  return {
    boundaryFrame,
    firstProgressFrame: boundaryFrame + 1,
    ...difference,
  }
}

app.on('window-all-closed', () => {})

app
  .whenReady()
  .then(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'okay-karaoke-video-smoke-'))
    const audioPath = path.join(directory, 'silence.wav')
    const outputPath = path.join(directory, 'smoke.mp4')

    try {
      // One second of audio exercises FFmpeg's silence padding against a
      // two-second lyric/video timeline.
      await fs.writeFile(audioPath, silentWav(1))
      const ffmpegPath = await findFfmpeg()
      const project = JSON.parse(
        await fs.readFile(
          path.join(__dirname, '..', 'tests', 'fixtures', 'current-project-v0.json'),
          'utf8',
        ),
      )
      Object.assign(project, {
        id: 'video-export-smoke',
        title: 'Video export smoke test',
        artist: 'Okay Karaoke Studio',
        audioPath,
        durationMs: 2_000,
        offsetMs: 0,
      })
      Object.assign(project.stageStyle.background, {
        mode: 'gradient',
        imagePath: null,
      })
      Object.assign(project.tracks[0], {
        id: 'smoke-track',
        lines: [
          {
            id: 'smoke-line',
            text: 'Smoke test',
            startMs: 500,
            endMs: 1_500,
            words: [
              // These exact 30/60 fps boundaries make the first post-boundary
              // frame visibly different, so a stale or one-frame-late capture
              // fails the decoded-output assertions below.
              { id: 'smoke-word-1', text: 'Smoke', startMs: 500, endMs: 700 },
              { id: 'smoke-word-2', text: 'test', startMs: 700, endMs: 900 },
            ],
          },
        ],
      })
      const result = await exportKaraokeVideo({
        BrowserWindow,
        projectJson: JSON.stringify(project),
        durationMs: 2_000,
        audioPath,
        outputPath,
        ffmpegPath,
        resolution: '240p',
        fps: 30,
      })
      const probe = spawnSync(
        probeExecutable(ffmpegPath),
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration,start_time:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,duration,start_time',
          '-of',
          'json',
          outputPath,
        ],
        { encoding: 'utf8' },
      )
      if (probe.status !== 0) throw new Error(probe.stderr || 'FFprobe failed')
      const report = JSON.parse(probe.stdout)
      const video = report.streams.find((stream) => stream.codec_name === 'h264')
      const audio = report.streams.find((stream) => stream.codec_name === 'aac')
      const duration = Number(report.format.duration)
      const videoStartSeconds = Number(video?.start_time)
      const audioStartSeconds = Number(audio?.start_time)
      if (
        !video ||
        video.width !== 426 ||
        video.height !== 240 ||
        Math.abs(rationalValue(video.r_frame_rate) - 30) > 0.001 ||
        !audio
      ) {
        throw new Error(`Unexpected video streams: ${probe.stdout}`)
      }
      if (Math.abs(videoStartSeconds - audioStartSeconds) > 0.001) {
        throw new Error(
          `Expected synchronized audio/video starts, received video=${videoStartSeconds}, audio=${audioStartSeconds}`,
        )
      }
      if (Math.abs(duration - 2) > 0.05) {
        throw new Error(`Expected a 2-second video, received ${duration} seconds`)
      }
      const highlightTransitions30 = [
        assertHighlightStartsOnPlannedFrame({
          ffmpegPath,
          videoPath: outputPath,
          width: 426,
          height: 240,
          fps: 30,
          startMs: 500,
          label: 'First word',
        }),
        assertHighlightStartsOnPlannedFrame({
          ffmpegPath,
          videoPath: outputPath,
          width: 426,
          height: 240,
          fps: 30,
          startMs: 700,
          label: 'Second word',
        }),
      ]

      const output60Path = path.join(directory, 'smoke-60fps.mp4')
      const result60 = await exportKaraokeVideo({
        BrowserWindow,
        projectJson: JSON.stringify(project),
        durationMs: 2_000,
        audioPath,
        outputPath: output60Path,
        ffmpegPath,
        resolution: '360p',
        fps: 60,
      })
      const probe60 = spawnSync(
        probeExecutable(ffmpegPath),
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration,start_time:stream=codec_name,width,height,r_frame_rate,start_time',
          '-of',
          'json',
          output60Path,
        ],
        { encoding: 'utf8' },
      )
      if (probe60.status !== 0) throw new Error(probe60.stderr || '60 fps FFprobe failed')
      const report60 = JSON.parse(probe60.stdout)
      const video60 = report60.streams.find((stream) => stream.codec_name === 'h264')
      const audio60 = report60.streams.find((stream) => stream.codec_name === 'aac')
      if (
        !video60 ||
        video60.width !== 640 ||
        video60.height !== 360 ||
        Math.abs(rationalValue(video60.r_frame_rate) - 60) > 0.001 ||
        !audio60 ||
        Math.abs(Number(video60.start_time) - Number(audio60.start_time)) > 0.001 ||
        Math.abs(Number(report60.format.duration) - 2) > 0.05
      ) {
        throw new Error(`Unexpected 60 fps video streams: ${probe60.stdout}`)
      }
      const highlightTransitions60 = [
        assertHighlightStartsOnPlannedFrame({
          ffmpegPath,
          videoPath: output60Path,
          width: 640,
          height: 360,
          fps: 60,
          startMs: 500,
          label: 'First word',
        }),
        assertHighlightStartsOnPlannedFrame({
          ffmpegPath,
          videoPath: output60Path,
          width: 640,
          height: 360,
          fps: 60,
          startMs: 700,
          label: 'Second word',
        }),
      ]

      const canceledPath = path.join(directory, 'canceled.mp4')
      const controller = new AbortController()
      let cancellationObserved = false
      let cancellationScheduled = false
      try {
        await exportKaraokeVideo({
          BrowserWindow,
          projectJson: JSON.stringify(project),
          durationMs: 2_000,
          audioPath,
          outputPath: canceledPath,
          ffmpegPath,
          resolution: '240p',
          fps: 30,
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.phase === 'frames' && progress.completed >= 15 && !cancellationScheduled) {
              cancellationScheduled = true
              setImmediate(() => controller.abort())
            }
          },
        })
      } catch (error) {
        if (error?.name !== 'AbortError') throw error
        cancellationObserved = true
      }
      const canceledDestinationExists = await fs.stat(canceledPath).then(
        () => true,
        () => false,
      )
      const partialPattern =
        /^canceled\.partial-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp4$/iu
      const directoryEntries = await fs.readdir(directory)
      const partialCancellationFiles = directoryEntries.filter((fileName) =>
        partialPattern.test(fileName),
      )
      if (
        !cancellationObserved ||
        canceledDestinationExists ||
        partialCancellationFiles.length !== 1
      ) {
        throw new Error(
          `Canceled video export did not preserve exactly one partial output: ${JSON.stringify(directoryEntries)}`,
        )
      }

      console.log(
        JSON.stringify({
          ...result,
          sixtyFpsFrameCount: result60.frameCount,
          codecs: ['h264', 'aac'],
          resolution: '426x240',
          fps: 30,
          verified60FpsResolution: '640x360',
          probedDurationSeconds: duration,
          videoStartSeconds,
          audioStartSeconds,
          paddedAudio: true,
          highlightTransitions30,
          highlightTransitions60,
          cancellationPartialPreserved: true,
        }),
      )
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
      app.quit()
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
