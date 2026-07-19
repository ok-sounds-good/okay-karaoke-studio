import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { cloneStageStyle, cloneVocalStyle } from '../src/lib/video-style'
import type { StyleTemplate, StyleTemplatePreferences } from '../src/lib/style-template-codec'

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

function preferences(): StyleTemplatePreferences {
  return {
    stageStyle: cloneStageStyle(),
    lyricDisplay: { lineCount: 3, advanceMode: 'scroll' },
    vocalStyle: cloneVocalStyle(),
    videoExportDefaults: { resolution: '720p', fps: 30 },
  }
}

function loadStudio(result: unknown) {
  const invocations: Array<{ channel: string; value: unknown }> = []
  let studio: {
    listStyleTemplates(): Promise<StyleTemplate[]>
    createStyleTemplate(value: unknown): Promise<StyleTemplate>
    renameStyleTemplate(id: string, name: string): Promise<StyleTemplate>
  } | null = null
  runInNewContext(source('electron/preload.cjs'), {
    require: (specifier: string) => {
      if (specifier !== 'electron') throw new Error(`Unexpected require: ${specifier}`)
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, value: typeof studio) => {
            studio = value
          },
        },
        ipcRenderer: {
          invoke: async (channel: string, value: unknown) => {
            invocations.push({ channel, value })
            return result
          },
          on: () => {},
          removeListener: () => {},
        },
      }
    },
  })
  if (!studio) throw new Error('Preload did not expose the Studio API.')
  return { studio, invocations }
}

describe('style template Electron boundary', () => {
  const main = source('electron/main.cjs')
  const preload = source('electron/preload.cjs')
  const types = source('src/electron.d.ts')

  it('keeps the fixed store path exclusively in the main process', () => {
    expect(main).toContain("path.join(app.getPath('userData'), 'style-templates.json')")
    expect(preload).not.toContain('userData')
    expect(preload).not.toContain('style-templates.json')
    expect(types).not.toContain('style-templates.json')
  })

  it('trust-checks every handler before forwarding request values', () => {
    for (const channel of [
      'listStyleTemplates',
      'createStyleTemplate',
      'renameStyleTemplate',
      'deleteStyleTemplate',
    ]) {
      const start = main.indexOf(`ipcMain.handle(CHANNELS.${channel}`)
      const end = main.indexOf('\n  })', start)
      const handler = main.slice(start, end)
      expect(start).toBeGreaterThan(0)
      expect(handler).toContain('assertTrustedSender(event)')
      if (channel !== 'listStyleTemplates') {
        expect(handler.indexOf('assertTrustedSender(event)')).toBeLessThan(
          handler.indexOf(`styleTemplateStore.${channel.replace('StyleTemplate', '')}(value)`),
        )
      }
    }
  })

  it('exposes only pathless CRUD requests and validates main-process results', () => {
    expect(preload).toContain(
      'listStyleTemplates: async () =>\n    requireStyleTemplateList(await ipcRenderer.invoke(CHANNELS.listStyleTemplates))',
    )
    expect(preload).toContain('requireStyleTemplateCreateRequest(options)')
    expect(preload).toContain("requireStyleTemplateId(id, 'renameStyleTemplate')")
    expect(preload).toContain("requireStyleTemplateId(id, 'deleteStyleTemplate')")
    expect(preload).toContain('requireStyleTemplate(')
    expect(preload).toContain('deleted !== true')
    for (const method of [
      'listStyleTemplates()',
      'createStyleTemplate(options:',
      'renameStyleTemplate(id:',
      'deleteStyleTemplate(id:',
    ]) {
      expect(types).toContain(method)
    }
  })

  it('rejects hostile nested requests and results while accepting canonical values', async () => {
    const canonical: StyleTemplate = { id: 'stable-id', name: 'Warm', preferences: preferences() }
    const valid = loadStudio(canonical)
    await expect(
      valid.studio.createStyleTemplate({ name: 'Warm', preferences: preferences() }),
    ).resolves.toMatchObject(canonical)
    expect(valid.invocations).toHaveLength(1)

    const invalidPreferences = {
      stageStyle: {},
      lyricDisplay: {},
      vocalStyle: {},
      videoExportDefaults: {},
    }
    const hostileRequest = loadStudio(canonical)
    await expect(
      hostileRequest.studio.createStyleTemplate({ name: 'Bad', preferences: invalidPreferences }),
    ).rejects.toThrow('valid name and preferences')
    expect(hostileRequest.invocations).toHaveLength(0)

    const hostileResult = { id: 'stable-id', name: 'Bad', preferences: invalidPreferences }
    await expect(loadStudio([hostileResult]).studio.listStyleTemplates()).rejects.toThrow(
      'invalid style template',
    )
    await expect(
      loadStudio(hostileResult).studio.createStyleTemplate({
        name: 'Warm',
        preferences: preferences(),
      }),
    ).rejects.toThrow('invalid style template')
    await expect(
      loadStudio(hostileResult).studio.renameStyleTemplate('stable-id', 'Renamed'),
    ).rejects.toThrow('invalid style template')
  })
})
