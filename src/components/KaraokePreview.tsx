import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Edit3, MonitorPlay, ShieldCheck } from 'lucide-react'
import type { KaraokeProject, LyricDisplaySettings } from '../lib/model'
import { formatTime } from '../lib/model'
import { fontFamilyFor, loadLocalFont } from '../lib/font-runtime'
import { logicalStagePx, previewStageLayoutVariables } from '../lib/stage-layout'
import { previewFrameStateAt, type StageFrameLine } from '../lib/stage-frame-state'
import { SYNC_AID_GEOMETRY, syncAidBrightness, syncAidPosition } from '../lib/sync-aid-geometry'
import {
  backgroundReadiness,
  fontFaceKey,
  resolveFontFace,
  resolveVocalStyle,
  type FontSizeStyle,
  type TextStyle,
} from '../lib/video-style'
import { Button } from './ui'

interface KaraokePreviewProps {
  project: KaraokeProject
  playbackMs: number
  lyricMs: number
  selectedWordIds: Set<string>
  onUpdateLyricDisplay?: (patch: Partial<LyricDisplaySettings>) => void
  onEditLyrics?: () => void
}

function fontKey(style: FontSizeStyle) {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return JSON.stringify([style.typeface.kind, style.typeface.family, fontFaceKey(face)])
}

function projectFonts(project: KaraokeProject) {
  const stage = project.stageStyle
  const values: FontSizeStyle[] = [
    stage.lyrics,
    stage.titleCard.eyebrow,
    stage.titleCard.title,
    stage.titleCard.artist,
    stage.stageFrame.brand,
    stage.stageFrame.clock,
    stage.stageFrame.footer,
    ...project.tracks.map((track) => resolveVocalStyle(stage.lyrics, track.vocalStyle)),
  ]
  return [...new Map(values.map((style) => [fontKey(style), style])).values()]
}

function useFontRuntime(project: KaraokeProject) {
  const selectedFonts = projectFonts(project)
  const selectionKey = JSON.stringify(selectedFonts.map(fontKey))
  const fonts = useMemo(() => selectedFonts, [selectionKey])
  const [generation, setGeneration] = useState(0)
  const [result, setResult] = useState<{
    aliases: Record<string, string | null>
    failures: string[]
    loading: boolean
  }>({ aliases: {}, failures: [], loading: false })
  useEffect(() => {
    let active = true
    setResult((current) => ({ ...current, loading: fonts.some(({ typeface }) => typeface.kind === 'local') }))
    void Promise.all(fonts.map(async (style) => ({
      alias: await loadLocalFont(style.typeface, style.fontStyle, generation > 0),
      face: resolveFontFace(style.typeface, style.fontStyle),
      key: fontKey(style),
      local: style.typeface.kind === 'local',
    }))).then((loaded) => {
      if (!active) return
      setResult({
        aliases: Object.fromEntries(loaded.map(({ alias, key }) => [key, alias])),
        failures: loaded.filter(({ alias, local }) => local && !alias)
          .map(({ face }) => face.fullName),
        loading: false,
      })
    })
    return () => { active = false }
  }, [fonts, generation])
  return { ...result, retry: () => setGeneration((value) => value + 1) }
}

function textStyle(style: TextStyle, aliases: Record<string, string | null>): CSSProperties {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return {
    color: style.color,
    fontFamily: fontFamilyFor(style.typeface, aliases[fontKey(style)] ?? null),
    fontSize: logicalStagePx(style.sizePx),
    fontStyle: face.slant,
    fontWeight: face.weight,
    fontSynthesis: 'none',
  }
}

function lineKey(trackId: string, lineId: string) {
  return JSON.stringify([trackId, lineId])
}

function PreviewLine({
  line,
  selectedWordIds,
  aliases,
}: {
  line: StageFrameLine
  selectedWordIds: Set<string>
  aliases: Record<string, string | null>
}) {
  const face = resolveFontFace(line.style.typeface, line.style.fontStyle)
  return (
    <div className={`stage-line stage-line--${line.style.alignment}`} style={{
      '--track-color': line.style.sungColor,
      '--unsung-color': line.style.unsungColor,
      fontFamily: fontFamilyFor(line.style.typeface, aliases[fontKey(line.style)] ?? null),
      fontSize: logicalStagePx(line.style.sizePx),
      fontStyle: face.slant,
      fontWeight: face.weight,
      fontSynthesis: 'none',
    } as CSSProperties}>
      <p><span className="stage-line__text" data-sync-line={lineKey(line.trackId, line.id)}>
        {line.words.map((word, index) => <span
          key={word.id}
          className={`stage-word ${word.progress >= 1 ? 'is-done' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
          style={{ '--word-progress': `${word.progress * 100}%` } as CSSProperties}
        >{index ? ' ' : ''}{word.text}</span>)}
      </span></p>
    </div>
  )
}

function SyncAidCue({ line, progress }: { line: StageFrameLine; progress: number }) {
  const cueRef = useRef<HTMLDivElement>(null)
  const fallback = line.style.alignment === 'left' ? 128 : line.style.alignment === 'center' ? 960 : 1_792
  const [leadingEdgePx, setLeadingEdgePx] = useState(fallback)
  const key = lineKey(line.trackId, line.id)

  useLayoutEffect(() => {
    const cue = cueRef.current
    const stage = cue?.closest<HTMLElement>('.karaoke-stage')
    const text = [...(stage?.querySelectorAll<HTMLElement>('.stage-line__text') ?? [])]
      .find((element) => element.dataset.syncLine === key)
    if (!stage || !text) return
    const measure = () => {
      const stageRect = stage.getBoundingClientRect()
      const textRect = text.getBoundingClientRect()
      if (stageRect.width > 0) {
        setLeadingEdgePx((textRect.left - stageRect.left) * 1_920 / stageRect.width)
      }
    }
    setLeadingEdgePx(fallback)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(stage)
    observer?.observe(text)
    document.fonts?.addEventListener?.('loadingdone', measure)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      document.fonts?.removeEventListener?.('loadingdone', measure)
      window.removeEventListener('resize', measure)
    }
  }, [fallback, key])

  const position = syncAidPosition(leadingEdgePx)
  return <div ref={cueRef} className="sync-aid" style={{
    '--sync-brightness': syncAidBrightness(progress),
    '--sync-color': line.style.sungColor,
    '--sync-end': logicalStagePx(position.endLeftPx),
    '--sync-progress': progress,
    '--sync-start': logicalStagePx(position.startLeftPx),
    '--sync-travel': logicalStagePx(position.travelPx),
    '--sync-width': logicalStagePx(SYNC_AID_GEOMETRY.cueWidthPx),
  } as CSSProperties}><i /></div>
}

export function KaraokePreview({
  project,
  playbackMs,
  selectedWordIds,
  onUpdateLyricDisplay,
  onEditLyrics,
}: KaraokePreviewProps) {
  const frame = useMemo(() => previewFrameStateAt(project, playbackMs), [playbackMs, project])
  const fontRuntime = useFontRuntime(project)
  const background = frame.stageStyle.background
  const imageReadiness = backgroundReadiness(
    background,
    null,
    'Linked-image Preview and MP4 export are deferred; using the authored gradient fallback.',
  )
  const backgroundStyle: CSSProperties = background.mode === 'solid'
    ? { background: background.solidColor }
    : { background: `linear-gradient(145deg, ${background.gradientStartColor}, ${background.gradientEndColor})` }
  const stageFrame = frame.stageStyle.stageFrame
  const stageVars = {
    ...backgroundStyle,
    ...previewStageLayoutVariables(frame.lines.length),
    '--stage-frame-color': stageFrame.lineColor,
    '--stage-frame-width': logicalStagePx(stageFrame.lineWidthPx),
  } as CSSProperties
  const lines = new Map(frame.lines.map((line) => [lineKey(line.trackId, line.id), line]))

  return <section className="preview-panel panel" aria-label="Karaoke preview">
    <header className="panel-header preview-panel__header">
      <div className="panel-title"><span className="panel-title__icon"><MonitorPlay size={16} /></span>
        <div><span className="eyebrow">Stage monitor</span><h2>Live preview</h2></div>
      </div>
      <div className="preview-toolbar">
        <label className="preview-setting"><span>Lines</span><select
          aria-label="Visible lyric lines"
          title="Choose how many lyric lines appear in the preview and exported video"
          value={project.lyricDisplay.lineCount}
          onChange={(event) => onUpdateLyricDisplay?.({ lineCount: Number(event.target.value) })}
        >{[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
        <label className="preview-setting"><span>Advance</span><select
          aria-label="Lyric line advance mode"
          title="Clear replaces a page; Scroll advances one line at a time within a section"
          value={project.lyricDisplay.advanceMode}
          onChange={(event) => onUpdateLyricDisplay?.({ advanceMode: event.target.value as LyricDisplaySettings['advanceMode'] })}
        ><option value="clear">Clear</option><option value="scroll">Scroll</option></select></label>
        {onEditLyrics && <Button size="sm" variant="ghost" title="Open the lyric text editor" onClick={onEditLyrics}><Edit3 size={13} /> Edit text</Button>}
        <div className="preview-badges"><span className="status-pill status-pill--live"><i /> Live</span><span className="status-pill"><ShieldCheck size={12} /> Title safe</span></div>
      </div>
    </header>

    <div className={`karaoke-stage karaoke-stage--lines-${project.lyricDisplay.lineCount}`} style={stageVars}>
      <div className="karaoke-stage__grain" />
      {!imageReadiness.ready ? <div className="stage-resource-warning" role="status">{imageReadiness.reason}</div>
        : fontRuntime.loading ? <div className="stage-resource-warning" role="status">Loading requested local font; previewing with System UI.</div>
          : fontRuntime.failures[0] && <div className="stage-resource-warning" role="status">Requested font {fontRuntime.failures[0]} is unavailable; previewing with System UI. <button onClick={fontRuntime.retry}>Retry</button></div>}
      {stageFrame.enabled && <div className="karaoke-stage__safe-area" aria-hidden="true" />}
      {stageFrame.enabled && stageFrame.brand.visible && <div className="karaoke-stage__brand" style={textStyle(stageFrame.brand, fontRuntime.aliases)}>OKAY / STUDIO</div>}
      {stageFrame.enabled && stageFrame.clock.visible && <div className="karaoke-stage__time" style={textStyle(stageFrame.clock, fontRuntime.aliases)}>{formatTime(playbackMs)}</div>}
      <div className="karaoke-stage__content">
        {frame.showTitle ? <div className="title-card">
          {frame.stageStyle.titleCard.eyebrow.visible && <span style={textStyle(frame.stageStyle.titleCard.eyebrow, fontRuntime.aliases)}>Tonight&apos;s performance</span>}
          {frame.stageStyle.titleCard.title.visible && <h3 style={textStyle(frame.stageStyle.titleCard.title, fontRuntime.aliases)}>{frame.title}</h3>}
          {frame.stageStyle.titleCard.artist.visible && <p style={textStyle(frame.stageStyle.titleCard.artist, fontRuntime.aliases)}>{frame.artist}</p>}
        </div> : frame.lines.length ? <div className="active-lines">{frame.lines.map((line) => <PreviewLine key={lineKey(line.trackId, line.id)} line={line} selectedWordIds={selectedWordIds} aliases={fontRuntime.aliases} />)}</div> : null}
      </div>
      {frame.syncAids.map((aid) => {
        const line = lines.get(lineKey(aid.trackId, aid.lineId))
        return line ? <SyncAidCue key={lineKey(aid.trackId, aid.lineId)} line={line} progress={aid.progress} /> : null
      })}
      {stageFrame.enabled && stageFrame.footer.visible && <div className="karaoke-stage__footer" style={textStyle(stageFrame.footer, fontRuntime.aliases)}><span>{frame.artist} · {frame.title}</span></div>}
    </div>
  </section>
}
