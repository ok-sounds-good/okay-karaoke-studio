import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { InstalledFontState } from '../hooks/useInstalledFonts'
import { loadLocalFont } from '../lib/font-runtime'
import {
  SYSTEM_MONOSPACE_TYPEFACE,
  SYSTEM_UI_TYPEFACE,
  fontFaceKey,
  fontTypefaceKey,
  resolveFontFace,
  type FontFaceDescriptor,
  type FontTypefaceDescriptor,
} from '../lib/video-style'
import { Button } from './ui'
import { TypefaceComboboxOption } from './TypefaceComboboxOption'

const TYPEFACE_WINDOW_SIZE = 36

type FaceLoadStatus = 'loading' | 'ready' | 'failed'

interface KeyedFaceLoad {
  key: string
  status: FaceLoadStatus
  alias: string | null
}

export interface TypefaceComboboxProps extends InstalledFontState {
  value: FontTypefaceDescriptor
  selectedFace: FontFaceDescriptor
  onChange: (typeface: FontTypefaceDescriptor) => void
  onRetry: () => void
  ariaLabel?: string
}

function sameFace(left: FontFaceDescriptor, right: FontFaceDescriptor) {
  return left.postscriptName && right.postscriptName
    ? left.postscriptName === right.postscriptName
    : fontFaceKey(left) === fontFaceKey(right)
}

function faceLabel(face: FontFaceDescriptor) {
  return face.fullName || face.style
}

function windowStartFor(activeIndex: number, total: number) {
  const finalStart = Math.max(0, total - TYPEFACE_WINDOW_SIZE)
  return Math.min(Math.floor(activeIndex / TYPEFACE_WINDOW_SIZE) * TYPEFACE_WINDOW_SIZE, finalStart)
}

function faceStatusMessage({
  typeface,
  requestedFace,
  effectiveFace,
  loadStatus,
}: {
  typeface: FontTypefaceDescriptor
  requestedFace: FontFaceDescriptor
  effectiveFace: FontFaceDescriptor
  loadStatus: FaceLoadStatus
}) {
  const requestedName = faceLabel(requestedFace)
  const effectiveName = faceLabel(effectiveFace)
  const differs = !sameFace(requestedFace, effectiveFace)
  const retained = 'The requested Face remains selected.'

  if (typeface.kind === 'local' && loadStatus === 'loading') {
    return differs
      ? `Requested face ${requestedName} resolves to ${effectiveName}. ` +
          `Loading ${effectiveName} for Preview and MP4…`
      : `Loading requested and effective face ${effectiveName} for Preview and MP4…`
  }
  if (typeface.kind === 'local' && loadStatus === 'failed') {
    if (!effectiveFace.postscriptName) {
      return (
        `Requested face ${requestedName} has no loadable face in ${typeface.family}. ` +
        `Preview and MP4 use ${effectiveName}. ${retained}`
      )
    }
    return differs
      ? `Requested face ${requestedName} resolves to ${effectiveName}, but ` +
          `${effectiveName} could not be loaded. Preview and MP4 use System UI. ${retained}`
      : `Requested and effective face ${effectiveName} could not be loaded. ` +
          `Preview and MP4 use System UI. ${retained}`
  }
  if (differs) {
    return (
      `Requested face ${requestedName} is unavailable in ${typeface.family}; ` +
      `Preview and MP4 use ${effectiveName}. ${retained}`
    )
  }
  return null
}

export function TypefaceCombobox({
  value,
  selectedFace,
  typefaces,
  status,
  message,
  onChange,
  onRetry,
  ariaLabel = 'Project lyric typeface',
}: TypefaceComboboxProps) {
  const inputId = useId()
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const consumedRetryRef = useRef('')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [faceLoad, setFaceLoad] = useState<KeyedFaceLoad>({
    key: '',
    status: 'loading',
    alias: null,
  })
  const [retryRequest, setRetryRequest] = useState({ key: '', generation: 0 })

  const valueKey = fontTypefaceKey(value)
  const selectedFaceKey = fontFaceKey(selectedFace)
  const loadTarget = useMemo(
    () => ({ typeface: value, face: resolveFontFace(value, selectedFace) }),
    [selectedFaceKey, valueKey],
  )
  const effectiveFace = loadTarget.face
  const effectiveFaceKey = fontFaceKey(effectiveFace)
  const selectionKey = JSON.stringify([valueKey, selectedFaceKey, effectiveFaceKey])
  const retryGeneration = retryRequest.key === selectionKey ? retryRequest.generation : 0
  const faceLoadKey = JSON.stringify([selectionKey, retryGeneration])
  const currentFaceLoad =
    faceLoad.key === faceLoadKey
      ? faceLoad
      : { key: faceLoadKey, status: 'loading' as const, alias: null }

  useEffect(() => {
    let activeRequest = true
    if (loadTarget.typeface.kind !== 'local') return
    const retryToken = retryGeneration ? faceLoadKey : ''
    const retry = Boolean(retryToken && consumedRetryRef.current !== retryToken)
    if (retry) consumedRetryRef.current = retryToken
    setFaceLoad({ key: faceLoadKey, status: 'loading', alias: null })
    void loadLocalFont(loadTarget.typeface, loadTarget.face, retry).then(
      (alias) => {
        if (!activeRequest) return
        setFaceLoad({
          key: faceLoadKey,
          status: alias ? 'ready' : 'failed',
          alias,
        })
      },
      () => {
        if (activeRequest) {
          setFaceLoad({ key: faceLoadKey, status: 'failed', alias: null })
        }
      },
    )
    return () => {
      activeRequest = false
    }
  }, [faceLoadKey, loadTarget, retryGeneration])

  const catalogKeys = useMemo(() => new Set(typefaces.map(fontTypefaceKey)), [typefaces])
  const catalogHasSavedDescriptor = catalogKeys.has(valueKey)
  const catalogDrifted = value.kind === 'local' && status === 'ready' && !catalogHasSavedDescriptor
  const choices = useMemo(() => {
    const available = [SYSTEM_UI_TYPEFACE, SYSTEM_MONOSPACE_TYPEFACE, ...typefaces]
    if (value.kind === 'local' && !catalogHasSavedDescriptor) available.unshift(value)
    const seen = new Set<string>()
    return available.filter((typeface) => {
      const key = fontTypefaceKey(typeface)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [catalogHasSavedDescriptor, typefaces, valueKey])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle
      ? choices.filter(({ family }) => family.toLocaleLowerCase().includes(needle))
      : choices
  }, [choices, query])
  const selectedChoiceIndex = choices.findIndex(
    (typeface) => fontTypefaceKey(typeface) === valueKey,
  )
  const safeActiveIndex =
    filtered.length === 0 ? null : Math.min(activeIndex ?? 0, filtered.length - 1)
  const windowStart =
    safeActiveIndex === null ? 0 : windowStartFor(safeActiveIndex, filtered.length)
  const visible = filtered.slice(windowStart, windowStart + TYPEFACE_WINDOW_SIZE)

  const openList = () => {
    if (!open) {
      setQuery('')
      setActiveIndex(selectedChoiceIndex >= 0 ? selectedChoiceIndex : choices.length ? 0 : null)
    }
    setOpen(true)
  }
  const select = (typeface: FontTypefaceDescriptor) => {
    if (fontTypefaceKey(typeface) !== valueKey) onChange(typeface)
    setOpen(false)
    setQuery('')
    setActiveIndex(null)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setQuery('')
      setActiveIndex(null)
      return
    }
    const activeTypeface = safeActiveIndex === null ? undefined : filtered[safeActiveIndex]
    if (event.key === 'Enter' && open && activeTypeface) {
      event.preventDefault()
      select(activeTypeface)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!open) {
      setOpen(true)
      setQuery('')
      if (!choices.length) {
        setActiveIndex(null)
      } else if (event.key === 'Home') {
        setActiveIndex(0)
      } else if (event.key === 'End') {
        setActiveIndex(choices.length - 1)
      } else if (selectedChoiceIndex >= 0) {
        setActiveIndex(selectedChoiceIndex)
      } else {
        setActiveIndex(event.key === 'ArrowUp' ? choices.length - 1 : 0)
      }
      return
    }
    if (!filtered.length) return
    if (event.key === 'Home') {
      setActiveIndex(0)
    } else if (event.key === 'End') {
      setActiveIndex(filtered.length - 1)
    } else if (event.key === 'ArrowUp') {
      setActiveIndex(Math.max(0, (safeActiveIndex ?? 0) - 1))
    } else {
      setActiveIndex(Math.min(filtered.length - 1, (safeActiveIndex ?? -1) + 1))
    }
  }

  const faceStatus = faceStatusMessage({
    typeface: value,
    requestedFace: selectedFace,
    effectiveFace,
    loadStatus: currentFaceLoad.status,
  })
  const effectiveFaceLoadFailed = value.kind === 'local' && currentFaceLoad.status === 'failed'
  const optionDetail = (typeface: FontTypefaceDescriptor) => {
    if (!catalogDrifted) return undefined
    const key = fontTypefaceKey(typeface)
    if (key === valueKey) {
      return effectiveFaceLoadFailed ? 'Saved · font load failed' : 'Saved'
    }
    if (typeface.kind === 'local' && typeface.family === value.family) {
      return 'Installed · replacement'
    }
    return undefined
  }
  const retryFaceLoad = () =>
    setRetryRequest((current) => ({
      key: selectionKey,
      generation: current.key === selectionKey ? current.generation + 1 : 1,
    }))

  return (
    <div
      ref={rootRef}
      className="typeface-combobox"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
        }
      }}
    >
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={
          open && safeActiveIndex !== null ? `${listboxId}-option-${safeActiveIndex}` : undefined
        }
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        value={open ? query : value.family}
        placeholder={value.family}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActiveIndex(0)
        }}
        onClick={openList}
        onFocus={openList}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div className="typeface-popup">
          <div id={listboxId} role="listbox" aria-label={`${ariaLabel} choices`}>
            {visible.map((typeface, visibleIndex) => {
              const index = windowStart + visibleIndex
              return (
                <TypefaceComboboxOption
                  key={fontTypefaceKey(typeface)}
                  id={`${listboxId}-option-${index}`}
                  index={index}
                  total={filtered.length}
                  active={index === safeActiveIndex}
                  selected={fontTypefaceKey(typeface) === valueKey}
                  typeface={typeface}
                  detail={optionDetail(typeface)}
                  onActivate={() => setActiveIndex(index)}
                  onSelect={() => select(typeface)}
                />
              )
            })}
            {!visible.length && <p className="typeface-empty">No matching typefaces</p>}
          </div>
          {windowStart + visible.length < filtered.length && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                setActiveIndex(Math.min(filtered.length - 1, windowStart + TYPEFACE_WINDOW_SIZE))
              }
            >
              Show more typefaces
            </Button>
          )}
        </div>
      )}
      {status === 'loading' && (
        <p className="font-access-message" role="status">
          Reading installed fonts…
        </p>
      )}
      {message && (
        <div className="font-access-message" role="status">
          <span>{message}</span>
          {(status === 'denied' || status === 'error' || status === 'unavailable') && (
            <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
              Retry font access
            </Button>
          )}
        </div>
      )}
      {catalogDrifted && (
        <p className="font-access-message font-access-message--warning" role="status">
          Saved typeface {value.family} differs from the installed catalog and remains selected.{' '}
          Choose an installed replacement to change it.
        </p>
      )}
      {faceStatus && (
        <div className="font-access-message font-access-message--warning" role="status">
          <span>{faceStatus}</span>
          {effectiveFaceLoadFailed && Boolean(effectiveFace.postscriptName) && (
            <Button type="button" size="sm" variant="ghost" onClick={retryFaceLoad}>
              Retry font preview
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
