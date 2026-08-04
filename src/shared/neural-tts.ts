export type SpeechEngine = 'system' | 'supertonic'

export const SUPERTONIC_LANGUAGES = [
  ['ar', 'Arabic'],
  ['bg', 'Bulgarian'],
  ['hr', 'Croatian'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['et', 'Estonian'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['hi', 'Hindi'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['lv', 'Latvian'],
  ['lt', 'Lithuanian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['ro', 'Romanian'],
  ['ru', 'Russian'],
  ['sk', 'Slovak'],
  ['sl', 'Slovenian'],
  ['es', 'Spanish'],
  ['sv', 'Swedish'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['vi', 'Vietnamese'],
] as const

export type SupertonicLanguage = (typeof SUPERTONIC_LANGUAGES)[number][0]

export interface SupertonicStatus {
  supported: boolean
  installed: boolean
  ready: boolean
  installing: boolean
  modelDirectory: string
  modelVersion: string
  downloadBytes: number
  licenseName: 'OpenRAIL-M'
  licenseUrl: string
  error?: string
}

export interface SupertonicSynthesisInput {
  text: string
  speakerId: number
  language: SupertonicLanguage
  speed: number
}

export interface SupertonicSynthesisResult {
  audio: Uint8Array
  sampleRate: number
  durationSeconds: number
}
