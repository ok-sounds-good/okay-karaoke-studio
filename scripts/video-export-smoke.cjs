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

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'okay-karaoke-video-smoke-'))
  const audioPath = path.join(directory, 'silence.wav')
  const outputPath = path.join(directory, 'smoke.mp4')

  try {
    // One second of audio exercises FFmpeg's silence padding against a
    // two-second lyric/video timeline.
    await fs.writeFile(audioPath, silentWav(1))
    const ffmpegPath = await findFfmpeg()
    const project = {
      title: 'Video export smoke test',
      artist: 'Okay Karaoke Studio',
      audioPath,
      durationMs: 2_000,
      offsetMs: 0,
      tracks: [{
        name: 'Lead Vocal',
        color: '#d7fa4a',
        muted: false,
        solo: false,
        lines: [{
          text: 'Smoke test',
          startMs: 500,
          endMs: 1_500,
          words: [
            { text: 'Smoke', startMs: 500, endMs: 1_000 },
            { text: 'test', startMs: 1_000, endMs: 1_500 },
          ],
        }],
      }],
    }
    const result = await exportKaraokeVideo({
      BrowserWindow,
      projectJson: JSON.stringify(project),
      durationMs: 2_000,
      audioPath,
      outputPath,
      ffmpegPath,
    })
    const probe = spawnSync(probeExecutable(ffmpegPath), [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_name,width,height',
      '-of', 'json',
      outputPath,
    ], { encoding: 'utf8' })
    if (probe.status !== 0) throw new Error(probe.stderr || 'FFprobe failed')
    const report = JSON.parse(probe.stdout)
    const video = report.streams.find((stream) => stream.codec_name === 'h264')
    const audio = report.streams.find((stream) => stream.codec_name === 'aac')
    const duration = Number(report.format.duration)
    if (!video || video.width !== 1920 || video.height !== 1080 || !audio) {
      throw new Error(`Unexpected video streams: ${probe.stdout}`)
    }
    if (Math.abs(duration - 2) > 0.05) {
      throw new Error(`Expected a 2-second video, received ${duration} seconds`)
    }

    const canceledPath = path.join(directory, 'canceled.mp4')
    const controller = new AbortController()
    let cancellationObserved = false
    try {
      await exportKaraokeVideo({
        BrowserWindow,
        projectJson: JSON.stringify(project),
        durationMs: 2_000,
        audioPath,
        outputPath: canceledPath,
        ffmpegPath,
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.phase === 'frames' && progress.completed === 1) controller.abort()
        },
      })
    } catch (error) {
      if (error?.name !== 'AbortError') throw error
      cancellationObserved = true
    }
    const leftoverCancellationFiles = (await fs.readdir(directory))
      .filter((fileName) => fileName.startsWith('canceled.mp4'))
    if (!cancellationObserved || leftoverCancellationFiles.length > 0) {
      throw new Error('Canceled video export did not remove its partial output')
    }

    console.log(JSON.stringify({
      ...result,
      codecs: ['h264', 'aac'],
      resolution: '1920x1080',
      paddedAudio: true,
      cancellationClean: true,
    }))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
    app.quit()
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
