import type { CSSProperties, KeyboardEvent } from 'react'

export interface StyleDestinationItem<Destination extends string> {
  id: Destination
  label: string
}

interface StyleDestinationTabsProps<Destination extends string> {
  destinations: readonly StyleDestinationItem<Destination>[]
  idPrefix: string
  selected: Destination
  onSelect: (destination: Destination) => void
}

export function StyleDestinationTabs<Destination extends string>({
  destinations,
  idPrefix,
  selected,
  onSelect,
}: StyleDestinationTabsProps<Destination>) {
  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = [
      ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        []),
    ]
    const current = tabs.indexOf(event.currentTarget)
    if (current < 0 || tabs.length !== destinations.length) return
    event.preventDefault()
    event.stopPropagation()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    const next = tabs[nextIndex]
    onSelect(next.dataset.styleDestination as Destination)
    next.focus()
  }

  return (
    <div
      className="style-destination-tabs"
      role="tablist"
      aria-label="Style destinations"
      style={{ '--style-destination-count': destinations.length } as CSSProperties}
    >
      {destinations.map(({ id, label }) => (
        <button
          key={id}
          id={`${idPrefix}-${id}-tab`}
          type="button"
          role="tab"
          aria-controls={`${idPrefix}-${id}-panel`}
          aria-selected={selected === id}
          data-style-destination={id}
          tabIndex={selected === id ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={navigate}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
