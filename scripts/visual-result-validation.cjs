'use strict'

const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { PNG_LIMITS, parseBoundedPngContainer } = require('../electron/png-validation.cjs')
const { validateFreshOutputPath } = require('../electron/smoke-artifacts.cjs')

const BASELINE_SCENARIO = 'baseline'
const PROJECT_TYPOGRAPHY_SCENARIO = 'project-typography'
const BASELINE_NAME = '01-baseline.png'
const PROJECT_TYPOGRAPHY_NAMES = Object.freeze([
  '01-project-typography-1280x720.png',
  '02-project-typography-1440x900.png',
])
const RESULT_NAME = 'result.json'
const EXPECTED_FILES = Object.freeze([BASELINE_NAME, RESULT_NAME])
const VIEWPORT = Object.freeze({ height: 720, width: 1280 })
const PROJECT_TYPOGRAPHY_VIEWPORTS = Object.freeze([
  VIEWPORT,
  Object.freeze({ height: 900, width: 1440 }),
])
const SCENARIO_CONTRACTS = Object.freeze({
  [BASELINE_SCENARIO]: Object.freeze([Object.freeze({ ...VIEWPORT, name: BASELINE_NAME })]),
  [PROJECT_TYPOGRAPHY_SCENARIO]: Object.freeze(
    PROJECT_TYPOGRAPHY_VIEWPORTS.map((viewport, index) =>
      Object.freeze({ ...viewport, name: PROJECT_TYPOGRAPHY_NAMES[index] }),
    ),
  ),
})
const MAX_RESULT_BYTES = 16 * 1024
const WORKFLOW_EVIDENCE_NAME = 'okay-karaoke-studio-video-style-visual'
const WORKFLOW_PATH_ARGUMENT = '--emit-workflow-evidence-path'

function resultError() {
  const error = new Error('VISUAL_SMOKE_RESULT_INVALID')
  error.code = 'VISUAL_SMOKE_RESULT_INVALID'
  return error
}

function statIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) }
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

function stableDirectoryEvidence(stats) {
  return Object.freeze({
    ...statIdentity(stats),
    ctimeNs: String(stats.ctimeNs),
    mtimeNs: String(stats.mtimeNs),
  })
}

function sameStableDirectoryEvidence(left, right) {
  return Boolean(
    sameIdentity(left, right) && left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs,
  )
}

function stableFileEvidence(stats) {
  return Object.freeze({
    ...statIdentity(stats),
    ctimeNs: String(stats.ctimeNs),
    mtimeNs: String(stats.mtimeNs),
    size: String(stats.size),
  })
}

function sameStableFileEvidence(left, right) {
  return Boolean(
    sameIdentity(left, right) &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs &&
    left.size === right.size,
  )
}

function workflowEvidencePath(rawTemporaryRoot, pathApi = path) {
  try {
    if (
      typeof rawTemporaryRoot !== 'string' ||
      !rawTemporaryRoot ||
      !pathApi ||
      typeof pathApi.resolve !== 'function' ||
      typeof pathApi.join !== 'function' ||
      pathApi.resolve(rawTemporaryRoot) !== rawTemporaryRoot
    )
      throw resultError()
    const output = pathApi.join(rawTemporaryRoot, WORKFLOW_EVIDENCE_NAME)
    if (/[\r\n]/u.test(output)) throw resultError()
    return validateFreshOutputPath(output, pathApi)
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

async function writeWorkflowEvidencePath(environment = process.env, fsApi = fs, pathApi = path) {
  try {
    const githubOutput = environment?.GITHUB_OUTPUT
    if (
      typeof githubOutput !== 'string' ||
      !githubOutput ||
      githubOutput.includes('\0') ||
      /[\r\n]/u.test(githubOutput)
    )
      throw resultError()
    const output = workflowEvidencePath(environment.RUNNER_TEMP, pathApi)
    await fsApi.appendFile(githubOutput, `path=${output}\n`, 'utf8')
    return output
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

function plainDataObject(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw resultError()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))) {
    throw resultError()
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function scenarioContract(scenario) {
  if (typeof scenario !== 'string' || !Object.hasOwn(SCENARIO_CONTRACTS, scenario)) {
    throw resultError()
  }
  return SCENARIO_CONTRACTS[scenario]
}

function expectedFilesForScenario(scenario) {
  return Object.freeze([...scenarioContract(scenario).map(({ name }) => name), RESULT_NAME].sort())
}

function validatePng(bytes, expected) {
  if (!Buffer.isBuffer(bytes)) throw resultError()
  let parsed
  try {
    parsed = parseBoundedPngContainer(bytes)
  } catch {
    throw resultError()
  }
  if (parsed.animated || parsed.width !== expected.width || parsed.height !== expected.height)
    throw resultError()
  return Object.freeze({
    bytes: bytes.length,
    height: parsed.height,
    name: expected.name,
    sha256: sha256(bytes),
    width: parsed.width,
  })
}

function validateBaselinePng(bytes) {
  return validatePng(bytes, scenarioContract(BASELINE_SCENARIO)[0])
}

function normalizeManifest(value, scenario = BASELINE_SCENARIO) {
  const contract = scenarioContract(scenario)
  const manifest = plainDataObject(value, ['artifacts', 'ok', 'schemaVersion'])
  if (
    manifest.ok !== true ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== contract.length
  )
    throw resultError()
  const artifacts = manifest.artifacts.map((value, index) => {
    const expected = contract[index]
    const artifact = plainDataObject(value, ['bytes', 'height', 'name', 'sha256', 'width'])
    if (
      artifact.name !== expected.name ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      artifact.bytes > PNG_LIMITS.maxBytes ||
      artifact.width !== expected.width ||
      artifact.height !== expected.height ||
      typeof artifact.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(artifact.sha256)
    )
      throw resultError()
    return Object.freeze(artifact)
  })
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    ok: true,
    schemaVersion: 1,
  })
}

function serializeManifest(manifest, scenario = BASELINE_SCENARIO) {
  return `${JSON.stringify(normalizeManifest(manifest, scenario))}\n`
}

function createScenarioResultArtifacts(scenario, pngBytes) {
  const contract = scenarioContract(scenario)
  if (!Array.isArray(pngBytes) || pngBytes.length !== contract.length) throw resultError()
  const manifest = normalizeManifest(
    {
      artifacts: pngBytes.map((bytes, index) => validatePng(bytes, contract[index])),
      ok: true,
      schemaVersion: 1,
    },
    scenario,
  )
  return Object.freeze({
    artifacts: Object.freeze([
      ...pngBytes.map((bytes, index) =>
        Object.freeze({ bytes: Buffer.from(bytes), name: contract[index].name }),
      ),
      Object.freeze({
        bytes: Buffer.from(serializeManifest(manifest, scenario)),
        name: RESULT_NAME,
      }),
    ]),
    manifest,
  })
}

function createResultArtifacts(pngBytes) {
  return createScenarioResultArtifacts(BASELINE_SCENARIO, [pngBytes])
}

async function assertDirectory(identity, fsApi) {
  try {
    const realPath = await fsApi.realpath(identity.output)
    const stats = await fsApi.lstat(identity.output, { bigint: true })
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !sameStableDirectoryEvidence(stableDirectoryEvidence(stats), identity) ||
      realPath !== identity.realPath
    )
      throw resultError()
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

async function readRegularFile(identity, name, limit, options, fsApi) {
  const filePath = path.join(identity.output, name)
  await options.beforeRead?.(identity.output, name)
  await assertDirectory(identity, fsApi)
  let handle
  try {
    const linked = await fsApi.lstat(filePath, { bigint: true })
    if (!linked.isFile() || linked.isSymbolicLink() || linked.size > BigInt(limit)) {
      throw resultError()
    }
    handle = await fsApi.open(filePath, 'r')
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile() ||
      !sameStableFileEvidence(stableFileEvidence(linked), stableFileEvidence(opened))
    ) {
      throw resultError()
    }
    const bytes = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    if (
      bytes.length !== Number(afterRead.size) ||
      !sameStableFileEvidence(stableFileEvidence(opened), stableFileEvidence(afterRead))
    )
      throw resultError()
    await handle.close()
    handle = null
    const finalLink = await fsApi.lstat(filePath, { bigint: true })
    if (
      !finalLink.isFile() ||
      finalLink.isSymbolicLink() ||
      !sameStableFileEvidence(stableFileEvidence(afterRead), stableFileEvidence(finalLink))
    )
      throw resultError()
    await assertDirectory(identity, fsApi)
    return Object.freeze({
      bytes,
      evidence: stableFileEvidence(afterRead),
      name,
    })
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  } finally {
    await handle?.close()
  }
}

async function revalidateRegularFile(identity, original, fsApi) {
  const current = await readRegularFile(identity, original.name, original.bytes.length, {}, fsApi)
  if (
    !sameStableFileEvidence(original.evidence, current.evidence) ||
    !original.bytes.equals(current.bytes)
  )
    throw resultError()
}

function authoritativeArtifacts(consumedFiles) {
  const [resultFile, ...pngFiles] = consumedFiles
  return Object.freeze(
    [...pngFiles, resultFile].map(({ bytes, name }) =>
      Object.freeze({ bytes: Buffer.from(bytes), name }),
    ),
  )
}

async function validateVisualResultDirectory(rawOutput, options = {}) {
  const fsApi = options.fsApi || fs
  const scenario = options.scenario ?? BASELINE_SCENARIO
  const contract = scenarioContract(scenario)
  const expectedFiles = expectedFilesForScenario(scenario)
  let output
  try {
    output = validateFreshOutputPath(rawOutput)
    const stats = await fsApi.lstat(output, { bigint: true })
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw resultError()
    const identity = {
      ...stableDirectoryEvidence(stats),
      output,
      realPath: await fsApi.realpath(output),
    }
    await assertDirectory(identity, fsApi)
    const names = (await fsApi.readdir(output)).sort()
    if (names.join(',') !== expectedFiles.join(',')) throw resultError()

    const consumedFiles = []
    const resultFile = await readRegularFile(
      identity,
      RESULT_NAME,
      MAX_RESULT_BYTES,
      options,
      fsApi,
    )
    consumedFiles.push(resultFile)
    const resultBytes = resultFile.bytes
    let parsed
    try {
      parsed = JSON.parse(resultBytes.toString('utf8'))
    } catch {
      throw resultError()
    }
    const manifest = normalizeManifest(parsed, scenario)
    if (!resultBytes.equals(Buffer.from(serializeManifest(manifest, scenario)))) throw resultError()

    for (const [index, expected] of contract.entries()) {
      const pngFile = await readRegularFile(
        identity,
        expected.name,
        manifest.artifacts[index].bytes,
        options,
        fsApi,
      )
      consumedFiles.push(pngFile)
      const pngBytes = pngFile.bytes
      const actual = validatePng(pngBytes, expected)
      if (
        actual.bytes !== manifest.artifacts[index].bytes ||
        actual.sha256 !== manifest.artifacts[index].sha256
      )
        throw resultError()
    }
    // These private copies, not the mutable child-output paths, are the bytes
    // the launcher is authorized to publish after validation succeeds.
    const publishedArtifacts = authoritativeArtifacts(consumedFiles)
    for (const consumed of consumedFiles) {
      await revalidateRegularFile(identity, consumed, fsApi)
    }
    // A concurrent diagnostic pass catches a leaf changed while a later leaf
    // was being checked above. Publication safety does not depend on this pass:
    // a still-later source mutation cannot change publishedArtifacts.
    await Promise.all(
      consumedFiles.map((consumed) => revalidateRegularFile(identity, consumed, fsApi)),
    )
    if ((await fsApi.readdir(output)).sort().join(',') !== expectedFiles.join(',')) {
      throw resultError()
    }
    await assertDirectory(identity, fsApi)
    return Object.freeze({
      ...manifest,
      publishedArtifacts,
    })
  } catch (error) {
    if (error?.code === 'VISUAL_SMOKE_RESULT_INVALID') throw error
    throw resultError()
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] !== WORKFLOW_PATH_ARGUMENT) throw resultError()
  await writeWorkflowEvidencePath()
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('VISUAL_SMOKE_RESULT_INVALID\n')
    process.exitCode = 1
  })
}

module.exports = {
  BASELINE_SCENARIO,
  BASELINE_NAME,
  EXPECTED_FILES,
  PROJECT_TYPOGRAPHY_NAMES,
  PROJECT_TYPOGRAPHY_SCENARIO,
  PROJECT_TYPOGRAPHY_VIEWPORTS,
  RESULT_NAME,
  SCENARIO_CONTRACTS,
  VIEWPORT,
  createResultArtifacts,
  createScenarioResultArtifacts,
  expectedFilesForScenario,
  normalizeManifest,
  scenarioContract,
  serializeManifest,
  validateBaselinePng,
  validateVisualResultDirectory,
  workflowEvidencePath,
  writeWorkflowEvidencePath,
}
