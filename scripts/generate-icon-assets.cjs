'use strict'

const { app, BrowserWindow } = require('electron')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const GENERATOR_PATH = __filename
const SOURCE_PATH = path.join(ROOT, 'build', 'icon-source.png')
const MANIFEST_PATH = path.join(ROOT, 'build', 'icon-assets.json')
const OUTPUTS = [
  { path: path.join(ROOT, 'build', 'icon.png'), size: 1024 },
  { path: path.join(ROOT, 'public', 'app-icon.png'), size: 128 },
]

// Trim the concept's white presentation matte, including its antialiased edge.
const SOURCE_INSET_RATIO = 104 / 1254
const CORNER_RADIUS_RATIO = 0.23

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256Text(bytes) {
  return sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n')))
}

function renderIcon(sourceUrl, size, sourceInsetRatio, cornerRadiusRatio) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth !== image.naturalHeight) {
        reject(new Error('The canonical app icon source must be square.'))
        return
      }

      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Canvas 2D is unavailable.'))
        return
      }

      const radius = size * cornerRadiusRatio
      context.beginPath()
      context.moveTo(radius, 0)
      context.lineTo(size - radius, 0)
      context.quadraticCurveTo(size, 0, size, radius)
      context.lineTo(size, size - radius)
      context.quadraticCurveTo(size, size, size - radius, size)
      context.lineTo(radius, size)
      context.quadraticCurveTo(0, size, 0, size - radius)
      context.lineTo(0, radius)
      context.quadraticCurveTo(0, 0, radius, 0)
      context.closePath()
      context.clip()

      const inset = image.naturalWidth * sourceInsetRatio
      const sourceSize = image.naturalWidth - inset * 2
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, inset, inset, sourceSize, sourceSize, 0, 0, size, size)

      const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3]
      const centerAlpha = context.getImageData(Math.floor(size / 2), Math.floor(size / 2), 1, 1)
        .data[3]
      if (cornerAlpha !== 0 || centerAlpha !== 255) {
        reject(new Error(`Invalid icon alpha coverage at ${size}px.`))
        return
      }

      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('Could not decode the canonical app icon source.'))
    image.src = sourceUrl
  })
}

async function writeAtomically(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporaryPath, bytes)
  await fs.rename(temporaryPath, filePath)
}

async function main() {
  const [source, generator] = await Promise.all([
    fs.readFile(SOURCE_PATH),
    fs.readFile(GENERATOR_PATH),
  ])
  const sourceUrl = `data:image/png;base64,${source.toString('base64')}`
  const generated = []
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  try {
    await window.loadURL('about:blank')
    for (const output of OUTPUTS) {
      const dataUrl = await window.webContents.executeJavaScript(
        `(${renderIcon.toString()})(${JSON.stringify(sourceUrl)}, ${output.size}, ${SOURCE_INSET_RATIO}, ${CORNER_RADIUS_RATIO})`,
        true,
      )
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      await writeAtomically(output.path, bytes)
      generated.push({
        path: path.relative(ROOT, output.path),
        size: output.size,
        sha256: sha256(bytes),
      })
      console.log(`Wrote ${path.relative(ROOT, output.path)} (${output.size}x${output.size})`)
    }
    const manifest = {
      version: 1,
      source: {
        path: path.relative(ROOT, SOURCE_PATH),
        sha256: sha256(source),
      },
      generator: {
        path: path.relative(ROOT, GENERATOR_PATH),
        sha256: sha256Text(generator),
      },
      configuration: {
        sourceInsetRatio: SOURCE_INSET_RATIO,
        cornerRadiusRatio: CORNER_RADIUS_RATIO,
      },
      generated,
    }
    await writeAtomically(MANIFEST_PATH, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
    console.log(`Wrote ${path.relative(ROOT, MANIFEST_PATH)}`)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

app
  .whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
