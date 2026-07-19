import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { runProcess, writeJpegFrame } = require('../electron/video-export.cjs') as {
  runProcess(
    executable: string,
    args: string[],
    options: {
      signal?: AbortSignal
      inputWriter?: (stream: PassThrough) => Promise<void>
      spawnImpl: () => FakeChild
    },
  ): Promise<void>
  writeJpegFrame(stream: PassThrough, frame: Buffer, signal?: AbortSignal): Promise<void>
}

type FakeChild = EventEmitter & {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  stderr: PassThrough
  stdin: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  }) as FakeChild
  child.kill.mockImplementation((signal: NodeJS.Signals) => {
    child.signalCode = signal
    queueMicrotask(() => child.emit('close', null, signal))
    return true
  })
  return child
}

describe('video export FFmpeg process boundary', () => {
  it('resolves after a successful writer and FFmpeg close', async () => {
    const child = fakeChild()
    const result = runProcess('ffmpeg', [], {
      spawnImpl: () => child,
      inputWriter: async () => {},
    })

    queueMicrotask(() => child.emit('close', 0, null))

    await expect(result).resolves.toBeUndefined()
  })

  it('preserves a writer failure when FFmpeg exits during teardown', async () => {
    const child = fakeChild()
    const writerError = new Error('renderer frame transaction failed')

    const result = runProcess('ffmpeg', [], {
      spawnImpl: () => child,
      inputWriter: async () => {
        throw writerError
      },
    })

    await expect(result).rejects.toBe(writerError)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
  })

  it('retains bounded FFmpeg diagnostics when the writer succeeds', async () => {
    const child = fakeChild()
    const result = runProcess('ffmpeg', [], {
      spawnImpl: () => child,
      inputWriter: async () => {},
    })

    child.stderr.write('encoder rejected the stream')
    queueMicrotask(() => child.emit('close', 1, null))

    await expect(result).rejects.toThrow('FFmpeg failed: encoder rejected the stream')
  })

  it('retains FFmpeg diagnostics when child termination breaks the active writer pipe', async () => {
    const child = fakeChild()
    const pipeError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    const result = runProcess('ffmpeg', [], {
      spawnImpl: () => child,
      inputWriter: async () => {
        await new Promise<void>((_resolve, reject) => {
          child.stdin.once('error', reject)
        })
      },
    })

    child.stderr.write('encoder root cause')
    child.stdin.emit('error', pipeError)
    queueMicrotask(() => child.emit('close', 1, null))

    await expect(result).rejects.toThrow('FFmpeg failed: encoder root cause')
  })

  it('classifies the production destroyed-stream frame error as child input termination', async () => {
    const child = fakeChild()
    const result = runProcess('ffmpeg', [], {
      spawnImpl: () => child,
      inputWriter: async (stream) => {
        stream.destroy()
        await writeJpegFrame(stream, Buffer.from('frame'))
      },
    })
    child.stderr.write('encoder root cause')

    await expect(result).rejects.toThrow('FFmpeg failed (SIGINT): encoder root cause')
  })

  it('preserves abort precedence during writer teardown', async () => {
    const child = fakeChild()
    const controller = new AbortController()
    const result = runProcess('ffmpeg', [], {
      signal: controller.signal,
      spawnImpl: () => child,
      inputWriter: async () => {
        throw new Error('renderer failed after cancellation')
      },
    })

    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})
