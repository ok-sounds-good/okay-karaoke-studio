'use strict'

// Acceptance-only renderer evaluation scripts and fail-closed result contracts.
// Production startup, preload, and renderer code never import this module.
const { VIEWPORT } = require('../scripts/visual-result-validation.cjs')

const PACKAGED_APP_URL = 'studio-app://app/index.html'
const STYLE_SESSION_READINESS_TIMEOUT_MS = 10_000
const STYLE_TEMPLATE_NAME = 'Smoke 158'
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
const STUDIO_BRIDGE_KEYS = Object.freeze(
  'cancelVideoExport,chooseBackgroundImage,createStyleTemplate,deleteStyleTemplate,exportText,exportVideo,getBackgroundState,getPendingWindowClose,importAudio,importLrc,listStyleTemplates,onMenuAction,onVideoExportProgress,onWindowCloseRequest,openProject,releaseAudio,releaseBackground,releaseBackgroundSnapshot,renameStyleTemplate,resetProjectScope,resolveProjectAudio,resolveProjectBackground,resolveStyleTemplateBackground,resolveWindowClose,retainBackground,saveProject,settleBackgroundImage,settleProjectOpen'.split(
    ',',
  ),
)

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
    const bridge = window.studio
    const bridgeKeys = bridge && typeof bridge === 'object' ? Object.keys(bridge).sort() : []
    const bridgeFunctions = bridgeKeys.every((key) => typeof bridge[key] === 'function')
    let ipcReady = false
    try {
      ipcReady = (await bridge?.getPendingWindowClose?.()) === null
    } catch {}
    return {
      bridgeFrozen: Object.isFrozen(bridge),
      bridgeFunctions,
      bridgeKeys,
      devicePixelRatio: window.devicePixelRatio,
      height: document.documentElement.clientHeight,
      href: window.location.href,
      ipcReady,
      nodeAccess: typeof window.process !== 'undefined' || typeof window.require !== 'undefined',
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
    fitFixture.style.setProperty('--style-destination-count', '6')
    for (const label of ['Project lyrics', 'Lead Vocal', 'Background', 'Title card', 'Stage frame', 'Templates']) {
      const button = document.createElement('button')
      button.textContent = label
      fitFixture.append(button)
    }
    document.body.append(fitFixture)

    const sixDestinationsFit = () => {
      const fixtureBounds = fitFixture.getBoundingClientRect()
      const buttons = [...fitFixture.querySelectorAll('button')]
      const bounds = buttons.map((button) => button.getBoundingClientRect())
      const rowTops = new Set(bounds.map((box) => box.top))
      return fixtureBounds.width === 330 && fitFixture.scrollWidth <= fitFixture.clientWidth &&
        bounds.length === 6 && rowTops.size === 2 && bounds.every((box) =>
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
          workspace.querySelectorAll('.style-editor__body').length !== 1 || !sixDestinationsFit()) return null
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
          }) || workspace.querySelectorAll('.style-editor__body').length !== 1 || !sixDestinationsFit() ||
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
        const cue = stage?.querySelector('.sync-aid')
        const enabled = panel?.querySelector('[aria-label="Enable Lead Vocal Sync Aid"]')
        const timing = [...(panel?.querySelectorAll('.vocal-timing-field input[type="number"]') ?? [])]
        const bounds = stage?.getBoundingClientRect()
        const text = panel?.textContent ?? ''
        if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
          !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
          !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) ||
          !(line instanceof HTMLElement) || !bounds || bounds.width <= 0 || bounds.height <= 0 ||
          Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
          panel.querySelectorAll('input[aria-label^="Override Lead Vocal"]').length !== 5 ||
          panel.querySelectorAll('input[type="color"]').length !== 2 ||
          !(enabled instanceof HTMLInputElement) || !enabled.checked || timing.length !== 3 ||
          timing.some((input) => !(input instanceof HTMLInputElement) || input.step !== 'any' ||
            input.dataset.stepMs !== '100' || input.min !== '0' || input.max !== '60000' ||
            getComputedStyle(input).appearance !== 'textfield' ||
            input.validity.stepMismatch || !input.checkValidity() || !input.value) ||
          !text.includes('Sung') || !text.includes('Unsung') || !text.includes('Preview Time') ||
          !text.includes('Sync Aid') || !text.includes('Minimum lead') || !text.includes('Maximum lead') ||
          !text.includes('Arrow Up or Arrow Down adjusts by 100 ms') ||
          !(cue instanceof HTMLElement) || cue.style.getPropertyValue('--sync-progress') !== '0.5' ||
          stage.querySelectorAll('.stage-line').length !== 2 ||
          !/^stage-line stage-line--(?:left|center|right)$/u.test(line.className) ||
          !line.getAttribute('data-stage-font-size') || document.readyState !== 'complete' ||
          fontSet?.status !== 'loaded' || document.documentElement.clientWidth !== expected.width ||
          document.documentElement.clientHeight !== expected.height ||
          document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
          window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
          !sixDestinationsFit()) return null
        return { controls: timing.length + 1, cueProgress: .5, height: expected.height,
          resourcesReady: true, stageHeight: bounds.height, stageWidth: bounds.width,
          width: expected.width }
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
        !sixDestinationsFit() || Array.from(document.images).some(
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
    const templatesTab = document.querySelector('[role="tab"][data-style-destination="templates"]')
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
    const syncAid = document.querySelector('[aria-label="Enable Lead Vocal Sync Aid"]')
    const templateName = document.querySelector('input[aria-label="New template name"]')
    const saveTemplate = [...(workspace?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Save as new',
    )
    const apply = workspace?.querySelector('[data-style-action="apply"]')
    const targets = { background: backgroundTab, lead: leadVocalTab, solid, apply, reopen:
      document.querySelector('button.style-button[aria-label="Edit project Style"]'),
      title: titleTab, 'eyebrow-visibility': eyebrowVisibility, artist,
      'artist-visibility': artistVisibility, 'apply-title': apply, stage: stageTab,
      'stage-off': stageMaster, 'stage-on': stageMaster, clock, 'clock-face': clockFace,
      footer, 'footer-visibility': footerVisibility, 'apply-stage': apply, 'sync-aid': syncAid,
      templates: templatesTab, 'template-name': templateName, 'save-template': saveTemplate }
    const target = targets[action]
    if (['sync-aid', 'template-name', 'save-template'].includes(action) && target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center' })
    }
    const semantic = ({
      background: projectTab?.getAttribute('aria-selected') === 'true' && backgroundTab?.getAttribute('aria-selected') === 'false',
      lead: projectTab?.getAttribute('aria-selected') === 'true' && leadVocalTab?.getAttribute('aria-selected') === 'false',
      'sync-aid': leadVocalTab?.getAttribute('aria-selected') === 'true' && !syncAid?.checked,
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
      templates: workspace instanceof HTMLElement &&
        leadVocalTab?.getAttribute('aria-selected') === 'true' &&
        templatesTab?.getAttribute('aria-selected') === 'false',
      'template-name': templatesTab?.getAttribute('aria-selected') === 'true' &&
        templateName instanceof HTMLInputElement && !templateName.disabled && !templateName.value &&
        Boolean(workspace?.querySelector('.style-template-list[aria-busy="false"]')),
      'save-template': templatesTab?.getAttribute('aria-selected') === 'true' &&
        templateName instanceof HTMLInputElement && templateName.value === ${JSON.stringify(STYLE_TEMPLATE_NAME)} &&
        saveTemplate instanceof HTMLButtonElement && !saveTemplate.disabled,
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

function styleTemplateReadinessScript(viewport, name = STYLE_TEMPLATE_NAME) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const expectedName = ${JSON.stringify(name)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    const mutationObserver = new MutationObserver(() => schedule())
    const resizeObserver = new ResizeObserver(() => schedule())
    const fontSet = document.fonts
    let checking = false
    let finished = false
    let rerun = false
    const sample = () => {
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-templates-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="templates"]')
      const list = panel?.querySelector('.style-template-list')
      const selected = list?.querySelector('button[aria-pressed="true"]')
      const status = panel?.querySelector('[role="status"]')
      const newName = panel?.querySelector('input[aria-label="New template name"]')
      const renameName = panel?.querySelector('input[aria-label="Rename selected template"]')
      const save = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Save as new',
      )
      const load = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Load into Style',
      )
      const remove = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Delete',
      )
      const preview = document.querySelector('[aria-label="Project lyrics design preview"]')
      const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
      const line = stage?.querySelector('[data-design-preview="project-lyrics"] .stage-line')
      const bounds = stage?.getBoundingClientRect()
      selected?.scrollIntoView({ block: 'nearest' })
      const body = workspace?.querySelector('.style-editor__body')
      const bodyBounds = body?.getBoundingClientRect()
      const selectedBounds = selected?.getBoundingClientRect()
      const controls = [newName, renameName, save, load, remove]
      if (!(workspace instanceof HTMLElement) || !(panel instanceof HTMLElement) || panel.hidden ||
        !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
        !(list instanceof HTMLElement) || list.getAttribute('aria-busy') !== 'false' ||
        !(selected instanceof HTMLButtonElement) || selected.textContent?.trim() !== expectedName ||
        !bodyBounds || !selectedBounds || selectedBounds.left < bodyBounds.left ||
        selectedBounds.right > bodyBounds.right || selectedBounds.top < bodyBounds.top ||
        selectedBounds.bottom > bodyBounds.bottom ||
        !(status instanceof HTMLElement) || status.textContent?.trim() !== 'Saved “' + expectedName + '”.' ||
        !(newName instanceof HTMLInputElement) || newName.value ||
        !(renameName instanceof HTMLInputElement) || renameName.value !== expectedName ||
        !(save instanceof HTMLButtonElement) || !save.disabled ||
        controls.some((control) => !(control instanceof HTMLElement) ||
          (control !== save && control instanceof HTMLButtonElement && control.disabled) ||
          getComputedStyle(control).visibility !== 'visible') ||
        !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(line instanceof HTMLElement) ||
        !bounds || bounds.width <= 0 || bounds.height <= 0 ||
        Math.abs(bounds.width / bounds.height - 16 / 9) > .01 ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        Array.from(document.images).some((image) => !image.complete ||
          image.naturalWidth <= 0 || image.naturalHeight <= 0)) return null
      return { controls: controls.length, height: expected.height, name: expectedName,
        resourcesReady: true, stageHeight: bounds.height, stageWidth: bounds.width,
        status: status.textContent.trim(), width: expected.width }
    }
    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
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
        await Promise.all(Array.from(document.images, (image) => image.decode?.() ?? Promise.resolve()))
        await frame()
        await frame()
        const first = sample()
        await frame()
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      } catch {
        // Resource and persistence failures remain non-ready until the outer deadline expires.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() { void check() }
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

function styleTemplateFormReadinessScript(viewport) {
  return `(() => new Promise((resolve) => {
    const expected = ${JSON.stringify(viewport)}
    const frame = () => new Promise((done) => requestAnimationFrame(() => done()))
    const mutationObserver = new MutationObserver(() => schedule())
    const resizeObserver = new ResizeObserver(() => schedule())
    const fontSet = document.fonts
    let checking = false
    let finished = false
    let rerun = false
    const sample = () => {
      const workspace = document.querySelector('.style-workspace[role="dialog"]')
      const body = workspace?.querySelector('.style-editor__body')
      const panel = document.querySelector('[role="tabpanel"][aria-labelledby$="-templates-tab"]')
      const tab = document.querySelector('[role="tab"][data-style-destination="templates"]')
      const list = panel?.querySelector('.style-template-list')
      const newName = panel?.querySelector('input[aria-label="New template name"]')
      const save = [...(panel?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent?.trim() === 'Save as new',
      )
      const preview = document.querySelector('[aria-label="Project lyrics design preview"]')
      const stage = preview?.querySelector('[data-logical-stage="1920x1080"]')
      const line = stage?.querySelector('[data-design-preview="project-lyrics"] .stage-line')
      newName?.scrollIntoView({ block: 'center' })
      const bodyBounds = body?.getBoundingClientRect()
      const nameBounds = newName?.getBoundingClientRect()
      const stageBounds = stage?.getBoundingClientRect()
      if (!(workspace instanceof HTMLElement) || !(body instanceof HTMLElement) ||
        !(panel instanceof HTMLElement) || panel.hidden ||
        !(tab instanceof HTMLButtonElement) || tab.getAttribute('aria-selected') !== 'true' ||
        !(list instanceof HTMLElement) || list.getAttribute('aria-busy') !== 'false' ||
        !(newName instanceof HTMLInputElement) || newName.disabled || newName.value ||
        !(save instanceof HTMLButtonElement) || !save.disabled ||
        !bodyBounds || !nameBounds || nameBounds.left < bodyBounds.left ||
        nameBounds.right > bodyBounds.right || nameBounds.top < bodyBounds.top ||
        nameBounds.bottom > bodyBounds.bottom ||
        !(preview instanceof HTMLElement) || !(stage instanceof HTMLElement) || !(line instanceof HTMLElement) ||
        !stageBounds || stageBounds.width <= 0 || stageBounds.height <= 0 ||
        Math.abs(stageBounds.width / stageBounds.height - 16 / 9) > .01 ||
        document.readyState !== 'complete' || fontSet?.status !== 'loaded' ||
        document.documentElement.clientWidth !== expected.width ||
        document.documentElement.clientHeight !== expected.height ||
        document.documentElement.scrollWidth > expected.width || document.body.scrollWidth > expected.width ||
        window.location.href !== '${PACKAGED_APP_URL}' || document.querySelector('.stage-resource-warning') ||
        Array.from(document.images).some((image) => !image.complete ||
          image.naturalWidth <= 0 || image.naturalHeight <= 0)) return null
      return { controls: 2, height: expected.height, nameReady: true, resourcesReady: true,
        stageHeight: stageBounds.height, stageWidth: stageBounds.width, width: expected.width }
    }
    const cleanup = () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
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
        await Promise.all(Array.from(document.images, (image) => image.decode?.() ?? Promise.resolve()))
        await frame()
        await frame()
        const first = sample()
        await frame()
        const second = sample()
        if (first && second && JSON.stringify(first) === JSON.stringify(second)) finish(second)
      } catch {
        // Loading and layout failures remain non-ready until the outer deadline expires.
      } finally {
        checking = false
        if (rerun && !finished) {
          rerun = false
          queueMicrotask(check)
        }
      }
    }
    function schedule() { void check() }
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

function validRendererState(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.bridgeFrozen === true &&
    value.bridgeFunctions === true &&
    JSON.stringify(value.bridgeKeys) === JSON.stringify(STUDIO_BRIDGE_KEYS) &&
    value.devicePixelRatio === 1 &&
    value.height === VIEWPORT.height &&
    value.width === VIEWPORT.width &&
    value.href === PACKAGED_APP_URL &&
    value.ipcReady === true &&
    value.nodeAccess === false &&
    value.readyState === 'complete' &&
    Number.isSafeInteger(value.rootChildren) &&
    value.rootChildren > 0 &&
    value.stable === true,
  )
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
      JSON.stringify([
        'controls',
        'cueProgress',
        'height',
        'resourcesReady',
        'stageHeight',
        'stageWidth',
        'width',
      ]) &&
    value.controls === 4 &&
    value.cueProgress === 0.5 &&
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

function validStyleTemplateState(value, viewport, name = STYLE_TEMPLATE_NAME) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.controls === 5 &&
    value.height === viewport.height &&
    value.name === name &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    value.status === `Saved “${name}”.` &&
    value.width === viewport.width,
  )
}

function validStyleTemplateFormState(value, viewport) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.controls === 2 &&
    value.height === viewport.height &&
    value.nameReady === true &&
    value.resourcesReady === true &&
    Number.isFinite(value.stageHeight) &&
    value.stageHeight > 0 &&
    Number.isFinite(value.stageWidth) &&
    value.stageWidth > 0 &&
    value.width === viewport.width,
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
    throw readinessError()
  }
  let timer
  const pending = Promise.resolve().then(operation)
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(readinessError()), timeoutMs)
  })
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer))
}

function readinessError() {
  const error = new Error('VISUAL_SMOKE_READINESS_INVALID')
  error.code = 'VISUAL_SMOKE_READINESS_INVALID'
  return error
}

module.exports = {
  PACKAGED_APP_URL,
  STABLE_RENDERER_SCRIPT,
  STUDIO_BRIDGE_KEYS,
  STYLE_KEY_CHANGES,
  STYLE_KEY_FOCUS,
  STYLE_KEY_RECORDER_SCRIPT,
  STYLE_KEY_RESULT_SCRIPT,
  STYLE_KEY_SEQUENCE,
  STYLE_SESSION_READINESS_TIMEOUT_MS,
  STYLE_TEMPLATE_NAME,
  STYLE_TARGET_SCRIPT,
  executeBeforeDeadline,
  projectLyricsReadinessScript,
  styleSessionActionScript,
  styleTemplateFormReadinessScript,
  styleTemplateReadinessScript,
  validBackgroundState,
  validLeadVocalState,
  validProjectLyricsState,
  validRendererState,
  validStageFrameState,
  validStyleActionTarget,
  validStyleKeyboardState,
  validStyleTemplateFormState,
  validStyleTemplateState,
  validStyleTarget,
}
