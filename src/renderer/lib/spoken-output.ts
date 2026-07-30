export { createQuickRecap, sanitizeForSpeech } from '../../shared/spoken-output'
export type {
  MessageSpokenOutput,
  SpokenOutputGenerationKind,
  SpokenOutputKind,
} from '../../shared/spoken-output'

export const SPOKEN_OUTPUT_SETTINGS_KEY = 'nexy.spokenOutput.settings.v1'

export interface SpokenOutputSettings {
  voiceUri: string | null
  rate: number
  pitch: number
  offlineOnly: boolean
  autoPlay: boolean
}

export const DEFAULT_SPOKEN_OUTPUT_SETTINGS: SpokenOutputSettings = {
  voiceUri: null,
  rate: 1,
  pitch: 1,
  offlineOnly: true,
  autoPlay: false,
}

export function readSpokenOutputSettings(storage: Pick<Storage, 'getItem'>): SpokenOutputSettings {
  try {
    const parsed = JSON.parse(storage.getItem(SPOKEN_OUTPUT_SETTINGS_KEY) ?? '{}') as Partial<SpokenOutputSettings>
    return {
      voiceUri: typeof parsed.voiceUri === 'string' ? parsed.voiceUri : null,
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
