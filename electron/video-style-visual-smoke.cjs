'use strict'

const { pathsAreSeparate, validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const {
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('./smoke-artifacts.cjs')
const { focusSmokeWindow } = require('./smoke-window-focus.cjs')
const {
  BASELINE_SCENARIO,
  PROJECT_TYPOGRAPHY_SCENARIO,
  PROJECT_TYPOGRAPHY_VIEWPORTS,
  VIEWPORT,
  createResultArtifacts,
  createScenarioResultArtifacts,
} = require('../scripts/visual-result-validation.cjs')

const TRIGGER = '--oks-video-style-visual-smoke'
const OPTION_PREFIX = '--oks-video-style-visual-'
const OPTIONS = Object.freeze({
  output: '--oks-video-style-visual-output=',
  scenario: '--oks-video-style-visual-scenario=',
  sessionData: '--oks-video-style-visual-session-data=',
  sessionIdentity: '--oks-video-style-visual-session-identity=',
  userData: '--oks-video-style-visual-user-data=',
  userIdentity: '--oks-video-style-visual-user-identity=',
})
const PACKAGED_APP_URL = 'studio-app://app/index.html'
const PUBLIC_FAILURE = Object.freeze({ code: 'VISUAL_SMOKE_FAILED', ok: false })
const FATAL_DIAGNOSTIC = '[oks-visual-smoke:fatal]\n'
const PROJECT_TYPOGRAPHY_READINESS_TIMEOUT_MS = 10_000

const STABLE_RENDERER_SCRIPT = `(() => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  const sample = () => {
    const root = document.getElementById('root')
    const bounds = root?.getBoundingClientRect()
    return {
      bodyHeight: document.body?.scrollHeight ?? -1,
      bodyWidth: document.body?.scrollWidth ?? -1,
      rootChildren: root?.childElementCount ?? 0,
      rootHeight: bounds?.height ?? -1,
      rootWidth: bounds?.width ?? -1,
    }
  }
  return (async () => {
    await document.fonts?.ready
    await Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return Promise.resolve()
      return image.decode?.().catch(() => undefined) ?? Promise.resolve()
    }))
    await frame()
    await frame()
    const first = sample()
    await delay(120)
    await frame()
    await frame()
    const second = sample()
    return {
      devicePixelRatio: window.devicePixelRatio,
      height: document.documentElement.clientHeight,
      href: window.location.href,
      readyState: document.readyState,
      rootChildren: second.rootChildren,
      stable: JSON.stringify(first) === JSON.stringify(second),
      width: document.documentElement.clientWidth,
    }
  })()
})()`

const STYLE_TARGET_SCRIPT = `(() => new Promise((resolve) => {
  const mutationObserver = new MutationObserver(() => check())
  const resizeObserver = new ResizeObserver(() => check())
  let checking = false
  let finished = false
  const sample = () => {
    const root = document.getElementById('root')
    const target = document.querySelector(
      'button.style-button[aria-label="Edit project lyric style"]',
    )
    if (!(target instanceof HTMLButtonElement) || !root?.childElementCount) return null
    const bounds = target.getBoundingClientRect()
    const style = getComputedStyle(target)
    if (
      target.disabled ||
      target.getAttribute('aria-disabled') === 'true' ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      style.display === 'none' ||
      style.pointerEvents === 'none' ||
      style.visibility !== 'visible'
    ) return null
    return {
      boundsHeight: bounds.height,
      boundsWidth: bounds.width,
      height: document.documentElement.clientHeight,
      href: window.location.href,
      readyState: document.readyState,
      width: document.documentElement.clientWidth,
      x: Math.round(bounds.left + bounds.width / 2),
      y: Math.round(bounds.top + bounds.height / 2),
    }
  }
  const finish = (value) => {
    if (finished) return
    finished = true
    mutationObserver.disconnect()
    resizeObserver.disconnect()
    resolve(value)
  }
  function check() {
    if (checking || finished) return
    checking = true
    requestAnimationFrame(() => requestAnimationFrame(() => {
      checking = false
      const first = sample()
      requestAnimationFrame(() => {
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      })
    }))
  }
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  })
  resizeObserver.observe(document.documentElement)
  check()
}))()`

function projectTypographyReadinessScript(viewport) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    let checking = false
    let finished = false
    let rerun = false
    const resizeObserver = new ResizeObserver(() => schedule())
    const mutationObserver = new MutationObserver(() => schedule())
    const fontSet = document.fonts

    const sample = () => {
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const typeface = document.querySelector('[role="combobox"][aria-label="Project lyric typeface"]')
      const preview = document.querySelector('[aria-label="Project lyrics design preview"]')
      const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
      const designLine = stage?.querySelector('[data-design-preview="project-lyrics"] .stage-line')
      const blockers = workspace?.querySelector('.font-access-message, .stage-resource-warning')
      if (
        !(workspace instanceof HTMLElement) ||
        !(typeface instanceof HTMLInputElement) ||
        !(preview instanceof HTMLElement) ||
        !(stage instanceof HTMLElement) ||
        !(designLine instanceof HTMLElement) ||
        blockers ||
        !typeface.value.trim() ||
        document.readyState !== 'complete' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        window.location.href !== '${PACKAGED_APP_URL}' ||
        fontSet?.status !== 'loaded' ||
        Array.from(document.images).some(
          (image) => !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0,
        )
      ) return null
      const stageBounds = stage.getBoundingClientRect()
      const lineBounds = designLine.getBoundingClientRect()
      const lineStyle = getComputedStyle(designLine)
      if (
        stageBounds.width <= 0 ||
        stageBounds.height <= 0 ||
        lineBounds.width <= 0 ||
        lineBounds.height <= 0 ||
        !lineStyle.fontFamily ||
        !lineStyle.fontSize
      ) return null
      return {
        fontFamily: lineStyle.fontFamily,
        fontSize: lineStyle.fontSize,
        fontStatus: fontSet.status,
        height: document.documentElement.clientHeight,
        href: window.location.href,
        readyState: document.readyState,
        resourcesReady: true,
        stageHeight: stageBounds.height,
        stageWidth: stageBounds.width,
        typeface: typeface.value,
        width: document.documentElement.clientWidth,
      }
    }

    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('load', schedule, true)
      document.removeEventListener('error', schedule, true)
      fontSet?.removeEventListener?.('loadingdone', schedule)
      fontSet?.removeEventListener?.('loadingerror', schedule)
    }
    const finish = (value) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(value)
    }
    async function check() {
      if (finished) return
      if (checking) {
        rerun = true
        return
      }
      checking = true
      try {
        await fontSet?.ready
        await Promise.all(
          Array.from(document.images, (image) => image.decode?.() ?? Promise.resolve()),
        )
        await frame()
        await frame()
        const first = sample()
        await frame()
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      } catch {
        // Resource failures remain non-ready and are surfaced by the outer deadline.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() {
      void check()
    }

    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
    resizeObserver.observe(document.documentElement)
    document.addEventListener('load', schedule, true)
    document.addEventListener('error', schedule, true)
    fontSet?.addEventListener?.('loadingdone', schedule)
    fontSet?.addEventListener?.('loadingerror', schedule)
    schedule()
  }))()`
}

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
        const [details, legacyLevel] = args
        const level = details && typeof details === 'object' ? details.level : undefined
        if (level === 'error' || level === 3 || (typeof level !== 'string' && legacyLevel === 3))
          observeFatal()
      } catch {
        observeFatal()
      }
    }
    const rendererObserver = Object.freeze({
      dispose() {
        if (!active) return
        active = false
        rendererObservers.delete(rendererObserver)
        try {
          if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) return
          contents.removeListener('console-message', observeConsoleMessage)
          contents.removeListener('destroyed', observeDestroyed)
        } catch {
          observeFatal()
        }
      },
    })
    const observeDestroyed = () => {
      active = false
      rendererObservers.delete(rendererObserver)
    }

    try {
      if (typeof contents.isDestroyed === 'function' && contents.isDestroyed()) {
        throw smokeError('VISUAL_SMOKE_FATAL_OBSERVER_FAILED')
      }
      contents.on('console-message', observeConsoleMessage)
      contents.once('destroyed', observeDestroyed)
      rendererObservers.add(rendererObserver)
      return rendererObserver
    } catch {
      try {
        contents.removeListener('console-message', observeConsoleMessage)
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

function fatalObserved(observer) {
  if (!observer) return false
  try {
    return observer.hasFatal() === true
  } catch {
    return true
  }
}

function settleTeardown() {
  return new Promise((resolve) => setImmediate(resolve))
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
  if (scenario !== BASELINE_SCENARIO && scenario !== PROJECT_TYPOGRAPHY_SCENARIO) {
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

function validRendererState(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.devicePixelRatio === 1 &&
    value.height === VIEWPORT.height &&
    value.width === VIEWPORT.width &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    Number.isSafeInteger(value.rootChildren) &&
    value.rootChildren > 0 &&
    value.stable === true,
  )
}

function liveWindow(window) {
  try {
    return Boolean(
      window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed(),
    )
  } catch {
    return false
  }
}

function setExactViewport(window, viewport, displayScale) {
  if (!liveWindow(window)) throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  const expectedContentSize = [viewport.width / displayScale, viewport.height / displayScale]
  if (expectedContentSize.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  window.setContentSize(expectedContentSize[0], expectedContentSize[1], false)
  const observedContentSize = liveWindow(window) ? window.getContentSize() : []
  if (observedContentSize.join(',') !== expectedContentSize.join(',')) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
}

async function prepareCaptureWindow(window, app, options) {
  if (!liveWindow(window) || window.webContents.getURL() !== PACKAGED_APP_URL) {
    throw smokeError('VISUAL_SMOKE_WINDOW_INVALID')
  }
  window.setContentSize(VIEWPORT.width, VIEWPORT.height, false)
  const focused = await options.focus({
    app,
    window,
    errorCode: 'VISUAL_SMOKE_FOCUS_FAILED',
    timeoutMs: 5_000,
  })
  if (focused !== true) throw smokeError('VISUAL_SMOKE_FOCUS_FAILED')
  const displayScale = await window.webContents.executeJavaScript('window.devicePixelRatio', false)
  if (displayScale !== 1 && displayScale !== 2) {
    throw smokeError('VISUAL_SMOKE_VIEWPORT_INVALID')
  }
  if (displayScale === 2) {
    window.webContents.setZoomFactor(0.5)
    window.setMinimumSize(1, 1)
  }
  setExactViewport(window, VIEWPORT, displayScale)
  return displayScale
}

async function captureViewport(window, viewport) {
  let image
  try {
    image = await window.webContents.capturePage()
  } catch {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  if (
    !image ||
    image.isEmpty() ||
    image.getSize().width !== viewport.width ||
    image.getSize().height !== viewport.height
  )
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  try {
    return image.toPNG()
  } catch {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
}

async function captureBaseline(window, app, options) {
  await prepareCaptureWindow(window, app, options)
  const rendererState = await window.webContents.executeJavaScript(STABLE_RENDERER_SCRIPT, false)
  if (!validRendererState(rendererState)) throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
  const png = await captureViewport(window, VIEWPORT)
  return options.createArtifacts(png).artifacts
}

function validStyleTarget(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isFinite(value.boundsHeight) &&
    value.boundsHeight > 0 &&
    Number.isFinite(value.boundsWidth) &&
    value.boundsWidth > 0 &&
    value.height === VIEWPORT.height &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    value.width === VIEWPORT.width &&
    Number.isSafeInteger(value.x) &&
    value.x >= 0 &&
    value.x < VIEWPORT.width &&
    Number.isSafeInteger(value.y) &&
    value.y >= 0 &&
    value.y < VIEWPORT.height,
  )
}

function validProjectTypographyState(value, viewport) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.fontFamily === 'string' &&
    value.fontFamily.length > 0 &&
    typeof value.fontSize === 'string' &&
    value.fontSize.length > 0 &&
    value.fontStatus === 'loaded' &&
    value.height === viewport.height &&
    value.href === PACKAGED_APP_URL &&
    value.readyState === 'complete' &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    typeof value.typeface === 'string' &&
    value.typeface.trim().length > 0 &&
    value.width === viewport.width,
  )
}

function executeBeforeDeadline(operation, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  }
  let timer
  const pending = Promise.resolve().then(operation)
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(smokeError('VISUAL_SMOKE_READINESS_INVALID')), timeoutMs)
  })
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer))
}

function sendTrustedStyleActivation(contents, target) {
  if (!contents || typeof contents.sendInputEvent !== 'function' || !validStyleTarget(target)) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  try {
    contents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y })
    contents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseDown',
      x: target.x,
      y: target.y,
    })
    contents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseUp',
      x: target.x,
      y: target.y,
    })
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

async function captureProjectTypography(window, app, options) {
  const displayScale = await prepareCaptureWindow(window, app, options)
  const target = await executeBeforeDeadline(
    () => window.webContents.executeJavaScript(STYLE_TARGET_SCRIPT, false),
    options.readinessTimeoutMs,
  )
  if (!validStyleTarget(target)) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  sendTrustedStyleActivation(window.webContents, target)

  const pngs = []
  for (const viewport of PROJECT_TYPOGRAPHY_VIEWPORTS) {
    setExactViewport(window, viewport, displayScale)
    const state = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(projectTypographyReadinessScript(viewport), false),
      options.readinessTimeoutMs,
    )
    if (!validProjectTypographyState(state, viewport)) {
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    }
    pngs.push(await captureViewport(window, viewport))
  }
  return options.createScenarioArtifacts(PROJECT_TYPOGRAPHY_SCENARIO, pngs).artifacts
}

function destroyWindow(window) {
  try {
    if (!window || typeof window.isDestroyed !== 'function' || typeof window.destroy !== 'function')
      throw smokeError('VISUAL_SMOKE_TEARDOWN_FAILED')
    if (window.isDestroyed()) return
    window.destroy()
    if (!window.isDestroyed()) throw smokeError('VISUAL_SMOKE_TEARDOWN_FAILED')
  } catch {
    throw smokeError('VISUAL_SMOKE_TEARDOWN_FAILED')
  }
}

async function writeFailure(output, options) {
  try {
    await options.writeFailure(output, PUBLIC_FAILURE)
  } catch {
    // Preserve an existing or partially claimed output rather than replacing it.
  }
  return Object.freeze({ ok: false })
}

async function runVisualSmoke({ app, config, fatalObserver, window }, dependencies = {}) {
  const options = {
    createArtifacts: dependencies.createArtifacts || createResultArtifacts,
    createScenarioArtifacts: dependencies.createScenarioArtifacts || createScenarioResultArtifacts,
    focus: dependencies.focus || focusSmokeWindow,
    publish: dependencies.publish || publishArtifactBuffers,
    readinessTimeoutMs: dependencies.readinessTimeoutMs ?? PROJECT_TYPOGRAPHY_READINESS_TIMEOUT_MS,
    settle: dependencies.settle || settleTeardown,
    writeFailure: dependencies.writeFailure || writeFreshLauncherFailure,
  }
  let artifacts
  let failed = fatalObserved(fatalObserver)
  if (!failed) {
    try {
      const scenario = config.scenario ?? BASELINE_SCENARIO
      if (scenario === BASELINE_SCENARIO) {
        artifacts = await captureBaseline(window, app, options)
      } else if (scenario === PROJECT_TYPOGRAPHY_SCENARIO) {
        artifacts = await captureProjectTypography(window, app, options)
      } else {
        throw smokeError('VISUAL_SMOKE_SCENARIO_INVALID')
      }
    } catch {
      failed = true
    }
  }
  try {
    destroyWindow(window)
  } catch {
    failed = true
  }
  try {
    await options.settle()
  } catch {
    failed = true
  }
  try {
    fatalObserver?.disposeRenderers()
  } catch {
    failed = true
  }
  if (fatalObserved(fatalObserver)) failed = true
  if (failed) return writeFailure(config.output, options)

  try {
    await options.publish(config.output, artifacts)
    return Object.freeze({ ok: true })
  } catch {
    return writeFailure(config.output, options)
  }
}

module.exports = {
  BASELINE_SCENARIO,
  FATAL_DIAGNOSTIC,
  OPTIONS,
  PACKAGED_APP_URL,
  PROJECT_TYPOGRAPHY_READINESS_TIMEOUT_MS,
  PROJECT_TYPOGRAPHY_SCENARIO,
  PUBLIC_FAILURE,
  STABLE_RENDERER_SCRIPT,
  STYLE_TARGET_SCRIPT,
  TRIGGER,
  VIEWPORT,
  captureBaseline,
  captureProjectTypography,
  configureVisualSmokeBeforeReady,
  executeBeforeDeadline,
  installVisualSmokeFatalObserver,
  parseVisualSmokeArguments,
  projectTypographyReadinessScript,
  runVisualSmoke,
  sendTrustedStyleActivation,
  validProjectTypographyState,
  validStyleTarget,
}
