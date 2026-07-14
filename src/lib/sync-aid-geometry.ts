import geometry from '../../electron/sync-aid-geometry.json'

export const SYNC_AID_GEOMETRY = Object.freeze(geometry)

export function syncAidPosition(leadingEdgePx: number) {
  if (!Number.isFinite(leadingEdgePx)) {
    throw new RangeError('Sync-aid leading edge must be finite.')
  }
  const endLeftPx = leadingEdgePx - SYNC_AID_GEOMETRY.gapPx - SYNC_AID_GEOMETRY.cueWidthPx
  const startLeftPx = Math.min(
    -SYNC_AID_GEOMETRY.cueWidthPx - SYNC_AID_GEOMETRY.gapPx,
    endLeftPx - SYNC_AID_GEOMETRY.minimumTravelPx,
  )
  return {
    endLeftPx,
    startLeftPx,
    travelPx: endLeftPx - startLeftPx,
  }
}

export function syncAidBrightness(progress: number) {
  const normalized = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  if (normalized < 1 / 3) return 0.35
  if (normalized < 2 / 3) return 0.65
  return 1
}
