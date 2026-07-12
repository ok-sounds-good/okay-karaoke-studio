'use strict'

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const VIDEO_WIDTH = 1920
const VIDEO_HEIGHT = 1080
const VIDEO_RENDER_FPS = 10
const VIDEO_OUTPUT_FPS = 30
const FRAME_INTERVAL_MS = 1_000 / VIDEO_RENDER_FPS
const MAX_VIDEO_DURATION_MS = 30 * 60 * 1000
const MAX_VIDEO_FRAMES = Math.ceil(MAX_VIDEO_DURATION_MS / FRAME_INTERVAL_MS)
const MAX_TRACKS = 2
const MAX_LINES = 20_000
const MAX_WORDS = 150_000

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

function normalizeTiming(value, label) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer or null`)
  if (value < 0 || value > MAX_VIDEO_DURATION_MS) {
    throw new RangeError(`${label} must be between zero and thirty minutes`)
  }
  return value
}

function validateTimingPair(startMs, endMs, label) {
  if ((startMs === null) !== (endMs === null)) {
    throw new TypeError(`${label} must have both a start and end time, or neither`)
  }
  if (startMs !== null && endMs <= startMs) {
    throw new RangeError(`${label} must end after it starts`)
  }
}

function normalizeProjectForVideo(value) {
  if (!isRecord(value)) throw new TypeError('Video export requires a project object')
  if (!Array.isArray(value.tracks) || value.tracks.length === 0 || value.tracks.length > MAX_TRACKS) {
    throw new TypeError(`Video export supports between 1 and ${MAX_TRACKS} vocal tracks`)
  }

  let lineCount = 0
  let wordCount = 0
  const tracks = value.tracks.map((rawTrack, trackIndex) => {
    if (!isRecord(rawTrack) || !Array.isArray(rawTrack.lines)) {
      throw new TypeError(`tracks[${trackIndex}] is invalid`)
    }
    lineCount += rawTrack.lines.length
    if (lineCount > MAX_LINES) throw new RangeError(`Video export supports at most ${MAX_LINES} lyric lines`)

    const lines = rawTrack.lines.map((rawLine, lineIndex) => {
      if (!isRecord(rawLine) || !Array.isArray(rawLine.words)) {
        throw new TypeError(`tracks[${trackIndex}].lines[${lineIndex}] is invalid`)
      }
      wordCount += rawLine.words.length
      if (wordCount > MAX_WORDS) throw new RangeError(`Video export supports at most ${MAX_WORDS} words`)

      const words = rawLine.words.map((rawWord, wordIndex) => {
        if (!isRecord(rawWord)) {
          throw new TypeError(`tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}] is invalid`)
        }
        const startMs = normalizeTiming(
          rawWord.startMs,
          `tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}].startMs`,
        )
        const endMs = normalizeTiming(
          rawWord.endMs,
          `tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}].endMs`,
        )
        validateTimingPair(
          startMs,
          endMs,
          `tracks[${trackIndex}].lines[${lineIndex}].words[${wordIndex}]`,
        )
        return {
          text: limitedText(rawWord.text, '', 250),
          startMs,
          endMs,
        }
      })

      const startMs = normalizeTiming(
        rawLine.startMs,
        `tracks[${trackIndex}].lines[${lineIndex}].startMs`,
      )
      const endMs = normalizeTiming(
        rawLine.endMs,
        `tracks[${trackIndex}].lines[${lineIndex}].endMs`,
      )
      validateTimingPair(startMs, endMs, `tracks[${trackIndex}].lines[${lineIndex}]`)
      return {
        text: limitedText(rawLine.text, words.map((word) => word.text).join(' '), 2_000),
        startMs,
        endMs,
        words,
      }
    })

    return {
      name: limitedText(rawTrack.name, `Vocal ${trackIndex + 1}`, 120),
      color: /^#[0-9a-f]{6}$/iu.test(rawTrack.color) ? rawTrack.color : '#d7fa4a',
      muted: rawTrack.muted === true,
      solo: rawTrack.solo === true,
      lines,
    }
  })

  const durationMs = value.durationMs === null || value.durationMs === undefined
    ? 0
    : finiteInteger(value.durationMs, Number.NaN)
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > MAX_VIDEO_DURATION_MS) {
    throw new RangeError('Project duration must be between zero and thirty minutes')
  }
  const offsetMs = finiteInteger(value.offsetMs, Number.NaN)
  if (!Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > MAX_VIDEO_DURATION_MS) {
    throw new RangeError('Project offset must be within thirty minutes')
  }

  return {
    title: limitedText(value.title, 'Untitled song', 300),
    artist: limitedText(value.artist, 'Unknown artist', 300),
    audioPath: limitedText(value.audioPath, '', 8_192),
    durationMs,
    offsetMs,
    tracks,
  }
}

function parseProjectForVideo(json) {
  if (typeof json !== 'string') throw new TypeError('projectJson must be a string')
  if (Buffer.byteLength(json, 'utf8') > 50 * 1024 * 1024) {
    throw new RangeError('The project is too large to render as video')
  }
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new TypeError('The project JSON is invalid')
  }
  return normalizeProjectForVideo(parsed)
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
  return effectiveVideoDurationForProject(normalizeProjectForVideo(projectValue), requestedDurationMs)
}

function createVideoIndex(project) {
  const tracks = visibleTracks(project).map((track) => ({
    track,
    lines: track.lines
      .map((line) => ({ line, range: adjustedLineRange(line, project.offsetMs) }))
      .filter((entry) => entry.range)
      .sort((left, right) => left.range.startMs - right.range.startMs),
  }))
  const upcomingLines = tracks
    .flatMap(({ track, lines }) => lines.map((entry) => ({ ...entry, track })))
    .sort((left, right) => left.range.startMs - right.range.startMs)
  return {
    project,
    tracks,
    upcomingLines,
    firstStart: upcomingLines[0]?.range.startMs ?? Number.POSITIVE_INFINITY,
  }
}

function buildFrameTimelineForProject(project, requestedDurationMs) {
  const durationMs = effectiveVideoDurationForProject(project, requestedDurationMs)
  const frameCount = Math.ceil(durationMs / FRAME_INTERVAL_MS)
  if (frameCount > MAX_VIDEO_FRAMES) {
    throw new RangeError(`Video export would require more than ${MAX_VIDEO_FRAMES} lyric frames`)
  }
  const times = Array.from(
    { length: frameCount },
    (_unused, index) => Math.round(index * FRAME_INTERVAL_MS),
  )
  return { project, durationMs, times }
}

function buildFrameTimeline(projectValue, requestedDurationMs) {
  return buildFrameTimelineForProject(
    normalizeProjectForVideo(projectValue),
    requestedDurationMs,
  )
}

function lineProgress(line, lyricMs) {
  const displayWords = line.words.filter((word) => word.text)
  const totalCharacters = Math.max(
    1,
    displayWords.reduce((total, word) => total + word.text.replaceAll('/', '·').length, 0) + Math.max(0, displayWords.length - 1),
  )
  let charactersBefore = 0

  for (const word of displayWords) {
    const length = word.text.replaceAll('/', '·').length
    if (word.startMs === null || word.endMs === null) {
      charactersBefore += length + 1
      continue
    }
    if (lyricMs <= word.startMs) return Math.max(0, Math.min(1, charactersBefore / totalCharacters))
    if (lyricMs < word.endMs) {
      const progress = (lyricMs - word.startMs) / Math.max(1, word.endMs - word.startMs)
      return Math.max(0, Math.min(1, (charactersBefore + length * progress) / totalCharacters))
    }
    charactersBefore += length + 1
  }

  const range = rawLineRange(line)
  if (!displayWords.some((word) => word.startMs !== null && word.endMs !== null) && range) {
    return Math.max(0, Math.min(1, (lyricMs - range.startMs) / Math.max(1, range.endMs - range.startMs)))
  }
  return 1
}

function createFrameCursor(index) {
  return {
    trackPositions: index.tracks.map(() => 0),
    upcomingPosition: 0,
  }
}

function frameStateAtIndex(index, playbackMs, cursor) {
  const { project } = index
  const lyricMs = playbackMs - project.offsetMs
  const showTitle = Number.isFinite(index.firstStart) && playbackMs < Math.max(0, index.firstStart - 1_500)
  const lines = []
  const activeLines = new Set()

  index.tracks.forEach(({ track, lines: trackLines }, trackIndex) => {
    let activeEntry
    if (cursor) {
      let position = cursor.trackPositions[trackIndex]
      while (position < trackLines.length && playbackMs > trackLines[position].range.endMs + 500) {
        position += 1
      }
      cursor.trackPositions[trackIndex] = position
      const candidate = trackLines[position]
      if (
        candidate &&
        ((playbackMs >= candidate.range.startMs - 120 && playbackMs <= candidate.range.endMs + 500) ||
          (candidate.range.startMs > playbackMs && candidate.range.startMs - playbackMs < 1_800))
      ) {
        activeEntry = candidate
      }
    } else {
      activeEntry = trackLines.find(
        (entry) => playbackMs >= entry.range.startMs - 120 && playbackMs <= entry.range.endMs + 500,
      )
      activeEntry ||= trackLines.find(
        (entry) => entry.range.startMs > playbackMs && entry.range.startMs - playbackMs < 1_800,
      )
    }
    if (!activeEntry) return
    activeLines.add(activeEntry.line)
    lines.push({
      track: track.name,
      color: track.color,
      text: activeEntry.line.text.replaceAll('/', '·'),
      progress: lineProgress(activeEntry.line, lyricMs),
    })
  })

  let upcoming
  if (cursor) {
    while (
      cursor.upcomingPosition < index.upcomingLines.length &&
      (index.upcomingLines[cursor.upcomingPosition].range.startMs <= playbackMs ||
        activeLines.has(index.upcomingLines[cursor.upcomingPosition].line))
    ) {
      cursor.upcomingPosition += 1
    }
    upcoming = index.upcomingLines[cursor.upcomingPosition]
  } else {
    upcoming = index.upcomingLines.find(
      (entry) => entry.range.startMs > playbackMs && !activeLines.has(entry.line),
    )
  }

  return {
    title: project.title || 'Untitled song',
    artist: project.artist || 'Unknown artist',
    playbackMs,
    showTitle,
    instrumental: !showTitle && lines.length === 0,
    lines: lines.slice(0, 2),
    nextLine: !showTitle && upcoming ? upcoming.line.text.replaceAll('/', '·') : '',
    nextInMs: upcoming ? Math.max(0, upcoming.range.startMs - playbackMs) : null,
  }
}

function frameStateAt(projectValue, playbackMs) {
  const project = normalizeProjectForVideo(projectValue)
  return frameStateAtIndex(createVideoIndex(project), playbackMs)
}

function renderDocument() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#080a0e;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
body{position:relative;background:radial-gradient(circle at 18% 20%,rgba(215,250,74,.18),transparent 34%),radial-gradient(circle at 82% 35%,rgba(88,214,222,.16),transparent 38%),linear-gradient(155deg,#171e1b 0%,#0e1217 52%,#171119 100%)}
.grain{position:absolute;inset:0;opacity:.12;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:5px 5px}.safe{position:absolute;inset:64px 96px;border:2px solid rgba(255,255,255,.08);border-radius:30px}
.brand{position:absolute;left:86px;top:58px;font-size:25px;font-weight:800;letter-spacing:.22em;color:#d7fa4a}.clock{position:absolute;right:86px;top:56px;font:600 27px ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,255,255,.58)}
.content{position:absolute;inset:140px 130px 120px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.title-card span{font-size:25px;letter-spacing:.2em;text-transform:uppercase;color:#d7fa4a}.title-card h1{margin:34px 0 14px;font-size:104px;line-height:1.04;max-width:1500px}.title-card p{margin:0;font-size:42px;color:rgba(255,255,255,.68)}
.lines{width:100%;display:flex;flex-direction:column;gap:54px}.line-label{margin-bottom:14px;font-size:23px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}.lyric{position:relative;width:100%;height:1.22em;font-size:82px;line-height:1.15;font-weight:850;letter-spacing:.01em;white-space:nowrap}.lyric span{position:absolute;inset:0;text-align:center}.lyric .base{color:rgba(255,255,255,.46);text-shadow:0 5px 8px rgba(0,0,0,.8),0 0 4px #000}.lyric .fill{color:var(--accent);clip-path:inset(0 calc(100% - var(--progress)) 0 0);text-shadow:0 5px 8px rgba(0,0,0,.8),0 0 16px color-mix(in srgb,var(--accent) 42%,transparent)}
.instrumental{font-size:64px;font-weight:760;letter-spacing:.08em}.instrumental small{display:block;margin-top:25px;font-size:27px;font-weight:500;color:rgba(255,255,255,.55)}.next{position:absolute;bottom:28px;max-width:1450px;font-size:31px;color:rgba(255,255,255,.46);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.footer{position:absolute;left:86px;right:86px;bottom:53px;display:flex;justify-content:space-between;font-size:24px;color:rgba(255,255,255,.48)}
</style></head><body><div class="grain"></div><div class="safe"></div><div class="brand">OKAY / STUDIO</div><div id="clock" class="clock"></div><main id="content" class="content"></main><footer class="footer"><span id="footer-song"></span><span>Okay Karaoke Studio</span></footer><script>
const text=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=value;return node}
const fitSize=(value)=>Math.max(44,Math.min(88,Math.floor(1520/Math.max(12,value.length)*1.28)))
window.renderKaraokeFrame=(state,sequence)=>{document.body.dataset.frame=String(sequence);document.querySelector('#clock').textContent=new Date(Math.max(0,state.playbackMs)).toISOString().slice(11,19);document.querySelector('#footer-song').textContent=state.artist+' · '+state.title;const content=document.querySelector('#content');content.replaceChildren();
if(state.showTitle){const card=text('div','title-card','');card.append(text('span','',"Tonight's performance"),text('h1','',state.title),text('p','',state.artist));content.append(card)}else if(state.lines.length){const group=text('div','lines','');for(const item of state.lines){const line=text('div','line','');const label=text('div','line-label',item.track);label.style.color=item.color;const lyric=text('div','lyric','');lyric.style.setProperty('--accent',item.color);lyric.style.setProperty('--progress',(item.progress*100).toFixed(3)+'%');lyric.style.fontSize=fitSize(item.text)+'px';lyric.append(text('span','base',item.text),text('span','fill',item.text));line.append(label,lyric);group.append(line)}content.append(group)}else{const detail=state.nextInMs!==null&&state.nextInMs<=10000?'Lyrics resume in '+Math.max(1,Math.ceil(state.nextInMs/1000))+' seconds':'';const block=text('div','instrumental','Instrumental');if(detail)block.append(text('small','',detail));content.append(block)}
if(state.nextLine){const next=text('div','next','Next · '+state.nextLine);content.append(next)}return true}
</script></body></html>`
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

function captureNextPaint(contents, update, signal) {
  return new Promise((resolve, reject) => {
    let updateFinished = false
    const cleanup = () => {
      clearTimeout(timeout)
      contents.off('paint', onPaint)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error) => {
      cleanup()
      reject(error)
    }
    const timeout = setTimeout(() => {
      fail(new Error('Timed out while rendering a video frame'))
    }, 10_000)
    const onPaint = (_event, _dirtyRect, image) => {
      if (!updateFinished || image.isEmpty()) return
      cleanup()
      resolve(image)
    }
    const onAbort = () => fail(createAbortError())
    if (signal?.aborted) {
      fail(createAbortError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    contents.on('paint', onPaint)
    Promise.resolve()
      .then(update)
      .then(() => {
        throwIfAborted(signal)
        updateFinished = true
        contents.invalidate()
      })
      .catch(fail)
  })
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return null
  child.kill('SIGTERM')
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
    const onAbort = () => {
      writerError ||= createAbortError()
      child.stdin?.destroy(writerError)
      killTimeout ||= terminateChild(child)
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
      if (killTimeout) clearTimeout(killTimeout)
      signal?.removeEventListener?.('abort', onAbort)
      if (spawnError) reject(spawnError)
      else if (writerError?.name === 'AbortError' || signal?.aborted) reject(createAbortError())
      else if (code === 0 && !writerError) resolve()
      else if (code === 0) reject(writerError)
      else reject(new Error(`FFmpeg failed${terminationSignal ? ` (${terminationSignal})` : ''}: ${stderr.trim() || `exit code ${code}`}`))
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
          child.stdin.destroy(error)
          killTimeout ||= terminateChild(child)
        })
    }
  })
}

async function findFfmpeg(preferredPath, signal) {
  const candidates = [
    preferredPath,
    process.env.OKAY_KARAOKE_FFMPEG,
    'ffmpeg',
    process.platform === 'darwin' ? '/opt/homebrew/bin/ffmpeg' : null,
    process.platform === 'darwin' ? '/usr/local/bin/ffmpeg' : null,
  ].filter(Boolean)

  for (const candidate of [...new Set(candidates)]) {
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

async function writePngFrame(stream, image, signal) {
  throwIfAborted(signal)
  if (stream.destroyed) throw new Error('FFmpeg stopped accepting video frames')
  if (!stream.write(image.toPNG())) {
    await once(stream, 'drain', signal ? { signal } : undefined)
  }
  throwIfAborted(signal)
}

async function renderVideoFrames(BrowserWindow, index, timeline, stream, onProgress, signal) {
  throwIfAborted(signal)
  const window = new BrowserWindow({
    show: false,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setFrameRate(VIDEO_RENDER_FPS)
  const onAbort = () => {
    if (!window.isDestroyed()) window.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(renderDocument())}`
    await window.loadURL(documentUrl)
    throwIfAborted(signal)
    const cursor = createFrameCursor(index)

    for (let frameIndex = 0; frameIndex < timeline.times.length; frameIndex += 1) {
      throwIfAborted(signal)
      const currentMs = timeline.times[frameIndex]
      const state = frameStateAtIndex(index, currentMs, cursor)
      const stateJson = JSON.stringify(state)
      const image = await captureNextPaint(window.webContents, () =>
        window.webContents.executeJavaScript(`window.renderKaraokeFrame(${stateJson},${frameIndex})`),
      signal)
      await writePngFrame(stream, image, signal)
      onProgress?.({ phase: 'frames', completed: frameIndex + 1, total: timeline.times.length })
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!window.isDestroyed()) window.destroy()
  }
}

function buildFfmpegArguments(audioPath, outputPath, durationMs) {
  return [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'image2pipe',
    '-framerate', String(VIDEO_RENDER_FPS),
    '-vcodec', 'png',
    '-i', 'pipe:0',
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', `fps=${VIDEO_OUTPUT_FPS},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'apad',
    '-t', (durationMs / 1000).toFixed(3),
    '-movflags', '+faststart',
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
  onProgress,
  signal,
}) {
  throwIfAborted(signal)
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required')
  const project = parseProjectForVideo(projectJson)
  const requestedAudioPath = limitedText(audioPath || project.audioPath, '', 8_192).trim()
  const requestedOutputPath = limitedText(outputPath, '', 8_192).trim()
  if (!requestedAudioPath || !requestedOutputPath) throw new TypeError('Audio and output paths are required')
  const resolvedAudioPath = path.resolve(requestedAudioPath)
  const resolvedOutputPath = path.resolve(requestedOutputPath)

  const audioStats = await fs.stat(resolvedAudioPath).catch(() => null)
  if (!audioStats?.isFile()) throw new Error('The linked audio file could not be read')
  const timeline = buildFrameTimelineForProject(project, durationMs)
  const index = createVideoIndex(project)
  const executable = await findFfmpeg(ffmpegPath, signal)
  const partialPath = `${resolvedOutputPath}.partial-${randomUUID()}.mp4`

  try {
    throwIfAborted(signal)
    onProgress?.({ phase: 'preparing', completed: 0, total: 1 })
    await runProcess(executable, buildFfmpegArguments(
      resolvedAudioPath,
      partialPath,
      timeline.durationMs,
    ), {
      signal,
      inputWriter: async (stream) => {
        await renderVideoFrames(BrowserWindow, index, timeline, stream, onProgress, signal)
        throwIfAborted(signal)
        onProgress?.({ phase: 'encoding', completed: 0, total: 1 })
      },
    })
    throwIfAborted(signal)
    await fs.rename(partialPath, resolvedOutputPath)
    onProgress?.({ phase: 'complete', completed: 1, total: 1 })
    return { path: resolvedOutputPath, durationMs: timeline.durationMs, frameCount: timeline.times.length }
  } finally {
    await fs.rm(partialPath, { force: true }).catch(() => {})
  }
}

module.exports = {
  MAX_VIDEO_DURATION_MS,
  MAX_VIDEO_FRAMES,
  VIDEO_RENDER_FPS,
  buildFfmpegArguments,
  buildFrameTimeline,
  effectiveVideoDuration,
  exportKaraokeVideo,
  findFfmpeg,
  frameStateAt,
  normalizeProjectForVideo,
  parseProjectForVideo,
}
