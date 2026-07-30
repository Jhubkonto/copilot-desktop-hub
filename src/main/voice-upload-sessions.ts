import { randomUUID } from 'crypto'

export const VOICE_UPLOAD_CHUNK_BYTES = 32 * 1024
export const VOICE_UPLOAD_TIMEOUT_MS = 30_000
export const VOICE_UPLOAD_MAX_DURATION_MS = 10 * 60 * 1000
export const VOICE_UPLOAD_MAX_PCM_BYTES = 16_000 * 2 * (VOICE_UPLOAD_MAX_DURATION_MS / 1000)
const MAX_LOCAL_WHISPER_AUDIO_BYTES = 50 * 1024 * 1024

export type VoiceUploadReply =
  | { event: 'voice:upload-started'; data: { sessionId: string; chunkBytes: number; maxBytes: number } }
  | { event: 'voice:upload-ack'; data: { sessionId: string; nextSequence: number; receivedBytes: number } }
  | { event: 'voice:transcription'; data: { sessionId: string; text: string } }
  | { event: 'voice:upload-cancelled'; data: { sessionId: string } }
  | { event: 'voice:upload-error'; data: { sessionId?: string; code: string; message: string } }

interface VoiceUploadSession {
  id: string
  connectionId: string
  chunks: Uint8Array[]
  receivedBytes: number
  nextSequence: number
  timeout: ReturnType<typeof setTimeout>
  notify?: (reply: VoiceUploadReply) => void
}

interface VoiceUploadRuntime {
  transcribe: (audio: Uint8Array) => Promise<{ text: string } | { error: string }>
  createId: () => string
  onTimeout?: (reply: VoiceUploadReply) => void
}

function pcm16MonoToWav(pcm: Uint8Array, sampleRate = 16_000): Uint8Array {
  const wav = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(wav.buffer)
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) wav[offset + index] = value.charCodeAt(index)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  wav.set(pcm, 44)
  return wav
}

function decodeChunk(dataBase64: unknown): Uint8Array | null {
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) return null
  try {
    const decoded = Buffer.from(dataBase64, 'base64')
    if (decoded.byteLength === 0 || decoded.byteLength > VOICE_UPLOAD_CHUNK_BYTES) return null
    return decoded
  } catch {
    return null
  }
}

export class VoiceUploadSessionManager {
  private readonly sessions = new Map<string, VoiceUploadSession>()
  private readonly runtime: VoiceUploadRuntime

  constructor(runtime: Partial<VoiceUploadRuntime> = {}) {
    this.runtime = {
      transcribe: runtime.transcribe ?? (async (audio) => {
        const { transcribeLocalWhisper } = await import('./local-whisper')
        return transcribeLocalWhisper(audio)
      }),
      createId: runtime.createId ?? randomUUID,
      onTimeout: runtime.onTimeout,
    }
  }

  start(connectionId: string, notify?: (reply: VoiceUploadReply) => void): VoiceUploadReply {
    if (!connectionId) return this.error(undefined, 'invalid-connection', 'Voice upload requires an authenticated connection.')
    this.disconnect(connectionId)
    const id = this.runtime.createId()
    const session: VoiceUploadSession = {
      id,
      connectionId,
      chunks: [],
      receivedBytes: 0,
      nextSequence: 0,
      timeout: setTimeout(() => this.expire(id), VOICE_UPLOAD_TIMEOUT_MS),
      notify,
    }
    this.sessions.set(id, session)
    return {
      event: 'voice:upload-started',
      data: { sessionId: id, chunkBytes: VOICE_UPLOAD_CHUNK_BYTES, maxBytes: VOICE_UPLOAD_MAX_PCM_BYTES },
    }
  }

  append(connectionId: string, sessionId: unknown, sequence: unknown, dataBase64: unknown): VoiceUploadReply {
    const session = this.ownedSession(connectionId, sessionId)
    if (!session) return this.errorString(sessionId, 'session-not-found', 'Voice upload session was not found.')
    if (!Number.isInteger(sequence) || sequence !== session.nextSequence) {
      this.remove(session.id)
      return this.error(session.id, 'invalid-sequence', 'Voice upload chunks arrived out of order.')
    }
    const chunk = decodeChunk(dataBase64)
    if (!chunk) {
      this.remove(session.id)
      return this.error(session.id, 'invalid-chunk', 'Voice upload chunk is empty, malformed, or oversized.')
    }
    if (session.receivedBytes + chunk.byteLength > Math.min(
      VOICE_UPLOAD_MAX_PCM_BYTES,
      MAX_LOCAL_WHISPER_AUDIO_BYTES - 44,
    )) {
      this.remove(session.id)
      return this.error(session.id, 'oversized-input', 'Voice recording exceeds the 50 MiB limit.')
    }
    session.chunks.push(chunk)
    session.receivedBytes += chunk.byteLength
    session.nextSequence += 1
    this.refreshTimeout(session)
    return {
      event: 'voice:upload-ack',
      data: { sessionId: session.id, nextSequence: session.nextSequence, receivedBytes: session.receivedBytes },
    }
  }

  async finish(connectionId: string, sessionId: unknown): Promise<VoiceUploadReply> {
    const session = this.ownedSession(connectionId, sessionId)
    if (!session) return this.errorString(sessionId, 'session-not-found', 'Voice upload session was not found.')
    clearTimeout(session.timeout)
    this.sessions.delete(session.id)
    if (session.receivedBytes < 2 || session.receivedBytes % 2 !== 0) {
      session.chunks.length = 0
      return this.error(session.id, 'invalid-audio', 'Voice recording does not contain valid 16-bit PCM audio.')
    }
    const pcm = new Uint8Array(session.receivedBytes)
    let offset = 0
    for (const chunk of session.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.byteLength
    }
    session.chunks.length = 0
    try {
      const result = await this.runtime.transcribe(pcm16MonoToWav(pcm))
      if ('error' in result) return this.error(session.id, 'transcription-failed', result.error)
      return { event: 'voice:transcription', data: { sessionId: session.id, text: result.text } }
    } catch (error) {
      return this.error(
        session.id,
        'transcription-failed',
        error instanceof Error ? error.message : 'Local transcription failed.',
      )
    }
  }

  cancel(connectionId: string, sessionId: unknown): VoiceUploadReply {
    const session = this.ownedSession(connectionId, sessionId)
    if (!session) return this.errorString(sessionId, 'session-not-found', 'Voice upload session was not found.')
    this.remove(session.id)
    return { event: 'voice:upload-cancelled', data: { sessionId: session.id } }
  }

  disconnect(connectionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.connectionId === connectionId) this.remove(session.id)
    }
  }

  activeSessionCount(): number {
    return this.sessions.size
  }

  private ownedSession(connectionId: string, sessionId: unknown): VoiceUploadSession | null {
    if (typeof sessionId !== 'string') return null
    const session = this.sessions.get(sessionId)
    return session?.connectionId === connectionId ? session : null
  }

  private refreshTimeout(session: VoiceUploadSession): void {
    clearTimeout(session.timeout)
    session.timeout = setTimeout(() => this.expire(session.id), VOICE_UPLOAD_TIMEOUT_MS)
  }

  private expire(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.remove(sessionId)
    const reply = this.error(sessionId, 'upload-timeout', 'Voice upload timed out.')
    session.notify?.(reply)
    this.runtime.onTimeout?.(reply)
  }

  private remove(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    clearTimeout(session.timeout)
    session.chunks.length = 0
    this.sessions.delete(sessionId)
  }

  private error(sessionId: string | undefined, code: string, message: string): VoiceUploadReply {
    return { event: 'voice:upload-error', data: { ...(sessionId ? { sessionId } : {}), code, message } }
  }

  private errorString(sessionId: unknown, code: string, message: string): VoiceUploadReply {
    return this.error(typeof sessionId === 'string' ? sessionId : undefined, code, message)
  }
}
