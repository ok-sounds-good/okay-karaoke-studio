'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const electronExecutable = require('electron')
const {
  createOwnedSmokeProfile,
  verifyRetainedSmokeProfile,
} = require('../electron/smoke-profile.cjs')
const {
  outputState,
  validateFreshOutputPath,
  writeFreshLauncherFailure,
} = require('../electron/smoke-artifacts.cjs')
const { publicChildOutcomeCode, publicStatusLine, runBoundedChild } = require('./bounded-child.cjs')
const {
  BASELINE_SCENARIO,
  PROJECT_TYPOGRAPHY_SCENARIO,
  validateVisualResultDirectory,
} = require('./visual-result-validation.cjs')
const { FATAL_DIAGNOSTIC, OPTIONS, TRIGGER } = require('../electron/video-style-visual-smoke.cjs')

const REPOSITORY_ROOT = path.resolve(__dirname, '..')
const OUTPUT_ENVIRONMENT_KEY = 'OKS_VISUAL_EVIDENCE_DIR'
const SCENARIO_ARGUMENT = '--scenario='
const DEFAULT_TIMEOUT_MS = 45_000
const MAX_DIAGNOSTIC_BYTES = 64 * 1024
const FATAL_DIAGNOSTIC_PATTERNS = Object.freeze([
  FATAL_DIAGNOSTIC.trim(),
  'Uncaught ',
  'UnhandledPromiseRejection',
  'Unhandled Rejection',
  'TypeError: Object has been destroyed',
  'Fatal error',
  'FATAL:',
  'CHECK failed',
])

function capturedFatalDiagnostic(stdout, stderr) {
  const captured = Buffer.concat([stdout, Buffer.from('\n'), stderr]).toString('utf8')
  const normalized = captured.toLocaleLowerCase('en-US')
  return FATAL_DIAGNOSTIC_PATTERNS.some((pattern) =>
    normalized.includes(pattern.toLocaleLowerCase('en-US')),
  )
}

function launcherError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function requestedOutput(argv, environment, fsApi = fs) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
  if (argv.length > 1 || (argv.length === 1 && environment[OUTPUT_ENVIRONMENT_KEY])) {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
  let rawOutput = argv[0] || environment[OUTPUT_ENVIRONMENT_KEY]
  if (!rawOutput) {
    const root = await fsApi.mkdtemp(path.join(os.tmpdir(), 'oks-visual-evidence-'))
    rawOutput = path.join(root, 'video-style')
  }
  try {
    return validateFreshOutputPath(rawOutput)
  } catch {
    throw launcherError('VISUAL_SMOKE_OUTPUT_INVALID')
  }
}

function requestedScenario(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  const scenarioArguments = argv.filter((value) => value.startsWith('--scenario'))
  if (scenarioArguments.length === 0) return BASELINE_SCENARIO
  if (
    scenarioArguments.length !== 1 ||
    scenarioArguments[0] !== `${SCENARIO_ARGUMENT}${PROJECT_TYPOGRAPHY_SCENARIO}`
  ) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  return PROJECT_TYPOGRAPHY_SCENARIO
}

async function requestedRun(argv, environment, fsApi = fs) {
  const scenario = requestedScenario(argv)
  const outputArguments = argv.filter((value) => !value.startsWith('--scenario'))
  const output = await requestedOutput(outputArguments, environment, fsApi)
  return Object.freeze({ output, scenario })
}

async function claimFreshOutput(rawOutput, dependencies = {}) {
  const state = await (dependencies.outputState || outputState)(rawOutput)
  if (state.state !== 'absent') throw launcherError('VISUAL_SMOKE_OUTPUT_EXISTS')
  return state.output
}

function childArguments(output, scenario, userProfile, sessionProfile) {
  if (scenario !== BASELINE_SCENARIO && scenario !== PROJECT_TYPOGRAPHY_SCENARIO) {
    throw launcherError('VISUAL_SMOKE_SCENARIO_INVALID')
  }
  return Object.freeze([
    REPOSITORY_ROOT,
    TRIGGER,
    `${OPTIONS.output}${output}`,
    `${OPTIONS.scenario}${scenario}`,
    `${OPTIONS.userData}${userProfile.path}`,
    `${OPTIONS.userIdentity}${userProfile.serializedIdentity}`,
    `${OPTIONS.sessionData}${sessionProfile.path}`,
    `${OPTIONS.sessionIdentity}${sessionProfile.serializedIdentity}`,
  ])
}

async function retainProfiles(profiles, verify) {
  const results = await Promise.allSettled(profiles.map((profile) => verify(profile)))
  return results.every((result) => result.status === 'fulfilled')
}

async function publishLauncherFailure(output, code, dependencies) {
  const safeCode =
    typeof code === 'string' && code.startsWith('VISUAL_SMOKE_')
      ? code
      : 'VISUAL_SMOKE_LAUNCHER_FAILED'
  const current = await dependencies.outputState(output)
  if (current.state === 'absent') {
    try {
      await dependencies.writeFailure(output, { code: safeCode, ok: false })
    } catch {
      return 'VISUAL_SMOKE_OUTPUT_INVALID'
    }
  }
  return safeCode
}

async function runLauncher(options = {}, supplied = {}) {
  const dependencies = {
    createProfile: supplied.createProfile || createOwnedSmokeProfile,
    outputState: supplied.outputState || outputState,
    runChild: supplied.runChild || runBoundedChild,
    validateResult: supplied.validateResult || validateVisualResultDirectory,
    verifyProfile: supplied.verifyProfile || verifyRetainedSmokeProfile,
    writeFailure: supplied.writeFailure || writeFreshLauncherFailure,
  }
  const argv = options.argv || []
  const environment = options.environment || {}
  let output
  let scenario
  let profiles = []
  let failureCode = null

  try {
    const request = await requestedRun(argv, environment, options.fsApi || fs)
    output = request.output
    scenario = request.scenario
    output = await claimFreshOutput(output, dependencies)
    const userProfile = await dependencies.createProfile('oks-visual-user-data-')
    profiles.push(userProfile)
    const sessionProfile = await dependencies.createProfile('oks-visual-session-data-')
    profiles.push(sessionProfile)

    const outcome = await dependencies.runChild({
      executable: options.executable || electronExecutable,
      args: childArguments(output, scenario, userProfile, sessionProfile),
      captureOutput: {
        classify: capturedFatalDiagnostic,
        maxBytesPerStream: MAX_DIAGNOSTIC_BYTES,
      },
      spawnOptions: { cwd: REPOSITORY_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    })
    failureCode = publicChildOutcomeCode('VISUAL_SMOKE', outcome)
    if (
      !failureCode &&
      (outcome?.diagnostics?.fatal !== false || outcome?.diagnostics?.overflow !== false)
    ) {
      failureCode = 'VISUAL_SMOKE_CHILD_FAILED'
    }
    if (!(await retainProfiles(profiles, dependencies.verifyProfile))) {
      failureCode = 'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED'
    }
    if (failureCode) {
      failureCode = await publishLauncherFailure(output, failureCode, dependencies)
      return Object.freeze({ code: failureCode, ok: false })
    }
    try {
      await dependencies.validateResult(output, { scenario })
    } catch {
      failureCode = 'VISUAL_SMOKE_RESULT_INVALID'
      return Object.freeze({ code: failureCode, ok: false })
    }
    return Object.freeze({ ok: true })
  } catch (error) {
    failureCode = typeof error?.code === 'string' ? error.code : 'VISUAL_SMOKE_LAUNCHER_FAILED'
    if (output) failureCode = await publishLauncherFailure(output, failureCode, dependencies)
    if (profiles.length > 0 && !(await retainProfiles(profiles, dependencies.verifyProfile))) {
      failureCode = 'VISUAL_SMOKE_PROFILE_IDENTITY_FAILED'
    }
    return Object.freeze({ code: failureCode, ok: false })
  }
}

async function main() {
  const outcome = await runLauncher({
    argv: process.argv.slice(2),
    environment: process.env,
  })
  if (outcome.ok) {
    process.stdout.write('{"ok":true}\n')
    return 0
  }
  process.stderr.write(`${publicStatusLine(outcome.code)}\n`)
  return 1
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    () => {
      process.stderr.write(`${publicStatusLine('VISUAL_SMOKE_LAUNCHER_FAILED')}\n`)
      process.exitCode = 1
    },
  )
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_DIAGNOSTIC_BYTES,
  OUTPUT_ENVIRONMENT_KEY,
  REPOSITORY_ROOT,
  SCENARIO_ARGUMENT,
  childArguments,
  claimFreshOutput,
  requestedOutput,
  requestedRun,
  requestedScenario,
  runLauncher,
}
