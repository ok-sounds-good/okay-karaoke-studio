import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { parseProjectJson } = require('../electron/project-schema.cjs')
const { createVideoExportCommitState } = require('../electron/video-export.cjs')
const { createVideoExportOperation } = require('../electron/video-export-operation.cjs')
const GOLDEN_JSON = readFileSync(
  new URL('./fixtures/current-project-v0.json', import.meta.url),
  'utf8',
).trim()
const REQUEST = {
  projectJson: GOLDEN_JSON,
  audioPath: '/fixtures/backing-track.wav',
  durationMs: 12_000,
  resolution: '720p',
  fps: 30,
  suggestedName: 'Fixture Song.mp4',
}
const RESULT = { path: '/exports/Fixture Song.mp4', frameCount: 360 }
class FakeSender extends EventEmitter {
  destroyed = false
  readonly send = vi.fn()
  constructor(readonly id: number) {
    super()
  }
  isDestroyed() {
    return this.destroyed
  }

  destroy() {
    this.destroyed = true
    this.emit('destroyed')
  }
}

function changedProject(change: (project: Record<string, unknown>) => void) {
  const project = JSON.parse(GOLDEN_JSON) as Record<string, unknown>
  change(project)
  return JSON.stringify(project)
}
function deferred<T>() {
  let resolve = (_value: T) => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function harness() {
  const events: string[] = []
  let latestCommitState = null
  const createCommitState = vi.fn(() => {
    events.push('begin')
    latestCommitState = createVideoExportCommitState()
    return latestCommitState
  })
  const prepareExport = vi.fn(async () => {
    events.push('prepare')
    return '/tools/ffmpeg'
  })
  const selectDestination = vi.fn(async () => {
    events.push('destination')
    return '/exports/Fixture Song.mp4'
  })
  const executeExport = vi.fn(async ({ operation, onProgress }) => {
    events.push('execute')
    onProgress({ phase: 'frames', completed: 1, total: 2 })
    operation.commitState.beginPromotion()
    operation.commitState.finishPromotion()
    return RESULT
  })
  const sendProgress = vi.fn((sender: FakeSender, progress: unknown) => {
    events.push('progress')
    sender.send('studio:video-export-progress', progress)
  })
  const coordinator = createVideoExportOperation({
    parseProject: (json: string) => {
      events.push('parse')
      return parseProjectJson(json)
    },
    createCommitState,
    prepareExport,
    selectDestination,
    executeExport,
    sendProgress,
  })
  return {
    coordinator, createCommitState, events, executeExport, prepareExport,
    selectDestination, sendProgress, latestCommitState: () => latestCommitState,
  }
}

function run(
  coordinator: ReturnType<typeof createVideoExportOperation>,
  sender: FakeSender,
  request = REQUEST,
) {
  return coordinator.run({ owner: { kind: 'main-window' }, sender, request })
}

function expectClean(fixture: ReturnType<typeof harness>, sender: FakeSender) {
  expect(fixture.coordinator.hasActiveExport()).toBe(false)
  expect(sender.listenerCount('destroyed')).toBe(0)
}

describe('video export operation preflight and lifecycle', () => {
  it.each([
    ['malformed JSON', '{oops'],
    ['nonzero schema', changedProject((project) => { project.schemaVersion = 1 })],
    ['nonnumeric schema', changedProject((project) => { project.schemaVersion = '0' })],
    ['malformed current project', changedProject((project) => { project.title = 42 })],
  ])('rejects %s before any export effect or lifecycle mutation', async (_label, projectJson) => {
    const fixture = harness()
    const sender = new FakeSender(7)

    await expect(run(fixture.coordinator, sender, { ...REQUEST, projectJson })).rejects.toThrow()

    expect(fixture.events).toEqual(['parse'])
    for (const effect of [
      fixture.createCommitState, fixture.prepareExport, fixture.selectDestination,
      fixture.executeExport, fixture.sendProgress,
    ]) expect(effect).not.toHaveBeenCalled()
    expectClean(fixture, sender)
  })

  it('runs one valid request in order, forwards only live progress, and returns its result', async () => {
    const fixture = harness()
    const sender = new FakeSender(11)
    fixture.executeExport.mockImplementationOnce(async ({ operation, onProgress }) => {
      fixture.events.push('execute')
      onProgress({ phase: 'frames', completed: 1, total: 2 })
      sender.destroyed = true
      onProgress({ phase: 'frames', completed: 2, total: 2 })
      operation.commitState.beginPromotion()
      operation.commitState.finishPromotion()
      return RESULT
    })
    await expect(run(fixture.coordinator, sender)).resolves.toEqual(RESULT)
    expect(fixture.events).toEqual([
      'parse', 'begin', 'prepare', 'destination', 'execute', 'progress',
    ])
    for (const effect of [
      fixture.createCommitState, fixture.prepareExport, fixture.selectDestination,
      fixture.executeExport, fixture.sendProgress, sender.send,
    ]) expect(effect).toHaveBeenCalledOnce()
    expect(fixture.latestCommitState().state).toBe('committed')
    expect(fixture.executeExport.mock.calls[0][0]).toMatchObject({
      request: REQUEST,
      preparation: '/tools/ffmpeg',
      destination: '/exports/Fixture Song.mp4',
    })
    expectClean(fixture, sender)
  })

  it('returns null and finishes when FFmpeg setup or destination selection is canceled', async () => {
    const setupCanceled = harness()
    const setupSender = new FakeSender(20)
    setupCanceled.prepareExport.mockResolvedValueOnce(null)
    await expect(run(setupCanceled.coordinator, setupSender)).resolves.toBeNull()
    expect(setupCanceled.selectDestination).not.toHaveBeenCalled()
    expect(setupCanceled.executeExport).not.toHaveBeenCalled()
    expectClean(setupCanceled, setupSender)

    const dialogCanceled = harness()
    const dialogSender = new FakeSender(21)
    dialogCanceled.selectDestination.mockResolvedValueOnce(null)
    await expect(run(dialogCanceled.coordinator, dialogSender)).resolves.toBeNull()
    expect(dialogCanceled.prepareExport).toHaveBeenCalledOnce()
    expect(dialogCanceled.executeExport).not.toHaveBeenCalled()
    expectClean(dialogCanceled, dialogSender)
  })

  it('joins renderer and lifecycle cancellation after FFmpeg setup returns', async () => {
    const fixture = harness()
    const sender = new FakeSender(30)
    const preparation = deferred<string>()
    fixture.prepareExport.mockImplementationOnce(() => preparation.promise)
    const running = run(fixture.coordinator, sender)
    await vi.waitFor(() => expect(fixture.prepareExport).toHaveBeenCalledOnce())

    expect(fixture.coordinator.hasActiveExport()).toBe(true)
    await expect(run(fixture.coordinator, new FakeSender(31))).rejects.toThrow(
      'Another karaoke video export is already running',
    )
    expect(fixture.createCommitState).toHaveBeenCalledOnce()

    const operation = fixture.coordinator.activeExportForOwner(sender.id)!
    expect(operation.commitState.tryBeginCancellation()).toBe(true)
    operation.controller.abort()
    let lifecycleFinished = false
    const lifecycleCancellation = fixture.coordinator.abortActiveExport()
      .then(() => { lifecycleFinished = true })
    await Promise.resolve()
    expect(lifecycleFinished).toBe(false)
    preparation.resolve('/tools/ffmpeg')
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    await lifecycleCancellation
    expect(fixture.selectDestination).not.toHaveBeenCalled()
    expect(fixture.executeExport).not.toHaveBeenCalled()
    expectClean(fixture, sender)
  })

  it('cancels after the dialog when the owner is destroyed', async () => {
    const fixture = harness()
    const sender = new FakeSender(40)
    const destination = deferred<string>()
    fixture.selectDestination.mockImplementationOnce(() => destination.promise)
    const running = run(fixture.coordinator, sender)
    await vi.waitFor(() => expect(fixture.selectDestination).toHaveBeenCalledOnce())

    sender.destroy()
    destination.resolve('/exports/Fixture Song.mp4')
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.executeExport).not.toHaveBeenCalled()
    expect(fixture.latestCommitState().state).toBe('canceling')
    expectClean(fixture, sender)
  })

  it('clears failed exporter state so a later request can finish', async () => {
    const fixture = harness()
    const failedSender = new FakeSender(50)
    fixture.executeExport.mockRejectedValueOnce(new Error('Encoder stopped unexpectedly'))
    await expect(run(fixture.coordinator, failedSender)).rejects.toThrow(
      'Encoder stopped unexpectedly',
    )
    expectClean(fixture, failedSender)

    const retrySender = new FakeSender(51)
    await expect(run(fixture.coordinator, retrySender)).resolves.toEqual(RESULT)
    expect(fixture.createCommitState).toHaveBeenCalledTimes(2)
    expect(fixture.executeExport).toHaveBeenCalledTimes(2)
    expectClean(fixture, retrySender)
  })
})
