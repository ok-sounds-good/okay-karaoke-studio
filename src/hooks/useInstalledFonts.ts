import { useCallback, useRef, useState } from 'react'
import { normalizeInstalledFontCatalog } from '../lib/installed-font-catalog'
import type { FontTypefaceDescriptor } from '../lib/video-style'

export type InstalledFontStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable' | 'error'

export interface InstalledFontState {
  typefaces: FontTypefaceDescriptor[]
  status: InstalledFontStatus
  message: string | null
}

const INITIAL_STATE: InstalledFontState = {
  typefaces: [],
  status: 'idle',
  message: null,
}

function rejectedState(error: unknown): InstalledFontState {
  const name = error instanceof DOMException ? error.name : ''
  const detail = error instanceof Error ? error.message : ''
  const denied = name === 'NotAllowedError' || /denied|permission/iu.test(detail)
  return {
    typefaces: [],
    status: denied ? 'denied' : 'error',
    message: denied
      ? 'Font access was denied. Allow local fonts, then retry.'
      : 'Installed fonts could not be read. Retry font access.',
  }
}

export function useInstalledFonts() {
  const sequenceRef = useRef(0)
  const [state, setState] = useState<InstalledFontState>(INITIAL_STATE)

  const request = useCallback(() => {
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    const query = window.queryLocalFonts
    if (!query) {
      setState({
        typefaces: [],
        status: 'unavailable',
        message: 'Installed-font access is unavailable in this environment.',
      })
      return
    }

    setState((current) => ({
      ...current,
      status: 'loading',
      message: null,
    }))
    let pending: Promise<StudioLocalFontRecord[]>
    try {
      // Keep this call in the user-triggered request path. Chromium requires
      // transient user activation when local-font permission is requested.
      pending = query()
    } catch (error) {
      setState(rejectedState(error))
      return
    }

    void pending
      .then((records) => {
        if (sequence !== sequenceRef.current) return
        setState({
          typefaces: normalizeInstalledFontCatalog(records),
          status: 'ready',
          message: null,
        })
      })
      .catch((error: unknown) => {
        if (sequence !== sequenceRef.current) return
        setState(rejectedState(error))
      })
  }, [])

  return { ...state, request }
}
