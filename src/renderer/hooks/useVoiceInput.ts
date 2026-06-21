import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '../../shared/types'

type VoiceState = 'idle' | 'recording' | 'transcribing'

function encodeWav(chunks: Float32Array[], sourceRate: number): Uint8Array {
  const source = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { source.set(chunk, offset); offset += chunk.length }
  const targetRate = 16_000
  const ratio = sourceRate / targetRate
  const samples = new Float32Array(Math.max(1, Math.floor(source.length / ratio)))
  for (let i = 0; i < samples.length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(source.length, Math.floor((i + 1) * ratio))
    let total = 0
    for (let j = start; j < end; j += 1) total += source[j]
    samples[i] = total / Math.max(1, end - start)
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true))
  return new Uint8Array(buffer)
}

export function useVoiceInput(onText: (text: string) => void, onError: (message: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])

  const stop = useCallback(async () => {
    const context = contextRef.current
    const processor = processorRef.current
    const chunks = chunksRef.current
    processor?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null; processorRef.current = null; contextRef.current = null; chunksRef.current = []
    if (!context || chunks.length === 0) { setState('idle'); await context?.close(); return }
    const wav = encodeWav(chunks, context.sampleRate)
    await context.close()
    setState('transcribing')
    try {
      const result = await window.api.transcribeVoice(wav)
      if (isApiError(result)) onError(result.error)
      else onText(result.text)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Voice transcription failed.')
    } finally {
      setState('idle')
    }
  }, [onError, onText])

  const start = useCallback(async () => {
    try {
      const status = await window.api.getVoiceStatus()
      if (isApiError(status) || !status.ready) {
        onError(isApiError(status) ? status.error : 'Install local Whisper in Settings → General before using voice input.')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      chunksRef.current = []
      processor.onaudioprocess = (event) => chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      source.connect(processor); processor.connect(context.destination)
      streamRef.current = stream; contextRef.current = context; processorRef.current = processor
      setState('recording')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Microphone access failed.')
      setState('idle')
    }
  }, [onError])

  const toggle = useCallback(() => state === 'recording' ? void stop() : state === 'idle' ? void start() : undefined, [start, state, stop])
  useEffect(() => () => { processorRef.current?.disconnect(); streamRef.current?.getTracks().forEach((track) => track.stop()); void contextRef.current?.close() }, [])
  return { voiceState: state, toggleVoice: toggle }
}
