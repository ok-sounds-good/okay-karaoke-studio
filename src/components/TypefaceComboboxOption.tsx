import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fontFamilyFor, loadLocalFont } from '../lib/font-runtime'
import { fontFaceKey, fontTypefaceKey, type FontTypefaceDescriptor } from '../lib/video-style'

type PreviewStatus = 'loading' | 'ready' | 'failed'

interface KeyedPreview {
  key: string
  status: PreviewStatus
  alias: string | null
}

interface TypefaceComboboxOptionProps {
  active: boolean
  selected: boolean
  id: string
  index: number
  total: number
  typeface: FontTypefaceDescriptor
  detail?: string
  onActivate: () => void
  onSelect: () => void
}

export function TypefaceComboboxOption({
  active,
  selected,
  id,
  index,
  total,
  typeface,
  detail,
  onActivate,
  onSelect,
}: TypefaceComboboxOptionProps) {
  const face = typeface.faces[0]
  const optionKey = face
    ? JSON.stringify([fontTypefaceKey(typeface), fontFaceKey(face)])
    : fontTypefaceKey(typeface)
  const loadTarget = useMemo(() => ({ face, typeface }), [optionKey])
  const [preview, setPreview] = useState<KeyedPreview>({
    key: '',
    status: 'loading',
    alias: null,
  })
  const currentPreview =
    preview.key === optionKey
      ? preview
      : { key: optionKey, status: 'loading' as const, alias: null }
  const previewStatus =
    typeface.kind !== 'local' ? 'system' : face ? currentPreview.status : 'failed'

  useEffect(() => {
    let activeRequest = true
    if (loadTarget.typeface.kind !== 'local' || !loadTarget.face) return
    setPreview({ key: optionKey, status: 'loading', alias: null })
    void loadLocalFont(loadTarget.typeface, loadTarget.face).then(
      (alias) => {
        if (!activeRequest) return
        setPreview({
          key: optionKey,
          status: alias ? 'ready' : 'failed',
          alias,
        })
      },
      () => {
        if (activeRequest) {
          setPreview({ key: optionKey, status: 'failed', alias: null })
        }
      },
    )
    return () => {
      activeRequest = false
    }
  }, [loadTarget, optionKey])

  const style = face
    ? ({
        fontFamily: fontFamilyFor(typeface, currentPreview.alias),
        fontStyle: face.slant,
        fontWeight: face.weight,
        fontSynthesis: 'none',
      } as CSSProperties)
    : undefined
  const previewDetail =
    previewStatus === 'loading'
      ? 'Loading font preview'
      : previewStatus === 'failed'
        ? 'Font preview unavailable'
        : undefined
  const annotation = [detail, previewDetail].filter(Boolean).join(' · ')

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={total}
      aria-busy={previewStatus === 'loading' || undefined}
      aria-label={
        previewStatus === 'loading'
          ? `${typeface.family}, font preview loading`
          : previewStatus === 'failed'
            ? `${typeface.family}, font preview unavailable`
            : undefined
      }
      className={`typeface-option ${active ? 'is-active' : ''}`}
      data-font-family={typeface.family}
      data-font-load-state={previewStatus}
      onMouseEnter={onActivate}
      onMouseDown={(event) => {
        event.preventDefault()
        onSelect()
      }}
    >
      <span style={style}>{typeface.family}</span>
      {annotation && <small>{annotation}</small>}
    </div>
  )
}
