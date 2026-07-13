import './instrumental-break.css'

/**
 * Dormant source for a possible creator-placed stage element. It is deliberately
 * not mounted by Live Preview or video export.
 */
export function InstrumentalBreak() {
  return (
    <div className="instrumental-break">
      <span>Instrumental</span>
      <i /><i /><i /><i />
    </div>
  )
}
