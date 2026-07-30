import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '../../shared/types'
import {
  encodeVoiceWav,
  PcmVoiceRecorder,
  type VoiceRecorderSnapshot,
} from '../lib/pcm-voice-recorder'
import { usableVoiceTranscript } from '../lib/voice-transcript'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

const EMPTY_SNAPSHOT: VoiceRecorderSnapshot = { durationMs: 0, level: 0, bytes: 0 }

export function useVoiceInput(
  onText: (text: string) => void,
  onError: (message: string) => void,
  contextKey?: string | null,
) {
  const [state, setState] = useState<VoiceState>('idle')
  const [snapshot, setSnapshot] = useState<VoiceRecorderSnapshot>(EMPTY_SNAPSHOT)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recorderRef = useRef<PcmVoiceRecorder | null>(null)
  const stateRef = useRef<VoiceState>('idle')
  const operationPendingRef = useRef(false)
  const operationEpochRef = useRef(0)
  const onTextRef = useRef(onText)
  const onErrorRef = useRef(onError)
  onTextRef.current = onText
  onErrorRef.current = onError

  const updateState = useCallback((next: VoiceState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const reportError = useCallback((message: string) => {
    setVoiceError(message)
    onErrorRef.current(message)
  }, [])

  const cancel = useCallback(async () => {
    operationEpochRef.current += 1
    const recorder = recorderRef.current
    recorderRef.current = null
    await recorder?.cancel()
    operationPendingRef.current = false
    setSnapshot(EMPTY_SNAPSHOT)
    updateState('idle')
  }, [updateState])

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording' || operationPendingRef.current) return
    operationPendingRef.current = true
    const operationEpoch = operationEpochRef.current
    const recorder = recorderRef.current
    recorderRef.current = null
    updateState('transcribing')
    try {
      const recording = await recorder?.stop()
      if (!recording || recording.bytes <= 0 || !recording.chunks.some((chunk) => chunk.length > 0)) return
      const wav = encodeVoiceWav(recording.chunks, recording.sampleRate)
      const result = await window.api.transcribeVoice(wav)
      if (operationEpoch !== operationEpochRef.current) return
      if (isApiError(result)) reportError(result.error)
      else {
        const transcript = usableVoiceTranscript(result.text)
        if (transcript) onTextRef.current(transcript)
      }
    } catch (error) {
      reportError(error instanceof Error ? error.message : 'Voice transcription failed.')
    } finally {
      operationPendingRef.current = false
      setSnapshot(EMPTY_SNAPSHOT)
      updateState('idle')
    }
  }, [reportError, updateState])

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle' || operationPendingRef.current) return
    operationPendingRef.current = true
    const operationEpoch = operationEpochRef.current
    setVoiceError(null)
    try {
      const status = await window.api.getVoiceStatus()
      if (isApiError(status) || !status.ready) {
        reportError(isApiError(status) ? status.error : 'Install local Whisper in Settings → General before using voice input.')
        return
      }
      const recorder = new PcmVoiceRecorder({
        onSnapshot: setSnapshot,
        onLimit: (limit) => {
          reportError(limit === 'duration'
            ? 'Voice recording reached the 10-minute safety limit and is being transcribed.'
            : 'Voice recording reached the 50 MiB safety limit and is being transcribed.')
          void stop()
        },
      })
      recorderRef.current = recorder
      await recorder.start()
      if (operationEpoch !== operationEpochRef.current) {
        recorderRef.current = null
        await recorder.cancel()
        return
      }
      updateState('recording')
    } catch (error) {
      recorderRef.current = null
      reportError(error instanceof Error ? error.message : 'Microphone access failed.')
      updateState('idle')
    } finally {
      operationPendingRef.current = false
    }
  }, [reportError, stop, updateState])

  const toggle = useCallback(() => {
    if (stateRef.current === 'recording') void stop()
    else if (stateRef.current === 'idle') void start()
  }, [start, stop])

  useEffect(() => () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    void recorder?.cancel()
  }, [])

  const previousContextRef = useRef(contextKey)
  useEffect(() => {
    if (previousContextRef.current === contextKey) return
    previousContextRef.current = contextKey
    if (stateRef.current !== 'idle' || operationPendingRef.current) void cancel()
  }, [cancel, contextKey])

  return {
    voiceState: state,
    voiceDurationMs: snapshot.durationMs,
    voiceLevel: snapshot.level,
    voiceBytes: snapshot.bytes,
    voiceError,
    startVoice: start,
    stopVoice: stop,
    toggleVoice: toggle,
    cancelVoice: cancel,
  }
}
