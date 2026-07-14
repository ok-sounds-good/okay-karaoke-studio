'use strict'

/**
 * This function is serialized into the isolated video-rendering document.
 * Keep it self-contained: it cannot close over any Node.js values.
 */
function installKaraokeRuntime() {
  let aliases = new Map()
  const fontLoads = new Map()
  let assetGeneration = 0
  let nextFontAlias = 0
  let layoutKey = ''
  let wordNodes = []
  let lineTextNodes = new Map()
  let syncNodes = []

  const byId = (id) => document.getElementById(id)

  const node = (tag, className, text) => {
    const value = document.createElement(tag)
    if (className) value.className = className
    if (text !== undefined) value.textContent = text
    return value
  }

  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze)
      Object.freeze(value)
    }
    return value
  }

  const lineKey = (trackId, lineId) => JSON.stringify([trackId, lineId])

  const compareOrdinal = (left, right) => {
    if (left < right) return -1
    if (left > right) return 1
    return 0
  }

  const compareFontFaces = (left, right) => compareOrdinal(left.style, right.style) ||
    compareOrdinal(left.fullName, right.fullName) ||
    compareOrdinal(String(left.postscriptName), String(right.postscriptName))

  const forbiddenPostscriptCharacters = new Set('[](){}<>/%')

  const isValidPostScriptName = (value) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 63) return false
    for (const character of value) {
      const codePoint = character.codePointAt(0) || 0
      if (
        codePoint < 0x21 ||
        codePoint > 0x7e ||
        forbiddenPostscriptCharacters.has(character)
      ) return false
    }
    return true
  }

  const escapeCssString = (value) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

  const localFontSource = (postscriptName) => {
    if (!isValidPostScriptName(postscriptName)) throw new TypeError('Invalid PostScript name.')
    return `local("${escapeCssString(postscriptName)}")`
  }

  const fontFaceKey = (face) => JSON.stringify([
    face.postscriptName,
    face.fullName,
    face.style,
    face.weight,
    face.slant,
  ])

  const allocateFontAlias = () => {
    const alias = `OKSLocalFont${nextFontAlias.toString(36)}`
    nextFontAlias += 1
    return alias
  }

  const resolveFontFace = (typeface, requested) => {
    const exactPostscript = requested.postscriptName
      ? typeface.faces.find((face) => face.postscriptName === requested.postscriptName)
      : null
    if (exactPostscript) return exactPostscript
    const exactStyle = typeface.faces.filter((face) => (
      face.style.toLowerCase() === requested.style.toLowerCase() &&
      face.weight === requested.weight &&
      face.slant === requested.slant
    )).sort(compareFontFaces)[0]
    if (exactStyle) return exactStyle
    return [...typeface.faces].sort((left, right) => {
      const score = (face) => Math.abs(face.weight - requested.weight) +
        (face.slant === requested.slant ? 0 : 1_000)
      return score(left) - score(right) || compareFontFaces(left, right)
    })[0]
  }

  const fontFamily = (typeface, face) => {
    if (typeface.kind === 'system-monospace') {
      return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }
    if (typeface.kind === 'system-ui') {
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }
    if (aliases.has(face.postscriptName)) {
      return `"${aliases.get(face.postscriptName)}", system-ui, -apple-system, ` +
        'BlinkMacSystemFont, "Segoe UI", sans-serif'
    }
    return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  }

  const applyText = (element, style) => {
    const face = resolveFontFace(style.typeface, style.fontStyle)
    element.style.color = style.color
    element.style.fontFamily = fontFamily(style.typeface, face)
    element.style.fontSize = `${style.sizePx}px`
    element.style.fontWeight = String(face.weight)
    element.style.fontStyle = face.slant
    element.style.fontSynthesis = 'none'
  }

  const formatTime = (playbackMs) => {
    const absolute = Math.max(0, Math.round(playbackMs))
    const milliseconds = String(absolute % 1000).padStart(3, '0')
    const totalSeconds = Math.floor(absolute / 1000)
    const seconds = String(totalSeconds % 60).padStart(2, '0')
    const totalMinutes = Math.floor(totalSeconds / 60)
    if (totalMinutes < 60) return `${String(totalMinutes).padStart(2, '0')}:${seconds}.${milliseconds}`
    const minutes = String(totalMinutes % 60).padStart(2, '0')
    return `${Math.floor(totalMinutes / 60)}:${minutes}:${seconds}.${milliseconds}`
  }

  const loadLocalFont = (face) => {
    const cached = fontLoads.get(face.postscriptName)
    if (cached) return cached
    const alias = allocateFontAlias()
    const pending = (async () => {
      const loadedFace = new FontFace(alias, localFontSource(face.postscriptName), {
        weight: String(face.weight),
        style: face.slant,
        display: 'block',
      })
      const loaded = await loadedFace.load()
      document.fonts.add(loaded)
      return alias
    })()
    fontLoads.set(face.postscriptName, pending)
    void pending.catch(() => {
      if (fontLoads.get(face.postscriptName) === pending) {
        fontLoads.delete(face.postscriptName)
      }
    })
    return pending
  }

  const loadFont = async (style, preparedAliases) => {
    const face = resolveFontFace(style.typeface, style.fontStyle)
    if (style.typeface.kind !== 'local') return null
    if (!isValidPostScriptName(face.postscriptName)) {
      return { requested: face.fullName, effective: 'System UI' }
    }
    try {
      preparedAliases.set(face.postscriptName, await loadLocalFont(face))
      return null
    } catch {
      return {
        requested: face.fullName,
        effective: 'System UI',
      }
    }
  }

  window.prepareKaraokeAssets = async (runtime) => {
    const generation = ++assetGeneration
    const preparedAliases = new Map()
    const backgroundDataUrl = runtime.backgroundDataUrl || ''
    const stageLayout = deepFreeze(runtime.stageLayout)
    const syncAidGeometry = deepFreeze(runtime.syncAidGeometry)
    const backgroundLoad = backgroundDataUrl
      ? new Promise((resolve, reject) => {
          const image = new Image()
          image.onload = resolve
          image.onerror = reject
          image.src = backgroundDataUrl
        }).then(() => true)
      : Promise.resolve(false)
    const uniqueFonts = new Map()
    runtime.fonts.forEach((style) => {
      const face = resolveFontFace(style.typeface, style.fontStyle)
      if (style.typeface.kind !== 'local') return
      const key = isValidPostScriptName(face.postscriptName)
        ? JSON.stringify(['postscriptName', face.postscriptName])
        : fontFaceKey(face)
      if (!uniqueFonts.has(key)) uniqueFonts.set(key, style)
    })
    const [backgroundReady, ...loaded] = await Promise.all([
      backgroundLoad,
      ...[...uniqueFonts.values()].map((style) => loadFont(style, preparedAliases)),
    ])
    if (generation === assetGeneration) {
      aliases = preparedAliases
      layoutKey = ''
      window.backgroundDataUrl = backgroundDataUrl
      window.stageLayout = stageLayout
      window.syncAidGeometry = syncAidGeometry
      if (backgroundReady) byId('scene').dataset.backgroundReady = 'true'
      else delete byId('scene').dataset.backgroundReady
    }
    return { fontFallbacks: loaded.filter(Boolean) }
  }

  const applyBackground = (scene, background) => {
    if (background.mode === 'solid') {
      scene.style.background = background.solidColor
      return
    }
    if (background.mode === 'gradient') {
      scene.style.background = [
        'linear-gradient(145deg,',
        background.gradientStartColor,
        ',',
        background.gradientEndColor,
        ')',
      ].join('')
      return
    }
    scene.style.backgroundColor = background.gradientEndColor
    scene.style.backgroundImage = `url("${window.backgroundDataUrl}")`
    scene.style.backgroundPosition = 'center'
    scene.style.backgroundSize = 'cover'
  }

  const applyFrame = (state) => {
    const style = state.stageStyle.stageFrame
    const frame = byId('frame')
    frame.hidden = !style.enabled
    frame.style.borderColor = style.lineColor
    frame.style.borderWidth = `${style.lineWidthPx}px`

    const brand = byId('brand')
    brand.hidden = !style.enabled || !style.brand.visible
    applyText(brand, style.brand)

    const clock = byId('clock')
    clock.hidden = !style.enabled || !style.clock.visible
    clock.textContent = formatTime(state.playbackMs)
    applyText(clock, style.clock)

    const footer = byId('footer')
    footer.hidden = !style.enabled || !style.footer.visible
    footer.textContent = `${state.artist} · ${state.title}`
    applyText(footer, style.footer)
  }

  const appendTitleCard = (content, state) => {
    const card = node('div', 'title-card')
    const roles = state.stageStyle.titleCard
    if (roles.eyebrow.visible) {
      const eyebrow = node('div', 'title-eyebrow', "Tonight's performance")
      applyText(eyebrow, roles.eyebrow)
      card.append(eyebrow)
    }
    if (roles.title.visible) {
      const title = node('h1', 'title-main', state.title)
      applyText(title, roles.title)
      card.append(title)
    }
    if (roles.artist.visible) {
      const artist = node('p', 'title-artist', state.artist)
      applyText(artist, roles.artist)
      card.append(artist)
    }
    content.append(card)
  }

  const appendLyrics = (content, lines) => {
    const group = node('div', 'lines')
    const actualLineCount = Math.max(1, Math.min(5, lines.length))
    group.style.gap = `${window.stageLayout.lyric.gapsPx[actualLineCount]}px`
    for (const item of lines) {
      const lyric = node('div', `lyric ${item.style.alignment}`)
      const text = node('span', 'lyric-text')
      applyText(lyric, { ...item.style, color: item.style.unsungColor })
      lyric.style.setProperty('--sung', item.style.sungColor)
      lyric.style.setProperty('--unsung', item.style.unsungColor)
      item.words.forEach((word, index) => {
        const wrapper = node('span', 'word')
        const fill = node('span', 'word-fill', word.text)
        wrapper.append(node('span', 'word-base', word.text), fill)
        text.append(wrapper)
        wordNodes.push(fill)
        if (index < item.words.length - 1) text.append(document.createTextNode(' '))
      })
      lyric.append(text)
      lineTextNodes.set(lineKey(item.trackId, item.id), text)
      group.append(lyric)
    }
    content.append(group)
  }

  const syncBrightness = (progress) => {
    const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
    if (normalized < 1 / 3) return 0.35
    if (normalized < 2 / 3) return 0.65
    return 1
  }

  const positionSyncAid = (entry, progress) => {
    const geometry = window.syncAidGeometry
    if (!geometry || !window.stageLayout) throw new Error('Karaoke assets are not prepared.')
    const sceneRect = byId('scene').getBoundingClientRect()
    const textRect = lineTextNodes.get(entry.lineKey)?.getBoundingClientRect()
    if (!textRect || sceneRect.width <= 0) return
    const stageWidth = window.stageLayout.stage.widthPx
    const leadingEdgePx = (textRect.left - sceneRect.left) * stageWidth / sceneRect.width
    const endLeftPx = leadingEdgePx - geometry.gapPx - geometry.cueWidthPx
    const startLeftPx = Math.min(
      -geometry.cueWidthPx - geometry.gapPx,
      endLeftPx - geometry.minimumTravelPx,
    )
    const travelPx = endLeftPx - startLeftPx
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
    entry.indicator.style.width = `${geometry.cueWidthPx}px`
    entry.indicator.style.left = `${reduced ? endLeftPx : startLeftPx}px`
    entry.indicator.style.opacity = String(reduced ? syncBrightness(normalized) : 1)
    entry.indicator.style.transform = reduced
      ? 'none'
      : `translateX(${normalized * travelPx}px)`
  }

  const appendSyncAids = (syncLayer, syncAids) => {
    for (const aid of syncAids) {
      const cue = node('div', 'sync')
      cue.style.setProperty('--sync-color', aid.style.sungColor)
      const indicator = node('i')
      cue.append(indicator)
      syncLayer.append(cue)
      const entry = {
        cue,
        indicator,
        lineKey: lineKey(aid.trackId, aid.lineId),
      }
      syncNodes.push(entry)
      positionSyncAid(entry, aid.progress)
    }
  }

  const nextLayoutKey = (state) => state.showTitle
    ? `title:${state.title}|${state.artist}|${JSON.stringify(state.stageStyle.titleCard)}`
    : `lines:${JSON.stringify(state.lines.map((line) => [
        line.id,
        line.trackId,
        line.text,
        line.style,
        line.words.map((word) => word.text),
      ]))}|sync:${JSON.stringify(state.syncAids.map((aid) => [
        aid.trackId,
        aid.lineId,
        aid.style,
      ]))}`

  const rebuildLayout = (state) => {
    const content = byId('content')
    const syncLayer = byId('syncs')
    wordNodes = []
    lineTextNodes = new Map()
    syncNodes = []
    content.replaceChildren()
    syncLayer.replaceChildren()
    if (state.showTitle) appendTitleCard(content, state)
    else if (state.lines.length) appendLyrics(content, state.lines)
    appendSyncAids(syncLayer, state.syncAids)
  }

  const updateFrameProgress = (state) => {
    let index = 0
    for (const line of state.lines) {
      for (const word of line.words) {
        const progress = Number.isFinite(word.progress)
          ? Math.max(0, Math.min(1, word.progress))
          : 0
        wordNodes[index]?.style.setProperty('width', `${(progress * 100).toFixed(3)}%`)
        index += 1
      }
    }
    state.syncAids.forEach((aid, cueIndex) => {
      const entry = syncNodes[cueIndex]
      if (entry) positionSyncAid(entry, aid.progress)
    })
  }

  window.renderKaraokeFrame = (state, sequence) => {
    document.body.dataset.frame = String(sequence)
    applyBackground(byId('scene'), state.stageStyle.background)
    applyFrame(state)
    const key = nextLayoutKey(state)
    if (key !== layoutKey) {
      layoutKey = key
      rebuildLayout(state)
    }
    updateFrameProgress(state)
    return true
  }
}

module.exports = { installKaraokeRuntime }
