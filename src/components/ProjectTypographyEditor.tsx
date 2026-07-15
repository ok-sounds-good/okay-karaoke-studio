import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type { ProjectTypographySession } from '../hooks/useProjectTypographySession'
import type { KaraokeProject } from '../lib/model'
import {
  FONT_SIZE_OPTIONS,
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  isFontSizePx,
  resolveFontFace,
  type FontTypefaceDescriptor,
  type LyricTextStyle,
} from '../lib/video-style'
import '../video-style.css'
import { KaraokePreview } from './KaraokePreview'
import { TypefaceCombobox } from './TypefaceCombobox'
import { Button } from './ui'

export interface ProjectTypographyEditorProps {
  project: KaraokeProject
  playbackMs: number
  draft: LyricTextStyle
  fonts: InstalledFontState
  onDraftChange: ProjectTypographySession['change']
  onRetryFonts: () => void
  onTogglePlayback: () => void
  onCancel: ProjectTypographySession['cancel']
  onApply: ProjectTypographySession['apply']
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  )
}

export function ProjectTypographyEditor({
  project,
  playbackMs,
  draft,
  fonts,
  onDraftChange,
  onRetryFonts,
  onTogglePlayback,
  onCancel,
  onApply,
}: ProjectTypographyEditorProps) {
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const effectiveFaceKey = fontFaceKey(resolveFontFace(draft.typeface, draft.fontStyle))
  const update = (patch: Partial<LyricTextStyle>) =>
    onDraftChange((current) => ({ ...current, ...patch }))
  const chooseTypeface = (typeface: FontTypefaceDescriptor) =>
    onDraftChange((current) => ({ ...current, typeface: cloneTypeface(typeface) }))
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const exactShiftSpace =
      event.code === 'Space' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if (exactShiftSpace) {
      if (event.repeat || isEditableTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      onTogglePlayback()
      return
    }
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  useEffect(() => headingRef.current?.focus(), [])

  return (
    <main
      className="style-workspace"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
    >
      <section className="style-editor panel">
        <header className="panel-header panel-title">
          <div>
            <span className="eyebrow">Project lyrics</span>
            <h2 ref={headingRef} id={titleId} tabIndex={-1}>
              Typography
            </h2>
          </div>
        </header>

        <div className="style-editor__body">
          <section className="style-control-group" aria-labelledby={`${titleId}-typeface`}>
            <h3 id={`${titleId}-typeface`}>Typeface</h3>
            <TypefaceCombobox
              {...fonts}
              value={draft.typeface}
              selectedFace={draft.fontStyle}
              onChange={chooseTypeface}
              onRetry={onRetryFonts}
            />
          </section>

          <section className="style-control-group" aria-labelledby={`${titleId}-face`}>
            <h3 id={`${titleId}-face`}>Available faces</h3>
            <div className="font-face-list">
              {draft.typeface.faces.map((face) => (
                <button
                  key={fontFaceKey(face)}
                  type="button"
                  className="font-face-button"
                  aria-pressed={fontFaceKey(face) === effectiveFaceKey}
                  style={{
                    fontStyle: face.slant,
                    fontWeight: face.weight,
                    fontSynthesis: 'none',
                  }}
                  onClick={() => {
                    onDraftChange((current) => ({ ...current, fontStyle: cloneFontFace(face) }))
                  }}
                >
                  {face.style}
                </button>
              ))}
            </div>
          </section>

          <section className="style-control-row">
            <label className="style-field">
              <span>Size</span>
              <select
                aria-label="Project lyric font size"
                value={draft.sizePx}
                onChange={(event) => {
                  const sizePx = Number(event.currentTarget.value)
                  if (isFontSizePx(sizePx)) update({ sizePx })
                }}
              >
                {FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="style-color-grid" aria-label="Project lyric colors">
            <label className="style-color-field">
              <span>Sung</span>
              <div>
                <input
                  aria-label="Project lyric sung color"
                  type="color"
                  value={draft.sungColor}
                  onChange={(event) => update({ sungColor: event.currentTarget.value })}
                />
                <output>{draft.sungColor.toUpperCase()}</output>
              </div>
            </label>
            <label className="style-color-field">
              <span>Unsung</span>
              <div>
                <input
                  aria-label="Project lyric unsung color"
                  type="color"
                  value={draft.unsungColor}
                  onChange={(event) => update({ unsungColor: event.currentTarget.value })}
                />
                <output>{draft.unsungColor.toUpperCase()}</output>
              </div>
            </label>
          </section>
        </div>

        <footer className="style-editor__actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onApply}>
            Apply &amp; close
          </Button>
        </footer>
      </section>

      <KaraokePreview
        project={project}
        playbackMs={playbackMs}
        lyricMs={playbackMs - project.offsetMs}
        selectedWordIds={new Set()}
        designMode={{ target: 'project-lyrics', style: draft }}
      />
    </main>
  )
}
