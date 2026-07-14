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

const require = createRequire(import.meta.url)
const { frameStateAt } = require('../electron/video-export.cjs') as {
  frameStateAt(project: unknown, playbackMs: number): { showTitle: boolean }
}

function projectWithLineLeadIn() {
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
      createVocalTrack({ id: 'lead', lines: [line] }),
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
  it('uses the offset-adjusted line lead-in rather than the later first word', () => {
    const project = projectWithLineLeadIn()

    // The adjusted line starts at 2800 ms, so its 1500 ms title lead ends at 1300 ms.
    for (const playbackMs of [1_299, 1_300, 2_299]) {
      expect(previewShowsTitle(playbackMs)).toBe(frameStateAt(project, playbackMs).showTitle)
    }
    expect(previewShowsTitle(1_299)).toBe(true)
    expect(previewShowsTitle(1_300)).toBe(false)
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
