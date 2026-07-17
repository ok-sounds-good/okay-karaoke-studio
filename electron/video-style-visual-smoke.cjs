'use strict'

const { pathsAreSeparate, validateOwnedSmokeProfile } = require('./smoke-profile.cjs')
const {
  publishArtifactBuffers,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('./smoke-artifacts.cjs')
const { parseBoundedPngContainer } = require('./png-validation.cjs')
const { focusSmokeWindow } = require('./smoke-window-focus.cjs')
const {
  BASELINE_SCENARIO,
  STYLE_SESSION_SCENARIO,
  STYLE_SESSION_VIEWPORTS,
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
const CAPTURE_STABILITY_CANDIDATE_LIMIT = 5
const CAPTURE_STABILITY_SETTLE_MS = 50
const STYLE_SESSION_READINESS_TIMEOUT_MS = 10_000
const STYLE_KEY_SEQUENCE = Object.freeze([
  'Tab',
  'Tab',
  'Shift+Tab',
  'Tab',
  'Left',
  'Shift+Tab',
  'Tab',
  'Up',
  'Shift+Tab',
  'Tab',
  'Right',
  'Right',
  'Up',
  'Down',
  'Tab',
  'Tab',
  'Escape',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Tab',
  'Enter',
])
const STYLE_KEY_FOCUS = Object.freeze([
  'master',
  'role:brand',
  'master',
  'role:brand',
  'role:footer',
  'master',
  'role:footer',
  'role:clock',
  'master',
  'role:clock',
  'role:footer',
  'role:brand',
  'role:footer',
  'role:brand',
  'visibility',
  'typeface',
  'face:Regular',
  'face:Italic',
  'face:Semi Bold',
  'face:Bold',
  'face:Extra Bold',
  'size',
  'color',
  'cancel',
  'apply',
])
const STYLE_KEY_CHANGES = Object.freeze(['footer', 'clock', 'footer', 'brand', 'footer', 'brand'])

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
      'button.style-button[aria-label="Edit project Style"]',
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

const STYLE_KEY_RECORDER_SCRIPT = `(() => {
  const storage = '__oksStyleKeyboardRecorder'
  if (globalThis[storage]) return false
  const focus = []
  const changes = []
  const describe = (target) => {
    if (!(target instanceof HTMLElement)) return null
    if (target.matches('[aria-label="Show Stage frame in output"]')) return 'master'
    if (target.matches('input[type="radio"]')) return 'role:' + target.value
    const label = target.getAttribute('aria-label')
    if (label === 'Show Brand in output') return 'visibility'
    if (label === 'Brand typeface') return 'typeface'
    if (label?.startsWith('Brand face ')) return 'face:' + label.slice(11)
    if (label === 'Brand font size') return 'size'
    if (label === 'Brand color') return 'color'
    return target.dataset.styleAction ?? null
  }
  const onFocus = (event) => {
    const value = describe(event.target)
    if (value) focus.push(value)
  }
  const onChange = (event) => {
    const target = event.target
    const roles = [...document.querySelectorAll(
      '[aria-label="Stage frame role"] input[type="radio"]',
    )]
    if (target instanceof HTMLInputElement && roles.includes(target)) changes.push({
      active: document.activeElement === target,
      checked: target.checked,
      checkedCount: roles.filter((role) => role.checked).length,
      role: target.value,
    })
  }
  document.addEventListener('focusin', onFocus, true)
  document.addEventListener('change', onChange, true)
  globalThis[storage] = { changes, focus, dispose() {
    document.removeEventListener('focusin', onFocus, true)
    document.removeEventListener('change', onChange, true)
  } }
  return true
})()`

const STYLE_KEY_RESULT_SCRIPT = `(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const storage = '__oksStyleKeyboardRecorder'
    const recorder = globalThis[storage]
    const undo = document.querySelector('[aria-label="Undo"]')
    const redo = document.querySelector('[aria-label="Redo"]')
    const result = recorder ? { changes: [...recorder.changes], focus: [...recorder.focus],
      closed: !document.querySelector('.style-workspace[role="dialog"]'),
      clean: !document.querySelector('[title="Unsaved changes"]'),
      redoDisabled: redo instanceof HTMLButtonElement && redo.disabled,
      undoDisabled: undo instanceof HTMLButtonElement && undo.disabled } : null
    recorder?.dispose()
    delete globalThis[storage]
    resolve(result)
  }))
}))()`

function projectLyricsReadinessScript(viewport, contract = { kind: 'project-lyrics' }) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const contract = ${JSON.stringify(contract)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    let checking = false
    let finished = false
    let rerun = false
    const resizeObserver = new ResizeObserver(() => schedule())
    const mutationObserver = new MutationObserver(() => schedule())
    const fontSet = document.fonts
    const fitFixture = document.createElement('div')
    fitFixture.className = 'style-destination-tabs'
    fitFixture.setAttribute('aria-hidden', 'true')
    fitFixture.style.cssText = 'position:fixed;left:0;top:0;width:330px;visibility:hidden;pointer-events:none'
    fitFixture.style.setProperty('--style-destination-count', '5')
    for (const label of ['Project lyrics', 'Lead Vocal', 'Background', 'Title card', 'Stage frame']) {
      const button = document.createElement('button')
      button.textContent = label
      fitFixture.append(button)
    }
    document.body.append(fitFixture)

    const fiveDestinationsFit = () => {
      const fixtureBounds = fitFixture.getBoundingClientRect()
      const buttons = [...fitFixture.querySelectorAll('button')]
      const bounds = buttons.map((button) => button.getBoundingClientRect())
      const rowTops = new Set(bounds.map((box) => box.top))
      return fixtureBounds.width === 330 && fitFixture.scrollWidth <= fitFixture.clientWidth &&
        bounds.length === 5 && rowTops.size === 2 && bounds.every((box) =>
          box.left >= fixtureBounds.left && box.right <= fixtureBounds.right) &&
        buttons.every((button) => button.scrollWidth <= button.clientWidth)
    }

    const sampleBackground = () => {
      const applied = contract.applied === true
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-background-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="background"]')
      const preview = document.querySelector(
        applied ? '[aria-label="Karaoke preview"]' : '[aria-label="Background design preview"]',
      )
      const stage = preview?.querySelector('.karaoke-stage')
      const mode = stage?.getAttribute('data-background-mode')
      const colors = {
        gradientEndColor: stage?.getAttribute('data-background-gradient-end-color'),
        gradientStartColor: stage?.getAttribute('data-background-gradient-start-color'),
        solidColor: stage?.getAttribute('data-background-solid-color'),
      }
      if (
        !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
        mode !== contract.mode || Object.values(colors).some((color) => !/^#[0-9a-f]{6}$/iu.test(color)) ||
        (contract.colors && Object.entries(contract.colors).some(([key, value]) => colors[key] !== value)) ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning')
      ) return null
      if (applied) {
        const trigger = document.querySelector('button.style-button[aria-label="Edit project Style"]')
        if (workspace || !(trigger instanceof HTMLButtonElement) || stage.classList.contains('is-designing')) return null
      } else {
        const radios = panel?.querySelectorAll('input[type="radio"]') ?? []
        const colorLabels = [...(panel?.querySelectorAll('input[type="color"]') ?? [])]
          .map((input) => input.getAttribute('aria-label'))
        const expectedLabels = mode === 'solid'
          ? ['Background solid color']
          : ['Background gradient start color', 'Background gradient end color']
        if (
          !(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          radios.length !== 3 || colorLabels.join('|') !== expectedLabels.join('|')
        ) return null
      }
      const hexRgb = (hex) => {
        const value = Number.parseInt(hex.slice(1), 16)
        return 'rgb(' + ((value >> 16) & 255) + ', ' + ((value >> 8) & 255) + ', ' +
          (value & 255) + ')'
      }
      const style = getComputedStyle(stage)
      const css = mode === 'solid' ? style.backgroundColor : style.backgroundImage
      const expectedCss = mode === 'solid'
        ? hexRgb(colors.solidColor)
        : 'linear-gradient(145deg, ' + hexRgb(colors.gradientStartColor) + ', ' +
          hexRgb(colors.gradientEndColor) + ')'
      const bounds = stage.getBoundingClientRect()
      const actions = applied ? [] : [
        panel.querySelector('fieldset'),
        workspace.querySelector('[data-style-action="cancel"]'),
        workspace.querySelector('[data-style-action="apply"]'),
      ]
      if (
        css.replace(/\s/gu, '') !== expectedCss.replace(/\s/gu, '') ||
        bounds.width <= 0 || bounds.height <= 0 || Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        actions.some((element) => {
          const box = element?.getBoundingClientRect()
          return !box || box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 ||
            box.right > expected.width || box.bottom > expected.height
        })
      ) return null
      return { applied, ...colors, css, height: expected.height, mode, resourcesReady: true,
        stageHeight: bounds.height, stageWidth: bounds.width, width: expected.width }
    }

    const sampleTitleCard = () => {
      const applied = contract.applied === true
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-title-card-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="title-card"]')
      const preview = document.querySelector(
        applied ? '[aria-label="Karaoke preview"]' : '[aria-label="Title card design preview"]',
      )
      const stage = preview?.querySelector('.karaoke-stage')
      const card = stage?.querySelector('.title-card')
      const role = card?.querySelector('[data-title-card-design-role="' + contract.role + '"]')
      const status = card?.querySelector('.title-card-design-status')
      const eyebrow = card?.querySelector('[data-title-card-role="eyebrow"]')
      const title = card?.querySelector('[data-title-card-role="title"]')
      const artist = card?.querySelector('[data-title-card-role="artist"]')
      const bounds = stage?.getBoundingClientRect()
      if (!(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
        !(card instanceof HTMLElement) || !(title instanceof HTMLElement) ||
        !bounds || bounds.width <= 0 || Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        stage.querySelector('.active-lines, .sync-aid')) return null
      if (applied) {
        if (workspace || stage.classList.contains('is-designing') || eyebrow || artist || status) return null
      } else {
        const selected = panel?.querySelector('input[value="' + contract.role + '"]')
        const visibility = panel?.querySelector('[aria-label="Show ' +
          contract.role[0].toUpperCase() + contract.role.slice(1) + ' in output"]')
        const hidden = contract.role === 'eyebrow' ? contract.eyebrowHidden : contract.artistHidden
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(selected instanceof HTMLInputElement) || !selected.checked ||
          !(visibility instanceof HTMLInputElement) || visibility.checked === hidden ||
          !(role instanceof HTMLElement) || (hidden !== (role.dataset.hiddenOutput === 'true')) ||
          (hidden !== (status?.textContent === 'Hidden in output')) ||
          (contract.eyebrowHidden && contract.role !== 'eyebrow' ? Boolean(eyebrow) : !eyebrow) ||
          (contract.artistHidden && contract.role !== 'artist' ? Boolean(artist) : !artist) ||
          workspace.querySelectorAll('.style-editor__body').length !== 1 || !fiveDestinationsFit()) return null
      }
      return { applied, height: expected.height, resourcesReady: true, role: contract.role,
        stageHeight: bounds.height, stageWidth: bounds.width, width: expected.width }
    }

    const sampleStageFrame = () => {
      const applied = contract.applied === true
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-stage-frame-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="stage-frame"]')
      const preview = document.querySelector(
        applied ? '[aria-label="Karaoke preview"]' : '[aria-label="Stage frame design preview"]',
      )
      const stage = preview?.querySelector('.karaoke-stage')
      const line = stage?.querySelector('[data-stage-frame-line]')
      const brand = stage?.querySelector('[data-stage-frame-role="brand"]')
      const clock = stage?.querySelector('[data-stage-frame-role="clock"]')
      const footer = stage?.querySelector('[data-stage-frame-role="footer"]')
      const status = preview?.querySelectorAll('[data-stage-frame-output-status]') ?? []
      const bounds = stage?.getBoundingClientRect()
      const lineColor = stage?.style.getPropertyValue('--stage-frame-color')
      const lineWidth = stage?.style.getPropertyValue('--stage-frame-width')
      const brandStyle = brand?.getAttribute('style')
      const clockStyle = clock?.getAttribute('style')
      const clockWeight = clock instanceof HTMLElement ? getComputedStyle(clock).fontWeight : null
      if (!(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
        !bounds || bounds.width <= 0 || Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        !(line instanceof HTMLElement) || !(brand instanceof HTMLElement) ||
        !(clock instanceof HTMLElement) || brand.textContent !== 'OKAY / STUDIO' ||
        !/^\\d{2}:\\d{2}\\.\\d{3}$/u.test(clock.textContent ?? '') ||
        (footer && footer.textContent !== 'Unknown Artist · Untitled Song') ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        (contract.lineColor && lineColor !== contract.lineColor) ||
        (contract.lineWidth && lineWidth !== contract.lineWidth) ||
        (contract.brandStyle && brandStyle !== contract.brandStyle) ||
        (contract.clockStyle && clockStyle !== contract.clockStyle) ||
        (contract.clockWeight && clockWeight !== contract.clockWeight)) return null
      const stageCenterX = bounds.left + bounds.width / 2
      const stageCenterY = bounds.top + bounds.height / 2
      const brandBounds = brand.getBoundingClientRect()
      const clockBounds = clock.getBoundingClientRect()
      const footerBounds = footer?.getBoundingClientRect()
      if (brandBounds.left >= stageCenterX || brandBounds.top >= stageCenterY ||
        clockBounds.right <= stageCenterX || clockBounds.top >= stageCenterY ||
        (footerBounds && footerBounds.bottom <= stageCenterY)) return null
      if (applied) {
        if (workspace || stage.classList.contains('is-designing') || status.length || footer ||
          stage.querySelector('[data-stage-frame-design-role], [data-design-only]')) return null
      } else {
        const master = panel?.querySelector('[aria-label="Show Stage frame in output"]')
        const selected = panel?.querySelector('input[value="' + contract.role + '"]')
        const visibility = panel?.querySelector('[aria-label="Show ' +
          contract.role[0].toUpperCase() + contract.role.slice(1) + ' in output"]')
        const target = stage.querySelector('[data-stage-frame-design-role="' + contract.role + '"]')
        const controls = [...(panel?.querySelectorAll('input, button, select') ?? [])]
        const body = workspace?.querySelector('.style-editor__body')
        const bodyBounds = body?.getBoundingClientRect()
        const initialControls = [master, panel?.querySelector('[role="radiogroup"]'),
          panel?.querySelector('.visible-text-role-editor > h3'), visibility,
          panel?.querySelector('[role="combobox"]')]
        const expectedStatus = contract.enabled
          ? (contract.roleVisible ? null : contract.role[0].toUpperCase() + contract.role.slice(1) + ' hidden in output')
          : 'Stage frame off in output'
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(master instanceof HTMLInputElement) || master.checked !== contract.enabled ||
          !(selected instanceof HTMLInputElement) || !selected.checked ||
          !(visibility instanceof HTMLInputElement) || visibility.checked !== contract.roleVisible ||
          !(target instanceof HTMLElement) || getComputedStyle(target).outlineStyle === 'none' ||
          controls.some((control) => control.disabled || getComputedStyle(control).visibility !== 'visible') ||
          !bodyBounds || initialControls.some((control) => {
            const box = control?.getBoundingClientRect()
            return !box || box.top < bodyBounds.top || box.bottom > bodyBounds.bottom
          }) || workspace.querySelectorAll('.style-editor__body').length !== 1 || !fiveDestinationsFit() ||
          status.length !== (expectedStatus ? 1 : 0) ||
          (expectedStatus && status[0]?.getAttribute('aria-label') !== expectedStatus) ||
          (status[0] && status[0].nextElementSibling?.textContent !== 'Fixed 1920 × 1080 stage')) return null
        const opacityFor = (role) => {
          const element = role === 'footer' ? footer?.closest('.karaoke-stage__footer') :
            role === 'brand' ? brand : clock
          return element instanceof HTMLElement ? Number(getComputedStyle(element).opacity) : null
        }
        if (Number(getComputedStyle(target).opacity) !== 1 ||
          Number(getComputedStyle(line).opacity) !== (contract.enabled ? 1 : .45) ||
          (!contract.enabled && ['brand', 'clock', 'footer'].some((role) =>
            role !== contract.role && opacityFor(role) !== .45))) return null
      }
      return { applied, brandStyle, clockStyle, clockWeight, height: expected.height,
        lineColor, lineWidth, resourcesReady: true, role: contract.role,
        stageHeight: bounds.height, stageWidth: bounds.width, width: expected.width }
    }

    const sample = () => {
      if (contract.kind === 'background') return sampleBackground()
      if (contract.kind === 'title-card') return sampleTitleCard()
      if (contract.kind === 'stage-frame') return sampleStageFrame()
      if (contract.kind === 'lead-vocal') {
        const workspace = document.querySelector('.style-workspace[role="dialog"]')
        const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-lead-vocal-tab"]')
        const tab = document.querySelector('[role="tab"][data-style-destination="lead-vocal"]')
        const preview = document.querySelector('[aria-label="Lead Vocal design preview"]')
        const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
        const line = stage?.querySelector('[data-design-preview="lead-vocal"] .stage-line')
        const bounds = stage?.getBoundingClientRect()
        const text = panel?.textContent ?? ''
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
          !(line instanceof HTMLElement) || !bounds || bounds.width <= 0 || bounds.height <= 0 ||
          Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
          panel.querySelectorAll('input[aria-label^="Override Lead Vocal"]').length !== 5 ||
          panel.querySelectorAll('input[type="color"]').length !== 2 ||
          !text.includes('Sung') || !text.includes('Unsung') ||
          text.includes('Preview time') || text.includes('Sync aid') ||
          stage.querySelector('.sync-aid') || stage.querySelectorAll('.stage-line').length !== 1 ||
          !/^stage-line stage-line--(?:left|center|right)$/u.test(line.className) ||
          !line.getAttribute('data-stage-font-size') || document.readyState !== 'complete' ||
          fontSet?.status !== 'loaded' || document.documentElement.clientWidth !== expected.width ||
          document.documentElement.clientHeight !== expected.height ||
          document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
          window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
          !fiveDestinationsFit()) return null
        return { height: expected.height, resourcesReady: true, stageHeight: bounds.height,
          stageWidth: bounds.width, width: expected.width }
      }
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
        !fiveDestinationsFit() || Array.from(document.images).some(
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
      fitFixture.remove()
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

function styleSessionActionScript(action) {
  return `(() => {
    const action = ${JSON.stringify(action)}
    const workspace = document.querySelector('.style-workspace[role="dialog"]')
    const projectTab = document.querySelector('[role="tab"][data-style-destination="project-lyrics"]')
    const leadVocalTab = document.querySelector('[role="tab"][data-style-destination="lead-vocal"]')
    const backgroundTab = document.querySelector('[role="tab"][data-style-destination="background"]')
    const titleTab = document.querySelector('[role="tab"][data-style-destination="title-card"]')
    const stageTab = document.querySelector('[role="tab"][data-style-destination="stage-frame"]')
    const gradient = document.querySelector('input[type="radio"][value="gradient"]')
    const solid = document.querySelector('input[type="radio"][value="solid"]')
    const eyebrow = document.querySelector('input[type="radio"][value="eyebrow"]')
    const artist = document.querySelector('input[type="radio"][value="artist"]')
    const eyebrowVisibility = document.querySelector('[aria-label="Show Eyebrow in output"]')
    const artistVisibility = document.querySelector('[aria-label="Show Artist in output"]')
    const stageMaster = document.querySelector('[aria-label="Show Stage frame in output"]')
    const brand = document.querySelector('input[type="radio"][value="brand"]')
    const clock = document.querySelector('input[type="radio"][value="clock"]')
    const footer = document.querySelector('input[type="radio"][value="footer"]')
    const clockFace = document.querySelector('[aria-label="Clock face Bold"]')
    const footerVisibility = document.querySelector('[aria-label="Show Footer in output"]')
    const apply = workspace?.querySelector('[data-style-action="apply"]')
    const targets = { background: backgroundTab, lead: leadVocalTab, solid, apply, reopen:
      document.querySelector('button.style-button[aria-label="Edit project Style"]'),
      title: titleTab, 'eyebrow-visibility': eyebrowVisibility, artist,
      'artist-visibility': artistVisibility, 'apply-title': apply, stage: stageTab,
      'stage-off': stageMaster, 'stage-on': stageMaster, clock, 'clock-face': clockFace,
      footer, 'footer-visibility': footerVisibility, 'apply-stage': apply }
    const target = targets[action]
    const semantic = ({
      background: projectTab?.getAttribute('aria-selected') === 'true' && backgroundTab?.getAttribute('aria-selected') === 'false',
      lead: projectTab?.getAttribute('aria-selected') === 'true' && leadVocalTab?.getAttribute('aria-selected') === 'false',
      solid: backgroundTab?.getAttribute('aria-selected') === 'true' && gradient?.checked && !solid?.checked,
      apply: backgroundTab?.getAttribute('aria-selected') === 'true' && solid?.checked,
      reopen: !workspace,
      title: projectTab?.getAttribute('aria-selected') === 'true',
      'eyebrow-visibility': titleTab?.getAttribute('aria-selected') === 'true' && eyebrow?.checked && eyebrowVisibility?.checked,
      artist: eyebrow?.checked && !eyebrowVisibility?.checked && !artist?.checked,
      'artist-visibility': artist?.checked && artistVisibility?.checked,
      'apply-title': artist?.checked && !eyebrowVisibility?.checked && !artistVisibility?.checked,
      stage: projectTab?.getAttribute('aria-selected') === 'true' && stageTab?.getAttribute('aria-selected') === 'false',
      'stage-off': stageTab?.getAttribute('aria-selected') === 'true' && brand?.checked && stageMaster?.checked,
      'stage-on': brand?.checked && !stageMaster?.checked,
      clock: stageMaster?.checked && brand?.checked && !clock?.checked,
      'clock-face': clock?.checked && clockFace?.getAttribute('aria-pressed') === 'false',
      footer: clock?.checked && clockFace?.getAttribute('aria-pressed') === 'true' && !footer?.checked,
      'footer-visibility': footer?.checked && footerVisibility?.checked,
      'apply-stage': stageTab?.getAttribute('aria-selected') === 'true' &&
        stageMaster?.checked && footer?.checked && !footerVisibility?.checked,
    })[action] === true
    if (!(target instanceof HTMLElement) || !semantic || target.disabled) return null
    const bounds = target.getBoundingClientRect()
    const style = getComputedStyle(target)
    if (bounds.width <= 0 || bounds.height <= 0 || style.display === 'none' ||
      style.pointerEvents === 'none' || style.visibility !== 'visible') return null
    return { action, boundsHeight: bounds.height, boundsWidth: bounds.width,
      height: document.documentElement.clientHeight, href: window.location.href,
      readyState: document.readyState, width: document.documentElement.clientWidth,
      x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) }
  })()`
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

function settleCapture() {
  return new Promise((resolve) => setTimeout(resolve, CAPTURE_STABILITY_SETTLE_MS))
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

async function capturePngCandidate(window, viewport) {
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
  let bytes
  let parsed
  try {
    bytes = image.toPNG()
    if (!Buffer.isBuffer(bytes)) throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
    parsed = parseBoundedPngContainer(bytes)
  } catch {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  if (parsed.animated || parsed.width !== viewport.width || parsed.height !== viewport.height) {
    throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
  }
  return Buffer.from(bytes)
}

async function captureViewport(window, viewport, settle = settleCapture) {
  let previous
  for (
    let candidateIndex = 0;
    candidateIndex < CAPTURE_STABILITY_CANDIDATE_LIMIT;
    candidateIndex += 1
  ) {
    const candidate = await capturePngCandidate(window, viewport)
    if (previous && previous.equals(candidate)) return candidate
    previous = candidate
    if (candidateIndex < CAPTURE_STABILITY_CANDIDATE_LIMIT - 1) {
      try {
        await settle()
      } catch {
        throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
      }
    }
  }
  throw smokeError('VISUAL_SMOKE_CAPTURE_INVALID')
}

async function captureBaseline(window, app, options) {
  await prepareCaptureWindow(window, app, options)
  const rendererState = await window.webContents.executeJavaScript(STABLE_RENDERER_SCRIPT, false)
  if (!validRendererState(rendererState)) throw smokeError('VISUAL_SMOKE_RENDERER_INVALID')
  const png = await captureViewport(window, VIEWPORT, options.captureSettle)
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

function validStyleActionTarget(value, action) {
  return validStyleTarget(value) && value.action === action
}

function validBackgroundState(value, viewport, mode, colors = null, applied = false) {
  const colorKeys = ['gradientEndColor', 'gradientStartColor', 'solidColor']
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.applied === applied &&
    value.mode === mode &&
    value.height === viewport.height &&
    value.width === viewport.width &&
    value.resourcesReady === true &&
    typeof value.css === 'string' &&
    value.css.length > 0 &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    colorKeys.every((key) => /^#[0-9a-f]{6}$/iu.test(value[key])) &&
    (!colors || colorKeys.every((key) => value[key] === colors[key])),
  )
}

function validProjectLyricsState(value, viewport) {
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

function validLeadVocalState(value, viewport) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(['height', 'resourcesReady', 'stageHeight', 'stageWidth', 'width']) &&
    value.height === viewport.height &&
    value.width === viewport.width &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    Math.abs(value.stageWidth / value.stageHeight - 16 / 9) <= 0.01,
  )
}

function validStageFrameState(value, viewport, contract) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.applied === (contract.applied === true) &&
    value.role === contract.role &&
    value.height === viewport.height &&
    value.width === viewport.width &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    typeof value.brandStyle === 'string' &&
    typeof value.clockStyle === 'string' &&
    typeof value.clockWeight === 'string' &&
    /^#[0-9a-f]{6}$/iu.test(value.lineColor) &&
    typeof value.lineWidth === 'string' &&
    value.lineWidth.length > 0,
  )
}

function validStyleKeyboardState(value) {
  return Boolean(
    value &&
    value.closed === true &&
    value.clean === true &&
    value.undoDisabled === true &&
    value.redoDisabled === true &&
    JSON.stringify(value.focus) === JSON.stringify(STYLE_KEY_FOCUS) &&
    Array.isArray(value.changes) &&
    value.changes.length === STYLE_KEY_CHANGES.length &&
    value.changes.every((change, index) =>
      Boolean(
        change &&
        change.active === true &&
        change.checked === true &&
        change.checkedCount === 1 &&
        change.role === STYLE_KEY_CHANGES[index],
      ),
    ),
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

function sendTrustedStyleActivation(contents, target, displayScale) {
  if (
    !contents ||
    typeof contents.sendInputEvent !== 'function' ||
    !validStyleTarget(target) ||
    (displayScale !== 1 && displayScale !== 2)
  ) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  const x = Math.round(target.x / displayScale)
  const y = Math.round(target.y / displayScale)
  const contentWidth = VIEWPORT.width / displayScale
  const contentHeight = VIEWPORT.height / displayScale
  if (
    !Number.isSafeInteger(x) ||
    x < 0 ||
    x >= contentWidth ||
    !Number.isSafeInteger(y) ||
    y < 0 ||
    y >= contentHeight
  ) {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
  try {
    contents.sendInputEvent({ type: 'mouseMove', x, y })
    contents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseDown',
      x,
      y,
    })
    contents.sendInputEvent({
      button: 'left',
      clickCount: 1,
      type: 'mouseUp',
      x,
      y,
    })
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

function sendTrustedStyleKey(contents, accelerator) {
  if (
    !contents ||
    typeof contents.sendInputEvent !== 'function' ||
    !STYLE_KEY_SEQUENCE.includes(accelerator)
  )
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  const shifted = accelerator.startsWith('Shift+')
  const keyCode = shifted ? accelerator.slice(6) : accelerator
  const eventTypes = accelerator === 'Enter' ? ['keyDown', 'char', 'keyUp'] : ['keyDown', 'keyUp']
  try {
    for (const type of eventTypes) {
      const event = { keyCode, type }
      if (shifted) event.modifiers = ['shift']
      contents.sendInputEvent(event)
    }
  } catch {
    throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  }
}

async function captureStyleSession(window, app, options) {
  const displayScale = await prepareCaptureWindow(window, app, options)
  const capture = (viewport) => captureViewport(window, viewport, options.captureSettle)
  const target = await executeBeforeDeadline(
    () => window.webContents.executeJavaScript(STYLE_TARGET_SCRIPT, false),
    options.readinessTimeoutMs,
  )
  if (!validStyleTarget(target)) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  sendTrustedStyleActivation(window.webContents, target, displayScale)

  const pngs = []
  for (const viewport of STYLE_SESSION_VIEWPORTS.slice(0, 2)) {
    setExactViewport(window, viewport, displayScale)
    const state = await executeBeforeDeadline(
      () => window.webContents.executeJavaScript(projectLyricsReadinessScript(viewport), false),
      options.readinessTimeoutMs,
    )
    if (!validProjectLyricsState(state, viewport)) {
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    }
    pngs.push(await capture(viewport))
  }
  const viewport = STYLE_SESSION_VIEWPORTS[2]
  setExactViewport(window, viewport, displayScale)
  const resized = await executeBeforeDeadline(
    () => window.webContents.executeJavaScript(projectLyricsReadinessScript(viewport), false),
    options.readinessTimeoutMs,
  )
  if (!validProjectLyricsState(resized, viewport))
    throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  const activate = async (action) => {
    const actionTarget = await window.webContents.executeJavaScript(
      styleSessionActionScript(action),
      false,
    )
    if (!validStyleActionTarget(actionTarget, action))
      throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
    sendTrustedStyleActivation(window.webContents, actionTarget, displayScale)
  }
  const stageFrameState = async (contract) => {
    const state = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          projectLyricsReadinessScript(viewport, { kind: 'stage-frame', ...contract }),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (!validStageFrameState(state, viewport, contract))
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    return state
  }
  await activate('stage')
  await stageFrameState({ enabled: true, role: 'brand', roleVisible: true })
  const armed = await window.webContents.executeJavaScript(STYLE_KEY_RECORDER_SCRIPT, false)
  if (armed !== true) throw smokeError('VISUAL_SMOKE_ACTIVATION_INVALID')
  STYLE_KEY_SEQUENCE.forEach((key) => sendTrustedStyleKey(window.webContents, key))
  const keyboardState = await executeBeforeDeadline(
    () => window.webContents.executeJavaScript(STYLE_KEY_RESULT_SCRIPT, false),
    options.readinessTimeoutMs,
  )
  if (!validStyleKeyboardState(keyboardState)) throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  await activate('reopen')
  const backgroundState = async (mode, colors = null, applied = false) => {
    const state = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          projectLyricsReadinessScript(viewport, {
            applied,
            colors,
            kind: 'background',
            mode,
          }),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (!validBackgroundState(state, viewport, mode, colors, applied)) {
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
    }
    return state
  }
  await activate('background')
  await backgroundState('gradient')
  pngs.push(await capture(viewport))
  await activate('solid')
  const solid = await backgroundState('solid')
  pngs.push(await capture(viewport))
  const colors = Object.fromEntries(
    ['gradientEndColor', 'gradientStartColor', 'solidColor'].map((key) => [key, solid[key]]),
  )
  await activate('apply')
  await backgroundState('solid', colors, true)
  pngs.push(await capture(viewport))
  const titleCardState = async (contract) => {
    const state = await executeBeforeDeadline(
      () =>
        window.webContents.executeJavaScript(
          projectLyricsReadinessScript(viewport, { kind: 'title-card', ...contract }),
          false,
        ),
      options.readinessTimeoutMs,
    )
    if (
      !state ||
      state.resourcesReady !== true ||
      state.role !== contract.role ||
      state.applied !== (contract.applied === true)
    )
      throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  }
  await activate('reopen')
  await activate('title')
  await titleCardState({ role: 'eyebrow', eyebrowHidden: false, artistHidden: false })
  pngs.push(await capture(viewport))
  await activate('eyebrow-visibility')
  await titleCardState({ role: 'eyebrow', eyebrowHidden: true, artistHidden: false })
  pngs.push(await capture(viewport))
  await activate('artist')
  await activate('artist-visibility')
  await titleCardState({ role: 'artist', eyebrowHidden: true, artistHidden: true })
  pngs.push(await capture(viewport))
  await activate('apply-title')
  await titleCardState({ applied: true, role: 'artist', eyebrowHidden: true, artistHidden: true })
  pngs.push(await capture(viewport))
  await activate('reopen')
  await activate('stage')
  const baselineFrame = await stageFrameState({ enabled: true, role: 'brand', roleVisible: true })
  pngs.push(await capture(viewport))
  const preservedFrame = {
    brandStyle: baselineFrame.brandStyle,
    clockStyle: baselineFrame.clockStyle,
    clockWeight: baselineFrame.clockWeight,
    lineColor: baselineFrame.lineColor,
    lineWidth: baselineFrame.lineWidth,
  }
  await activate('stage-off')
  await stageFrameState({ ...preservedFrame, enabled: false, role: 'brand', roleVisible: true })
  pngs.push(await capture(viewport))
  await activate('stage-on')
  await activate('clock')
  await activate('clock-face')
  const clockFrame = await stageFrameState({
    ...preservedFrame,
    clockStyle: undefined,
    clockWeight: '700',
    enabled: true,
    role: 'clock',
    roleVisible: true,
  })
  pngs.push(await capture(viewport))
  const changedFrame = { ...preservedFrame, clockStyle: clockFrame.clockStyle, clockWeight: '700' }
  await activate('footer')
  await activate('footer-visibility')
  await stageFrameState({ ...changedFrame, enabled: true, role: 'footer', roleVisible: false })
  pngs.push(await capture(viewport))
  await activate('apply-stage')
  await stageFrameState({
    ...changedFrame,
    applied: true,
    enabled: true,
    role: 'footer',
    roleVisible: false,
  })
  pngs.push(await capture(viewport))
  await activate('reopen')
  await activate('lead')
  const leadVocalState = await executeBeforeDeadline(
    () =>
      window.webContents.executeJavaScript(
        projectLyricsReadinessScript(viewport, { kind: 'lead-vocal' }),
        false,
      ),
    options.readinessTimeoutMs,
  )
  if (!validLeadVocalState(leadVocalState, viewport))
    throw smokeError('VISUAL_SMOKE_READINESS_INVALID')
  pngs.push(await capture(viewport))
  return options.createScenarioArtifacts(STYLE_SESSION_SCENARIO, pngs).artifacts
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
    captureSettle: dependencies.captureSettle || settleCapture,
    createArtifacts: dependencies.createArtifacts || createResultArtifacts,
    createScenarioArtifacts: dependencies.createScenarioArtifacts || createScenarioResultArtifacts,
    focus: dependencies.focus || focusSmokeWindow,
    publish: dependencies.publish || publishArtifactBuffers,
    readinessTimeoutMs: dependencies.readinessTimeoutMs ?? STYLE_SESSION_READINESS_TIMEOUT_MS,
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
      } else if (scenario === STYLE_SESSION_SCENARIO) {
        artifacts = await captureStyleSession(window, app, options)
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
  PUBLIC_FAILURE,
  STABLE_RENDERER_SCRIPT,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_SESSION_SCENARIO,
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
  validProjectLyricsState,
  validStyleTarget,
}
