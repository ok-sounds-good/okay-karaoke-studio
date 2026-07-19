const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const electronExecutable = require('electron')
const presets = require('../electron/video-export-presets.json')
const { publicChildOutcomeCode, publicStatusLine, runBoundedChild } = require('./bounded-child.cjs')
const REPOSITORY_ROOT = path.resolve(__dirname, '..')
const ROOT_ENVIRONMENT_KEY = 'OKS_VIDEO_SMOKE_ROOT'
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000
const MAX_CAPTURE_BYTES = 64 * 1_024
const EXPECTED_MATRIX = presets.resolutions.flatMap((preset) =>
  presets.frameRates.map((fps) => ({ ...preset, fps })),
)
function validTransition(value, boundaryFrame) {
  return (
    value &&
    value.boundaryFrame === boundaryFrame &&
    value.observedFrame === value.boundaryFrame + 1 &&
    Number.isSafeInteger(value.changedPixels) &&
    value.changedPixels > 0 &&
    Number.isSafeInteger(value.totalDifference) &&
    value.totalDifference > 0
  )
}
function validateManifest(value) {
  if (
    !value ||
    value.ok !== true ||
    value.cancellationPartialPreserved !== true ||
    value.fixture?.audioSeconds !== 0.5 ||
    value.fixture?.videoSeconds !== 1 ||
    !Array.isArray(value.cases) ||
    value.cases.length !== EXPECTED_MATRIX.length
  ) {
    throw new Error('invalid manifest envelope')
  }
  value.cases.forEach((item, index) => {
    const expected = EXPECTED_MATRIX[index]
    if (
      item?.ordinal !== index + 1 ||
      item.preset !== expected.value ||
      item.fps !== expected.fps ||
      item.observedDimensions?.width !== expected.width ||
      item.observedDimensions?.height !== expected.height ||
      item.codecs?.video !== 'h264' ||
      item.codecs?.audio !== 'aac' ||
      item.rationalRate?.average !== String(expected.fps) + '/1' ||
      item.rationalRate?.rendered !== String(expected.fps) + '/1' ||
      !Number.isFinite(item.streamStarts?.videoSeconds) ||
      !Number.isFinite(item.streamStarts?.audioSeconds) ||
      Math.abs(item.streamStarts.videoSeconds) > 0.001 ||
      Math.abs(item.streamStarts.audioSeconds) > 0.001 ||
      Math.abs(item.streamStarts?.videoSeconds - item.streamStarts?.audioSeconds) > 0.001 ||
      !Number.isFinite(item.durationSeconds) ||
      Math.abs(item.durationSeconds - 1) > 0.05 ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      !/^[0-9a-f]{64}$/u.test(item.sha256) ||
      !Array.isArray(item.decodedLyricEvidence) ||
      item.decodedLyricEvidence.length !== (index < 2 ? 2 : 1) ||
      !(index < 2
        ? item.decodedLyricEvidence.every((evidence, evidenceIndex) =>
            validTransition(evidence, item.fps * [0.5, 0.7][evidenceIndex]),
          )
        : item.decodedLyricEvidence.every(
            (evidence) =>
              evidence?.observedFrame === (900 * item.fps) / 1_000 &&
              Number.isSafeInteger(evidence.lyricPixels) &&
              evidence.lyricPixels > 0,
          ))
    ) {
      throw new Error(`invalid case ${index + 1}`)
    }
  })
  return value
}
function validFailure(value) {
  const expected = value?.case?.ordinal > 0 ? EXPECTED_MATRIX[value.case.ordinal - 1] : null
  return (
    value?.ok === false &&
    value.code === 'VIDEO_SMOKE_CHILD_FAILED' &&
    Number.isSafeInteger(value.case?.ordinal) &&
    value.case.ordinal >= 0 &&
    value.case.ordinal <= EXPECTED_MATRIX.length &&
    typeof value.case?.phase === 'string' &&
    value.case.phase.length <= 24 &&
    typeof value.diagnostic === 'string' &&
    value.diagnostic.length <= 400 &&
    (!expected || (value.case.preset === expected.value && value.case.fps === expected.fps))
  )
}
async function readJson(root, name) {
  return JSON.parse(await fs.readFile(path.join(root, name), 'utf8'))
}
async function runLauncher(options = {}, supplied = {}) {
  const fsApi = options.fsApi || fs
  const createRoot =
    supplied.createRoot || (() => fsApi.mkdtemp(path.join(os.tmpdir(), 'oks-video-')))
  const runChild = supplied.runChild || runBoundedChild
  let root
  let result
  try {
    root = await createRoot()
    const outcome = await runChild({
      executable: options.executable || electronExecutable,
      args: [path.join(REPOSITORY_ROOT, 'scripts', 'video-export-smoke.cjs')],
      captureOutput: {
        classify: () => false,
        maxBytesPerStream: MAX_CAPTURE_BYTES,
      },
      spawnOptions: {
        cwd: REPOSITORY_ROOT,
        env: { ...process.env, [ROOT_ENVIRONMENT_KEY]: root },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    })
    const code = publicChildOutcomeCode('VIDEO_SMOKE', outcome)
    if (code) {
      const failure = await readJson(root, 'failure.json').catch(() => null)
      result = validFailure(failure) ? failure : { ok: false, code }
    } else {
      result = validateManifest(await readJson(root, 'result.json'))
    }
  } catch {
    result = { ok: false, code: 'VIDEO_SMOKE_LAUNCHER_FAILED' }
  } finally {
    if (root) {
      try {
        await fsApi.rm(root, { recursive: true, force: true })
      } catch {
        result = { ok: false, code: 'VIDEO_SMOKE_CLEANUP_FAILED' }
      }
    }
  }
  return result
}
async function main() {
  const result = await runLauncher()
  const line = JSON.stringify(result)
  ;(result.ok ? process.stdout : process.stderr).write(`${line}\n`)
  return result.ok ? 0 : 1
}
if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    () => {
      process.stderr.write(`${publicStatusLine('VIDEO_SMOKE_LAUNCHER_FAILED')}\n`)
      process.exitCode = 1
    },
  )
}
module.exports = { DEFAULT_TIMEOUT_MS, EXPECTED_MATRIX, runLauncher, validateManifest }
