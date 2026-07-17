// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KaraokePreview, type KaraokePreviewDesignMode } from '../src/components/KaraokePreview'
import { titleCardDesignPreviewFonts } from '../src/hooks/usePreviewFonts'
import { createProject } from '../src/lib/model'
import { previewFrameStateAt } from '../src/lib/stage-frame-state'
import { logicalStagePx } from '../src/lib/stage-layout'
import {
  SYSTEM_MONOSPACE_TYPEFACE,
  cloneStageStyle,
  cloneVocalStyle,
  fontFaceKey,
  fontTypefaceKey,
  genericFontFace,
  type FontFaceDescriptor,
  type FontSizeStyle,
  type FontTypefaceDescriptor,
  type LyricTextStyle,
} from '../src/lib/video-style'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function localLyricStyle(
  family: string,
  postscriptName: string,
  style = 'Regular',
  weight = 400,
): LyricTextStyle {
  const face: FontFaceDescriptor = {
    fullName: `${family} ${style}`,
    style,
    postscriptName,
    weight,
    slant: 'normal',
  }
  const typeface: FontTypefaceDescriptor = { kind: 'local', family, faces: [face] }
  return {
    typeface,
    fontStyle: face,
    sizePx: 82,
    sungColor: '#FF8A2B',
    unsungColor: '#72687D',
  }
}

function applyFont(target: FontSizeStyle, source: FontSizeStyle) {
  target.typeface = source.typeface
  target.fontStyle = source.fontStyle
}

function previewMarkup(
  designMode: KaraokePreviewDesignMode,
  project = createProject(),
  playbackMs = 0,
  onEditLyrics?: () => void,
) {
  return renderToStaticMarkup(
    <KaraokePreview
      project={project}
      playbackMs={playbackMs}
      lyricMs={playbackMs}
      selectedWordIds={new Set()}
      designMode={designMode}
      onEditLyrics={onEditLyrics}
    />,
  )
}

function projectLyricsDesignMode(
  style: LyricTextStyle,
  project = createProject(),
): KaraokePreviewDesignMode {
  const stageStyle = cloneStageStyle(project.stageStyle)
  stageStyle.lyrics = style
  return { target: 'project-lyrics', stageStyle }
}

describe('Karaoke Preview project-lyrics design mode', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('renders the complete draft Style with one representative lyric line and mixed progress', () => {
    const project = createProject({ title: 'Project title', artist: 'Project artist' })
    const style: LyricTextStyle = {
      typeface: SYSTEM_MONOSPACE_TYPEFACE,
      fontStyle: genericFontFace(SYSTEM_MONOSPACE_TYPEFACE, 'Bold'),
      sizePx: 104,
      sungColor: '#ABCDEF',
      unsungColor: '#234567',
    }
    const designMode = projectLyricsDesignMode(style, project)
    designMode.stageStyle.background.mode = 'solid'
    designMode.stageStyle.background.solidColor = '#123456'
    designMode.stageStyle.stageFrame.lineColor = '#345678'
    const markup = previewMarkup(designMode, project, 0, vi.fn())
    const rendered = document.createElement('div')
    rendered.innerHTML = markup
    const panel = rendered.querySelector<HTMLElement>(
      '[aria-label="Project lyrics design preview"]',
    )
    const stage = panel?.querySelector<HTMLElement>('.karaoke-stage')
    const design = stage?.querySelector<HTMLElement>('[data-design-preview="project-lyrics"]')
    const line = design?.querySelector<HTMLElement>('.stage-line')
    const words = [...(design?.querySelectorAll<HTMLElement>('.stage-word') ?? [])]

    expect(stage?.dataset.logicalStage).toBe('1920x1080')
    expect(stage?.classList.contains('is-designing')).toBe(true)
    expect(stage?.style.background).toBe('#123456')
    expect(stage?.style.getPropertyValue('--stage-frame-color')).toBe('#345678')
    expect(stage?.querySelector('.karaoke-stage__safe-area')).not.toBeNull()
    expect(stage?.textContent).toContain('OKAY / STUDIO')
    expect(stage?.textContent).toContain('Project artist · Project title')
    expect(design?.textContent).toBe('Sing the first words and see the rest')
    expect(design?.textContent).not.toContain(`This is ${style.typeface.family}`)
    expect(line?.style.fontFamily).toContain('ui-monospace')
    expect(line?.style.fontWeight).toBe('700')
    expect(line?.getAttribute('style')).toContain(`font-size:${logicalStagePx(104)}`)
    expect(line?.style.getPropertyValue('--track-color')).toBe('#ABCDEF')
    expect(line?.style.getPropertyValue('--unsung-color')).toBe('#234567')
    expect(words.map((word) => word.style.getPropertyValue('--word-progress'))).toEqual([
      '100%',
      '50%',
      '0%',
      '0%',
      '0%',
      '0%',
      '0%',
      '0%',
    ])
    expect(panel?.querySelector('[aria-label="Visible lyric lines"]')).toBeNull()
    expect(panel?.querySelector('[aria-label="Lyric line advance mode"]')).toBeNull()
    expect(panel?.textContent).not.toContain('Edit text')
    expect(panel?.querySelector('.title-card')).toBeNull()

    const vocalStyle = cloneVocalStyle()
    Object.assign(vocalStyle, {
      typeface: SYSTEM_MONOSPACE_TYPEFACE,
      fontStyle: genericFontFace(SYSTEM_MONOSPACE_TYPEFACE, 'Bold'),
      sizePx: 96,
      sungColor: '#102030',
      unsungColor: '#405060',
      alignment: 'right',
      previewMs: 8_000,
      syncAid: { enabled: true, minLeadMs: 2_000, maxLeadMs: 6_000 },
    })
    rendered.innerHTML = previewMarkup({
      target: 'lead-vocal',
      stageStyle: designMode.stageStyle,
      vocalStyle,
    })
    const vocalPanel = rendered.querySelector<HTMLElement>(
      '[aria-label="Lead Vocal design preview"]',
    )!
    const vocalLine = vocalPanel.querySelector<HTMLElement>(
      '[data-design-preview="lead-vocal"] .stage-line',
    )!
    expect(vocalLine.classList.contains('stage-line--right')).toBe(true)
    expect(vocalLine.dataset.stageFontSize).toBe('96')
    expect(vocalLine.style.getPropertyValue('--track-color')).toBe('#102030')
    expect(vocalLine.style.getPropertyValue('--unsung-color')).toBe('#405060')
    expect(vocalPanel.querySelectorAll('.stage-line')).toHaveLength(1)
    expect(vocalPanel.querySelector('.sync-aid')).toBeNull()
    expect(vocalPanel.textContent).not.toContain('This is')
  })

  it('renders canonical content through the complete Background draft with exact CSS evidence', () => {
    const project = createProject({ title: 'Canonical title', artist: 'Canonical artist' })
    const snapshot = structuredClone(project)
    const gradient = cloneStageStyle(project.stageStyle)
    Object.assign(gradient.background, {
      mode: 'gradient',
      solidColor: '#654321',
      gradientStartColor: '#123456',
      gradientEndColor: '#abcdef',
      imagePath: '/linked/preserved.png',
    })
    gradient.titleCard.title.color = '#fedcba'
    const rendered = document.createElement('div')
    rendered.innerHTML = previewMarkup({ target: 'background', stageStyle: gradient }, project)
    const panel = rendered.querySelector<HTMLElement>('[aria-label="Background design preview"]')!
    const stage = panel.querySelector<HTMLElement>('.karaoke-stage')!

    expect(stage.dataset.logicalStage).toBe('1920x1080')
    expect(stage.classList.contains('is-designing')).toBe(true)
    expect(stage.dataset.backgroundMode).toBe('gradient')
    expect(stage.dataset.backgroundSolidColor).toBe('#654321')
    expect(stage.dataset.backgroundGradientStartColor).toBe('#123456')
    expect(stage.dataset.backgroundGradientEndColor).toBe('#abcdef')
    expect(stage.style.background).toBe('linear-gradient(145deg, #123456, #abcdef)')
    expect(stage.querySelector('.title-card h3')?.textContent).toBe('Canonical title')
    expect(stage.querySelector<HTMLElement>('.title-card h3')?.style.color).toBe('#fedcba')
    expect(panel.querySelector('[aria-label="Visible lyric lines"]')).toBeNull()

    const solid = cloneStageStyle(gradient)
    solid.background.mode = 'solid'
    rendered.innerHTML = previewMarkup({ target: 'background', stageStyle: solid }, project)
    const solidStage = rendered.querySelector<HTMLElement>('.karaoke-stage')!
    expect(solidStage.dataset.backgroundMode).toBe('solid')
    expect(solidStage.style.background).toBe('#654321')
    expect(project).toEqual(snapshot)
  })

  it('renders a selected hidden Title card role truthfully outside the timeline handoff', () => {
    const project = createProject({ title: 'Semantic title', artist: 'Semantic artist' })
    const track = project.tracks[0]!
    track.vocalStyle.syncAid = { enabled: true, minLeadMs: 2_000, maxLeadMs: 3_000 }
    track.lines = [
      {
        id: 'title-design-line',
        text: 'Timeline content',
        startMs: 3_000,
        endMs: 5_000,
        words: [{ id: 'title-design-word', text: 'Timeline', startMs: 3_000, endMs: 5_000 }],
      },
    ]
    const snapshot = structuredClone(project)
    const stageStyle = cloneStageStyle(project.stageStyle)
    Object.assign(stageStyle.titleCard.eyebrow, {
      visible: false,
      color: '#123456',
      sizePx: 56,
    })
    stageStyle.titleCard.artist.visible = false
    const frame = previewFrameStateAt(project, 1_000)
    expect(frame.showTitle).toBe(false)
    expect(frame.lines).toHaveLength(1)
    expect(frame.syncAids).toHaveLength(1)

    const rendered = document.createElement('div')
    rendered.innerHTML = previewMarkup(
      { target: 'title-card', role: 'eyebrow', stageStyle },
      project,
      1_000,
    )
    const panel = rendered.querySelector<HTMLElement>('[aria-label="Title card design preview"]')!
    const stage = panel.querySelector<HTMLElement>('.karaoke-stage')!
    const card = stage.querySelector<HTMLElement>('[data-design-preview="title-card"]')!
    const eyebrow = card.querySelector<HTMLElement>('[data-title-card-role="eyebrow"]')!
    const status = card.querySelector<HTMLElement>('[role="status"]')!

    expect(stage.classList.contains('is-designing-title-card')).toBe(true)
    expect(eyebrow.dataset.hiddenOutput).toBe('true')
    expect(eyebrow.textContent).toBe("Tonight's performance")
    expect(eyebrow.style.color).toBe('#123456')
    expect(eyebrow.getAttribute('style')).toContain(`font-size:${logicalStagePx(56)}`)
    expect(card.querySelector('[data-title-card-role="title"]')?.textContent).toBe('Semantic title')
    expect(card.querySelector('[data-title-card-role="artist"]')).toBeNull()
    expect(status.textContent).toBe('Hidden in output')
    expect(eyebrow.contains(status)).toBe(false)
    expect(stage.querySelector('.active-lines')).toBeNull()
    expect(stage.querySelector('.sync-aid')).toBeNull()
    expect(project).toEqual(snapshot)
  })

  it('renders the three Stage frame design states without leaking them into ordinary Preview', () => {
    const project = createProject({ title: 'Semantic title', artist: 'Semantic artist' })
    const renderStageFrame = (stageStyle = cloneStageStyle(project.stageStyle), role = 'brand') => {
      const rendered = document.createElement('div')
      rendered.innerHTML = previewMarkup(
        { target: 'stage-frame', role: role as 'brand' | 'clock' | 'footer', stageStyle },
        project,
        1_250,
      )
      return rendered
    }

    const visible = renderStageFrame()
    const visiblePanel = visible.querySelector<HTMLElement>(
      '[aria-label="Stage frame design preview"]',
    )!
    const visibleStage = visiblePanel.querySelector<HTMLElement>('.karaoke-stage')!
    expect(visibleStage.classList.contains('is-designing-stage-frame')).toBe(true)
    expect(visibleStage.querySelector('[data-stage-frame-line]')).not.toBeNull()
    const brand = visibleStage.querySelector<HTMLElement>('[data-stage-frame-design-role="brand"]')!
    const clock = visibleStage.querySelector<HTMLElement>('[data-stage-frame-role="clock"]')!
    const footer = visibleStage.querySelector<HTMLElement>('[data-stage-frame-role="footer"]')!
    expect(brand.textContent).toBe('OKAY / STUDIO')
    expect(brand.classList.contains('karaoke-stage__brand')).toBe(true)
    expect(clock.textContent).toBe('00:01.250')
    expect(clock.classList.contains('karaoke-stage__time')).toBe(true)
    expect(footer.textContent).toBe('Semantic artist · Semantic title')
    expect(footer.closest('.karaoke-stage__footer')).not.toBeNull()
    expect(visiblePanel.querySelector('[data-stage-frame-output-status]')).toBeNull()
    expect(visibleStage.querySelector('.stage-frame-design-context')).toBeNull()

    const hiddenDraft = cloneStageStyle(project.stageStyle)
    hiddenDraft.stageFrame.clock.visible = false
    hiddenDraft.stageFrame.footer.visible = false
    const hidden = renderStageFrame(hiddenDraft, 'clock')
    const hiddenPanel = hidden.querySelector<HTMLElement>(
      '[aria-label="Stage frame design preview"]',
    )!
    const hiddenStage = hiddenPanel.querySelector<HTMLElement>('.karaoke-stage')!
    const hiddenClock = hiddenStage.querySelector<HTMLElement>(
      '[data-stage-frame-design-role="clock"]',
    )!
    expect(hiddenClock.dataset.designOnly).toBe('true')
    expect(hiddenStage.querySelector('[data-stage-frame-role="footer"]')).toBeNull()
    expect(hiddenStage.querySelector('[data-stage-frame-line]')).not.toBeNull()
    expect(hiddenPanel.querySelectorAll('[data-stage-frame-output-status]')).toHaveLength(1)
    expect(
      hiddenPanel.querySelector('[data-stage-frame-output-status]')?.getAttribute('aria-label'),
    ).toBe('Clock hidden in output')
    expect(hiddenPanel.querySelector('[data-stage-frame-output-status]')?.textContent).toBe(
      'Hidden in output',
    )

    const offDraft = cloneStageStyle(hiddenDraft)
    offDraft.stageFrame.enabled = false
    offDraft.stageFrame.brand.visible = false
    offDraft.stageFrame.clock.visible = true
    const off = renderStageFrame(offDraft)
    const offPanel = off.querySelector<HTMLElement>('[aria-label="Stage frame design preview"]')!
    const offStage = offPanel.querySelector<HTMLElement>('.karaoke-stage')!
    expect(offStage.querySelector('[data-stage-frame-design-role="brand"]')).not.toBeNull()
    expect(
      offStage
        .querySelector('[data-stage-frame-design-role="brand"]')
        ?.classList.contains('stage-frame-design-context'),
    ).toBe(false)
    expect(
      offStage
        .querySelector('[data-stage-frame-role="clock"]')
        ?.classList.contains('stage-frame-design-context'),
    ).toBe(true)
    expect(
      offStage
        .querySelector('[data-stage-frame-line]')
        ?.classList.contains('stage-frame-design-context'),
    ).toBe(true)
    expect(offStage.querySelector('[data-stage-frame-role="footer"]')).toBeNull()
    expect(offPanel.querySelectorAll('[data-stage-frame-output-status]')).toHaveLength(1)
    expect(offPanel.querySelector('[data-stage-frame-output-status]')?.textContent).toBe(
      'Stage frame off in output',
    )

    offDraft.stageFrame.lineWidthPx = 0
    expect(renderStageFrame(offDraft).querySelector('[data-stage-frame-line]')).toBeNull()

    project.stageStyle = offDraft
    const ordinary = document.createElement('div')
    ordinary.innerHTML = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={1_250}
        lyricMs={1_250}
        selectedWordIds={new Set()}
      />,
    )
    expect(ordinary.querySelector('[data-stage-frame-line]')).toBeNull()
    expect(ordinary.querySelector('[data-stage-frame-role]')).toBeNull()
    expect(ordinary.querySelector('[data-stage-frame-output-status]')).toBeNull()
    expect(ordinary.querySelector('.is-designing-stage-frame')).toBeNull()
  })

  it('selects hidden target and visible Title card and Stage frame fonts for design loading', () => {
    const project = createProject()
    const draft = cloneStageStyle(project.stageStyle)
    const selected = localLyricStyle('Selected Hidden', 'SelectedHidden-Regular')
    const title = localLyricStyle('Visible Title', 'VisibleTitle-Regular')
    const artist = localLyricStyle('Hidden Artist', 'HiddenArtist-Regular')
    const brand = localLyricStyle('Visible Brand', 'VisibleBrand-Regular')
    const clock = localLyricStyle('Hidden Clock', 'HiddenClock-Regular')
    const footer = localLyricStyle('Visible Footer', 'VisibleFooter-Regular')
    applyFont(draft.titleCard.eyebrow, selected)
    applyFont(draft.titleCard.title, title)
    applyFont(draft.titleCard.artist, artist)
    applyFont(draft.stageFrame.brand, brand)
    applyFont(draft.stageFrame.clock, clock)
    applyFont(draft.stageFrame.footer, footer)
    draft.titleCard.eyebrow.visible = false
    draft.titleCard.artist.visible = false
    draft.stageFrame.clock.visible = false

    expect(
      titleCardDesignPreviewFonts(draft, 'eyebrow')
        .map(({ typeface }) => typeface.family)
        .sort(),
    ).toEqual(['Selected Hidden', 'Visible Brand', 'Visible Footer', 'Visible Title'].sort())
  })

  it('hides sync aids even when the ordinary frame planner produces one', () => {
    const project = createProject()
    const track = project.tracks[0]!
    track.vocalStyle.syncAid = { enabled: true, minLeadMs: 2_000, maxLeadMs: 3_000 }
    track.lines = [
      {
        id: 'design-hidden-sync-line',
        text: 'Timed words',
        startMs: 3_000,
        endMs: 5_000,
        words: [
          { id: 'design-hidden-sync-word-1', text: 'Timed', startMs: 3_000, endMs: 4_000 },
          { id: 'design-hidden-sync-word-2', text: 'words', startMs: 4_000, endMs: 5_000 },
        ],
      },
    ]
    expect(previewFrameStateAt(project, 1_000).syncAids).toHaveLength(1)

    const markup = previewMarkup(
      { target: 'project-lyrics', stageStyle: project.stageStyle },
      project,
      1_000,
    )
    expect(markup).not.toContain('class="sync-aid"')
  })

  it('preserves ordinary preloading for project, title, frame, and vocal timeline roles', async () => {
    const sources: string[] = []
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(_family: string, source: string) {
          sources.push(source)
        }

        async load() {
          return this
        }
      },
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    const project = createProject()
    const lyrics = localLyricStyle('Ordinary Lyrics', 'OrdinaryLyrics-Regular')
    const title = localLyricStyle('Future Title', 'FutureTitle-Regular')
    const frame = localLyricStyle('Future Frame', 'FutureFrame-Regular')
    const vocal = localLyricStyle('Future Vocal', 'FutureVocal-Regular')
    project.stageStyle.lyrics = lyrics
    applyFont(project.stageStyle.titleCard.title, title)
    project.stageStyle.titleCard.title.visible = false
    applyFont(project.stageStyle.stageFrame.brand, frame)
    project.stageStyle.stageFrame.enabled = false
    project.tracks[0]!.vocalStyle.typeface = vocal.typeface
    project.tracks[0]!.vocalStyle.fontStyle = vocal.fontStyle
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <KaraokePreview project={project} playbackMs={0} lyricMs={0} selectedWordIds={new Set()} />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sources).toEqual([
      'local("OrdinaryLyrics-Regular")',
      'local("FutureTitle-Regular")',
      'local("FutureFrame-Regular")',
      'local("FutureVocal-Regular")',
    ])
    expect(container.querySelector('[data-design-preview]')).toBeNull()
    expect(container.querySelector('[aria-label="Visible lyric lines"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('loads only rendered design roles and uses the effective draft face on failure', async () => {
    const sources: string[] = []
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          _family: string,
          private source: string,
        ) {
          sources.push(source)
        }

        async load() {
          if (this.source.includes('MissingDesign')) throw new Error('font unavailable')
          if (this.source.includes('Stale')) throw new Error('stale font must not be loaded')
          return this
        }
      },
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    const project = createProject()
    const staleLyrics = localLyricStyle('Stale Lyrics', 'StaleLyrics-Regular')
    const staleVocal = localLyricStyle('Stale Vocal', 'StaleVocal-Regular')
    const staleTitle = localLyricStyle('Stale Title', 'StaleTitle-Regular')
    const renderedBrand = localLyricStyle('Rendered Brand', 'RenderedBrand-Regular')
    project.stageStyle.lyrics = staleLyrics
    applyFont(project.stageStyle.titleCard.title, staleTitle)
    applyFont(project.stageStyle.stageFrame.brand, renderedBrand)
    project.tracks[0]!.vocalStyle.typeface = staleVocal.typeface
    project.tracks[0]!.vocalStyle.fontStyle = staleVocal.fontStyle
    const available = localLyricStyle('Available Design', 'AvailableDesign-Regular')
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        <KaraokePreview
          project={project}
          playbackMs={0}
          lyricMs={0}
          selectedWordIds={new Set()}
          designMode={projectLyricsDesignMode(available, project)}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(sources).toEqual(['local("RenderedBrand-Regular")', 'local("AvailableDesign-Regular")'])
    expect(
      container.querySelector<HTMLElement>('[data-design-preview] .stage-line')?.style.fontFamily,
    ).toContain('OKSLocalFont')

    const requested = localLyricStyle('Old Request', 'OldRequest-Regular')
    const missing = localLyricStyle('Missing Design', 'MissingDesign-Bold', 'Bold', 700)
    missing.fontStyle = requested.fontStyle
    const typefaceBefore = fontTypefaceKey(missing.typeface)
    const faceBefore = fontFaceKey(missing.fontStyle)
    await act(async () => {
      root.render(
        <KaraokePreview
          project={project}
          playbackMs={0}
          lyricMs={0}
          selectedWordIds={new Set()}
          designMode={projectLyricsDesignMode(missing, project)}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sources).toEqual([
      'local("RenderedBrand-Regular")',
      'local("AvailableDesign-Regular")',
      'local("MissingDesign-Bold")',
    ])
    expect(sources.every((source) => !source.includes('Stale'))).toBe(true)
    expect(container.querySelector('.stage-resource-warning')?.textContent).toContain(
      'Requested font Missing Design Bold is unavailable',
    )
    const failedLine = container.querySelector<HTMLElement>('[data-design-preview] .stage-line')!
    expect(failedLine.style.fontFamily).toContain('system-ui')
    expect(failedLine.style.fontWeight).toBe('700')
    expect(fontTypefaceKey(missing.typeface)).toBe(typefaceBefore)
    expect(fontFaceKey(missing.fontStyle)).toBe(faceBefore)
    await act(async () => root.unmount())
  })

  it('resolves and retries a selected hidden Stage frame font while its master is off', async () => {
    const attempts = new Map<string, number>()
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          public family: string,
          private source: string,
        ) {
          attempts.set(source, (attempts.get(source) ?? 0) + 1)
        }

        async load() {
          if (attempts.get(this.source) === 1) throw new Error('first load fails')
          return this
        }
      },
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    const project = createProject()
    const draft = cloneStageStyle(project.stageStyle)
    const hiddenClock = localLyricStyle('Hidden Frame Clock', 'HiddenFrameClock-Regular')
    applyFont(draft.stageFrame.clock, hiddenClock)
    draft.stageFrame.enabled = false
    draft.stageFrame.clock.visible = false
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <KaraokePreview
          project={project}
          playbackMs={0}
          lyricMs={0}
          selectedWordIds={new Set()}
          designMode={{ target: 'stage-frame', role: 'clock', stageStyle: draft }}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('.stage-resource-warning')?.textContent).toContain(
      'Hidden Frame Clock Regular is unavailable',
    )
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry',
    )!
    await act(async () => {
      retry.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(attempts.get('local("HiddenFrameClock-Regular")')).toBe(2)
    expect(container.querySelector('.stage-resource-warning')).toBeNull()
    expect(container.querySelector('[data-stage-frame-design-role="clock"]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it.each(['success', 'failure'] as const)(
    'never paints stale font A %s onto a pending font B selection',
    async (outcome) => {
      const suffix = outcome === 'success' ? 'Success' : 'Failure'
      const styleA = localLyricStyle(`Race ${suffix} A`, `Race${suffix}A-Regular`)
      const styleB = localLyricStyle(`Race ${suffix} B`, `Race${suffix}B-Regular`)
      const loadA = deferred<void>()
      const loadB = deferred<void>()
      const aliases = new Map<string, string>()
      vi.stubGlobal(
        'FontFace',
        class {
          constructor(
            public family: string,
            private source: string,
          ) {
            aliases.set(source, family)
          }

          load() {
            const pending = this.source.includes(`Race${suffix}A`) ? loadA : loadB
            return pending.promise.then(() => this)
          }
        },
      )
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { add: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
      })
      const project = createProject()
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      const renderStyle = (style: LyricTextStyle) =>
        root.render(
          <KaraokePreview
            project={project}
            playbackMs={0}
            lyricMs={0}
            selectedWordIds={new Set()}
            designMode={projectLyricsDesignMode(style, project)}
          />,
        )

      await act(async () => renderStyle(styleA))
      await act(async () => renderStyle(styleB))
      await act(async () => {
        if (outcome === 'success') loadA.resolve(undefined)
        else loadA.reject(new Error('stale A failure'))
        await Promise.allSettled([loadA.promise])
        await Promise.resolve()
      })

      const pendingLine = container.querySelector<HTMLElement>('[data-design-preview] .stage-line')!
      const aliasA = aliases.get(`local("Race${suffix}A-Regular")`)!
      expect(pendingLine.style.fontFamily).not.toContain(aliasA)
      expect(container.querySelector('.stage-resource-warning')?.textContent).toContain(
        'Loading requested local font',
      )
      expect(container.textContent).not.toContain(`Race ${suffix} A Regular is unavailable`)

      await act(async () => {
        loadB.resolve(undefined)
        await loadB.promise
        await Promise.resolve()
      })
      const aliasB = aliases.get(`local("Race${suffix}B-Regular")`)!
      expect(pendingLine.style.fontFamily).toContain(aliasB)
      expect(pendingLine.style.fontFamily).not.toContain(aliasA)
      expect(container.querySelector('.stage-resource-warning')).toBeNull()
      await act(async () => root.unmount())
    },
  )

  it('consumes retry for one selection and reuses cached prior design and ordinary fonts', async () => {
    const attempts = new Map<string, number>()
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          public family: string,
          private source: string,
        ) {
          attempts.set(source, (attempts.get(source) ?? 0) + 1)
        }

        async load() {
          if (this.source.includes('RetryOnceA') && attempts.get(this.source) === 1) {
            throw new Error('first A load fails')
          }
          return this
        }
      },
    )
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    const project = createProject()
    project.stageStyle.lyrics = localLyricStyle('Cached Ordinary', 'CachedOrdinary-Regular')
    const styleA = localLyricStyle('Retry Once A', 'RetryOnceA-Regular')
    const styleB = localLyricStyle('Retry Once B', 'RetryOnceB-Regular')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const renderMode = async (style?: LyricTextStyle) => {
      await act(async () => {
        root.render(
          <KaraokePreview
            project={project}
            playbackMs={0}
            lyricMs={0}
            selectedWordIds={new Set()}
            designMode={style ? projectLyricsDesignMode(style, project) : undefined}
          />,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode()
    await renderMode(styleA)
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry',
    )!
    await act(async () => {
      retry.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await renderMode(styleB)
    await renderMode(styleA)
    expect(container.querySelector('.stage-resource-warning')).toBeNull()
    await renderMode()

    expect(attempts.get('local("RetryOnceA-Regular")')).toBe(2)
    expect(attempts.get('local("RetryOnceB-Regular")')).toBe(1)
    expect(attempts.get('local("CachedOrdinary-Regular")')).toBe(1)
    expect(container.querySelector('.stage-resource-warning')).toBeNull()
    await act(async () => root.unmount())
  })
})
