import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { KaraokePreview } from '../src/components/KaraokePreview'
import {
  createLyricLine,
  createLyricWord,
  createProject,
  createVocalTrack,
} from '../src/lib/karaoke'
import { cloneVocalStyle } from '../src/lib/video-style'

const require = createRequire(import.meta.url)
const { frameStateAt } = require('../electron/video-export.cjs') as {
  frameStateAt(project: unknown, playbackMs: number): { showTitle: boolean }
}

function projectWithLineLeadIn() {
  const vocalStyle = cloneVocalStyle()
  vocalStyle.previewMs = 1_500
  vocalStyle.syncAid = { enabled: false, minLeadMs: 1_000, maxLeadMs: 1_500 }
  const mutedEarlierLine = createLyricLine('Muted count-in', {
    startMs: 0,
    endMs: 500,
    words: [createLyricWord('Muted', { startMs: 0, endMs: 500 })],
  })
  const line = createLyricLine('Wait for me', {
    id: 'line-with-lead-in',
    startMs: 2_000,
    endMs: 4_500,
    words: [
      createLyricWord('Wait', { startMs: 3_000, endMs: 3_500 }),
      createLyricWord('for', { startMs: 3_500, endMs: 4_000 }),
      createLyricWord('me', { startMs: 4_000, endMs: 4_500 }),
    ],
  })
  return createProject({
    offsetMs: 800,
    tracks: [
      createVocalTrack({ id: 'muted', muted: true, lines: [mutedEarlierLine] }),
      createVocalTrack({ id: 'lead', vocalStyle, lines: [line] }),
    ],
  })
}

function previewShowsTitle(playbackMs: number) {
  const project = projectWithLineLeadIn()
  const markup = renderToStaticMarkup(
    <KaraokePreview
      project={project}
      playbackMs={playbackMs}
      lyricMs={playbackMs - project.offsetMs}
      selectedWordIds={new Set()}
    />,
  )
  return markup.includes('class="title-card"')
}

describe('Live Preview and MP4 title-card parity', () => {
  it('uses Preview time before the first sung word rather than an earlier line range', () => {
    const project = projectWithLineLeadIn()

    // The first word starts at 3800 ms after offset, so 1500 ms Preview ends the title at 2300 ms.
    for (const playbackMs of [2_299, 2_300]) {
      expect(previewShowsTitle(playbackMs)).toBe(frameStateAt(project, playbackMs).showTitle)
    }
    expect(previewShowsTitle(2_299)).toBe(true)
    expect(previewShowsTitle(2_300)).toBe(false)
  })

  it('keeps the title card visible when no valid timed line exists', () => {
    const project = createProject({
      tracks: [createVocalTrack({ id: 'untimed-lead', lines: [createLyricLine('Still untimed')] })],
    })
    const markup = renderToStaticMarkup(
      <KaraokePreview
        project={project}
        playbackMs={0}
        lyricMs={0}
        selectedWordIds={new Set()}
      />,
    )

    expect(markup).toContain('class="title-card"')
    expect(frameStateAt(project, 0).showTitle).toBe(true)
  })
})
