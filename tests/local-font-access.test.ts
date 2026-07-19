import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const fontAccess = require('../electron/local-font-access.cjs') as {
  createLocalFontPermissionPolicy(options: {
    getMainWindow: () => unknown
    trustedOrigin: string
  }): {
    check(
      webContents: unknown,
      permission: string,
      requestingOrigin: string | undefined,
      details: unknown,
    ): boolean
    request(webContents: unknown, permission: string, details: unknown): boolean
  }
  sameRegisteredRenderer(rawUrl: unknown, trustedOrigin: string): boolean
}

function fixture(trustedOrigin = 'studio-app://app') {
  const webContents = {
    getURL: () =>
      trustedOrigin === 'studio-app://app'
        ? 'studio-app://app/index.html'
        : `${trustedOrigin}/index.html`,
  }
  const mainWindow = { isDestroyed: () => false, webContents }
  const policy = fontAccess.createLocalFontPermissionPolicy({
    getMainWindow: () => mainWindow,
    trustedOrigin,
  })
  const requestingUrl = webContents.getURL()
  return { mainWindow, policy, requestingUrl, trustedOrigin, webContents }
}

describe('local font permission policy', () => {
  it.each(['studio-app://app', 'http://127.0.0.1:5173'])(
    'allows only the trusted top-level renderer for %s',
    (trustedOrigin) => {
      const { policy, requestingUrl, webContents } = fixture(trustedOrigin)

      expect(
        policy.check(webContents, 'local-fonts', trustedOrigin, {
          isMainFrame: true,
          requestingUrl,
        }),
      ).toBe(true)
      expect(policy.request(webContents, 'local-fonts', { isMainFrame: true, requestingUrl })).toBe(
        true,
      )
    },
  )

  it('denies other permissions, frames, contents, and origins', () => {
    const { mainWindow, policy, requestingUrl, trustedOrigin, webContents } = fixture()
    const check = (
      contents: unknown = webContents,
      permission = 'local-fonts',
      origin: string | undefined = trustedOrigin,
      details: unknown = { isMainFrame: true, requestingUrl },
    ) => policy.check(contents, permission, origin, details)

    expect(check(webContents, 'camera')).toBe(false)
    expect(
      check(webContents, 'local-fonts', trustedOrigin, {
        isMainFrame: false,
        requestingUrl,
      }),
    ).toBe(false)
    expect(check(null)).toBe(false)
    expect(check({ getURL: () => requestingUrl })).toBe(false)
    expect(check(webContents, 'local-fonts', 'null')).toBe(false)
    expect(check(webContents, 'local-fonts', 'studio-app://attacker')).toBe(false)
    expect(
      check(webContents, 'local-fonts', trustedOrigin, {
        isMainFrame: true,
        requestingUrl: 'studio-app://attacker/index.html',
      }),
    ).toBe(false)
    expect(
      policy.request(webContents, 'local-fonts', {
        isMainFrame: true,
      }),
    ).toBe(false)
    mainWindow.isDestroyed = () => true
    expect(check()).toBe(false)
  })

  it('matches registered origins without accepting credentials, ports, or lookalikes', () => {
    expect(
      fontAccess.sameRegisteredRenderer('studio-app://app/index.html', 'studio-app://app'),
    ).toBe(true)
    expect(
      fontAccess.sameRegisteredRenderer('http://127.0.0.1:5173/editor', 'http://127.0.0.1:5173'),
    ).toBe(true)
    for (const value of [
      'studio-app://app.evil/index.html',
      'studio-app://user@app/index.html',
      'studio-app://app:8/index.html',
      'http://127.0.0.1:5174/index.html',
      'not a URL',
    ]) {
      expect(fontAccess.sameRegisteredRenderer(value, 'studio-app://app')).toBe(false)
    }
  })
})
