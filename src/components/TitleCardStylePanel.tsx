import { useId, useState } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import type { ProjectStyleSession } from '../hooks/useProjectStyleSession'
import type { StageStyle, VisibleTextStyle } from '../lib/video-style'
import { VisibleTextRoleEditor } from './VisibleTextRoleEditor'

const TITLE_CARD_ROLES = [
  { id: 'eyebrow', label: 'Eyebrow' },
  { id: 'title', label: 'Title' },
  { id: 'artist', label: 'Artist' },
] as const

export type TitleCardRole = (typeof TITLE_CARD_ROLES)[number]['id']

interface TitleCardStylePanelProps {
  active: boolean
  draft: StageStyle
  fonts: InstalledFontState
  id: string
  labelledBy: string
  onDraftChange: ProjectStyleSession['change']
  onRetryFonts: () => void
  onSelectedRoleChange: (role: TitleCardRole) => void
}

export function TitleCardStylePanel({
  active,
  draft,
  fonts,
  id,
  labelledBy,
  onDraftChange,
  onRetryFonts,
  onSelectedRoleChange,
}: TitleCardStylePanelProps) {
  const radioName = useId()
  const [selectedRole, setSelectedRole] = useState<TitleCardRole>('eyebrow')
  const selected = TITLE_CARD_ROLES.find(({ id }) => id === selectedRole)!
  const updateSelectedRole = (style: VisibleTextStyle) =>
    onDraftChange((current) => ({
      ...current,
      titleCard: {
        ...current.titleCard,
        [selectedRole]: style,
      },
    }))

  return (
    <section id={id} role="tabpanel" aria-labelledby={labelledBy} hidden={!active}>
      <fieldset className="title-card-role-selector">
        <legend>Title card role</legend>
        <div role="radiogroup" aria-label="Title card role">
          {TITLE_CARD_ROLES.map(({ id: role, label }) => (
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
        style={draft.titleCard[selectedRole]}
        onChange={updateSelectedRole}
        onRetryFonts={onRetryFonts}
      />
    </section>
  )
}
