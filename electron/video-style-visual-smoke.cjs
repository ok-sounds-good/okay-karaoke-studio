'use strict'

const { pathsAreSeparate, validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const { validateFreshOutputPath } = require('./smoke-artifacts.cjs')
const {
  BASELINE_SCENARIO,
  STYLE_SESSION_SCENARIO,
  VIEWPORT,
} = require('../scripts/visual-result-validation.cjs')
const {
  PACKAGED_APP_URL,
  STABLE_RENDERER_SCRIPT,
  STUDIO_BRIDGE_KEYS,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_TEMPLATE_NAME,
  STYLE_TARGET_SCRIPT,
  executeBeforeDeadline,
  projectLyricsReadinessScript,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  validProjectLyricsState,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
} = require('./visual-smoke-renderer-contracts.cjs')
const {
  PUBLIC_FAILURE,
  captureBaseline,
  captureStyleSession,
  runVisualSmoke,
  sendTrustedStyleActivation,
  sendTrustedStyleText,
} = require('./visual-smoke-orchestration.cjs')

const TRIGGER = '--oks-video-style-visual-smoke'
const OPTION_PREFIX = '--oks-video-style-visual-'
const FATAL_DIAGNOSTIC = '[oks-visual-smoke:fatal]\n'
const OPTIONS = Object.freeze({
  output: '--oks-video-style-visual-output=',
  scenario: '--oks-video-style-visual-scenario=',
  sessionData: '--oks-video-style-visual-session-data=',
  sessionIdentity: '--oks-video-style-visual-session-identity=',
  userData: '--oks-video-style-visual-user-data=',
  userIdentity: '--oks-video-style-visual-user-identity=',
})

function smokeError(code = 'VISUAL_SMOKE_FAILED') {
  const error = new Error(code)
  error.code = code
  return error
}

function installVisualSmokeFatalObserver(processLike = process) {
  if (
    !processLike ||
    typeof processLike.on !== 'function' ||
    typeof processLike.removeListener !== 'function'
  )
    throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
  let fatal = false
  let disposed = false
  const rendererObservers = new Set()
  const observeFatal = () => {
    if (fatal) return
    fatal = true
    try {
      processLike.stderr?.write?.(FATAL_DIAGNOSTIC)
    } catch {
      // Fatal state remains authoritative even when its fixed diagnostic cannot be written.
    }
  }
  const observeRenderer = (contents) => {
    if (
      disposed ||
      !contents ||
      typeof contents.on !== 'function' ||
      typeof contents.once !== 'function' ||
      typeof contents.removeListener !== 'function'
    )
      throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
    let active = true
    const observeConsoleMessage = (...args) => {
      try {
        const [eventOrDetails, detailsOrLevel] = args
        const details =
          detailsOrLevel && typeof detailsOrLevel === 'object' ? detailsOrLevel : eventOrDetails
        const level = details && typeof details === 'object' ? details.level : undefined
        const legacyLevel = typeof detailsOrLevel === 'number' ? detailsOrLevel : undefined
        if (level === 'error' || level === 3 || (typeof level !== 'string' && legacyLevel === 3))
          observeFatal()
      } catch {
        observeFatal()
      }
    }
    const observeGone = (_event, details) => {
      if (details?.reason !== 'clean-exit') observeFatal()
    }
    const observedEvents = [
      ['console-message', observeConsoleMessage],
      ['did-fail-load', observeFatal],
      ['preload-error', observeFatal],
      ['render-process-gone', observeGone],
      ['unresponsive', observeFatal],
    ]
    const observeDestroyed = () => {
      active = false
      rendererObservers.delete(rendererObserver)
    }
    const rendererObserver = Object.freeze({
      dispose() {
        if (!active) return
        active = false
        rendererObservers.delete(rendererObserver)
        try {
          if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return
          for (const [event, listener] of observedEvents) contents.removeListener(event, listener)
          contents.removeListener('destroyed', observeDestroyed)
        } catch {
          observeFatal()
        }
      },
    })
    try {
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) {
        throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
      }
      for (const [event, listener] of observedEvents) contents.on(event, listener)
      contents.once('destroyed', observeDestroyed)
      rendererObservers.add(rendererObserver)
      return rendererObserver
    } catch {
      try {
        for (const [event, listener] of observedEvents) contents.removeListener(event, listener)
        contents.removeListener('destroyed', observeDestroyed)
      } catch {
        // The fixed observer-installation failure remains the only public diagnostic.
      }
      observeFatal()
      throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
    }
  }
  processLike.on('uncaughtException', observeFatal)
  processLike.on('unhandledRejection', observeFatal)
  return Object.freeze({
    dispose() {
      if (disposed) return
      disposed = true
      for (const rendererObserver of [...rendererObservers]) rendererObserver.dispose()
      try {
        processLike.removeListener('uncaughtException', observeFatal)
        processLike.removeListener('unhandledRejection', observeFatal)
      } catch {
        observeFatal()
      }
    },
    disposeRenderers() {
      for (const rendererObserver of [...rendererObservers]) rendererObserver.dispose()
    },
    hasFatal: () => fatal,
    observeRenderer,
  })
}

function parseOption(args, prefix) {
  const matches = args.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  const value = matches[0].slice(prefix.length)
  if (!value || value.includes('\0')) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  return value
}

function parseScenario(args) {
  const scenario = parseOption(args, OPTIONS.scenario)
  if (scenario !== BASELINE_SCENARIO && scenario !== STYLE_SESSION_SCENARIO) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  return scenario
}

function parseVisualSmokeArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== 'string')) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  const related = argv.filter((argument) => argument.startsWith(OPTION_PREFIX))
  const triggers = argv.filter((argument) => argument === TRIGGER)
  if (triggers.length === 0 && related.length === 0) return null
  if (triggers.length !== 1) throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  const knownArguments = new Set([TRIGGER])
  for (const prefix of Object.values(OPTIONS)) {
    const match = argv.find((argument) => argument.startsWith(prefix))
    if (match) knownArguments.add(match)
  }
  if (related.some((argument) => !knownArguments.has(argument))) {
    throw smokeError('VISUAL_SMOKE_FLAG_INVALID')
  }
  return Object.freeze({
    output: validateFreshOutputPath(parseOption(argv, OPTIONS.output)),
    scenario: parseScenario(argv),
    sessionData: parseOption(argv, OPTIONS.sessionData),
    sessionIdentity: parseOption(argv, OPTIONS.sessionIdentity),
    userData: parseOption(argv, OPTIONS.userData),
    userIdentity: parseOption(argv, OPTIONS.userIdentity),
  })
}

function configureVisualSmokeBeforeReady(app, config) {
  if (!config) return null
  if (!app || app.isReady()) throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
  try {
    const defaultUserData = app.getPath('userData')
    const defaultSessionData = app.getPath('sessionData')
    const userData = validateOwnedSmokeProfile(
      config.userData,
      defaultUserData,
      config.userIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    validateOwnedSmokeProfile(
      userData,
      defaultSessionData,
      config.userIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    const sessionData = validateOwnedSmokeProfile(
      config.sessionData,
      defaultUserData,
      config.sessionIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    validateOwnedSmokeProfile(
      sessionData,
      defaultSessionData,
      config.sessionIdentity,
      'VISUAL_SMOKE_PROFILE_FAILED',
    )
    if (!pathsAreSeparate(userData, sessionData)) {
      throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
    }
    app.setPath('userData', userData)
    app.setPath('sessionData', sessionData)
    app.commandLine.appendSwitch('force-device-scale-factor', '1')
    return Object.freeze({ ...config, sessionData, userData })
  } catch {
    throw smokeError('VISUAL_SMOKE_PROFILE_FAILED')
  }
}

module.exports = {
  BASELINE_SCENARIO,
  FATAL_DIAGNOSTIC,
  OPTIONS,
  PACKAGED_APP_URL,
  PUBLIC_FAILURE,
  STABLE_RENDERER_SCRIPT,
  STUDIO_BRIDGE_KEYS,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_SESSION_SCENARIO,
  STYLE_TEMPLATE_NAME,
  STYLE_TARGET_SCRIPT,
  TRIGGER,
  VIEWPORT,
  captureBaseline,
  captureStyleSession,
  configureVisualSmokeBeforeReady,
  executeBeforeDeadline,
  installVisualSmokeFatalObserver,
  parseVisualSmokeArguments,
  projectLyricsReadinessScript,
  runVisualSmoke,
  sendTrustedStyleActivation,
  sendTrustedStyleText,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  validProjectLyricsState,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
}
