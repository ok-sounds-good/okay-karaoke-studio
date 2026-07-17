import { useId, useState } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type { StageStyleDraftChange } from '../hooks/useProjectStyleSession'
import type { StageStyle, VisibleTextStyle } from '../lib/video-style'
import { VisibleTextRoleEditor } from './VisibleTextRoleEditor'

const STAGE_FRAME_ROLES = [
  { id: 'brand', label: 'Brand' },
  { id: 'clock', label: 'Clock' },
  { id: 'footer', label: 'Footer' },
] as const

export type StageFrameRole = (typeof STAGE_FRAME_ROLES)[number]['id']

interface StageFrameStylePanelProps {
  active: boolean
  draft: StageStyle
  fonts: InstalledFontState
  id: string
  labelledBy: string
  onDraftChange: (change: StageStyleDraftChange) => void
  onRetryFonts: () => void
  onSelectedRoleChange: (role: StageFrameRole) => void
}

export function StageFrameStylePanel({
  active,
  draft,
  fonts,
  id,
  labelledBy,
  onDraftChange,
  onRetryFonts,
  onSelectedRoleChange,
}: StageFrameStylePanelProps) {
  const radioName = useId()
  const [selectedRole, setSelectedRole] = useState<StageFrameRole>('brand')
  const selected = STAGE_FRAME_ROLES.find(({ id: role }) => role === selectedRole)!
  const updateSelectedRole = (style: VisibleTextStyle) =>
    onDraftChange((current) => ({
      ...current,
      stageFrame: {
        ...current.stageFrame,
        [selectedRole]: style,
      },
    }))

  return (
    <section id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!active}>
      <label className="stage-frame-master-field">
        <input
          type="checkbox"
          aria-label="Show Stage frame in output"
          checked={draft.stageFrame.enabled}
          onChange={(event) => {
            const enabled = event.currentTarget.checked
            onDraftChange((current) => ({
              ...current,
              stageFrame: { ...current.stageFrame, enabled },
            }))
          }}
        />
        Show Stage frame in output
      </label>

      <fieldset className="title-card-role-selector stage-frame-role-selector">
        <legend>Stage frame role</legend>
        <div role="radiogroup" aria-label="Stage frame role">
          {STAGE_FRAME_ROLES.map(({ id: role, label }) => (
            <label key={role}>
              <input
                type="radio"
                name={radioName}
                value={role}
                checked={selectedRole === role}
                onChange={() => {
                  setSelectedRole(role)
                  onSelectedRoleChange(role)
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <VisibleTextRoleEditor
        fonts={fonts}
        label={selected.label}
        style={draft.stageFrame[selectedRole]}
        onChange={updateSelectedRole}
        onRetryFonts={onRetryFonts}
      />
    </section>
  )
}
