import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupMockApi } from '../../../test/mocks/api'

const recorderHarness = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  options: null as null | {
    onSnapshot?: (snapshot: { durationMs: number; level: number; bytes: number }) => void
    onLimit?: (limit: 'duration' | 'size') => void
  },
}))

vi.mock('../../lib/pcm-voice-recorder', () => ({
  encodeVoiceWav: vi.fn(() => new Uint8Array([1, 2, 3])),
  PcmVoiceRecorder: class {
    constructor(options: typeof recorderHarness.options) {
      recorderHarness.options = options
    }

    start = recorderHarness.start
    stop = recorderHarness.stop
    cancel = recorderHarness.cancel
  },
}))

import { useVoiceInput } from '../../hooks/useVoiceInput'

beforeEach(() => {
  recorderHarness.start.mockReset().mockResolvedValue(undefined)
  recorderHarness.stop.mockReset().mockResolvedValue({
    chunks: [new Float32Array([0.25])],
    sampleRate: 48_000,
    durationMs: 100,
    bytes: 4,
  })
  recorderHarness.cancel.mockReset().mockResolvedValue(undefined)
  recorderHarness.options = null
})

describe('useVoiceInput', () => {
  it('supports explicit start/stop and transcribes exactly once', async () => {
    const api = setupMockApi()
    api.getVoiceStatus.mockResolvedValue({ ready: true })
    window.api.transcribeVoice = vi.fn().mockResolvedValue({ text: 'spoken result' })
    const onText = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useVoiceInput(onText, onError))

    await act(async () => result.current.startVoice())
    expect(result.current.voiceState).toBe('recording')

    act(() => recorderHarness.options?.onSnapshot?.({
      durationMs: 1_250,
      level: 0.4,
      bytes: 32_000,
    }))
    expect(result.current).toMatchObject({
      voiceDurationMs: 1_250,
      voiceLevel: 0.4,
      voiceBytes: 32_000,
    })

    await act(async () => result.current.stopVoice())
    await waitFor(() => expect(result.current.voiceState).toBe('idle'))
    expect(window.api.transcribeVoice).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith('spoken result')
    expect(onError).not.toHaveBeenCalled()
  })

  it('coalesces repeated stop requests into one transcription', async () => {
    const api = setupMockApi()
    api.getVoiceStatus.mockResolvedValue({ ready: true })
    let resolveStop: ((value: {
      chunks: Float32Array[]
      sampleRate: number
      durationMs: number
      bytes: number
    }) => void) | null = null
    recorderHarness.stop.mockImplementation(() => new Promise((resolve) => {
      resolveStop = resolve
    }))
    window.api.transcribeVoice = vi.fn().mockResolvedValue({ text: 'once' })
    const onText = vi.fn()
    const { result } = renderHook(() => useVoiceInput(onText, vi.fn()))

    await act(async () => result.current.startVoice())
    let firstStop: Promise<void>
    await act(async () => {
      firstStop = result.current.stopVoice()
      await result.current.stopVoice()
    })
    expect(recorderHarness.stop).toHaveBeenCalledOnce()

    await act(async () => {
      const finish = resolveStop as ((value: {
        chunks: Float32Array[]
        sampleRate: number
        durationMs: number
        bytes: number
      }) => void) | null
      finish?.({
        chunks: [new Float32Array([0.5])],
        sampleRate: 48_000,
        durationMs: 100,
        bytes: 4,
      })
      await firstStop!
    })
    expect(window.api.transcribeVoice).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledOnce()
  })

  it('cancel discards capture without transcribing or changing draft callbacks', async () => {
    const api = setupMockApi()
    api.getVoiceStatus.mockResolvedValue({ ready: true })
    window.api.transcribeVoice = vi.fn()
    const onText = vi.fn()
    const { result } = renderHook(() => useVoiceInput(onText, vi.fn()))

    await act(async () => result.current.startVoice())
    await act(async () => result.current.cancelVoice())

    expect(result.current.voiceState).toBe('idle')
    expect(recorderHarness.cancel).toHaveBeenCalledOnce()
    expect(window.api.transcribeVoice).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })

  it('leaves the draft unchanged when the recording or transcript has no audio', async () => {
    const api = setupMockApi()
    api.getVoiceStatus.mockResolvedValue({ ready: true })
    window.api.transcribeVoice = vi.fn().mockResolvedValue({ text: '[BLANK_AUDIO]' })
    const onText = vi.fn()
    const { result } = renderHook(() => useVoiceInput(onText, vi.fn()))

    await act(async () => result.current.startVoice())
    await act(async () => result.current.stopVoice())

    expect(window.api.transcribeVoice).toHaveBeenCalledOnce()
    expect(onText).not.toHaveBeenCalled()

    recorderHarness.stop.mockResolvedValue({
      chunks: [],
      sampleRate: 48_000,
      durationMs: 0,
      bytes: 0,
    })
    await act(async () => result.current.startVoice())
    await act(async () => result.current.stopVoice())

    expect(window.api.transcribeVoice).toHaveBeenCalledOnce()
    expect(onText).not.toHaveBeenCalled()
  })

  it('keeps errors visible and never inserts text when transcription fails', async () => {
    const api = setupMockApi()
    api.getVoiceStatus.mockResolvedValue({ ready: true })
    window.api.transcribeVoice = vi.fn().mockResolvedValue({ error: 'Whisper failed.' })
    const onText = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useVoiceInput(onText, onError))

    await act(async () => result.current.startVoice())
    await act(async () => result.current.stopVoice())

    expect(result.current.voiceError).toBe('Whisper failed.')
    expect(onError).toHaveBeenCalledWith('Whisper failed.')
    expect(onText).not.toHaveBeenCalled()
  })

  it('cancels voice work when the initiating conversation changes', async () => {
    const api = setupMockApi()
    api.getVoiceStatus.mockResolvedValue({ ready: true })
    let resolveTranscription: ((value: { text: string }) => void) | null = null
    window.api.transcribeVoice = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveTranscription = resolve
    }))
    const onText = vi.fn()
    const { result, rerender } = renderHook(
      ({ contextKey }) => useVoiceInput(onText, vi.fn(), contextKey),
      { initialProps: { contextKey: 'conversation-a' } },
    )

    await act(async () => result.current.startVoice())
    let stopping: Promise<void>
    act(() => {
      stopping = result.current.stopVoice()
    })
    await waitFor(() => expect(window.api.transcribeVoice).toHaveBeenCalledOnce())
    rerender({ contextKey: 'conversation-b' })
    await act(async () => {
      resolveTranscription?.({ text: 'late transcript' })
      await stopping!
    })

    expect(onText).not.toHaveBeenCalled()
    expect(result.current.voiceState).toBe('idle')
  })
})
