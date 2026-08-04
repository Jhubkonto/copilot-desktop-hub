import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createQuickRecap,
  readSpokenOutputSettings,
  sanitizeForSpeech,
  writeSpokenOutputSettings,
  type SpokenOutputSettings,
} from '../lib/spoken-output'
import type { MessageSpokenOutput, SpokenOutputKind } from '../../shared/spoken-output'
import type { SupertonicStatus } from '../../shared/neural-tts'
import { isApiError } from '../../shared/types'

export type SpokenPlaybackState = 'idle' | 'preparing' | 'speaking' | 'paused'
export type PlaybackSpokenOutputKind = Extract<SpokenOutputKind, 'response' | 'quick-recap' | 'ai-recap'>

interface ActiveSpokenOutput {
  messageId: string
  text: string
  kind: PlaybackSpokenOutputKind
  model: string | null
}

export function useSpokenOutput() {
  const systemSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const supported = systemSupported || (typeof window !== 'undefined' && typeof window.api?.synthesizeSupertonic === 'function')
  const [state, setState] = useState<SpokenPlaybackState>('idle')
  const [active, setActive] = useState<ActiveSpokenOutput | null>(null)
  const [aiRecapMessageId, setAiRecapMessageId] = useState<string | null>(null)
  const [aiRecapError, setAiRecapError] = useState<string | null>(null)
  const [aiRecapErrorMessageId, setAiRecapErrorMessageId] = useState<string | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [supertonicStatus, setSupertonicStatus] = useState<SupertonicStatus | null>(null)
  const [settings, setSettingsState] = useState<SpokenOutputSettings>(
    () => readSpokenOutputSettings(localStorage),
  )
  const activeRef = useRef<ActiveSpokenOutput | null>(null)
  const playbackSequenceRef = useRef(0)
  const aiRecapPendingRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  activeRef.current = active

  const showPlaybackError = useCallback((messageId: string, message: string) => {
    setAiRecapError(message)
    setAiRecapErrorMessageId(messageId)
    void window.api?.recordRendererError?.({
      level: 'warn',
      message: `Spoken output: ${message}`,
    }).catch(() => {})
  }, [])

  const refreshVoices = useCallback(() => {
    if (!systemSupported) return
    setVoices(window.speechSynthesis.getVoices())
  }, [systemSupported])

  useEffect(() => {
    if (!systemSupported) return
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
      window.speechSynthesis.cancel()
    }
  }, [refreshVoices, systemSupported])

  useEffect(() => {
    const refreshSupertonic = () => {
      void window.api?.getSupertonicStatus?.().then(setSupertonicStatus).catch(() => setSupertonicStatus(null))
    }
    refreshSupertonic()
    window.addEventListener('nexy:supertonic-status-changed', refreshSupertonic)
    return () => {
      window.removeEventListener('nexy:supertonic-status-changed', refreshSupertonic)
      audioRef.current?.pause()
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    }
  }, [])

  const setSettings = useCallback((next: SpokenOutputSettings) => {
    setSettingsState(next)
    writeSpokenOutputSettings(localStorage, next)
    window.dispatchEvent(new Event('nexy:spoken-output-settings-changed'))
  }, [])

  useEffect(() => {
    const syncSettings = () => setSettingsState(readSpokenOutputSettings(localStorage))
    window.addEventListener('nexy:spoken-output-settings-changed', syncSettings)
    return () => window.removeEventListener('nexy:spoken-output-settings-changed', syncSettings)
  }, [])

  const stop = useCallback(() => {
    playbackSequenceRef.current += 1
    if (systemSupported) window.speechSynthesis.cancel()
    audioRef.current?.pause()
    audioRef.current = null
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    audioUrlRef.current = null
    setState('idle')
    setActive(null)
  }, [systemSupported])

  const speakWithSystem = useCallback((
    messageId: string,
    text: string,
    kind: PlaybackSpokenOutputKind = 'response',
    model: string | null = null,
    playbackSequence = playbackSequenceRef.current + 1,
  ) => {
    if (!systemSupported) {
      showPlaybackError(messageId, 'Speech is unavailable on this device.')
      return
    }
    try {
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
      utterance.onerror = (event) => {
        if (playbackSequenceRef.current === playbackSequence && event.error !== 'canceled') {
          showPlaybackError(messageId, 'System speech could not play this response.')
        }
        utterance.onend?.(event)
      }
      setActive(nextActive)
      setState('speaking')
      window.speechSynthesis.speak(utterance)
    } catch (error) {
      setActive(null)
      setState('idle')
      showPlaybackError(
        messageId,
        error instanceof Error ? `System speech failed: ${error.message}` : 'System speech failed.',
      )
    }
  }, [settings, showPlaybackError, systemSupported])

  const speakText = useCallback((
    messageId: string,
    input: string,
    kind: PlaybackSpokenOutputKind = 'response',
    model: string | null = null,
  ) => {
    const text = kind === 'quick-recap' ? createQuickRecap(input) : sanitizeForSpeech(input)
    if (!text) return
    setAiRecapError(null)
    setAiRecapErrorMessageId(null)

    const playbackSequence = playbackSequenceRef.current + 1
    playbackSequenceRef.current = playbackSequence
    if (settings.engine !== 'supertonic' || !supertonicStatus?.ready) {
      speakWithSystem(messageId, text, kind, model, playbackSequence)
      return
    }

    if (systemSupported) window.speechSynthesis.cancel()
    audioRef.current?.pause()
    const nextActive = { messageId, text, kind, model }
    setActive(nextActive)
    setState('preparing')
    void window.api.synthesizeSupertonic({
      text,
      speakerId: settings.supertonicSpeakerId,
      language: settings.supertonicLanguage,
      speed: settings.rate,
    }).then((result) => {
      if (playbackSequenceRef.current !== playbackSequence) return
      if (isApiError(result)) throw new Error(result.error)
      const bytes = new Uint8Array(result.audio)
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: 'audio/wav' }))
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onplay = () => setState('speaking')
      audio.onended = () => {
        if (playbackSequenceRef.current === playbackSequence) {
          setActive(null)
          setState('idle')
        }
      }
      audio.onerror = () => {
        showPlaybackError(messageId, systemSupported
          ? 'Neural speech playback failed. Try the system voice.'
          : 'Neural speech playback failed.')
        audio.onended?.(new Event('ended'))
      }
      return audio.play()
    }).catch((error) => {
      if (playbackSequenceRef.current !== playbackSequence) return
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      if (systemSupported) {
        showPlaybackError(messageId, `Neural voice failed${detail}. Using the system voice instead.`)
        speakWithSystem(messageId, text, kind, model, playbackSequence)
      }
      else {
        showPlaybackError(messageId, `Neural voice failed${detail}.`)
        setActive(null)
        setState('idle')
      }
    })
  }, [settings, showPlaybackError, speakWithSystem, supertonicStatus?.ready, systemSupported])

  const pause = useCallback(() => {
    if (state !== 'speaking') return
    if (settings.engine === 'supertonic' && audioRef.current) audioRef.current.pause()
    else if (systemSupported) window.speechSynthesis.pause()
    setState('paused')
  }, [settings.engine, state, systemSupported])

  const resume = useCallback(() => {
    if (state !== 'paused') return
    if (settings.engine === 'supertonic' && audioRef.current) {
      void audioRef.current.play().catch((error) => {
        showPlaybackError(
          activeRef.current?.messageId ?? '',
          error instanceof Error ? `Speech could not resume: ${error.message}` : 'Speech could not resume.',
        )
        setState('paused')
      })
    } else if (systemSupported) {
      window.speechSynthesis.resume()
      setState('speaking')
    }
  }, [settings.engine, showPlaybackError, state, systemSupported])

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
        setAiRecapError('No provider or Claude CLI is available for an AI summary.')
        setAiRecapErrorMessageId(messageId)
        return
      }
      speakText(messageId, output.spokenText, 'ai-recap', output.model)
    } catch (error) {
      setAiRecapError(error instanceof Error ? error.message : 'AI summary failed.')
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
    supertonicStatus,
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
