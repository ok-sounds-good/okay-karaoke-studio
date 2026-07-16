import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Edit3, MonitorPlay, ShieldCheck } from 'lucide-react'
import {
  designPreviewFonts,
  previewFontKey,
  projectPreviewFonts,
  usePreviewFonts,
} from '../hooks/usePreviewFonts'
import type { KaraokeProject, LyricDisplaySettings } from '../lib/model'
import { formatTime } from '../lib/model'
import { fontFamilyFor } from '../lib/font-runtime'
import { logicalStagePx, previewStageLayoutVariables } from '../lib/stage-layout'
import { previewFrameStateAt, type StageFrameLine } from '../lib/stage-frame-state'
import { SYNC_AID_GEOMETRY, syncAidBrightness, syncAidPosition } from '../lib/sync-aid-geometry'
import {
  DEFAULT_VOCAL_STYLE,
  backgroundReadiness,
  resolveFontFace,
  resolveVocalStyle,
  type LyricTextStyle,
  type StageStyle,
  type TextStyle,
} from '../lib/video-style'
import { Button } from './ui'

export type KaraokePreviewDesignMode = {
  target: 'project-lyrics' | 'background'
  stageStyle: StageStyle
}

interface KaraokePreviewProps {
  project: KaraokeProject
  playbackMs: number
  lyricMs: number
  selectedWordIds: Set<string>
  onUpdateLyricDisplay?: (patch: Partial<LyricDisplaySettings>) => void
  onEditLyrics?: () => void
  designMode?: KaraokePreviewDesignMode
}

function textStyle(style: TextStyle, aliases: Record<string, string | null>): CSSProperties {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return {
    color: style.color,
    fontFamily: fontFamilyFor(style.typeface, aliases[previewFontKey(style)] ?? null),
    fontSize: logicalStagePx(style.sizePx),
    fontStyle: face.slant,
    fontWeight: face.weight,
    fontSynthesis: 'none',
  }
}

function lineKey(trackId: string, lineId: string) {
  return JSON.stringify([trackId, lineId])
}

const PROJECT_LYRICS_DESIGN_WORDS = ['Sing', 'the', 'first', 'words', 'and', 'see', 'the', 'rest']

function projectLyricsDesignLine(style: LyricTextStyle): StageFrameLine {
  return {
    id: 'project-lyrics-design-line',
    trackId: 'project-lyrics-design-track',
    text: PROJECT_LYRICS_DESIGN_WORDS.join(' '),
    style: resolveVocalStyle(style, DEFAULT_VOCAL_STYLE),
    words: PROJECT_LYRICS_DESIGN_WORDS.map((text, index) => ({
      id: `project-lyrics-design-word-${index}`,
      text,
      progress: index === 0 ? 1 : index === 1 ? 0.5 : 0,
    })),
  }
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
    <div
      className={`stage-line stage-line--${line.style.alignment}`}
      style={
        {
          '--track-color': line.style.sungColor,
          '--unsung-color': line.style.unsungColor,
          fontFamily: fontFamilyFor(
            line.style.typeface,
            aliases[previewFontKey(line.style)] ?? null,
          ),
          fontSize: logicalStagePx(line.style.sizePx),
          fontStyle: face.slant,
          fontWeight: face.weight,
          fontSynthesis: 'none',
        } as CSSProperties
      }
    >
      <p>
        <span className="stage-line__text" data-sync-line={lineKey(line.trackId, line.id)}>
          {line.words.map((word, index) => (
            <span
              key={word.id}
              className={`stage-word ${word.progress >= 1 ? 'is-done' : ''} ${selectedWordIds.has(word.id) ? 'is-selected' : ''}`}
              style={{ '--word-progress': `${word.progress * 100}%` } as CSSProperties}
            >
              {index ? ' ' : ''}
              {word.text}
            </span>
          ))}
        </span>
      </p>
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
  designMode,
}: KaraokePreviewProps) {
  const designStyle = designMode?.stageStyle ?? null
  const previewProject = useMemo(
    () =>
      designMode?.target === 'background'
        ? { ...project, stageStyle: designMode.stageStyle }
        : project,
    [designMode, project],
  )
  const frame = useMemo(
    () => previewFrameStateAt(previewProject, playbackMs),
    [playbackMs, previewProject],
  )
  const designLine = useMemo(
    () =>
      designMode?.target === 'project-lyrics'
        ? projectLyricsDesignLine(designMode.stageStyle.lyrics)
        : null,
    [designMode],
  )
  const selectedFonts =
    designMode?.target === 'project-lyrics'
      ? designPreviewFonts(designMode.stageStyle)
      : projectPreviewFonts(previewProject)
  const fontRuntime = usePreviewFonts(selectedFonts)
  const stageStyle = designStyle ?? frame.stageStyle
  const background = stageStyle.background
  const imageReadiness = backgroundReadiness(
    background,
    null,
    'Linked-image Preview and MP4 export are deferred; using the authored gradient fallback.',
  )
  const backgroundStyle: CSSProperties =
    background.mode === 'solid'
      ? { background: background.solidColor }
      : {
          background: `linear-gradient(145deg, ${background.gradientStartColor}, ${background.gradientEndColor})`,
        }
  const stageFrame = stageStyle.stageFrame
  const stageVars = {
    ...backgroundStyle,
    ...previewStageLayoutVariables(designLine ? 1 : frame.lines.length),
    '--stage-frame-color': stageFrame.lineColor,
    '--stage-frame-width': logicalStagePx(stageFrame.lineWidthPx),
  } as CSSProperties
  const lines = new Map(frame.lines.map((line) => [lineKey(line.trackId, line.id), line]))
  const isDesigning = Boolean(designMode)
  const stageClassName = designLine
    ? 'karaoke-stage karaoke-stage--lines-1 is-designing'
    : `karaoke-stage karaoke-stage--lines-${project.lyricDisplay.lineCount}${isDesigning ? ' is-designing' : ''}`
  const designLabel = designMode?.target === 'background' ? 'Background' : 'Project lyrics'

  return (
    <section
      className="preview-panel panel"
      aria-label={isDesigning ? `${designLabel} design preview` : 'Karaoke preview'}
    >
      <header className="panel-header preview-panel__header">
        <div className="panel-title">
          <span className="panel-title__icon">
            <MonitorPlay size={16} />
          </span>
          <div>
            <span className="eyebrow">{isDesigning ? designLabel : 'Stage monitor'}</span>
            <h2>{isDesigning ? 'Design preview' : 'Live preview'}</h2>
          </div>
        </div>
        {isDesigning ? (
          <div className="preview-badges">
            <span className="status-pill">Fixed 1920 × 1080 stage</span>
            <span className="status-pill">
              <ShieldCheck size={12} /> Title safe
            </span>
          </div>
        ) : (
          <div className="preview-toolbar">
            <label className="preview-setting">
              <span>Lines</span>
              <select
                aria-label="Visible lyric lines"
                title="Choose how many lyric lines appear in the preview and exported video"
                value={project.lyricDisplay.lineCount}
                onChange={(event) =>
                  onUpdateLyricDisplay?.({ lineCount: Number(event.target.value) })
                }
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className="preview-setting">
              <span>Advance</span>
              <select
                aria-label="Lyric line advance mode"
                title="Clear replaces a page; Scroll advances one line at a time within a section"
                value={project.lyricDisplay.advanceMode}
                onChange={(event) =>
                  onUpdateLyricDisplay?.({
                    advanceMode: event.target.value as LyricDisplaySettings['advanceMode'],
                  })
                }
              >
                <option value="clear">Clear</option>
                <option value="scroll">Scroll</option>
              </select>
            </label>
            {onEditLyrics && (
              <Button
                size="sm"
                variant="ghost"
                title="Open the lyric text editor"
                onClick={onEditLyrics}
              >
                <Edit3 size={13} /> Edit text
              </Button>
            )}
            <div className="preview-badges">
              <span className="status-pill status-pill--live">
                <i /> Live
              </span>
              <span className="status-pill">
                <ShieldCheck size={12} /> Title safe
              </span>
            </div>
          </div>
        )}
      </header>

      <div
        className={stageClassName}
        data-background-gradient-end-color={background.gradientEndColor}
        data-background-gradient-start-color={background.gradientStartColor}
        data-background-mode={background.mode}
        data-background-solid-color={background.solidColor}
        data-logical-stage={isDesigning ? '1920x1080' : undefined}
        style={stageVars}
      >
        <div className="karaoke-stage__grain" />
        {!imageReadiness.ready ? (
          <div className="stage-resource-warning" role="status">
            {imageReadiness.reason}
          </div>
        ) : fontRuntime.loading ? (
          <div className="stage-resource-warning" role="status">
            Loading requested local font; previewing with System UI.
          </div>
        ) : (
          fontRuntime.failures[0] &&
          (designLine ? (
            <div className="stage-resource-warning" role="status">
              Requested font {fontRuntime.failures[0]} is unavailable; Preview and MP4 use System
              UI. <button onClick={fontRuntime.retry}>Retry</button>
            </div>
          ) : (
            <div className="stage-resource-warning" role="status">
              Requested font {fontRuntime.failures[0]} is unavailable; previewing with System UI.{' '}
              <button onClick={fontRuntime.retry}>Retry</button>
            </div>
          ))
        )}
        {stageFrame.enabled && <div className="karaoke-stage__safe-area" aria-hidden="true" />}
        {stageFrame.enabled && stageFrame.brand.visible && (
          <div
            className="karaoke-stage__brand"
            style={textStyle(stageFrame.brand, fontRuntime.aliases)}
          >
            OKAY / STUDIO
          </div>
        )}
        {stageFrame.enabled && stageFrame.clock.visible && (
          <div
            className="karaoke-stage__time"
            style={textStyle(stageFrame.clock, fontRuntime.aliases)}
          >
            {formatTime(playbackMs)}
          </div>
        )}
        <div className="karaoke-stage__content">
          {designLine ? (
            <div className="active-lines" data-design-preview="project-lyrics">
              <PreviewLine
                line={designLine}
                selectedWordIds={selectedWordIds}
                aliases={fontRuntime.aliases}
              />
            </div>
          ) : frame.showTitle ? (
            <div className="title-card">
              {stageStyle.titleCard.eyebrow.visible && (
                <span style={textStyle(stageStyle.titleCard.eyebrow, fontRuntime.aliases)}>
                  Tonight&apos;s performance
                </span>
              )}
              {stageStyle.titleCard.title.visible && (
                <h3 style={textStyle(stageStyle.titleCard.title, fontRuntime.aliases)}>
                  {frame.title}
                </h3>
              )}
              {stageStyle.titleCard.artist.visible && (
                <p style={textStyle(stageStyle.titleCard.artist, fontRuntime.aliases)}>
                  {frame.artist}
                </p>
              )}
            </div>
          ) : frame.lines.length ? (
            <div className="active-lines">
              {frame.lines.map((line) => (
                <PreviewLine
                  key={lineKey(line.trackId, line.id)}
                  line={line}
                  selectedWordIds={selectedWordIds}
                  aliases={fontRuntime.aliases}
                />
              ))}
            </div>
          ) : null}
        </div>
        {!designLine &&
          frame.syncAids.map((aid) => {
            const line = lines.get(lineKey(aid.trackId, aid.lineId))
            return line ? (
              <SyncAidCue
                key={lineKey(aid.trackId, aid.lineId)}
                line={line}
                progress={aid.progress}
              />
            ) : null
          })}
        {stageFrame.enabled && stageFrame.footer.visible && (
          <div
            className="karaoke-stage__footer"
            style={textStyle(stageFrame.footer, fontRuntime.aliases)}
          >
            <span>
              {frame.artist} · {frame.title}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
