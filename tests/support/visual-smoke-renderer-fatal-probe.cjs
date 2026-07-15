'use strict'

const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs/promises')
const {
  PACKAGED_APP_URL,
  installVisualSmokeFatalObserver,
  runVisualSmoke,
} = require('../../electron/video-style-visual-smoke.cjs')

const APP_SCHEME = 'studio-app'
const PROBE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body, #root { height: 100%; margin: 0; width: 100%; }
    </style>
  </head>
  <body>
    <div id="root"><main>Renderer fatal smoke probe</main></div>
    <script>
      window.addEventListener('load', () => {
        setTimeout(() => {
          throw new TypeError('renderer-fatal-probe')
        }, 50)
      }, { once: true })
    </script>
  </body>
</html>`

function argument(prefix) {
  const matches = process.argv.filter((value) => value.startsWith(prefix))
  if (matches.length !== 1) throw new Error('RENDERER_FATAL_PROBE_ARGUMENT_INVALID')
  const value = matches[0].slice(prefix.length)
  if (!value || value.includes('\0')) throw new Error('RENDERER_FATAL_PROBE_ARGUMENT_INVALID')
  return value
}

const output = argument('--output=')
const status = argument('--status=')
app.setPath('userData', argument('--user-data='))
app.setPath('sessionData', argument('--session-data='))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => undefined)

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
])

async function writeStatus(value) {
  await fs.writeFile(status, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' })
}

async function runProbe() {
  await app.whenReady()
  protocol.handle(
    APP_SCHEME,
    () =>
      new Response(PROBE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      }),
  )

  const window = new BrowserWindow({
    height: 720,
    show: true,
    useContentSize: true,
    width: 1280,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  const fatalObserver = installVisualSmokeFatalObserver(process)
  fatalObserver.observeRenderer(window.webContents)
  const capturePage = window.webContents.capturePage.bind(window.webContents)
  let fatalBeforeCapture = false
  window.webContents.capturePage = (...args) => {
    fatalBeforeCapture = fatalObserver.hasFatal()
    return capturePage(...args)
  }
  await window.loadURL(PACKAGED_APP_URL)

  const outcome = await runVisualSmoke(
    { app, config: { output }, fatalObserver, window },
    { focus: async () => true },
  )
  const observed = fatalObserver.hasFatal()
  const destroyed = window.isDestroyed()
  fatalObserver.dispose()
  await writeStatus({
    destroyed,
    disposed: true,
    fatal: observed,
    fatalBeforeCapture,
    ok: outcome.ok,
  })
  app.exit(outcome.ok ? 0 : 1)
}

runProbe().catch(async () => {
  try {
    await writeStatus({ failed: true })
  } catch {
    // The parent test treats a missing exclusive status file as a failed probe.
  }
  app.exit(2)
})
