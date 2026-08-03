export { createQuickRecap, sanitizeForSpeech } from '../../shared/spoken-output'
export type {
  MessageSpokenOutput,
  SpokenOutputGenerationKind,
  SpokenOutputKind,
} from '../../shared/spoken-output'
import { SUPERTONIC_LANGUAGES } from '../../shared/neural-tts'
import type { SpeechEngine, SupertonicLanguage } from '../../shared/neural-tts'

export const SPOKEN_OUTPUT_SETTINGS_KEY = 'nexy.spokenOutput.settings.v1'

export interface SpokenOutputSettings {
  engine: SpeechEngine
  voiceUri: string | null
  supertonicSpeakerId: number
  supertonicLanguage: SupertonicLanguage
  rate: number
  pitch: number
  offlineOnly: boolean
  autoPlay: boolean
}

export const DEFAULT_SPOKEN_OUTPUT_SETTINGS: SpokenOutputSettings = {
  engine: 'system',
  voiceUri: null,
  supertonicSpeakerId: 0,
  supertonicLanguage: 'auto',
  rate: 1,
  pitch: 1,
  offlineOnly: true,
  autoPlay: false,
}

export function readSpokenOutputSettings(storage: Pick<Storage, 'getItem'>): SpokenOutputSettings {
  try {
    const parsed = JSON.parse(storage.getItem(SPOKEN_OUTPUT_SETTINGS_KEY) ?? '{}') as Partial<SpokenOutputSettings>
    const language = SUPERTONIC_LANGUAGES.some(([code]) => code === parsed.supertonicLanguage)
      ? parsed.supertonicLanguage as SupertonicLanguage
      : DEFAULT_SPOKEN_OUTPUT_SETTINGS.supertonicLanguage
    return {
      engine: parsed.engine === 'supertonic' ? 'supertonic' : 'system',
      voiceUri: typeof parsed.voiceUri === 'string' ? parsed.voiceUri : null,
      supertonicSpeakerId: Math.round(clampNumber(parsed.supertonicSpeakerId, 0, 9, 0)),
      supertonicLanguage: language,
      rate: clampNumber(parsed.rate, 0.5, 2, DEFAULT_SPOKEN_OUTPUT_SETTINGS.rate),
      pitch: clampNumber(parsed.pitch, 0.5, 2, DEFAULT_SPOKEN_OUTPUT_SETTINGS.pitch),
      offlineOnly: typeof parsed.offlineOnly === 'boolean' ? parsed.offlineOnly : true,
      autoPlay: typeof parsed.autoPlay === 'boolean' ? parsed.autoPlay : false,
    }
  } catch {
    return { ...DEFAULT_SPOKEN_OUTPUT_SETTINGS }
  }
}

export function writeSpokenOutputSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: SpokenOutputSettings,
): void {
  storage.setItem(SPOKEN_OUTPUT_SETTINGS_KEY, JSON.stringify(settings))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
