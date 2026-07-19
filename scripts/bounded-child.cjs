'use strict'

const { spawn } = require('node:child_process')

const PUBLIC_CODES = new Set([
  'FONT_SMOKE_CHILD_FAILED',
  'FONT_SMOKE_CHILD_SIGNAL',
  'FONT_SMOKE_LAUNCHER_FAILED',
  'FONT_SMOKE_PROFILE_IDENTITY_FAILED',
  'FONT_SMOKE_PROFILE_FAILED',
  'FONT_SMOKE_START_FAILED',
  'FONT_SMOKE_TERMINATION_UNCONFIRMED',
  'FONT_SMOKE_TIMEOUT',
  'SMOKE_LAUNCHER_FAILED',
  'VIDEO_SMOKE_CHILD_FAILED',
  'VIDEO_SMOKE_CHILD_SIGNAL',
  'VIDEO_SMOKE_CLEANUP_FAILED',
  'VIDEO_SMOKE_LAUNCHER_FAILED',
  'VIDEO_SMOKE_START_FAILED',
  'VIDEO_SMOKE_TERMINATION_UNCONFIRMED',
  'VIDEO_SMOKE_TIMEOUT',
  'VISUAL_SMOKE_CHILD_FAILED',
  'VISUAL_SMOKE_CHILD_SIGNAL',
  'VISUAL_SMOKE_LAUNCHER_FAILED',
  'VISUAL_SMOKE_OUTPUT_EXISTS',
  'VISUAL_SMOKE_OUTPUT_INVALID',
  'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED',
  'VISUAL_SMOKE_PROFILE_FAILED',
  'VISUAL_SMOKE_RESULT_INVALID',
  'VISUAL_SMOKE_START_FAILED',
  'VISUAL_SMOKE_TERMINATION_UNCONFIRMED',
  'VISUAL_SMOKE_TIMEOUT',
])

function childHasExited(child) {
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null))
}

function ignoredStdioOptions(spawnOptions) {
  if (!spawnOptions || typeof spawnOptions !== 'object' || Array.isArray(spawnOptions)) return null
  const stdio = spawnOptions.stdio
  const ignoredArray =
    Array.isArray(stdio) && stdio.length >= 3 && stdio.every((entry) => entry === 'ignore')
  if (stdio !== undefined && stdio !== 'ignore' && !ignoredArray) return null
  return { ...spawnOptions, stdio: ignoredArray ? [...stdio] : 'ignore' }
}

function captureOptions(value) {
  if (value === undefined) return null
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.maxBytesPerStream) ||
    value.maxBytesPerStream < 1 ||
    value.maxBytesPerStream > 1024 * 1024 ||
    typeof value.classify !== 'function'
  )
    return false
  return {
    classify: value.classify,
    maxBytesPerStream: value.maxBytesPerStream,
  }
}

function capturedStdioOptions(spawnOptions) {
  if (!spawnOptions || typeof spawnOptions !== 'object' || Array.isArray(spawnOptions)) return null
  const stdio = spawnOptions.stdio
  const expected = ['ignore', 'pipe', 'pipe']
  if (
    stdio !== undefined &&
    (!Array.isArray(stdio) ||
      stdio.length !== expected.length ||
      stdio.some((entry, index) => entry !== expected[index]))
  )
    return null
  return { ...spawnOptions, stdio: expected }
}

function createOutputCapture(options) {
  if (!options) return null
  const buffers = { stderr: [], stdout: [] }
  const byteCounts = { stderr: 0, stdout: 0 }
  let overflow = false

  const append = (stream, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
    const remaining = options.maxBytesPerStream - byteCounts[stream]
    if (bytes.length > remaining) overflow = true
    if (remaining <= 0) return
    const retained = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes
    buffers[stream].push(Buffer.from(retained))
    byteCounts[stream] += retained.length
  }
  const outcome = () => {
    let fatal = true
    try {
      fatal =
        options.classify(
          Buffer.concat(buffers.stdout, byteCounts.stdout),
          Buffer.concat(buffers.stderr, byteCounts.stderr),
        ) === true
    } catch {
      // A classifier failure cannot make captured diagnostics look clean.
    }
    return Object.freeze({ fatal, overflow })
  }
  return { append, outcome }
}

function validDuration(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function startFailure() {
  return {
    code: null,
    forwardedSignal: null,
    killFailed: false,
    postSpawnError: false,
    signal: null,
    spawned: false,
    startFailed: true,
    terminationAttempted: false,
    terminationConfirmed: true,
    terminationUnconfirmed: false,
    timedOut: false,
  }
}

function runBoundedChild(options) {
  const {
    executable,
    args = [],
    spawnOptions = {},
    timeoutMs,
    killGraceMs = 2_000,
    forceSettleMs = 250,
    spawnImpl = spawn,
    processLike = process,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    captureOutput,
  } = options

  const captureConfig = captureOptions(captureOutput)
  const safeSpawnOptions = captureConfig
    ? capturedStdioOptions(spawnOptions)
    : captureConfig === false
      ? null
      : ignoredStdioOptions(spawnOptions)
  if (
    !safeSpawnOptions ||
    !validDuration(timeoutMs) ||
    !validDuration(killGraceMs) ||
    !validDuration(forceSettleMs)
  )
    return Promise.resolve(startFailure())

  return new Promise((resolve) => {
    let child = null
    let timeout = null
    let forceKill = null
    let forceSettle = null
    let settled = false
    let spawned = false
    let timedOut = false
    let forwardedSignal = null
    let postSpawnError = false
    let killFailed = false
    let terminationAttempted = false
    let capturedExit = null
    const captured = createOutputCapture(captureConfig)
    const capturedListeners = []

    const destroyCapturedStreams = () => {
      if (!captured) return
      for (const stream of [child?.stdout, child?.stderr]) {
        try {
          stream?.destroy?.()
        } catch {
          postSpawnError = true
        }
      }
    }
    const cleanup = () => {
      if (timeout !== null) clearTimeoutImpl(timeout)
      if (forceKill !== null) clearTimeoutImpl(forceKill)
      if (forceSettle !== null) clearTimeoutImpl(forceSettle)
      processLike.removeListener('SIGINT', onInterrupt)
      processLike.removeListener('SIGTERM', onTermination)
      for (const [stream, listener] of capturedListeners) stream.removeListener('data', listener)
    }
    const finish = (outcome) => {
      if (settled) return
      settled = true
      if (outcome.terminationUnconfirmed) {
        destroyCapturedStreams()
        try {
          child.unref()
        } catch {
          killFailed = true
        }
      }
      cleanup()
      const result = {
        forwardedSignal,
        killFailed,
        postSpawnError,
        spawned,
        terminationAttempted,
        timedOut,
        ...outcome,
      }
      if (captured) result.diagnostics = captured.outcome()
      resolve(result)
    }
    const finishCapturedExitWithoutClose = () => {
      if (!capturedExit) return false
      destroyCapturedStreams()
      finish(capturedExit)
      return true
    }
    const scheduleForceSettle = () => {
      if (settled || forceSettle !== null) return
      forceSettle = setTimeoutImpl(() => {
        if (settled || finishCapturedExitWithoutClose()) return
        finish({
          code: null,
          signal: null,
          startFailed: false,
          terminationConfirmed: false,
          terminationUnconfirmed: true,
        })
      }, forceSettleMs)
    }
    const attemptKill = (signal) => {
      if (!child || childHasExited(child)) return
      try {
        if (child.kill(signal) === false) killFailed = true
      } catch {
        killFailed = true
      }
    }
    const requestTermination = (signal) => {
      if (settled || !child || childHasExited(child)) return
      terminationAttempted = true
      attemptKill(signal)
      if (settled || forceKill) return
      forceKill = setTimeoutImpl(() => {
        if (settled) return
        if (!childHasExited(child)) attemptKill('SIGKILL')
        if (!settled) scheduleForceSettle()
      }, killGraceMs)
    }
    function forward(signal) {
      if (forwardedSignal) return
      forwardedSignal = signal
      requestTermination(signal)
    }
    function onInterrupt() {
      forward('SIGINT')
    }
    function onTermination() {
      forward('SIGTERM')
    }

    processLike.on('SIGINT', onInterrupt)
    processLike.on('SIGTERM', onTermination)
    try {
      child = spawnImpl(executable, args, safeSpawnOptions)
    } catch {
      finish({
        code: null,
        signal: null,
        startFailed: true,
        terminationConfirmed: true,
        terminationUnconfirmed: false,
      })
      return
    }

    child.once('spawn', () => {
      spawned = true
    })
    child.on('error', () => {
      if (!spawned && !terminationAttempted) {
        finish({
          code: null,
          signal: null,
          startFailed: true,
          terminationConfirmed: true,
          terminationUnconfirmed: false,
        })
        return
      }
      postSpawnError = true
      requestTermination('SIGTERM')
    })
    if (captured) {
      const streams = [
        ['stdout', child.stdout],
        ['stderr', child.stderr],
      ]
      if (streams.some(([, stream]) => !stream || typeof stream.on !== 'function')) {
        postSpawnError = true
        requestTermination('SIGTERM')
      } else {
        for (const [name, stream] of streams) {
          const listener = (value) => captured.append(name, value)
          capturedListeners.push([stream, listener])
          stream.on('data', listener)
        }
      }
      child.once('exit', (code, signal) => {
        capturedExit = {
          code,
          signal,
          startFailed: false,
          terminationConfirmed: true,
          terminationUnconfirmed: false,
        }
      })
      child.once('close', (code, signal) =>
        finish({
          code,
          signal,
          startFailed: false,
          terminationConfirmed: true,
          terminationUnconfirmed: false,
        }),
      )
    } else {
      child.once('exit', (code, signal) =>
        finish({
          code,
          signal,
          startFailed: false,
          terminationConfirmed: true,
          terminationUnconfirmed: false,
        }),
      )
    }
    timeout = setTimeoutImpl(() => {
      timedOut = true
      // Captured diagnostics settle on `close`, not `exit`. Keep this original
      // timeout as the hard bound when a descendant retains the stdio pipes.
      if (finishCapturedExitWithoutClose()) return
      requestTermination('SIGTERM')
    }, timeoutMs)
    // A signal can arrive synchronously inside a test or wrapper spawnImpl,
    // before its returned child has been assigned. Replay it only after all
    // child lifecycle listeners are installed so escalation stays observable.
    if (forwardedSignal) requestTermination(forwardedSignal)
  })
}

function publicChildOutcomeCode(prefix, outcome) {
  if (prefix !== 'FONT_SMOKE' && prefix !== 'VIDEO_SMOKE' && prefix !== 'VISUAL_SMOKE') {
    return 'SMOKE_LAUNCHER_FAILED'
  }
  if (outcome.startFailed) return `${prefix}_START_FAILED`
  if (outcome.terminationUnconfirmed) return `${prefix}_TERMINATION_UNCONFIRMED`
  if (outcome.timedOut) return `${prefix}_TIMEOUT`
  if (outcome.signal) return `${prefix}_CHILD_SIGNAL`
  if (outcome.diagnostics?.overflow || outcome.diagnostics?.fatal) {
    return `${prefix}_CHILD_FAILED`
  }
  if (outcome.postSpawnError || outcome.code !== 0) return `${prefix}_CHILD_FAILED`
  return null
}

function publicStatusLine(code) {
  return JSON.stringify({
    code: PUBLIC_CODES.has(code) ? code : 'SMOKE_LAUNCHER_FAILED',
    ok: false,
  })
}

module.exports = {
  publicChildOutcomeCode,
  publicStatusLine,
  runBoundedChild,
}
