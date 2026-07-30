const EMPTY_AUDIO_MARKER = /^\[\s*blank[\s_-]*audio\s*\]$/i

/**
 * Returns editable speech text, or null when the recognizer reports no speech.
 *
 * whisper.cpp can return `[BLANK_AUDIO]` as a successful transcription for an
 * empty/silent recording. That marker is transport metadata, not user text.
 */
export function usableVoiceTranscript(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || EMPTY_AUDIO_MARKER.test(trimmed)) return null
  return trimmed
}
