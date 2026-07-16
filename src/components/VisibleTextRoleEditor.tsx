import { useId } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import {
  FONT_SIZE_OPTIONS,
  cloneFontFace,
  cloneTypeface,
  fontFaceKey,
  isFontSizePx,
  resolveFontFace,
  type FontTypefaceDescriptor,
  type VisibleTextStyle,
} from '../lib/video-style'
import { TypefaceCombobox } from './TypefaceCombobox'

interface VisibleTextRoleEditorProps {
  fonts: InstalledFontState
  label: string
  style: VisibleTextStyle
  onChange: (style: VisibleTextStyle) => void
  onRetryFonts: () => void
}

export function VisibleTextRoleEditor({
  fonts,
  label,
  style,
  onChange,
  onRetryFonts,
}: VisibleTextRoleEditorProps) {
  const id = useId()
  const effectiveFaceKey = fontFaceKey(resolveFontFace(style.typeface, style.fontStyle))
  const update = (patch: Partial<VisibleTextStyle>) => onChange({ ...style, ...patch })
  const chooseTypeface = (typeface: FontTypefaceDescriptor) =>
    update({ typeface: cloneTypeface(typeface) })

  return (
    <div className="visible-text-role-editor">
      <h3>{label} styling</h3>
      <label className="style-visibility-field">
        <input
          type="checkbox"
          aria-label={`Show ${label} in output`}
          checked={style.visible}
          onChange={(event) => update({ visible: event.currentTarget.checked })}
        />
        Show in output
      </label>

      <section className="style-control-group" aria-labelledby={`${id}-typeface`}>
        <h4 id={`${id}-typeface`}>Typeface</h4>
        <TypefaceCombobox
          {...fonts}
          ariaLabel={`${label} typeface`}
          value={style.typeface}
          selectedFace={style.fontStyle}
          onChange={chooseTypeface}
          onRetry={onRetryFonts}
        />
      </section>

      <section className="style-control-group" aria-labelledby={`${id}-face`}>
        <h4 id={`${id}-face`}>Available faces</h4>
        <div className="font-face-list">
          {style.typeface.faces.map((face) => (
            <button
              key={fontFaceKey(face)}
              type="button"
              className="font-face-button"
              aria-label={`${label} face ${face.style}`}
              aria-pressed={fontFaceKey(face) === effectiveFaceKey}
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
      </section>

      <section className="style-control-row">
        <label className="style-field">
          <span>Size</span>
          <select
            aria-label={`${label} font size`}
            value={style.sizePx}
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

      <section className="style-color-grid style-color-grid--single">
        <label className="style-color-field">
          <span>Color</span>
          <div>
            <input
              aria-label={`${label} color`}
              type="color"
              value={style.color}
              onChange={(event) => update({ color: event.currentTarget.value })}
            />
            <output>{style.color.toUpperCase()}</output>
          </div>
        </label>
      </section>
    </div>
  )
}
