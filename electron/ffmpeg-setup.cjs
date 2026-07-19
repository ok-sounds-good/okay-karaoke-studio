'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

const MAX_PROCESS_OUTPUT = 128 * 1024
const REQUIRED_ENCODERS = Object.freeze(['libx264', 'aac'])
const WINGET_PACKAGE_ID = 'Gyan.FFmpeg'
const HELP_URLS = Object.freeze({
  darwin: 'https://brew.sh/',
  linux: 'https://ffmpeg.org/download.html#build-linux',
  win32: 'https://ffmpeg.org/download.html#build-windows',
  other: 'https://ffmpeg.org/download.html',
})

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))]
}

function ffmpegExecutableCandidates({
  preferredPath,
  platform = process.platform,
  env = process.env,
} = {}) {
  const candidates = [preferredPath, env.OKAY_KARAOKE_FFMPEG, 'ffmpeg']
  if (platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  } else if (platform === 'win32') {
    if (env.LOCALAPPDATA) {
      candidates.push(
        path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
      )
    }
    if (env.ProgramFiles) {
      candidates.push(path.win32.join(env.ProgramFiles, 'WinGet', 'Links', 'ffmpeg.exe'))
    }
  } else if (platform === 'linux') {
    candidates.push('/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  }
  return uniqueStrings(candidates)
}

function packageManagerCandidates({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'darwin') {
    return uniqueStrings(['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew'])
  }
  if (platform === 'win32') {
    return uniqueStrings([
      'winget',
      env.LOCALAPPDATA
        ? path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'winget.exe')
        : null,
    ])
  }
  return []
}

function installArguments(platform) {
  if (platform === 'darwin') return ['install', 'ffmpeg']
  if (platform === 'win32') {
    return [
      'install',
      '--id',
      WINGET_PACKAGE_ID,
      '--exact',
      '--source',
      'winget',
      '--accept-source-agreements',
      '--disable-interactivity',
    ]
  }
  return null
}

function displayInstallCommand(platform) {
  if (platform === 'darwin') return 'brew install ffmpeg'
  if (platform === 'win32') {
    return 'winget install --id Gyan.FFmpeg --exact --source winget --accept-source-agreements --disable-interactivity'
  }
  return null
}

function helpUrlForPlatform(platform = process.platform) {
  return HELP_URLS[platform] || HELP_URLS.other
}

function appendBounded(current, chunk) {
  const next = current + chunk.toString()
  return next.length <= MAX_PROCESS_OUTPUT ? next : next.slice(-MAX_PROCESS_OUTPUT)
}

function createAbortError(message = 'FFmpeg setup canceled') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function runCommand(executable, args, { signal, spawnImpl = spawn } = {}) {
  if (signal?.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer

    const finish = (callback) => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener?.('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2_000)
      killTimer.unref?.()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code, terminationSignal) =>
      finish(() => {
        if (signal?.aborted) reject(createAbortError())
        else resolve({ code: code ?? -1, signal: terminationSignal, stderr, stdout })
      }),
    )
  })
}

function parseEncoderNames(output) {
  const names = new Set()
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^\s*[A-Z.]{6}\s+(\S+)/)
    if (match) names.add(match[1])
  }
  return names
}

function ffmpegVersion(output) {
  const match = String(output || '').match(/^ffmpeg version\s+([^\s]+)/im)
  return match?.[1] || null
}

async function probeFfmpeg(executable, { run = runCommand, signal } = {}) {
  const versionResult = await run(executable, ['-hide_banner', '-version'], { signal })
  if (versionResult.code !== 0) return null
  const encoderResult = await run(executable, ['-hide_banner', '-encoders'], { signal })
  const names =
    encoderResult.code === 0
      ? parseEncoderNames(`${encoderResult.stdout}\n${encoderResult.stderr}`)
      : new Set()
  const missingEncoders = REQUIRED_ENCODERS.filter((encoder) => !names.has(encoder))
  return {
    available: true,
    exportCapable: encoderResult.code === 0 && missingEncoders.length === 0,
    missingEncoders,
    path: executable,
    version: ffmpegVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
  }
}

async function detectFfmpeg(options = {}) {
  const { run = runCommand, signal } = options
  let incomplete = null
  for (const executable of ffmpegExecutableCandidates(options)) {
    try {
      const status = await probeFfmpeg(executable, { run, signal })
      if (!status) continue
      if (status.exportCapable) return status
      incomplete ||= status
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error
    }
  }
  return (
    incomplete || {
      available: false,
      exportCapable: false,
      missingEncoders: [...REQUIRED_ENCODERS],
      path: null,
      version: null,
    }
  )
}

async function discoverInstallPlan(options = {}) {
  const platform = options.platform || process.platform
  const args = installArguments(platform)
  if (!args) return null
  const { run = runCommand, signal } = options
  for (const executable of packageManagerCandidates(options)) {
    try {
      const result = await run(executable, ['--version'], { signal })
      if (result.code !== 0) continue
      return {
        args,
        command: displayInstallCommand(platform),
        executable,
        label: platform === 'darwin' ? 'Install with Homebrew' : 'Install with WinGet',
        method: platform === 'darwin' ? 'homebrew' : 'winget',
        packageName: platform === 'darwin' ? 'Homebrew ffmpeg formula' : 'Gyan FFmpeg',
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error
    }
  }
  return null
}

function setupPrompt(status, plan, platform) {
  const missingDetail = status.available
    ? `The detected FFmpeg executable is missing: ${status.missingEncoders.join(', ')}.`
    : 'FFmpeg was not found on this computer.'
  if (!plan) {
    return {
      type: 'info',
      buttons: ['Open setup instructions', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'FFmpeg is required for video export',
      message: 'Set up FFmpeg to export an MP4.',
      detail: `${missingDetail}\n\nOkay Karaoke Studio does not bundle the FFmpeg command-line encoder. Install it from your system or package provider, then try the export again.`,
    }
  }
  const platformDetail =
    platform === 'win32'
      ? 'WinGet will download the third-party, GPL-licensed Gyan FFmpeg package. Windows may request permission.'
      : 'Homebrew will download its FFmpeg formula and dependencies. Homebrew is already installed.'
  return {
    type: 'question',
    buttons: [plan.label, 'Open setup instructions', 'Not now'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'FFmpeg is required for video export',
    message: plan.label,
    detail: `${missingDetail}\n\n${platformDetail}\n\nCommand: ${plan.command}`,
  }
}

function installFailureMessage(plan, result) {
  const detail = String(result?.stderr || result?.stdout || '').trim()
  const shortDetail = detail.length > 1_200 ? detail.slice(-1_200) : detail
  return [
    `${plan.label} did not produce an FFmpeg installation that supports libx264 and AAC.`,
    shortDetail,
    'Open the setup instructions or install FFmpeg manually, then try again.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function verifyAfterInstall(options) {
  const waits = options.verifyWaits || [0, 250, 750, 1_500]
  for (const delayMs of waits) {
    if (options.signal?.aborted) throw createAbortError()
    if (delayMs) {
      await (
        options.wait ||
        ((milliseconds) =>
          new Promise((resolve, reject) => {
            let timer
            const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
            const onAbort = () => {
              clearTimeout(timer)
              cleanup()
              reject(createAbortError())
            }
            timer = setTimeout(() => {
              cleanup()
              resolve()
            }, milliseconds)
            options.signal?.addEventListener('abort', onAbort, { once: true })
            timer.unref?.()
          }))
      )(delayMs)
    }
    if (options.signal?.aborted) throw createAbortError()
    const status = await detectFfmpeg(options)
    if (status.exportCapable) return status
  }
  return detectFfmpeg(options)
}

async function ensureFfmpegForExport({ openExternal, showMessageBox, ...options }) {
  const platform = options.platform || process.platform
  const status = await detectFfmpeg(options)
  if (status.exportCapable) return status.path

  const plan = await discoverInstallPlan(options)
  const choice = await showMessageBox(setupPrompt(status, plan, platform))
  if (!plan || choice.response === 1) {
    if (choice.response === 0 || (plan && choice.response === 1)) {
      await openExternal(helpUrlForPlatform(platform))
    }
    return null
  }
  if (choice.response !== 0) return null

  let result
  try {
    result = await (options.run || runCommand)(plan.executable, plan.args, {
      signal: options.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError' || options.signal?.aborted) throw error
    result = { code: -1, stderr: error?.message || String(error), stdout: '' }
  }
  const verified = await verifyAfterInstall(options)
  if (verified.exportCapable) return verified.path
  throw new Error(installFailureMessage(plan, result))
}

module.exports = {
  REQUIRED_ENCODERS,
  WINGET_PACKAGE_ID,
  detectFfmpeg,
  discoverInstallPlan,
  displayInstallCommand,
  ensureFfmpegForExport,
  ffmpegExecutableCandidates,
  ffmpegVersion,
  helpUrlForPlatform,
  installArguments,
  packageManagerCandidates,
  parseEncoderNames,
  probeFfmpeg,
  runCommand,
  setupPrompt,
}
