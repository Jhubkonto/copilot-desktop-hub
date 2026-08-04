import { describe, expect, it, vi } from 'vitest'
import {
  encodeVoiceWav,
  PcmVoiceRecorder,
  VOICE_SAMPLE_RATE,
  type VoiceRecorderSnapshot,
} from '../lib/pcm-voice-recorder'

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

function createRecorderHarness(options: {
  maxDurationMs?: number
  maxBytes?: number
  audioWorklet?: boolean
} = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] }
  const source = new FakeNode()
  const processor = Object.assign(new FakeNode(), {
    onaudioprocess: null as ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
  })
  const gain = Object.assign(new FakeNode(), { gain: { value: 1 } })
  const close = vi.fn().mockResolvedValue(undefined)
  const addModule = vi.fn().mockResolvedValue(undefined)
  const context = {
    sampleRate: 48_000,
    audioWorklet: options.audioWorklet ? { addModule } : undefined,
    destination: new FakeNode(),
    createMediaStreamSource: vi.fn(() => source),
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => gain),
    close,
  }
  let now = 1_000
  let intervalCallback: (() => void) | null = null
  const clearInterval = vi.fn()
  const snapshots: VoiceRecorderSnapshot[] = []
  const onLimit = vi.fn()
  const recorder = new PcmVoiceRecorder({
    maxDurationMs: options.maxDurationMs,
    maxBytes: options.maxBytes,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onLimit,
    environment: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      createAudioContext: vi.fn(() => context as unknown as AudioContext),
      now: () => now,
      setInterval: vi.fn((callback: () => void) => {
        intervalCallback = callback
        return 7 as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof setInterval,
      clearInterval: clearInterval as unknown as typeof clearInterval,
    },
  })
  return {
    recorder,
    processor,
    track,
    source,
    gain,
    close,
    clearInterval,
    snapshots,
    onLimit,
    addModule,
    advance(ms: number) {
      now += ms
      const callback = intervalCallback as (() => void) | null
      callback?.()
    },
    emit(chunk: Float32Array) {
      processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => chunk },
      })
    },
  }
}

describe('PcmVoiceRecorder', () => {
  it('prefers AudioWorklet capture when the runtime supports it', async () => {
    const workletNode = Object.assign(new FakeNode(), {
      port: { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null },
    })
    class FakeAudioWorkletNode {
      port = workletNode.port
      connect = workletNode.connect
      disconnect = workletNode.disconnect
    }
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const harness = createRecorderHarness({ audioWorklet: true })

    try {
      await harness.recorder.start()
      workletNode.port.onmessage?.({
        data: new Float32Array([0.5, -0.5]),
      } as MessageEvent<Float32Array>)
      const recording = await harness.recorder.stop()

      expect(harness.addModule).toHaveBeenCalledOnce()
      expect(String(harness.addModule.mock.calls[0][0])).not.toMatch(/^blob:/)
      expect(harness.processor.onaudioprocess).toBeNull()
      expect(recording?.bytes).toBe(8)
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })

  it('exposes explicit start and stop primitives with duration, level, and byte state', async () => {
    const harness = createRecorderHarness()
    await harness.recorder.start()

    harness.emit(new Float32Array([0.5, -0.5, 0.5, -0.5]))
    harness.advance(250)
    const recording = await harness.recorder.stop()

    expect(recording).toMatchObject({
      sampleRate: 48_000,
      durationMs: 250,
      bytes: 16,
    })
    expect(recording?.chunks).toHaveLength(1)
    expect(harness.snapshots.at(-1)).toMatchObject({
      durationMs: 250,
      level: 0.5,
      bytes: 16,
    })
    expect(harness.track.stop).toHaveBeenCalledOnce()
    expect(harness.close).toHaveBeenCalledOnce()
    expect(harness.recorder.isRecording).toBe(false)
  })

  it('cancels without returning captured audio and releases every resource', async () => {
    const harness = createRecorderHarness()
    await harness.recorder.start()
    harness.emit(new Float32Array([0.25, 0.25]))

    await harness.recorder.cancel()
    expect(await harness.recorder.stop()).toBeNull()
    expect(harness.track.stop).toHaveBeenCalledOnce()
    expect(harness.source.disconnect).toHaveBeenCalledOnce()
    expect(harness.gain.disconnect).toHaveBeenCalledOnce()
    expect(harness.clearInterval).toHaveBeenCalledOnce()
  })

  it('reports duration and size limits exactly once', async () => {
    const durationHarness = createRecorderHarness({ maxDurationMs: 100 })
    await durationHarness.recorder.start()
    durationHarness.advance(100)
    durationHarness.advance(100)
    expect(durationHarness.onLimit).toHaveBeenCalledOnce()
    expect(durationHarness.onLimit).toHaveBeenCalledWith('duration')
    await durationHarness.recorder.cancel()

    const sizeHarness = createRecorderHarness({ maxBytes: 8 })
    await sizeHarness.recorder.start()
    sizeHarness.emit(new Float32Array([1, 1]))
    sizeHarness.emit(new Float32Array([1, 1]))
    expect(sizeHarness.onLimit).toHaveBeenCalledOnce()
    expect(sizeHarness.onLimit).toHaveBeenCalledWith('size')
    await sizeHarness.recorder.cancel()
  })
})

describe('encodeVoiceWav', () => {
  it('creates a mono PCM16 WAV resampled to 16 kHz', () => {
    const wav = encodeVoiceWav([new Float32Array(48_000).fill(0.25)], 48_000)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(VOICE_SAMPLE_RATE * 2)
  })
})
