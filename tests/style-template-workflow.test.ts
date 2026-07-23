import { describe, expect, it } from 'vitest'
import { createProjectStyleDraft } from '../src/hooks/useProjectStyleSession'
import {
  captureStyleTemplatePreferences,
  loadStyleTemplateIntoDraft,
} from '../src/lib/style-template-workflow'
import { cloneStageStyle, cloneVocalStyle } from '../src/lib/video-style'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../src/lib/video-export-settings'
import { VOCAL_STYLE_TIMING_ERROR } from '../src/lib/vocal-style-timing'

function draft() {
  return createProjectStyleDraft(
    cloneStageStyle(),
    cloneVocalStyle(),
    { lineCount: 3, advanceMode: 'scroll' },
    { resolution: '1080p', fps: 60 },
  )
}

describe('style template workflow helpers', () => {
  it('captures all template-owned groups as isolated values', () => {
    const source = draft()
    source.vocalTiming = { previewMs: '4321', minLeadMs: '2100', maxLeadMs: '3200' }
    const preferences = captureStyleTemplatePreferences(source)

    expect(preferences).toMatchObject({
      lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
      vocalStyle: {
        previewMs: 4_321,
        syncAid: { minLeadMs: 2_100, maxLeadMs: 3_200 },
      },
      videoExportDefaults: { resolution: '1080p', fps: 60 },
    })
    preferences.stageStyle.background.solidColor = '#010203'
    preferences.lyricDisplay.lineCount = 1
    preferences.vocalStyle.syncAid.enabled = true
    preferences.videoExportDefaults.fps = 30

    expect(source.stageStyle.background.solidColor).not.toBe('#010203')
    expect(source.lyricDisplay.lineCount).toBe(3)
    expect(source.vocalStyle.syncAid.enabled).toBe(false)
    expect(source.videoExportDefaults.fps).toBe(60)
  })

  it('loads only template-owned groups and synchronizes editable vocal timing text', () => {
    const source = draft()
    source.vocalTiming.previewMs = '4321'
    const vocalStyle = cloneVocalStyle()
    vocalStyle.previewMs = 5_500
    vocalStyle.syncAid.minLeadMs = 2_500
    vocalStyle.syncAid.maxLeadMs = 4_500
    const loaded = loadStyleTemplateIntoDraft(source, {
      preferences: {
        stageStyle: cloneStageStyle(),
        lyricDisplay: { lineCount: 1, advanceMode: 'clear' },
        vocalStyle,
        videoExportDefaults: { ...DEFAULT_VIDEO_EXPORT_SETTINGS },
      },
    })

    expect(loaded.lyricDisplay).toEqual({ lineCount: 1, advanceMode: 'clear' })
    expect(loaded.videoExportDefaults).toEqual(DEFAULT_VIDEO_EXPORT_SETTINGS)
    expect(loaded.vocalTiming).toEqual({
      previewMs: '5500',
      minLeadMs: '2500',
      maxLeadMs: '4500',
    })
    expect(loaded.stageStyle).not.toBe(source.stageStyle)
    expect(loaded.vocalStyle).not.toBe(source.vocalStyle)
  })

  it('rejects saving a draft whose editable vocal timing is invalid', () => {
    const source = draft()
    source.vocalTiming.previewMs = ''

    expect(() => captureStyleTemplatePreferences(source)).toThrow(VOCAL_STYLE_TIMING_ERROR)
  })
})
