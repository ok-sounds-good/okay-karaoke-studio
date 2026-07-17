import { useEffect, useMemo, useRef, useState } from 'react'
import type { KaraokeProject } from '../lib/model'
import { loadLocalFont } from '../lib/font-runtime'
import {
  fontFaceKey,
  resolveFontFace,
  resolveVocalStyle,
  type FontSizeStyle,
  type StageStyle,
  type VocalStyle,
} from '../lib/video-style'

export function previewFontKey(style: FontSizeStyle) {
  const face = resolveFontFace(style.typeface, style.fontStyle)
  return JSON.stringify([style.typeface.kind, style.typeface.family, fontFaceKey(face)])
}

function uniqueFonts(values: FontSizeStyle[]) {
  return [...new Map(values.map((style) => [previewFontKey(style), style])).values()]
}

export function projectPreviewFonts(project: KaraokeProject) {
  const stage = project.stageStyle
  return uniqueFonts([
    stage.lyrics,
    stage.titleCard.eyebrow,
    stage.titleCard.title,
    stage.titleCard.artist,
    stage.stageFrame.brand,
    stage.stageFrame.clock,
    stage.stageFrame.footer,
    ...project.tracks.map((track) => resolveVocalStyle(stage.lyrics, track.vocalStyle)),
  ])
}

export function designPreviewFonts(stageStyle: StageStyle) {
  const values: FontSizeStyle[] = []
  const stageFrame = stageStyle.stageFrame
  if (stageFrame.enabled) {
    if (stageFrame.brand.visible) values.push(stageFrame.brand)
    if (stageFrame.clock.visible) values.push(stageFrame.clock)
    if (stageFrame.footer.visible) values.push(stageFrame.footer)
  }
  values.push(stageStyle.lyrics)
  return uniqueFonts(values)
}

export function vocalDesignPreviewFonts(stageStyle: StageStyle, vocalStyle: VocalStyle) {
  const values: FontSizeStyle[] = []
  const stageFrame = stageStyle.stageFrame
  if (stageFrame.enabled) {
    if (stageFrame.brand.visible) values.push(stageFrame.brand)
    if (stageFrame.clock.visible) values.push(stageFrame.clock)
    if (stageFrame.footer.visible) values.push(stageFrame.footer)
  }
  values.push(resolveVocalStyle(stageStyle.lyrics, vocalStyle))
  return uniqueFonts(values)
}

export function titleCardDesignPreviewFonts(
  stageStyle: StageStyle,
  selectedRole: keyof StageStyle['titleCard'],
) {
  const values: FontSizeStyle[] = []
  const stageFrame = stageStyle.stageFrame
  if (stageFrame.enabled) {
    if (stageFrame.brand.visible) values.push(stageFrame.brand)
    if (stageFrame.clock.visible) values.push(stageFrame.clock)
    if (stageFrame.footer.visible) values.push(stageFrame.footer)
  }
  Object.entries(stageStyle.titleCard).forEach(([role, style]) => {
    if (style.visible || role === selectedRole) values.push(style)
  })
  return uniqueFonts(values)
}

interface PreviewFontRuntimeResult {
  key: string
  aliases: Record<string, string | null>
  failures: string[]
  loading: boolean
}

function missingLocalFont(fonts: FontSizeStyle[], aliases: Record<string, string | null>) {
  return fonts.some((style) => style.typeface.kind === 'local' && !aliases[previewFontKey(style)])
}

function withoutSelectedAliases(aliases: Record<string, string | null>, fonts: FontSizeStyle[]) {
  const next = { ...aliases }
  fonts.forEach((style) => {
    if (style.typeface.kind === 'local') next[previewFontKey(style)] = null
  })
  return next
}

export function usePreviewFonts(selectedFonts: FontSizeStyle[]) {
  const selectionKey = JSON.stringify(selectedFonts.map(previewFontKey))
  const fonts = useMemo(() => selectedFonts, [selectionKey])
  const consumedRetryRef = useRef('')
  const [retryRequest, setRetryRequest] = useState({ key: '', generation: 0 })
  const [result, setResult] = useState<PreviewFontRuntimeResult>({
    key: '',
    aliases: {},
    failures: [],
    loading: false,
  })
  const retryGeneration = retryRequest.key === selectionKey ? retryRequest.generation : 0
  const retryToken = retryGeneration ? JSON.stringify([selectionKey, retryGeneration]) : ''
  const retryPending = Boolean(retryToken && consumedRetryRef.current !== retryToken)
  const currentAliases = retryPending
    ? withoutSelectedAliases(result.aliases, fonts)
    : result.aliases
  const currentResult =
    result.key === selectionKey && !retryPending
      ? result
      : {
          key: selectionKey,
          aliases: currentAliases,
          failures: [],
          loading: retryPending || missingLocalFont(fonts, currentAliases),
        }

  useEffect(() => {
    let active = true
    const retry = Boolean(retryToken && consumedRetryRef.current !== retryToken)
    if (retry) consumedRetryRef.current = retryToken
    setResult((current) => {
      const aliases = retry ? withoutSelectedAliases(current.aliases, fonts) : current.aliases
      return {
        key: selectionKey,
        aliases,
        failures: current.key === selectionKey && !retry ? current.failures : [],
        loading: retry || missingLocalFont(fonts, aliases),
      }
    })
    void Promise.all(
      fonts.map(async (style) => ({
        alias: await loadLocalFont(style.typeface, style.fontStyle, retry),
        face: resolveFontFace(style.typeface, style.fontStyle),
        key: previewFontKey(style),
        local: style.typeface.kind === 'local',
      })),
    ).then((loaded) => {
      if (!active) return
      setResult((current) => ({
        key: selectionKey,
        aliases: {
          ...current.aliases,
          ...Object.fromEntries(loaded.map(({ alias, key }) => [key, alias])),
        },
        failures: loaded
          .filter(({ alias, local }) => local && !alias)
          .map(({ face }) => face.fullName),
        loading: false,
      }))
    })
    return () => {
      active = false
    }
  }, [fonts, retryToken, selectionKey])

  return {
    ...currentResult,
    retry: () =>
      setRetryRequest((current) => ({
        key: selectionKey,
        generation: current.key === selectionKey ? current.generation + 1 : 1,
      })),
  }
}
