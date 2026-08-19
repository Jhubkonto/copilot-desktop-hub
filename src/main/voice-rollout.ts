import type Database from 'better-sqlite3'
import { existsSync } from 'fs'
import {
  VOICE_FEATURE_FLAG_KEYS,
  type VoiceCapabilities,
  type VoiceFeatureFlags,
} from '../shared/voice'

export const VOICE_PROTOCOL_VERSION = 1 as const
export const MAX_VOICE_RECORDING_SECONDS = 15 * 60
export const MAX_VOICE_AUDIO_BYTES = 50 * 1024 * 1024

function readFlag(db: Database.Database, key: string): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  // Phase 7 ships the completed implementation default-on. Persisting "false"
  // remains an immediate, restart-safe rollback switch.
  return row?.value !== 'false'
}

export function getVoiceFeatureFlags(
  db: Database.Database,
): VoiceFeatureFlags {
  return {
    voiceDockV1: readFlag(db, VOICE_FEATURE_FLAG_KEYS.voiceDockV1),
  }
}

export function getVoiceCapabilities(db: Database.Database): VoiceCapabilities {
  const flags = getVoiceFeatureFlags(db)
  const executable = db.prepare(
    "SELECT value FROM settings WHERE key = 'whisper_cpp_path'",
  ).get() as { value: string } | undefined
  const model = db.prepare(
    "SELECT value FROM settings WHERE key = 'whisper_model_path'",
  ).get() as { value: string } | undefined
  const localWhisperReady = Boolean(
    executable?.value &&
    model?.value &&
    existsSync(executable.value) &&
    existsSync(model.value),
  )
  return {
    protocolVersion: VOICE_PROTOCOL_VERSION,
    audioUpload: flags.voiceDockV1,
    localWhisperReady: flags.voiceDockV1 && localWhisperReady,
    maxAudioBytes: MAX_VOICE_AUDIO_BYTES,
    maxRecordingSeconds: MAX_VOICE_RECORDING_SECONDS,
  }
}
