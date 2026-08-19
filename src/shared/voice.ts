export interface VoiceFeatureFlags {
  voiceDockV1: boolean
}

export interface VoiceCapabilities {
  protocolVersion: 1
  audioUpload: boolean
  localWhisperReady: boolean
  maxAudioBytes: number
  maxRecordingSeconds: number
}

export const VOICE_FEATURE_FLAG_KEYS = {
  voiceDockV1: 'feature_voice_dock_v1',
} as const

export const DEFAULT_VOICE_FEATURE_FLAGS: Readonly<VoiceFeatureFlags> = Object.freeze({
  voiceDockV1: true,
})

function enabled(value: string | boolean | null | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback
  return value === true || value === 'true'
}

export function resolveVoiceFeatureFlags(
  settings: Readonly<Record<string, string | boolean | null | undefined>>,
): VoiceFeatureFlags {
  return {
    voiceDockV1: enabled(settings[VOICE_FEATURE_FLAG_KEYS.voiceDockV1], true),
  }
}
