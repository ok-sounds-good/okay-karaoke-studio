'use strict'

const { installKaraokeRuntime } = require('./video-style-render-runtime.cjs')

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const STAGE_LAYOUT = deepFreeze(require('./stage-layout.json'))
const SYNC_AID_GEOMETRY = deepFreeze(require('./sync-aid-geometry.json'))

const DOCUMENT_STYLES = `
* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

.scene {
  position: absolute;
  width: ${STAGE_LAYOUT.stage.widthPx}px;
  height: ${STAGE_LAYOUT.stage.heightPx}px;
  overflow: hidden;
  transform-origin: 0 0;
  background: transparent;
}

.grain {
  position: absolute;
  inset: 0;
  color: ${STAGE_LAYOUT.grain.color};
  opacity: ${STAGE_LAYOUT.grain.opacity};
  background-image:
    linear-gradient(
      currentColor ${STAGE_LAYOUT.grain.gridLinePx}px,
      transparent ${STAGE_LAYOUT.grain.gridLinePx}px
    ),
    linear-gradient(
      90deg,
      currentColor ${STAGE_LAYOUT.grain.gridLinePx}px,
      transparent ${STAGE_LAYOUT.grain.gridLinePx}px
    );
  background-size: ${STAGE_LAYOUT.grain.gridSizePx}px ${STAGE_LAYOUT.grain.gridSizePx}px;
  pointer-events: none;
}

.frame {
  position: absolute;
  inset:
    ${STAGE_LAYOUT.frame.topPx}px
    ${STAGE_LAYOUT.frame.rightPx}px
    ${STAGE_LAYOUT.frame.bottomPx}px
    ${STAGE_LAYOUT.frame.leftPx}px;
  border-style: solid;
  border-radius: ${STAGE_LAYOUT.frame.radiusPx}px;
  pointer-events: none;
}

.brand,
.clock,
.footer {
  position: absolute;
  z-index: 3;
}

.brand {
  top: ${STAGE_LAYOUT.brand.topPx}px;
  left: ${STAGE_LAYOUT.brand.leftPx}px;
  letter-spacing: ${STAGE_LAYOUT.brand.letterSpacingEm}em;
}

.clock {
  top: ${STAGE_LAYOUT.clock.topPx}px;
  right: ${STAGE_LAYOUT.clock.rightPx}px;
  letter-spacing: ${STAGE_LAYOUT.clock.letterSpacingEm}em;
}

.footer {
  right: ${STAGE_LAYOUT.footer.rightPx}px;
  bottom: ${STAGE_LAYOUT.footer.bottomPx}px;
  left: ${STAGE_LAYOUT.footer.leftPx}px;
  letter-spacing: ${STAGE_LAYOUT.footer.letterSpacingEm}em;
  text-transform: uppercase;
}

.content {
  position: absolute;
  inset:
    ${STAGE_LAYOUT.content.topPx}px
    ${STAGE_LAYOUT.content.rightPx}px
    ${STAGE_LAYOUT.content.bottomPx}px
    ${STAGE_LAYOUT.content.leftPx}px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.title-card {
  text-align: center;
}

.title-eyebrow {
  letter-spacing: ${STAGE_LAYOUT.title.eyebrowLetterSpacingEm}em;
  text-transform: uppercase;
}

.title-main {
  max-width: ${STAGE_LAYOUT.title.maxWidthPx}px;
  margin:
    ${STAGE_LAYOUT.title.marginTopPx}px
    ${STAGE_LAYOUT.title.marginRightPx}px
    ${STAGE_LAYOUT.title.marginBottomPx}px
    ${STAGE_LAYOUT.title.marginLeftPx}px;
  line-height: ${STAGE_LAYOUT.title.lineHeight};
  letter-spacing: ${STAGE_LAYOUT.title.letterSpacingEm}em;
  text-shadow: ${STAGE_LAYOUT.title.shadow};
}

.title-artist {
  margin: 0;
}

.lines {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: ${STAGE_LAYOUT.lyric.gapsPx[1]}px;
}

.lyric {
  width: 100%;
  height: ${STAGE_LAYOUT.lyric.lineBoxEm}em;
  line-height: ${STAGE_LAYOUT.lyric.lineHeight};
  letter-spacing: ${STAGE_LAYOUT.lyric.letterSpacingEm}em;
  white-space: nowrap;
}

.lyric.left { text-align: left; }
.lyric.center { text-align: center; }
.lyric.right { text-align: right; }

.lyric-text {
  display: inline-block;
}

.word {
  position: relative;
  display: inline-block;
  color: var(--unsung);
  filter: ${STAGE_LAYOUT.lyric.shadow};
}

.word-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  overflow: hidden;
  color: var(--sung);
  white-space: nowrap;
}

.sync-layer,
.sync {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.sync i {
  position: absolute;
  top: ${STAGE_LAYOUT.sync.topPercent}%;
  left: -${SYNC_AID_GEOMETRY.cueWidthPx}px;
  width: ${SYNC_AID_GEOMETRY.cueWidthPx}px;
  height: ${STAGE_LAYOUT.sync.heightPx}px;
  border-radius: 999px;
  background: var(--sync-color);
  box-shadow: ${STAGE_LAYOUT.sync.shadow};
}

@media (prefers-reduced-motion: reduce) {
  .sync i {
    transform: none !important;
  }
}
`

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record.`)
  }
  return value
}

function positiveDimension(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`)
  }
  return value
}

function renderDocument(options) {
  const { width, height } = record(options, 'Render options')
  positiveDimension(width, 'Render width')
  positiveDimension(height, 'Render height')
  const scaleX = width / STAGE_LAYOUT.stage.widthPx
  const scaleY = height / STAGE_LAYOUT.stage.heightPx
  const runtimeSource = `(${installKaraokeRuntime.toString()})()`.replace(
    /<\/script/giu,
    '<\\/script',
  )
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>${DOCUMENT_STYLES}</style>
  </head>
  <body>
    <div id="scene" class="scene" style="transform: scale(${scaleX}, ${scaleY})">
      <div class="grain"></div>
      <div id="frame" class="frame"></div>
      <div id="brand" class="brand">OKAY / STUDIO</div>
      <div id="clock" class="clock"></div>
      <main id="content" class="content"></main>
      <div id="syncs" class="sync-layer"></div>
      <footer id="footer" class="footer"></footer>
    </div>
    <script>${runtimeSource}</script>
  </body>
</html>`
}

function encodeJavaScriptValue(value, label) {
  record(value, label)
  let encoded
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new TypeError(`${label} must be JSON-serializable.`)
  }
  if (typeof encoded !== 'string') {
    throw new TypeError(`${label} must be JSON-serializable.`)
  }
  return Buffer.from(encoded, 'utf8').toString('base64')
}

function decodedValueExpression(payload) {
  return [
    'JSON.parse(new TextDecoder().decode(',
    `Uint8Array.from(atob("${payload}"),character=>character.charCodeAt(0))`,
    '))',
  ].join('')
}

function frameInvocation(state, sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError('Frame sequence must be a nonnegative safe integer.')
  }
  const payload = encodeJavaScriptValue(state, 'Frame state')
  const render = `window.renderKaraokeFrame(${decodedValueExpression(payload)},${sequence})`
  return (
    `(async()=>{const result=${render};await new Promise(resolve=>requestAnimationFrame(` +
    `()=>requestAnimationFrame(resolve)));return result})()`
  )
}

function assetInvocation(runtime) {
  const payload = encodeJavaScriptValue(runtime, 'Asset runtime')
  return `window.prepareKaraokeAssets(${decodedValueExpression(payload)})`
}

module.exports = { assetInvocation, frameInvocation, renderDocument }
