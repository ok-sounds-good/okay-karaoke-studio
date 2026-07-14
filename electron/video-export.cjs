'use strict'

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { ffmpegExecutableCandidates } = require('./ffmpeg-setup.cjs')

const VIDEO_RESOLUTION_PRESETS = Object.freeze({
  '240p': Object.freeze({ width: 426, height: 240 }),
  '360p': Object.freeze({ width: 640, height: 360 }),
  '480p': Object.freeze({ width: 854, height: 480 }),
  '720p': Object.freeze({ width: 1280, height: 720 }),
  '1080p': Object.freeze({ width: 1920, height: 1080 }),
  '1440p': Object.freeze({ width: 2560, height: 1440 }),
  '2160p': Object.freeze({ width: 3840, height: 2160 }),
})
const VIDEO_FRAME_RATES = Object.freeze([30, 60])
const DEFAULT_VIDEO_RESOLUTION = '720p'
const DEFAULT_VIDEO_FPS = 30
const VIDEO_RENDER_FPS = DEFAULT_VIDEO_FPS
const MAX_VIDEO_DURATION_MS = 30 * 60 * 1000
const MAX_VIDEO_FRAMES = Math.ceil(MAX_VIDEO_DURATION_MS * Math.max(...VIDEO_FRAME_RATES) / 1_000)
const MAX_TRACKS = 2
const MAX_LINES = 20_000
const MAX_WORDS = 150_000
const MIN_LYRIC_DISPLAY_LINES = 1
const MAX_LYRIC_DISPLAY_LINES = 5
const DEFAULT_LYRIC_DISPLAY = Object.freeze({ lineCount: 3, advanceMode: 'clear' })

function normalizeVideoSettings(value = {}) {
  if (!isRecord(value)) throw new TypeError('Video settings must be an object')
  const resolution = value.resolution ?? DEFAULT_VIDEO_RESOLUTION
  const fps = value.fps ?? DEFAULT_VIDEO_FPS
  if (typeof resolution !== 'string' || !Object.hasOwn(VIDEO_RESOLUTION_PRESETS, resolution)) {
    throw new RangeError('Video resolution preset is not supported')
  }
  const dimensions = VIDEO_RESOLUTION_PRESETS[resolution]
  if (!VIDEO_FRAME_RATES.includes(fps)) throw new RangeError('Video frame rate must be 30 or 60 fps')
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

function normalizeLyricDisplay(value) {
  if (value === undefined) return { ...DEFAULT_LYRIC_DISPLAY }
  if (!isRecord(value)) throw new TypeError('lyricDisplay must be an object')
  if (!Number.isSafeInteger(value.lineCount)) {
    throw new TypeError('lyricDisplay.lineCount must be an integer')
  }
  if (value.lineCount < MIN_LYRIC_DISPLAY_LINES || value.lineCount > MAX_LYRIC_DISPLAY_LINES) {
    throw new RangeError(
      `lyricDisplay.lineCount must be between ${MIN_LYRIC_DISPLAY_LINES} and ${MAX_LYRIC_DISPLAY_LINES}`,
    )
  }
  if (value.advanceMode !== 'clear' && value.advanceMode !== 'scroll') {
    throw new TypeError('lyricDisplay.advanceMode must be clear or scroll')
  }
  return { lineCount: value.lineCount, advanceMode: value.advanceMode }
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
    lyricDisplay: normalizeLyricDisplay(value.lyricDisplay),
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
    .flatMap(({ track, adjustedLines }) =>
      adjustedLines.map((entry) => ({ ...entry, track })),
    )
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
  const frameCount = Math.ceil(durationMs * fps / 1_000)
  if (frameCount > MAX_VIDEO_FRAMES) {
    throw new RangeError(`Video export would require more than ${MAX_VIDEO_FRAMES} lyric frames`)
  }
  const times = Array.from(
    { length: frameCount },
    (_unused, index) => Math.round(index * 1_000 / fps),
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

function createFrameCursor(index) {
  return {
    trackPositions: index.tracks.map(() => 0),
  }
}

function plannedTrackLines(trackIndex, lyricMs, settings, cursorPosition) {
  let position = cursorPosition
  if (position === undefined) {
    position = trackIndex.timedPositions.findIndex(
      (entry) => lyricMs < entry.rawRange.endMs,
    )
  }
  const target = position >= 0 ? trackIndex.timedPositions[position]?.position : undefined
  if (!target) return []
  const startIndex = settings.advanceMode === 'scroll'
    ? Math.min(target.lineIndex, Math.max(0, target.section.length - settings.lineCount))
    : Math.floor(target.lineIndex / settings.lineCount) * settings.lineCount
  return target.section.slice(startIndex, startIndex + settings.lineCount)
}

function frameStateAtIndex(index, playbackMs, cursor) {
  const { project } = index
  const lyricMs = playbackMs - project.offsetMs
  const showTitle = !Number.isFinite(index.firstStart) || playbackMs < Math.max(0, index.firstStart - 1_500)
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
          color: track.color,
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
  return frameStateAtIndex(createVideoIndex(project), playbackMs)
}

function renderDocument(settings = {}) {
  const { width, height } = normalizeVideoSettings(settings)
  const scaleX = width / 1920
  const scaleY = height / 1080
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#17111e;color:#f8f6fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.scene{position:absolute;width:1920px;height:1080px;overflow:hidden;transform:scale(${scaleX},${scaleY});transform-origin:0 0;background:radial-gradient(circle at 18% 20%,rgba(155,120,207,.28),transparent 34%),radial-gradient(circle at 82% 35%,rgba(255,138,43,.16),transparent 38%),linear-gradient(155deg,#30223f 0%,#21172b 52%,#17111e 100%)}
.grain{position:absolute;inset:0;opacity:.12;background-image:linear-gradient(rgba(248,246,251,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(248,246,251,.018) 1px,transparent 1px);background-size:5px 5px}.safe{position:absolute;inset:64px 96px;border:2px solid rgba(203,182,230,.16);border-radius:30px}
.brand{position:absolute;left:86px;top:58px;font-size:25px;font-weight:800;letter-spacing:.22em;color:#9b78cf}.clock{position:absolute;right:86px;top:56px;font:600 27px ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(248,246,251,.62)}
.content{position:absolute;inset:140px 130px 120px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.title-card span{font-size:25px;letter-spacing:.2em;text-transform:uppercase;color:#ff8a2b}.title-card h1{margin:34px 0 14px;font-size:104px;line-height:1.04;max-width:1500px}.title-card p{margin:0;font-size:42px;color:rgba(248,246,251,.72)}
.lines{width:100%;display:flex;flex-direction:column;gap:18px}.lyric{width:100%;height:1.18em;font-size:82px;line-height:1.12;font-weight:850;letter-spacing:.01em;white-space:nowrap}.word{position:relative;display:inline-block;color:rgba(248,246,251,.5);filter:drop-shadow(0 5px 5px rgba(0,0,0,.8))}.word-fill{position:absolute;inset:0 auto 0 0;width:0;overflow:hidden;color:var(--accent);white-space:nowrap}
.footer{position:absolute;left:86px;right:86px;bottom:53px;display:flex;justify-content:space-between;font-size:24px;color:rgba(248,246,251,.54)}
</style></head><body><div class="scene"><div class="grain"></div><div class="safe"></div><div class="brand">OKAY / STUDIO</div><div id="clock" class="clock"></div><main id="content" class="content"></main><footer class="footer"><span id="footer-song"></span><span>Okay Karaoke Studio</span></footer></div><script>
const text=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=value;return node}
const fitSize=(value,count)=>Math.max(28,Math.min(88,Math.floor(1520/Math.max(12,value.length)*1.28),Math.floor(610/Math.max(1,count))))
let layoutKey='';let wordNodes=[];let lastClock='';let lastFooter='';
window.renderKaraokeFrame=(state,sequence)=>{document.body.dataset.frame=String(sequence);const clock=new Date(Math.max(0,state.playbackMs)).toISOString().slice(11,19);if(clock!==lastClock){document.querySelector('#clock').textContent=clock;lastClock=clock}const footer=state.artist+' · '+state.title;if(footer!==lastFooter){document.querySelector('#footer-song').textContent=footer;lastFooter=footer}const content=document.querySelector('#content');const nextKey=state.showTitle?'title:'+state.title+'|'+state.artist:'lines:'+JSON.stringify(state.lines.map((item)=>[item.color,item.text,item.words.map((word)=>word.text)]));
if(nextKey!==layoutKey){layoutKey=nextKey;wordNodes=[];content.replaceChildren();if(state.showTitle){const card=text('div','title-card','');card.append(text('span','',"Tonight's performance"),text('h1','',state.title),text('p','',state.artist));content.append(card)}else if(state.lines.length){const group=text('div','lines','');group.style.gap=Math.max(8,38-state.lines.length*3)+'px';for(const item of state.lines){const line=text('div','line','');const lyric=text('div','lyric','');lyric.style.setProperty('--accent',item.color);lyric.style.fontSize=fitSize(item.text,state.lines.length)+'px';item.words.forEach((word,index)=>{const node=text('span','word','');const fill=text('span','word-fill',word.text);node.append(text('span','word-base',word.text),fill);lyric.append(node);wordNodes.push(fill);if(index<item.words.length-1)lyric.append(document.createTextNode(' '))});line.append(lyric);group.append(line)}content.append(group)}}
let wordIndex=0;for(const item of state.lines){for(const word of item.words){wordNodes[wordIndex]?.style.setProperty('width',(word.progress*100).toFixed(3)+'%');wordIndex+=1}}
return true}
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

async function promoteVideoOutput(partialPath, outputPath, {
  renameFile = fs.rename,
  onPromotionStart,
  onPromotionComplete,
} = {}) {
  if (onPromotionStart?.() === false) throw createAbortError()
  await renameFile(partialPath, outputPath)
  onPromotionComplete?.()
}

function waitForNextPaint(contents, update, signal) {
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
      resolve()
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
        // Offscreen rendering does not promise that capturePage observes the
        // compositor state produced by the immediately preceding DOM update.
        // Invalidate and consume the following paint so every encoded frame is
        // tied to the requested lyric state.
        contents.invalidate()
      })
      .catch(fail)
  })
}

async function captureRenderedPage(contents, update, signal) {
  await waitForNextPaint(contents, update, signal)
  throwIfAborted(signal)
  // The paint event is the presentation barrier. capturePage then copies the
  // fully composed surface instead of reusing Electron's offscreen paint image,
  // whose backing storage may be recycled by a later frame.
  const image = await contents.capturePage()
  throwIfAborted(signal)
  if (image.isEmpty()) throw new Error('Electron returned an empty video frame')
  return image
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

async function writeJpegFrame(stream, image, settings, signal) {
  throwIfAborted(signal)
  if (stream.destroyed) throw new Error('FFmpeg stopped accepting video frames')
  const size = image.getSize()
  const frame = size.width === settings.width && size.height === settings.height
    ? image
    : image.resize({ width: settings.width, height: settings.height, quality: 'best' })
  if (!stream.write(frame.toJPEG(95))) {
    await once(stream, 'drain', signal ? { signal } : undefined)
  }
  throwIfAborted(signal)
}

async function renderVideoFrames(BrowserWindow, index, timeline, stream, settings, onProgress, signal) {
  throwIfAborted(signal)
  const window = new BrowserWindow({
    show: false,
    width: settings.width,
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
  window.webContents.setFrameRate(settings.fps)
  const onAbort = () => {
    if (!window.isDestroyed()) window.destroy()
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const documentUrl = `data:text/html;charset=utf-8,${encodeURIComponent(renderDocument(settings))}`
    await window.loadURL(documentUrl)
    throwIfAborted(signal)
    const cursor = createFrameCursor(index)
    let lastProgressMs = Number.NEGATIVE_INFINITY

    for (let frameIndex = 0; frameIndex < timeline.times.length; frameIndex += 1) {
      throwIfAborted(signal)
      const currentMs = timeline.times[frameIndex]
      const state = frameStateAtIndex(index, currentMs, cursor)
      const stateJson = JSON.stringify(state)
      const image = await captureRenderedPage(window.webContents, () =>
        window.webContents.executeJavaScript(`window.renderKaraokeFrame(${stateJson},${frameIndex})`),
      signal)
      await writeJpegFrame(stream, image, settings, signal)
      if (
        frameIndex === 0 ||
        frameIndex === timeline.times.length - 1 ||
        currentMs - lastProgressMs >= 100
      ) {
        lastProgressMs = currentMs
        onProgress?.({ phase: 'frames', completed: frameIndex + 1, total: timeline.times.length })
      }
    }
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
    '-loglevel', 'error',
    '-probesize', '32768',
    '-analyzeduration', '0',
    '-f', 'image2pipe',
    '-framerate', String(fps),
    '-vcodec', 'mjpeg',
    '-i', 'pipe:0',
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', 'format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-bf', '0',
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
  if (!requestedAudioPath || !requestedOutputPath) throw new TypeError('Audio and output paths are required')
  const resolvedAudioPath = path.resolve(requestedAudioPath)
  const resolvedOutputPath = path.resolve(requestedOutputPath)
  const settings = normalizeVideoSettings({ resolution, fps })

  const audioStats = await fs.stat(resolvedAudioPath).catch(() => null)
  if (!audioStats?.isFile()) throw new Error('The linked audio file could not be read')
  const timeline = buildFrameTimelineForProject(project, durationMs, settings.fps)
  const index = createVideoIndex(project)
  const executable = ffmpegPath || await findFfmpeg(undefined, signal)
  const parsedOutput = path.parse(resolvedOutputPath)
  const partialPath = path.join(
    parsedOutput.dir,
    `${parsedOutput.name}.partial-${randomUUID()}${parsedOutput.ext || '.mp4'}`,
  )
  let preservePartial = false

  try {
    throwIfAborted(signal)
    onProgress?.({ phase: 'preparing', completed: 0, total: 1 })
    await runProcess(executable, buildFfmpegArguments(
      resolvedAudioPath,
      partialPath,
      timeline.durationMs,
      settings,
    ), {
      signal,
      inputWriter: async (stream) => {
        await renderVideoFrames(BrowserWindow, index, timeline, stream, settings, onProgress, signal)
        throwIfAborted(signal)
        onProgress?.({ phase: 'encoding', completed: 0, total: 1 })
      },
    })
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
  VIDEO_RENDER_FPS,
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
  promoteVideoOutput,
  renderDocument,
}
