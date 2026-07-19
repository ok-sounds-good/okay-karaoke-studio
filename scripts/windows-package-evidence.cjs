'use strict'

const { createHash } = require('node:crypto')
const {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const asar = require('@electron/asar')

const MAX_INSTALLER_BYTES = 300 * 1024 * 1024
const MAX_UNPACKED_BYTES = 600 * 1024 * 1024
const PE_X64_MACHINE = 0x8664
const PROHIBITED_ARCHIVE_PATHS = [
  /^\/tests(?:\/|$)/u,
  /^\/(?:release|\.worktrees)(?:\/|$)/u,
  /(?:^|\/)\.env(?:\.|$)/u,
  /(?:^|\/)[^/]*(?:secret|credential)[^/]*(?:\/|$)/iu,
  /\.(?:oks|log|mp3|wav|m4a|flac|mp4|mov|mkv|avi)$/iu,
]
const PROHIBITED_MEDIA_BINARIES =
  /^(?:ffmpeg|ffprobe)(?:\.exe)?$|(?:^|[-_.])(?:x264|avcodec)(?:[-_.]|$)/iu

function assertOwnedPath(root, candidate, label) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolved)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must be inside the repository root`)
  }
  return resolved
}

async function assertRealPathInside(root, candidate, label) {
  const resolvedRoot = await realpath(root)
  const resolved = await realpath(candidate)
  const relative = path.relative(resolvedRoot, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside the repository root`)
  }
  return resolved
}

async function sha256(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

async function readPeMachine(file) {
  const bytes = await readFile(file)
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`${path.basename(file)} is not a PE executable`)
  }
  const peOffset = bytes.readUInt32LE(0x3c)
  if (
    peOffset + 6 > bytes.length ||
    bytes.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0'
  ) {
    throw new Error(`${path.basename(file)} has an invalid PE header`)
  }
  return bytes.readUInt16LE(peOffset + 4)
}

function authenticodeStatus(file) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-AuthenticodeSignature -LiteralPath $env:OKS_SIGNATURE_PATH).Status.ToString()',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, OKS_SIGNATURE_PATH: file },
      windowsHide: true,
    },
  )
  if (result.error)
    throw new Error(`Could not inspect Authenticode status: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Authenticode inspection failed (exit ${result.status})`)
  return result.stdout.trim()
}

async function directorySize(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Packaged output contains a symlink: ${entry.name}`)
    total += entry.isDirectory() ? await directorySize(entryPath) : (await stat(entryPath)).size
  }
  return total
}

async function unpackedFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Packaged output contains a symlink: ${name}`)
    if (entry.isDirectory()) files.push(...(await unpackedFiles(entryPath, name)))
    else files.push(name)
  }
  return files
}

function listInstallerPayloads(installer) {
  const result = spawnSync('7z', ['l', '-slt', installer], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw new Error(`Could not inspect the NSIS installer: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Could not inspect the NSIS installer (7z exit ${result.status})`)
  }
  return parseInstallerPayloads(`${result.stdout}\n${result.stderr}`)
}

function parseInstallerPayloads(output) {
  const payloads = []
  for (const [name, nsisArchitecture, embeddedArchitecture] of output.matchAll(
    /(?:[^\s\\/]+-(x64|ia32|arm64)\.nsis|app-(64|32|arm64))\.7z/giu,
  )) {
    const rawArchitecture = (nsisArchitecture || embeddedArchitecture).toLowerCase()
    const architecture =
      rawArchitecture === '64' ? 'x64' : rawArchitecture === '32' ? 'ia32' : rawArchitecture
    payloads.push({ name, architecture })
  }
  return payloads
}

function validateArchiveInventory(files) {
  const normalized = files.map((file) => file.replaceAll('\\', '/'))
  for (const required of ['/package.json', '/dist/index.html', '/electron/main.cjs']) {
    if (!normalized.includes(required)) throw new Error(`Packaged app is missing ${required}`)
  }
  const prohibited = normalized.filter((file) =>
    PROHIBITED_ARCHIVE_PATHS.some((pattern) => pattern.test(file)),
  )
  if (prohibited.length > 0)
    throw new Error(`Packaged app contains prohibited files: ${prohibited.join(', ')}`)
  return normalized
}

async function validateWindowsPackage(root = process.cwd()) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const release = assertOwnedPath(root, path.join(root, 'release'), 'Release directory')
  await assertRealPathInside(root, release, 'Release directory')

  const expectedInstallerName = `Okay-Karaoke-Studio-${manifest.version}-x64-setup.exe`
  const installer = assertOwnedPath(root, path.join(release, expectedInstallerName), 'Installer')
  const unpacked = assertOwnedPath(root, path.join(release, 'win-unpacked'), 'Unpacked application')
  await assertRealPathInside(root, installer, 'Installer')
  await assertRealPathInside(root, unpacked, 'Unpacked application')

  const rootEntries = await readdir(release, { withFileTypes: true })
  const installers = rootEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.exe'))
  if (installers.map(({ name }) => name).join() !== expectedInstallerName) {
    throw new Error(`Expected exactly one installer named ${expectedInstallerName}`)
  }
  const unpackedDirectories = rootEntries.filter(
    (entry) => entry.isDirectory() && /^win-.*unpacked$/u.test(entry.name),
  )
  if (unpackedDirectories.map(({ name }) => name).join() !== 'win-unpacked') {
    throw new Error('Expected exactly one win-unpacked application directory')
  }

  const installerBytes = (await stat(installer)).size
  if (installerBytes <= 1024 * 1024 || installerBytes > MAX_INSTALLER_BYTES) {
    throw new Error(`Installer size is outside the allowed bounds: ${installerBytes}`)
  }

  const executable = path.join(unpacked, `${manifest.build.productName}.exe`)
  if ((await readPeMachine(executable)) !== PE_X64_MACHINE) {
    throw new Error('Packaged application executable is not Windows x64')
  }
  const signatures = {
    application: authenticodeStatus(executable),
    installer: authenticodeStatus(installer),
  }
  if (signatures.application !== 'NotSigned' || signatures.installer !== 'NotSigned') {
    throw new Error(`Windows artifacts must be unsigned: ${JSON.stringify(signatures)}`)
  }

  const resources = path.join(unpacked, 'resources')
  const archive = path.join(resources, 'app.asar')
  for (const required of [path.join(unpacked, 'resources.pak'), archive]) {
    if (!(await stat(required)).isFile()) throw new Error(`Missing packaged resource ${required}`)
  }
  const archiveFiles = validateArchiveInventory(asar.listPackage(archive))
  const files = await unpackedFiles(unpacked)
  const bundledMediaTools = files.filter((file) =>
    PROHIBITED_MEDIA_BINARIES.test(path.basename(file)),
  )
  if (bundledMediaTools.length > 0) {
    throw new Error(
      `Packaged output contains external media binaries: ${bundledMediaTools.join(', ')}`,
    )
  }

  const payloads = listInstallerPayloads(installer)
  if (payloads.length !== 1 || payloads[0].architecture !== 'x64') {
    throw new Error(`NSIS installer does not contain exactly one x64 application payload`)
  }

  const unpackedBytes = await directorySize(unpacked)
  if (unpackedBytes > MAX_UNPACKED_BYTES) {
    throw new Error(`Unpacked application exceeds the allowed size: ${unpackedBytes}`)
  }

  const evidence = {
    schemaVersion: 1,
    productVersion: manifest.version,
    architecture: 'x64',
    installer: {
      name: expectedInstallerName,
      bytes: installerBytes,
      sha256: await sha256(installer),
      payload: payloads[0].name,
    },
    unpacked: {
      directory: 'win-unpacked',
      executable: path.basename(executable),
      peMachine: `0x${PE_X64_MACHINE.toString(16)}`,
      bytes: unpackedBytes,
      files: files.length,
      archiveFiles: archiveFiles.length,
    },
    externalMediaBinaries: [],
    signatures,
    published: false,
  }

  const installerArtifact = assertOwnedPath(
    root,
    path.join(release, 'windows-x64-installer'),
    'Installer artifact directory',
  )
  await mkdir(installerArtifact)
  await copyFile(installer, path.join(installerArtifact, expectedInstallerName))
  const evidencePath = assertOwnedPath(
    root,
    path.join(release, 'windows-package-evidence.json'),
    'Evidence file',
  )
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })
  return evidence
}

if (require.main === module) {
  validateWindowsPackage().then(
    (evidence) => process.stdout.write(`${JSON.stringify(evidence)}\n`),
    (error) => {
      process.stderr.write(`${error.stack || error}\n`)
      process.exitCode = 1
    },
  )
}

module.exports = {
  PE_X64_MACHINE,
  assertOwnedPath,
  authenticodeStatus,
  listInstallerPayloads,
  parseInstallerPayloads,
  readPeMachine,
  validateArchiveInventory,
  validateWindowsPackage,
}
