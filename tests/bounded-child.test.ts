import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const bounded = require('../scripts/bounded-child.cjs') as {
  publicChildOutcomeCode(prefix: string, outcome: Record<string, unknown>): string | null
  publicStatusLine(code: string): string
  runBoundedChild(options: Record<string, unknown>): Promise<Record<string, unknown>>
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: string | null = null
  stderr = new PassThrough()
  stdout = new PassThrough()
  kills: string[] = []
  unrefs = 0
  killBehavior: 'exit-on-kill' | 'return-false' | 'throw' | 'ignore' = 'exit-on-kill'

  kill(signal: string) {
    this.kills.push(signal)
    if (this.killBehavior === 'throw') throw new Error('private kill failure')
    if (this.killBehavior === 'return-false') return false
    if (this.killBehavior === 'exit-on-kill' && signal === 'SIGKILL') {
      this.signalCode = signal
      this.emit('exit', null, signal)
    }
    return true
  }

  unref() {
    this.unrefs += 1
    return this
  }

  confirmSpawn() {
    this.emit('spawn')
  }

  exit(code = 0, signal: string | null = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }

  close(code = 0, signal: string | null = null) {
    this.emit('close', code, signal)
  }
}

afterEach(() => vi.useRealTimers())

function pendingChild(child: FakeChild, overrides: Record<string, unknown> = {}) {
  const parent = new EventEmitter()
  const pending = bounded.runBoundedChild({
    executable: 'electron',
    spawnImpl: () => child,
    processLike: parent,
    timeoutMs: 1_000,
    killGraceMs: 2_000,
    forceSettleMs: 250,
    setTimeoutImpl: setTimeout,
    clearTimeoutImpl: clearTimeout,
    ...overrides,
  })
  child.confirmSpawn()
  return { parent, pending }
}

describe('bounded child lifecycle', () => {
  it('force-kills an uncooperative child and confirms only the observed exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const { parent, pending } = pendingChild(child)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(child.kills).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toMatchObject({
      signal: 'SIGKILL',
      terminationConfirmed: true,
      terminationUnconfirmed: false,
      timedOut: true,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.unrefs).toBe(0)
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports explicit unconfirmed termination when SIGKILL produces no exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const { parent, pending } = pendingChild(child)

    await vi.advanceTimersByTimeAsync(3_250)
    await expect(pending).resolves.toMatchObject({
      signal: null,
      terminationConfirmed: false,
      terminationUnconfirmed: true,
      timedOut: true,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.unrefs).toBe(1)
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['throw', 'return-false'] as const)(
    'keeps escalation active when kill attempts %s',
    async (killBehavior) => {
      vi.useFakeTimers()
      const child = new FakeChild()
      child.killBehavior = killBehavior
      const { pending } = pendingChild(child)

      await vi.advanceTimersByTimeAsync(3_250)
      await expect(pending).resolves.toMatchObject({
        killFailed: true,
        signal: null,
        terminationUnconfirmed: true,
      })
      expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
      expect(child.unrefs).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('forwards only the first parent signal and does not invent a child exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const { parent, pending } = pendingChild(child, { timeoutMs: 60_000 })

    parent.emit('SIGINT')
    parent.emit('SIGINT')
    parent.emit('SIGTERM')
    expect(child.kills).toEqual(['SIGINT'])
    await vi.advanceTimersByTimeAsync(2_250)
    await expect(pending).resolves.toMatchObject({
      forwardedSignal: 'SIGINT',
      signal: null,
      terminationUnconfirmed: true,
    })
    expect(child.kills).toEqual(['SIGINT', 'SIGKILL'])
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
  })

  it('replays a signal emitted synchronously inside spawn and cleans up escalation', async () => {
    vi.useFakeTimers()
    const parent = new EventEmitter()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const pending = bounded.runBoundedChild({
      executable: 'electron',
      spawnImpl: () => {
        parent.emit('SIGTERM')
        return child
      },
      processLike: parent,
      timeoutMs: 60_000,
      killGraceMs: 20,
      forceSettleMs: 10,
    })
    child.confirmSpawn()

    expect(child.kills).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(30)
    await expect(pending).resolves.toMatchObject({
      forwardedSignal: 'SIGTERM',
      terminationUnconfirmed: true,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.unrefs).toBe(1)
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unrefs a real ignored-stdio child after bounded unconfirmed termination', async () => {
    let child: ReturnType<typeof spawn> | undefined
    let realKill: ReturnType<typeof spawn>['kill'] | undefined
    let killSpy: ReturnType<typeof vi.spyOn> | undefined
    let unrefSpy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const outcome = await bounded.runBoundedChild({
        executable: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1_000)'],
        spawnOptions: { stdio: 'ignore' },
        timeoutMs: 15,
        killGraceMs: 15,
        forceSettleMs: 15,
        spawnImpl: (...parameters: Parameters<typeof spawn>) => {
          child = spawn(...parameters)
          realKill = child.kill.bind(child)
          const realUnref = child.unref.bind(child)
          killSpy = vi.spyOn(child, 'kill').mockReturnValue(true)
          unrefSpy = vi.spyOn(child, 'unref').mockImplementation(() => {
            realUnref()
            return child as ReturnType<typeof spawn>
          })
          return child
        },
      })
      expect(outcome).toMatchObject({
        terminationConfirmed: false,
        terminationUnconfirmed: true,
        timedOut: true,
      })
      expect(unrefSpy).toHaveBeenCalledOnce()
    } finally {
      if (child && realKill && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        killSpy?.mockRestore()
        unrefSpy?.mockRestore()
        realKill.call(child, 'SIGKILL')
        await exited
      }
    }
  })

  it.each(['inherit', ['ignore', 'ignore', 'ipc']])(
    'rejects inherited or IPC stdio %# before spawning',
    async (stdio) => {
      const spawnImpl = vi.fn()
      const outcome = await bounded.runBoundedChild({
        executable: 'electron',
        spawnImpl,
        spawnOptions: { stdio },
        timeoutMs: 1_000,
      })
      expect(outcome).toMatchObject({ startFailed: true, spawned: false })
      expect(spawnImpl).not.toHaveBeenCalled()
    },
  )

  it('distinguishes a post-spawn process error from a start failure', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    child.killBehavior = 'ignore'
    const { pending } = pendingChild(child, { timeoutMs: 60_000 })
    child.emit('error', new Error('private runtime error'))

    await vi.advanceTimersByTimeAsync(2_250)
    const outcome = await pending
    expect(outcome).toMatchObject({
      postSpawnError: true,
      startFailed: false,
      terminationUnconfirmed: true,
    })
    expect(bounded.publicChildOutcomeCode('VISUAL_SMOKE', outcome)).toBe(
      'VISUAL_SMOKE_TERMINATION_UNCONFIRMED',
    )
  })

  it('clears timers and listeners after a normal confirmed exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const { parent, pending } = pendingChild(child)
    child.exit(0)

    await expect(pending).resolves.toMatchObject({ code: 0, terminationConfirmed: true })
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps private diagnostics and waits for close before settling captured output', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const secret = 'fatal:/private/diagnostic-path'
    const classify = vi.fn((_stdout: Buffer, stderr: Buffer) =>
      stderr.toString('utf8').startsWith('fatal:'),
    )
    const { pending } = pendingChild(child, {
      captureOutput: { classify, maxBytesPerStream: 8 },
      spawnOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
    })
    let settled = false
    void pending.then(() => {
      settled = true
    })
    child.stderr.write(secret)
    child.exit(0)
    await Promise.resolve()
    expect(settled).toBe(false)

    child.close(0)
    const outcome = await pending
    expect(outcome).toMatchObject({
      code: 0,
      diagnostics: { fatal: true, overflow: true },
      terminationConfirmed: true,
    })
    expect(classify).toHaveBeenCalledWith(Buffer.alloc(0), Buffer.from(secret.slice(0, 8)))
    expect(JSON.stringify(outcome)).not.toContain('/private/diagnostic-path')
    expect(bounded.publicChildOutcomeCode('VISUAL_SMOKE', outcome)).toBe(
      'VISUAL_SMOKE_CHILD_FAILED',
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds captured settlement when a descendant retains stdio after child exit', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const { parent, pending } = pendingChild(child, {
      captureOutput: { classify: () => false, maxBytesPerStream: 64 },
      spawnOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
    })
    let settled = false
    void pending.then(() => {
      settled = true
    })

    child.exit(0)
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const outcome = await pending
    expect(outcome).toMatchObject({
      code: 0,
      terminationConfirmed: true,
      terminationUnconfirmed: false,
      timedOut: true,
    })
    expect(bounded.publicChildOutcomeCode('VISUAL_SMOKE', outcome)).toBe('VISUAL_SMOKE_TIMEOUT')
    expect(child.kills).toEqual([])
    expect(child.stdout.destroyed).toBe(true)
    expect(child.stderr.destroyed).toBe(true)
    expect(parent.listenerCount('SIGINT')).toBe(0)
    expect(parent.listenerCount('SIGTERM')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves captured timeout escalation when SIGKILL exit never reaches close', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const { pending } = pendingChild(child, {
      captureOutput: { classify: () => false, maxBytesPerStream: 64 },
      spawnOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
    })

    await vi.advanceTimersByTimeAsync(3_250)
    await expect(pending).resolves.toMatchObject({
      signal: 'SIGKILL',
      terminationConfirmed: true,
      terminationUnconfirmed: false,
      timedOut: true,
    })
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(child.stdout.destroyed).toBe(true)
    expect(child.stderr.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['FONT_SMOKE', 'VIDEO_SMOKE', 'VISUAL_SMOKE'])(
    'maps secret-bearing %s start failures to fixed public output',
    async (prefix) => {
      const parent = new EventEmitter()
      const secret = 'CodexSecretPath-DoNotLeak'
      const outcome = await bounded.runBoundedChild({
        executable: secret,
        spawnImpl: () => {
          throw new Error(`cannot launch ${secret}`)
        },
        processLike: parent,
        timeoutMs: 1_000,
      })
      const code = bounded.publicChildOutcomeCode(prefix, outcome)
      const line = bounded.publicStatusLine(code as string)

      expect(code).toBe(`${prefix}_START_FAILED`)
      expect(line).toBe(`{"code":"${prefix}_START_FAILED","ok":false}`)
      expect(line).not.toContain(secret)
      expect(parent.listenerCount('SIGINT')).toBe(0)
      expect(parent.listenerCount('SIGTERM')).toBe(0)
    },
  )

  it('treats a pre-spawn emitted error as a confirmed start failure', async () => {
    const parent = new EventEmitter()
    const child = new FakeChild()
    const pending = bounded.runBoundedChild({
      executable: 'electron',
      spawnImpl: () => child,
      processLike: parent,
      timeoutMs: 1_000,
    })
    child.emit('error', new Error('private start error'))

    await expect(pending).resolves.toMatchObject({
      startFailed: true,
      terminationConfirmed: true,
    })
  })

  it('rejects arbitrary secret-bearing status codes from public output', () => {
    expect(bounded.publicStatusLine('CodexSecretPath-DoNotLeak')).toBe(
      '{"code":"SMOKE_LAUNCHER_FAILED","ok":false}',
    )
  })
})
