'use strict'

const { performance } = require('node:perf_hooks')

const DEFAULT_ERROR_CODE = 'FONT_ACCESS_SMOKE_FOCUS_FAILED'
const DEADLINE_REACHED = Symbol('deadline reached')
const ERROR_CODES = new Set([DEFAULT_ERROR_CODE, 'VISUAL_SMOKE_FOCUS_FAILED'])

function focusError(code) {
  const publicCode = ERROR_CODES.has(code) ? code : DEFAULT_ERROR_CODE
  const error = new Error(publicCode)
  error.code = publicCode
  return error
}

function validMilliseconds(value, positive) {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0)
}

function destroyedState(window) {
  try {
    if (
      !window ||
      typeof window.isDestroyed !== 'function' ||
      !window.webContents ||
      typeof window.webContents.isDestroyed !== 'function'
    )
      return 'unknown'
    return window.isDestroyed() === true || window.webContents.isDestroyed() === true
      ? 'destroyed'
      : 'alive'
  } catch {
    return 'unknown'
  }
}

function monotonicClock(now, timeout, code) {
  let previous = -1
  const read = () => {
    let value
    try {
      value = now()
    } catch {
      throw focusError(code)
    }
    if (!Number.isFinite(value) || value < 0 || value < previous) throw focusError(code)
    previous = value
    return value
  }
  const started = read()
  return () => timeout - (read() - started)
}

async function beforeDeadline(operation, remaining, deadline) {
  if (!(remaining > 0)) throw DEADLINE_REACHED
  return Promise.race([Promise.resolve().then(operation), deadline])
}

async function focusSmokeWindow({
  app,
  window,
  timeoutMs = 5_000,
  intervalMs = 50,
  errorCode = DEFAULT_ERROR_CODE,
  now = () => performance.now(),
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const code = ERROR_CODES.has(errorCode) ? errorCode : DEFAULT_ERROR_CODE
  if (!validMilliseconds(timeoutMs, false) || !validMilliseconds(intervalMs, true)) {
    throw focusError(code)
  }
  const remainingTime = monotonicClock(now, timeoutMs, code)
  let rejectDeadline
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject
  })
  let deadlineTimer
  try {
    deadlineTimer = setTimeoutImpl(() => rejectDeadline(DEADLINE_REACHED), timeoutMs)
  } catch {
    throw focusError(code)
  }
  const awaitOperation = (operation) => beforeDeadline(operation, remainingTime(), deadline)
  const maximumAttempts = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1)

  try {
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      if (remainingTime() < 0) break
      const initialState = destroyedState(window)
      if (initialState === 'destroyed') throw focusError(code)
      if (initialState === 'alive') {
        try {
          await awaitOperation(() => app.focus({ steal: true }))
          await awaitOperation(() => window.show())
          await awaitOperation(() => window.focus())
          await awaitOperation(() => window.webContents.focus())
          const rendererFocused = await awaitOperation(() =>
            window.webContents.executeJavaScript('document.hasFocus() === true', true),
          )
          const finalState = destroyedState(window)
          if (finalState === 'alive' && window.isFocused() === true && rendererFocused === true) {
            return true
          }
        } catch (error) {
          if (error === DEADLINE_REACHED) throw focusError(code)
          // Activation failures are transient until the bounded window expires.
        }
      }
      if (destroyedState(window) === 'destroyed') throw focusError(code)
      const remaining = remainingTime()
      if (remaining <= 0) break
      try {
        await beforeDeadline(() => delay(Math.min(intervalMs, remaining)), remaining, deadline)
      } catch (error) {
        if (error === DEADLINE_REACHED) throw focusError(code)
        throw focusError(code)
      }
    }
    throw focusError(code)
  } finally {
    try {
      clearTimeoutImpl(deadlineTimer)
    } catch {
      throw focusError(code)
    }
  }
}

module.exports = { focusSmokeWindow }
