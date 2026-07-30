import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createQuickRecap,
  readSpokenOutputSettings,
  sanitizeForSpeech,
  writeSpokenOutputSettings,
  type SpokenOutputSettings,
} from '../lib/spoken-output'
import type { MessageSpokenOutput, SpokenOutputKind } from '../../shared/spoken-output'
import { isApiError } from '../../shared/types'

export type SpokenPlaybackState = 'idle' | 'speaking' | 'paused'
export type PlaybackSpokenOutputKind = Extract<SpokenOutputKind, 'response' | 'quick-recap' | 'ai-recap'>

interface ActiveSpokenOutput {
  messageId: string
  text: string
  kind: PlaybackSpokenOutputKind
  model: string | null
}

export function useSpokenOutput() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [state, setState] = useState<SpokenPlaybackState>('idle')
  const [active, setActive] = useState<ActiveSpokenOutput | null>(null)
  const [aiRecapMessageId, setAiRecapMessageId] = useState<string | null>(null)
  const [aiRecapError, setAiRecapError] = useState<string | null>(null)
  const [aiRecapErrorMessageId, setAiRecapErrorMessageId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [settings, setSettingsState] = useState<SpokenOutputSettings>(
    () => readSpokenOutputSettings(localStorage),
  )
  const activeRef = useRef<ActiveSpokenOutput | null>(null)
  const playbackSequenceRef = useRef(0)
  const aiRecapPendingRef = useRef<string | null>(null)
  activeRef.current = active

  const refreshVoices = useCallback(() => {
    if (!supported) return
    setVoices(window.speechSynthesis.getVoices())
  }, [supported])

  useEffect(() => {
    if (!supported) return
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
      window.speechSynthesis.cancel()
    }
  }, [refreshVoices, supported])

  const setSettings = useCallback((next: SpokenOutputSettings) => {
    setSettingsState(next)
    writeSpokenOutputSettings(localStorage, next)
  }, [])

  const stop = useCallback(() => {
    playbackSequenceRef.current += 1
    if (supported) window.speechSynthesis.cancel()
    setState('idle')
    setActive(null)
  }, [supported])

  const speakText = useCallback((
    messageId: string,
    input: string,
    kind: PlaybackSpokenOutputKind = 'response',
    model: string | null = null,
  ) => {
    if (!supported) return
    const text = kind === 'quick-recap' ? createQuickRecap(input) : sanitizeForSpeech(input)
    if (!text) return

    const playbackSequence = playbackSequenceRef.current + 1
    playbackSequenceRef.current = playbackSequence
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const availableVoices = window.speechSynthesis.getVoices()
    const eligibleVoices = settings.offlineOnly
      ? availableVoices.filter((voice) => voice.localService)
      : availableVoices
    const selectedVoice = eligibleVoices.find((voice) => voice.voiceURI === settings.voiceUri)
      ?? eligibleVoices[0]
    if (selectedVoice) utterance.voice = selectedVoice
    utterance.rate = settings.rate
    utterance.pitch = settings.pitch

    const nextActive = { messageId, text, kind, model }
    utterance.onstart = () => {
      setActive(nextActive)
      setState('speaking')
    }
    utterance.onend = () => {
      if (playbackSequenceRef.current === playbackSequence) {
        setActive(null)
        setState('idle')
      }
    }
    utterance.onerror = utterance.onend
    setActive(nextActive)
    setState('speaking')
    window.speechSynthesis.speak(utterance)
  }, [settings, supported])

  const pause = useCallback(() => {
    if (!supported || state !== 'speaking') return
    window.speechSynthesis.pause()
    setState('paused')
  }, [state, supported])

  const resume = useCallback(() => {
    if (!supported || state !== 'paused') return
    window.speechSynthesis.resume()
    setState('speaking')
  }, [state, supported])

  const replay = useCallback(() => {
    if (!active) return
    speakText(active.messageId, active.text, active.kind, active.model)
  }, [active, speakText])
  const speakResponse = useCallback(
    (messageId: string, content: string) => {
      const text = sanitizeForSpeech(content)
      if (!text) return
      void window.api?.saveSpokenOutput({
        messageId,
        spokenText: text,
        outputKind: 'response',
        generationKind: 'deterministic',
      }).catch(() => {})
      speakText(messageId, text, 'response')
    },
    [speakText],
  )
  const speakQuickRecap = useCallback(
    (messageId: string, content: string) => {
      const text = createQuickRecap(content)
      if (!text) return
      void window.api?.saveSpokenOutput({
        messageId,
        spokenText: text,
        outputKind: 'quick-recap',
        generationKind: 'deterministic',
      }).catch(() => {})
      speakText(messageId, text, 'quick-recap')
    },
    [speakText],
  )
  const speakAiRecap = useCallback(async (messageId: string) => {
    if (aiRecapPendingRef.current) return
    aiRecapPendingRef.current = messageId
    setAiRecapMessageId(messageId)
    setAiRecapError(null)
    setAiRecapErrorMessageId(null)
    try {
      const result = await window.api.generateAiRecap(messageId)
      if (isApiError(result)) {
        setAiRecapError(result.error)
        setAiRecapErrorMessageId(messageId)
        return
      }
      const output = result as MessageSpokenOutput | null
      if (!output) {
        setAiRecapError('No provider or Claude CLI is available for an AI recap.')
        setAiRecapErrorMessageId(messageId)
        return
      }
      speakText(messageId, output.spokenText, 'ai-recap', output.model)
    } catch (error) {
      setAiRecapError(error instanceof Error ? error.message : 'AI recap failed.')
      setAiRecapErrorMessageId(messageId)
    } finally {
      aiRecapPendingRef.current = null
      setAiRecapMessageId(null)
    }
  }, [speakText])

  return {
    supported,
    state,
    active,
    voices: settings.offlineOnly ? voices.filter((voice) => voice.localService) : voices,
    settings,
    setSettings,
    speakResponse,
    speakQuickRecap,
    speakAiRecap,
    aiRecapMessageId,
    aiRecapError,
    aiRecapErrorMessageId,
    pause,
    resume,
    stop,
    replay,
  }
}
