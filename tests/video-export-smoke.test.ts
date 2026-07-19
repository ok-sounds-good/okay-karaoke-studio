import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const launcher = require('../scripts/video-export-smoke-launcher.cjs') as {
  EXPECTED_MATRIX: Array<{ value: string; width: number; height: number; fps: number }>
  runLauncher(options: Record<string, unknown>, supplied: Record<string, unknown>): Promise<unknown>
  validateManifest(value: unknown): unknown
}
const { countSungPixels } = require('../scripts/video-export-smoke-evidence.cjs') as {
  countSungPixels(decoded: Buffer): number
}
function manifest() {
  return {
    ok: true,
    fixture: { audioSeconds: 0.5, videoSeconds: 1 },
    cancellationPartialPreserved: true,
    cases: launcher.EXPECTED_MATRIX.map((entry, index) => ({
      ordinal: index + 1,
      preset: entry.value,
      fps: entry.fps,
      observedDimensions: { width: entry.width, height: entry.height },
      rationalRate: { average: `${entry.fps}/1`, rendered: `${entry.fps}/1` },
      codecs: { audio: 'aac', video: 'h264' },
      streamStarts: { audioSeconds: 0, videoSeconds: 0 },
      durationSeconds: 1,
      decodedLyricEvidence:
        index < 2
          ? Array.from({ length: 2 }, () => ({
              boundaryFrame: entry.fps === 30 ? 9 : 18,
              observedFrame: entry.fps === 30 ? 10 : 19,
              changedPixels: 12,
              totalDifference: 400,
            }))
          : [{ observedFrame: entry.fps === 30 ? 18 : 36, lyricPixels: 12 }],
      bytes: 1_024,
      sha256: 'a'.repeat(64),
    })),
  }
}
describe('video export smoke launcher', () => {
  it('distinguishes decoded sung magenta from blank grayscale samples', () => {
    expect(countSungPixels(Buffer.alloc(30, 110))).toBe(0)
    expect(countSungPixels(Buffer.from([130, 80, 140, 99, 0, 140]))).toBe(1)
  })
  it('derives the exact resolution-major, fps-minor 14-case matrix', () => {
    expect(launcher.EXPECTED_MATRIX.map(({ value, fps }) => `${value}/${fps}`)).toEqual([
      '240p/30',
      '240p/60',
      '360p/30',
      '360p/60',
      '480p/30',
      '480p/60',
      '720p/30',
      '720p/60',
      '1080p/30',
      '1080p/60',
      '1440p/30',
      '1440p/60',
      '2160p/30',
      '2160p/60',
    ])
    expect(launcher.validateManifest(manifest())).toEqual(manifest())
  })
  it('rejects a partial or reordered manifest', () => {
    const partial = manifest()
    partial.cases.pop()
    expect(() => launcher.validateManifest(partial)).toThrow('invalid manifest envelope')
    const reordered = manifest()
    ;[reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]]
    expect(() => launcher.validateManifest(reordered)).toThrow('invalid case 1')
    const missingTiming = manifest()
    delete (missingTiming.cases[0].streamStarts as { videoSeconds?: number }).videoSeconds
    expect(() => launcher.validateManifest(missingTiming)).toThrow('invalid case 1')
    const invalidDuration = manifest()
    invalidDuration.cases[0].durationSeconds = Number.NaN
    expect(() => launcher.validateManifest(invalidDuration)).toThrow('invalid case 1')
    const delayedStarts = manifest()
    delayedStarts.cases[0].streamStarts = { audioSeconds: 0.25, videoSeconds: 0.25 }
    expect(() => launcher.validateManifest(delayedStarts)).toThrow('invalid case 1')
  })
  it('cleans its owned root after a child timeout without publishing a manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oks-video-launcher-test-'))
    const runChild = vi.fn(async () => ({ timedOut: true }))
    const result = await launcher.runLauncher({}, { createRoot: async () => root, runChild })
    expect(result).toEqual({ code: 'VIDEO_SMOKE_TIMEOUT', ok: false })
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(runChild).toHaveBeenCalledOnce()
    await expect(writeFile(join(root, 'result.json'), '{}')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('returns bounded case identity and diagnostics from a failed child, then cleans', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oks-video-launcher-failure-'))
    const failure = {
      ok: false,
      code: 'VIDEO_SMOKE_CHILD_FAILED',
      case: { ordinal: 14, preset: '2160p', fps: 60, phase: 'probe' },
      diagnostic: 'observed stream contract does not match requested output',
    }
    const runChild = vi.fn(async () => {
      await writeFile(join(root, 'failure.json'), JSON.stringify(failure))
      return { code: 1 }
    })
    await expect(
      launcher.runLauncher({}, { createRoot: async () => root, runChild }),
    ).resolves.toEqual(failure)
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
