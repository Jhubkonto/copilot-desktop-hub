import { describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { getVoiceCapabilities, getVoiceFeatureFlags } from '../voice-rollout'

function fakeDatabase(settings: Record<string, string>): Database.Database {
  return {
    prepare: vi.fn(() => ({
      get: (key?: string) => key && settings[key] !== undefined
        ? { value: settings[key] }
        : undefined,
    })),
  } as unknown as Database.Database
}

describe('voice feature rollout', () => {
  it('ships voice features on while preserving explicit rollback switches', () => {
    expect(getVoiceFeatureFlags(fakeDatabase({}))).toEqual({
      voiceDockV1: true,
      spokenOutputV1: true,
    })
    expect(getVoiceFeatureFlags(fakeDatabase({ feature_voice_dock_v1: 'false' }))).toEqual({
      voiceDockV1: false,
      spokenOutputV1: true,
    })
  })

  it('exposes a voice-only capability contract', () => {
    expect(getVoiceCapabilities(fakeDatabase({}))).toEqual({
      protocolVersion: 1,
      audioUpload: true,
      localWhisperReady: false,
      spokenOutputPersistence: true,
      maxAudioBytes: 50 * 1024 * 1024,
      maxRecordingSeconds: 15 * 60,
    })
  })
})
