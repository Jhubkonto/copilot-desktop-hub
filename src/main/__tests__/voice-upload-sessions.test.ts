import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VOICE_UPLOAD_CHUNK_BYTES,
  VOICE_UPLOAD_TIMEOUT_MS,
  VoiceUploadSessionManager,
} from '../voice-upload-sessions'

function startedSessionId(reply: ReturnType<VoiceUploadSessionManager['start']>): string {
  if (reply.event !== 'voice:upload-started') throw new Error('session did not start')
  return reply.data.sessionId
}

function encoded(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('VoiceUploadSessionManager', () => {
  it('accepts ordered PCM chunks and transcribes exactly once as a WAV', async () => {
    const transcribe = vi.fn(async (wav: Uint8Array) => {
      expect(new TextDecoder('ascii').decode(wav.subarray(0, 4))).toBe('RIFF')
      expect(new TextDecoder('ascii').decode(wav.subarray(8, 12))).toBe('WAVE')
      expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4])
      return { text: 'hello' }
    })
    const manager = new VoiceUploadSessionManager({ createId: () => 'voice-1', transcribe })
    const sessionId = startedSessionId(manager.start('client-a'))

    expect(manager.append('client-a', sessionId, 0, encoded([1, 2]))).toMatchObject({
      event: 'voice:upload-ack',
      data: { nextSequence: 1, receivedBytes: 2 },
    })
    manager.append('client-a', sessionId, 1, encoded([3, 4]))

    await expect(manager.finish('client-a', sessionId)).resolves.toEqual({
      event: 'voice:transcription',
      data: { sessionId, text: 'hello' },
    })
    await expect(manager.finish('client-a', sessionId)).resolves.toMatchObject({
      event: 'voice:upload-error',
      data: { code: 'session-not-found' },
    })
    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(manager.activeSessionCount()).toBe(0)
  })

  it('rejects another connection and invalid sequence without exposing audio', () => {
    const manager = new VoiceUploadSessionManager({ createId: () => 'voice-2' })
    const sessionId = startedSessionId(manager.start('client-a'))
    expect(manager.append('client-b', sessionId, 0, encoded([1, 2]))).toMatchObject({
      event: 'voice:upload-error',
      data: { code: 'session-not-found' },
    })
    expect(manager.append('client-a', sessionId, 1, encoded([1, 2]))).toMatchObject({
      event: 'voice:upload-error',
      data: { code: 'invalid-sequence' },
    })
    expect(manager.activeSessionCount()).toBe(0)
  })

  it('cleans up cancel, disconnect, malformed chunks, and oversized chunks', () => {
    const manager = new VoiceUploadSessionManager()
    const cancelId = startedSessionId(manager.start('client-a'))
    expect(manager.cancel('client-a', cancelId).event).toBe('voice:upload-cancelled')

    const malformedId = startedSessionId(manager.start('client-a'))
    manager.append('client-a', malformedId, 0, '')

    const oversizedId = startedSessionId(manager.start('client-a'))
    manager.append('client-a', oversizedId, 0, Buffer.alloc(VOICE_UPLOAD_CHUNK_BYTES + 1).toString('base64'))

    startedSessionId(manager.start('client-a'))
    startedSessionId(manager.start('client-b'))
    manager.disconnect('client-a')
    expect(manager.activeSessionCount()).toBe(1)
    manager.disconnect('client-b')
    expect(manager.activeSessionCount()).toBe(0)
  })

  it('expires idle uploads and releases their buffered audio', () => {
    vi.useFakeTimers()
    const onTimeout = vi.fn()
    const manager = new VoiceUploadSessionManager({ onTimeout })
    startedSessionId(manager.start('client-a'))
    vi.advanceTimersByTime(VOICE_UPLOAD_TIMEOUT_MS)
    expect(manager.activeSessionCount()).toBe(0)
    expect(onTimeout).toHaveBeenCalledWith(expect.objectContaining({
      event: 'voice:upload-error',
      data: expect.objectContaining({ code: 'upload-timeout' }),
    }))
  })

  it('normalizes transcription failures and cleans the session', async () => {
    const manager = new VoiceUploadSessionManager({
      createId: () => 'voice-3',
      transcribe: async () => { throw new Error('Whisper crashed') },
    })
    const sessionId = startedSessionId(manager.start('client-a'))
    manager.append('client-a', sessionId, 0, encoded([1, 2]))
    await expect(manager.finish('client-a', sessionId)).resolves.toMatchObject({
      event: 'voice:upload-error',
      data: { code: 'transcription-failed', message: 'Whisper crashed' },
    })
    expect(manager.activeSessionCount()).toBe(0)
  })
})
