import { describe, expect, it } from 'vitest'
import {
  createQuickRecap,
  DEFAULT_SPOKEN_OUTPUT_SETTINGS,
  readSpokenOutputSettings,
  sanitizeForSpeech,
  SPOKEN_OUTPUT_SETTINGS_KEY,
} from '../lib/spoken-output'

describe('spoken output', () => {
  it('removes code, commands, URLs, and Markdown syntax', () => {
    const input = [
      '## Result',
      'Use **the safe option** at [Nexy](https://nexy.test).',
      '```ts',
      'const secret = "do not read this"',
      '```',
      'npm run build',
      'Then open https://example.test/path.',
    ].join('\n')

    const result = sanitizeForSpeech(input)

    expect(result).toBe('Result Use the safe option at Nexy. Then open')
    expect(result).not.toContain('secret')
    expect(result).not.toContain('npm')
    expect(result).not.toContain('https')
    expect(result).not.toMatch(/[*#`]/)
  })

  it('creates a deterministic recap without a model request', () => {
    const input = 'First result is complete. Second result explains the details. Third result is extra.'
    expect(createQuickRecap(input, 55)).toBe('First result is complete.')
    expect(createQuickRecap(input, 55)).toBe(createQuickRecap(input, 55))
  })

  it('clamps persisted settings and defaults privacy-sensitive values', () => {
    const storage = {
      getItem: (key: string) => key === SPOKEN_OUTPUT_SETTINGS_KEY
        ? JSON.stringify({ rate: 9, pitch: 0.1, offlineOnly: false, autoPlay: true, voiceUri: 'voice-1' })
        : null,
    }
    expect(readSpokenOutputSettings(storage)).toEqual({
      engine: 'system',
      voiceUri: 'voice-1',
      supertonicSpeakerId: 0,
      supertonicLanguage: 'auto',
      rate: 2,
      pitch: 0.5,
      offlineOnly: false,
      autoPlay: true,
    })
  })

  it('uses safe defaults when persisted settings are malformed', () => {
    expect(readSpokenOutputSettings({ getItem: () => '{bad json' }))
      .toEqual(DEFAULT_SPOKEN_OUTPUT_SETTINGS)
  })
})
