import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createNativeCloseArbiter, createNativeCloseRendererReadiness, isNativeCloseRequestId } =
  require('../electron/native-close-arbiter.cjs') as {
    isNativeCloseRequestId(value: unknown): boolean
    createNativeCloseRendererReadiness(): {
      markReady(ownerId: number): void
      isReady(ownerId: number): boolean
      clear(ownerId?: number): boolean
    }
    createNativeCloseArbiter(options: Record<string, unknown>): {
      requestWindowClose(): unknown
      requestAppQuit(): unknown
      getPendingRequest(): { requestId: string; action: 'window' | 'app' } | null
      resolve(requestId: string, proceed: boolean): boolean
      resumeAfterExport(action: 'window' | 'app'): boolean
      consumeWindowCloseApproval(): boolean
      consumeAppQuitApproval(): boolean
      clear(): void
    }
  }

const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]

function fixture() {
  const state = { exportActive: false, sequence: 0 }
  const sent: Array<{ requestId: string; action: 'window' | 'app' }> = []
  const resumed: string[] = []
  const requestExportCancellation = vi.fn(async () => true)
  const arbiter = createNativeCloseArbiter({
    createRequestId: () => IDS[state.sequence++],
    hasActiveExport: () => state.exportActive,
    requestExportCancellation,
    sendRequest: (request: (typeof sent)[number]) => {
      sent.push(request)
      return true
    },
    closeWindow: () => resumed.push('window'),
    quitApp: () => resumed.push('app'),
  })
  return { arbiter, requestExportCancellation, resumed, sent, state }
}

describe('native close arbiter', () => {
  it('accepts only bounded UUID request identities', () => {
    expect(isNativeCloseRequestId(IDS[0])).toBe(true)
    expect(isNativeCloseRequestId('native-1')).toBe(false)
    expect(isNativeCloseRequestId(`${IDS[0]}-extra`)).toBe(false)
    expect(isNativeCloseRequestId('z'.repeat(100_000))).toBe(false)
  })

  it('resends the same-scope ID, escalates, and resolves only the exact pending ID', () => {
    const { arbiter, resumed, sent } = fixture()

    arbiter.requestWindowClose()
    arbiter.requestWindowClose()
    expect(sent).toEqual([
      { requestId: IDS[0], action: 'window' },
      { requestId: IDS[0], action: 'window' },
    ])

    arbiter.requestAppQuit()
    expect(sent.at(-1)).toEqual({ requestId: IDS[1], action: 'app' })
    expect(arbiter.resolve(IDS[0], true)).toBe(false)
    expect(arbiter.resolve(IDS[1], false)).toBe(true)
    expect(arbiter.resolve(IDS[1], false)).toBe(false)

    arbiter.requestWindowClose()
    expect(arbiter.resolve(IDS[2], true)).toBe(true)
    expect(resumed).toEqual(['window'])
    expect(arbiter.consumeWindowCloseApproval()).toBe(true)
    expect(arbiter.consumeWindowCloseApproval()).toBe(false)
  })

  it('owns an authorized app transition through its consequent window close', () => {
    const { arbiter, resumed } = fixture()

    arbiter.requestAppQuit()
    expect(arbiter.resolve(IDS[0], true)).toBe(true)
    arbiter.requestWindowClose()

    expect(resumed).toEqual(['app'])
    expect(arbiter.consumeAppQuitApproval()).toBe(true)
    expect(arbiter.consumeAppQuitApproval()).toBe(true)
    expect(arbiter.consumeWindowCloseApproval()).toBe(true)
    expect(arbiter.consumeAppQuitApproval()).toBe(false)
  })

  it('cancels export before renderer arbitration and rechecks at authorization', async () => {
    const { arbiter, requestExportCancellation, resumed, sent, state } = fixture()
    state.exportActive = true

    arbiter.requestWindowClose()
    arbiter.requestAppQuit()
    expect(requestExportCancellation).toHaveBeenNthCalledWith(1, 'window')
    expect(requestExportCancellation).toHaveBeenNthCalledWith(2, 'app')
    expect(sent).toEqual([])

    state.exportActive = false
    expect(arbiter.resumeAfterExport('app')).toBe(true)
    expect(sent).toEqual([{ requestId: IDS[0], action: 'app' }])

    state.exportActive = true
    expect(arbiter.resolve(IDS[0], true)).toBe(true)
    expect(requestExportCancellation).toHaveBeenNthCalledWith(3, 'app')
    expect(resumed).toEqual([])
    state.exportActive = false
    expect(arbiter.resumeAfterExport('app')).toBe(true)
    expect(resumed).toEqual(['app'])
    await Promise.resolve()
  })

  it('rechecks a still-active export before ever notifying the renderer', () => {
    const { arbiter, requestExportCancellation, sent, state } = fixture()
    state.exportActive = true

    arbiter.requestWindowClose()
    expect(arbiter.resumeAfterExport('window')).toBe(false)

    expect(requestExportCancellation).toHaveBeenCalledTimes(2)
    expect(sent).toEqual([])
  })

  it('clears destroyed ownership and ignores late export continuation', () => {
    const { arbiter, sent, state } = fixture()
    arbiter.requestWindowClose()
    arbiter.clear()
    expect(arbiter.resolve(sent[0].requestId, true)).toBe(false)

    state.exportActive = true
    arbiter.requestWindowClose()
    arbiter.clear()
    state.exportActive = false
    expect(arbiter.resumeAfterExport('window')).toBe(false)
    expect(arbiter.getPendingRequest()).toBeNull()
  })

  it('owns renderer readiness by WebContents identity and clears only its owner', () => {
    const readiness = createNativeCloseRendererReadiness()

    expect(readiness.isReady(7)).toBe(false)
    expect(readiness.clear(7)).toBe(false)
    readiness.markReady(7)
    expect(readiness.isReady(7)).toBe(true)
    expect(readiness.isReady(8)).toBe(false)
    expect(readiness.clear(8)).toBe(false)
    expect(readiness.isReady(7)).toBe(true)
    expect(readiness.clear(7)).toBe(true)
    expect(readiness.isReady(7)).toBe(false)
  })
})
