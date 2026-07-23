import type { ProjectStyleDraft } from '../hooks/useProjectStyleSession'
import type { StyleTemplate, StyleTemplatePreferences } from './style-template-codec'
import { cloneStageStyle, cloneVocalStyle } from './video-style'
import {
  VOCAL_STYLE_TIMING_ERROR,
  vocalStyleTimingDraft,
  vocalStyleWithTiming,
} from './vocal-style-timing'

export function captureStyleTemplatePreferences(
  draft: ProjectStyleDraft,
): StyleTemplatePreferences {
  const vocalStyle = vocalStyleWithTiming(draft.vocalStyle, draft.vocalTiming)
  if (!vocalStyle) throw new Error(VOCAL_STYLE_TIMING_ERROR)

  return {
    stageStyle: cloneStageStyle(draft.stageStyle),
    lyricDisplay: { ...draft.lyricDisplay },
    vocalStyle,
    videoExportDefaults: { ...draft.videoExportDefaults },
  }
}

export function loadStyleTemplateIntoDraft(
  draft: ProjectStyleDraft,
  template: Pick<StyleTemplate, 'preferences'>,
): ProjectStyleDraft {
  const preferences = template.preferences
  const vocalStyle = cloneVocalStyle(preferences.vocalStyle)
  return {
    ...draft,
    stageStyle: cloneStageStyle(preferences.stageStyle),
    lyricDisplay: { ...preferences.lyricDisplay },
    vocalStyle,
    vocalTiming: vocalStyleTimingDraft(vocalStyle),
    videoExportDefaults: { ...preferences.videoExportDefaults },
  }
}
