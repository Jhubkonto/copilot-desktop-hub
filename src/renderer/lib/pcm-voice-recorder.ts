export const VOICE_SAMPLE_RATE = 16_000
export const DEFAULT_MAX_VOICE_DURATION_MS = 10 * 60 * 1_000
export const DEFAULT_MAX_VOICE_BYTES = 50 * 1024 * 1024

export type VoiceRecorderLimit = 'duration' | 'size'

export interface VoiceRecorderSnapshot {
  durationMs: number
  level: number
  bytes: number
}

export interface VoiceRecording {
  chunks: Float32Array[]
  sampleRate: number
  durationMs: number
  bytes: number
}

interface RecorderEnvironment {
  getUserMedia: () => Promise<MediaStream>
  createAudioContext: () => AudioContext
  now: () => number
  setInterval: typeof globalThis.setInterval
  clearInterval: typeof globalThis.clearInterval
}

export interface PcmVoiceRecorderOptions {
  maxDurationMs?: number
  maxBytes?: number
  onSnapshot?: (snapshot: VoiceRecorderSnapshot) => void
  onLimit?: (limit: VoiceRecorderLimit) => void
  environment?: RecorderEnvironment
}

const WORKLET_SOURCE = `
class NexyPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) this.port.postMessage(channel.slice())
    return true
  }
}
registerProcessor('nexy-pcm-capture', NexyPcmCaptureProcessor)
`

function defaultEnvironment(): RecorderEnvironment {
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    }),
    createAudioContext: () => new AudioContext(),
    now: () => performance.now(),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  }
}

function calculateLevel(chunk: Float32Array): number {
  if (chunk.length === 0) return 0
  let sum = 0
  for (const sample of chunk) sum += sample * sample
  return Math.min(1, Math.sqrt(sum / chunk.length))
}

export function encodeVoiceWav(chunks: Float32Array[], sourceRate: number): Uint8Array {
  const source = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    source.set(chunk, offset)
    offset += chunk.length
  }

  const ratio = sourceRate / VOICE_SAMPLE_RATE
  const sampleCount = source.length === 0 ? 0 : Math.max(1, Math.floor(source.length / ratio))
  const samples = new Float32Array(sampleCount)
  for (let i = 0; i < samples.length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(source.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let total = 0
    for (let j = start; j < end; j += 1) total += source[j]
    samples[i] = total / Math.max(1, end - start)
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, VOICE_SAMPLE_RATE, true)
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff), true)
  })
  return new Uint8Array(buffer)
}

export class PcmVoiceRecorder {
  private readonly environment: RecorderEnvironment
  private readonly maxDurationMs: number
  private readonly maxBytes: number
  private readonly onSnapshot?: (snapshot: VoiceRecorderSnapshot) => void
  private readonly onLimit?: (limit: VoiceRecorderLimit) => void
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private captureNode: AudioNode | null = null
  private muteGain: GainNode | null = null
  private timer: ReturnType<typeof globalThis.setInterval> | null = null
  private startedAt = 0
  private chunks: Float32Array[] = []
  private bytes = 0
  private level = 0
  private limitReported = false

  constructor(options: PcmVoiceRecorderOptions = {}) {
    this.environment = options.environment ?? defaultEnvironment()
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_VOICE_DURATION_MS
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_VOICE_BYTES
    this.onSnapshot = options.onSnapshot
    this.onLimit = options.onLimit
  }

  get isRecording(): boolean {
    return this.context !== null
  }

  async start(): Promise<void> {
    if (this.isRecording) throw new Error('Voice recording is already active.')
    const stream = await this.environment.getUserMedia()
    const context = this.environment.createAudioContext()
    try {
      const source = context.createMediaStreamSource(stream)
      const captureNode = await this.createCaptureNode(context)
      const muteGain = context.createGain()
      muteGain.gain.value = 0
      source.connect(captureNode)
      captureNode.connect(muteGain)
      muteGain.connect(context.destination)

      this.stream = stream
      this.context = context
      this.source = source
      this.captureNode = captureNode
      this.muteGain = muteGain
      this.chunks = []
      this.bytes = 0
      this.level = 0
      this.limitReported = false
      this.startedAt = this.environment.now()
      this.emitSnapshot()
      this.timer = this.environment.setInterval(() => this.tick(), 100)
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      await context.close()
      throw error
    }
  }

  async stop(): Promise<VoiceRecording | null> {
    if (!this.context) return null
    const durationMs = this.durationMs()
    const chunks = this.chunks
    const bytes = this.bytes
    const sampleRate = this.context.sampleRate
    await this.teardown()
    return { chunks, sampleRate, durationMs, bytes }
  }

  async cancel(): Promise<void> {
    await this.teardown()
  }

  private async createCaptureNode(context: AudioContext): Promise<AudioNode> {
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
      try {
        await context.audioWorklet.addModule(blobUrl)
        const node = new AudioWorkletNode(context, 'nexy-pcm-capture')
        node.port.onmessage = (event: MessageEvent<Float32Array>) => this.receiveChunk(event.data)
        return node
      } catch {
        // Older Electron/audio devices can reject worklet setup. Keep a tested fallback.
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    }

    const processor = context.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      this.receiveChunk(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    return processor
  }

  private receiveChunk(chunk: Float32Array): void {
    if (!this.context || this.limitReported) return
    const copy = new Float32Array(chunk)
    this.chunks.push(copy)
    this.bytes += copy.byteLength
    this.level = calculateLevel(copy)
    this.emitSnapshot()
    if (this.bytes >= this.maxBytes) this.reportLimit('size')
  }

  private tick(): void {
    this.emitSnapshot()
    if (this.durationMs() >= this.maxDurationMs) this.reportLimit('duration')
  }

  private durationMs(): number {
    return this.context ? Math.max(0, this.environment.now() - this.startedAt) : 0
  }

  private emitSnapshot(): void {
    this.onSnapshot?.({
      durationMs: this.durationMs(),
      level: this.level,
      bytes: this.bytes,
    })
  }

  private reportLimit(limit: VoiceRecorderLimit): void {
    if (this.limitReported) return
    this.limitReported = true
    this.onLimit?.(limit)
  }

  private async teardown(): Promise<void> {
    const context = this.context
    if (!context) return
    this.context = null
    if (this.timer !== null) this.environment.clearInterval(this.timer)
    this.timer = null
    this.captureNode?.disconnect()
    this.source?.disconnect()
    this.muteGain?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.source = null
    this.captureNode = null
    this.muteGain = null
    this.chunks = []
    this.bytes = 0
    this.level = 0
    await context.close()
  }
}
