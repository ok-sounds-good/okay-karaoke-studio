import { useId } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type { ProjectStyleDraft, ProjectStyleSession } from '../hooks/useProjectStyleSession'
import {
  FONT_SIZE_OPTIONS,
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  isFontSizePx,
  resolveFontFace,
  resolveVocalStyle,
  type FontTypefaceDescriptor,
  type VocalAlignment,
  type VocalStyle,
} from '../lib/video-style'
import { TypefaceCombobox } from './TypefaceCombobox'

interface LeadVocalStylePanelProps {
  active: boolean
  available: boolean
  draft: ProjectStyleDraft
  fonts: InstalledFontState
  id: string
  labelledBy: string
  onDraftChange: ProjectStyleSession['change']
  onRetryFonts: () => void
}

function OverrideToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="style-override-toggle">
      <strong>{label}</strong>
      <span>
        <span>Project</span>
        <input
          type="checkbox"
          aria-label={`Override Lead Vocal ${label}`}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>Override</span>
      </span>
    </label>
  )
}

function VocalColorField({
  field,
  label,
  resolvedValue,
  style,
  update,
}: {
  field: 'sungColor' | 'unsungColor'
  label: 'Sung' | 'Unsung'
  resolvedValue: string
  style: VocalStyle
  update: (patch: Partial<VocalStyle>) => void
}) {
  const overridden = style[field] !== null
  return (
    <section className="style-override-field style-override-color-field">
      <OverrideToggle
        checked={overridden}
        label={label}
        onChange={(checked) => update({ [field]: checked ? resolvedValue : null })}
      />
      <fieldset disabled={!overridden} aria-label={`Lead Vocal ${label} value`}>
        <div className="style-color-field">
          <div>
            <input
              aria-label={`Lead Vocal ${label.toLowerCase()} color`}
              type="color"
              value={style[field] ?? resolvedValue}
              onChange={(event) => update({ [field]: event.currentTarget.value })}
            />
            <output>{(style[field] ?? resolvedValue).toUpperCase()}</output>
          </div>
        </div>
      </fieldset>
    </section>
  )
}

export function LeadVocalStylePanel({
  active,
  available,
  draft,
  fonts,
  id,
  labelledBy,
  onDraftChange,
  onRetryFonts,
}: LeadVocalStylePanelProps) {
  const alignmentName = useId()
  const stageLyrics = draft.stageStyle.lyrics
  const vocal = draft.vocalStyle
  const resolved = resolveVocalStyle(stageLyrics, vocal)
  const effectiveFace = resolveFontFace(resolved.typeface, vocal.fontStyle ?? resolved.fontStyle)
  const update = (patch: Partial<VocalStyle>) =>
    onDraftChange((current) => ({
      ...current,
      vocalStyle: { ...current.vocalStyle, ...patch },
    }))
  const chooseTypeface = (typeface: FontTypefaceDescriptor) =>
    update({ typeface: cloneTypeface(typeface) })

  return (
    <section id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!active}>
      {!available ? (
        <p className="style-unavailable" role="status">
          Lead Vocal is unavailable because this project has no vocal track.
        </p>
      ) : (
        <div className="lead-vocal-style-panel">
          <section className="style-override-field">
            <OverrideToggle
              checked={vocal.typeface !== null}
              label="Typeface"
              onChange={(checked) =>
                update({ typeface: checked ? cloneTypeface(resolved.typeface) : null })
              }
            />
            <fieldset disabled={vocal.typeface === null} aria-label="Lead Vocal Typeface value">
              <TypefaceCombobox
                {...fonts}
                ariaLabel="Lead Vocal typeface"
                value={resolved.typeface}
                selectedFace={vocal.fontStyle ?? resolved.fontStyle}
                onChange={chooseTypeface}
                onRetry={onRetryFonts}
              />
            </fieldset>
          </section>

          <section className="style-override-field">
            <OverrideToggle
              checked={vocal.fontStyle !== null}
              label="Face"
              onChange={(checked) =>
                update({ fontStyle: checked ? cloneFontFace(resolved.fontStyle) : null })
              }
            />
            <fieldset disabled={vocal.fontStyle === null} aria-label="Lead Vocal Face value">
              <div className="font-face-list">
                {resolved.typeface.faces.map((face) => (
                  <button
                    key={fontFaceKey(face)}
                    type="button"
                    className="font-face-button"
                    aria-label={`Lead Vocal face ${face.style}`}
                    aria-pressed={fontFaceKey(face) === fontFaceKey(effectiveFace)}
                    style={{
                      fontStyle: face.slant,
                      fontWeight: face.weight,
                      fontSynthesis: 'none',
                    }}
                    onClick={() => update({ fontStyle: cloneFontFace(face) })}
                  >
                    {face.style}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>

          <section className="style-override-field">
            <OverrideToggle
              checked={vocal.sizePx !== null}
              label="Size"
              onChange={(checked) => update({ sizePx: checked ? resolved.sizePx : null })}
            />
            <fieldset disabled={vocal.sizePx === null} aria-label="Lead Vocal Size value">
              <label className="style-field">
                <select
                  aria-label="Lead Vocal font size"
                  value={vocal.sizePx ?? resolved.sizePx}
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
            </fieldset>
          </section>

          <div className="lead-vocal-color-grid">
            <VocalColorField
              field="sungColor"
              label="Sung"
              resolvedValue={resolved.sungColor}
              style={vocal}
              update={update}
            />
            <VocalColorField
              field="unsungColor"
              label="Unsung"
              resolvedValue={resolved.unsungColor}
              style={vocal}
              update={update}
            />
          </div>

          <fieldset className="lead-vocal-alignment">
            <legend>Alignment</legend>
            <div role="radiogroup" aria-label="Lead Vocal alignment">
              {(['left', 'center', 'right'] as VocalAlignment[]).map((alignment) => (
                <label key={alignment}>
                  <input
                    type="radio"
                    name={alignmentName}
                    value={alignment}
                    checked={vocal.alignment === alignment}
                    onChange={() => update({ alignment })}
                  />
                  {alignment[0].toUpperCase() + alignment.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </section>
  )
}
