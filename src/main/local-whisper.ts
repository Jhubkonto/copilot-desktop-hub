import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { app } from 'electron'
import path from 'path'
import { promisify } from 'util'
import { getDatabase } from './database'

const execFileAsync = promisify(execFile)

export const MAX_LOCAL_WHISPER_AUDIO_BYTES = 50 * 1024 * 1024

export interface LocalWhisperConfig {
  executablePath: string
  modelPath: string
  ready: boolean
}

interface LocalWhisperRuntime {
  tempRoot: string
  execute: (executablePath: string, args: string[]) => Promise<void>
}

function setting(key: string): string {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value?.trim() ?? ''
}

export function getLocalWhisperConfig(): LocalWhisperConfig {
  const executablePath = setting('whisper_cpp_path') || process.env.NEXY_WHISPER_CPP_PATH || ''
  const modelPath = setting('whisper_model_path') || process.env.NEXY_WHISPER_MODEL_PATH || ''
  return {
    executablePath,
    modelPath,
    ready: Boolean(executablePath && modelPath && existsSync(executablePath) && existsSync(modelPath)),
  }
}

export function validateLocalWhisperWav(audio: Uint8Array): string | null {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 44) return 'Invalid voice recording.'
  if (audio.byteLength > MAX_LOCAL_WHISPER_AUDIO_BYTES) return 'Voice recording exceeds the 50 MiB limit.'
  const header = new TextDecoder('ascii').decode(audio.subarray(0, 12))
  if (header.slice(0, 4) !== 'RIFF' || header.slice(8, 12) !== 'WAVE') {
    return 'Voice recording must be a WAV file.'
  }
  return null
}

function defaultRuntime(): LocalWhisperRuntime {
  return {
    tempRoot: app.getPath('temp'),
    execute: async (executablePath, args) => {
      await execFileAsync(executablePath, args, {
        timeout: 180_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      })
    },
  }
}

export async function transcribeLocalWhisper(
  audio: Uint8Array,
  config = getLocalWhisperConfig(),
  runtime?: LocalWhisperRuntime,
): Promise<{ text: string } | { error: string }> {
  if (!config.ready) {
    return { error: 'Install local Whisper in Settings → General, or configure valid executable and model paths.' }
  }
  const validationError = validateLocalWhisperWav(audio)
  if (validationError) return { error: validationError }
  const activeRuntime = runtime ?? defaultRuntime()

  const runDir = path.join(activeRuntime.tempRoot, `nexy-whisper-${randomUUID()}`)
  const inputPath = path.join(runDir, 'input.wav')
  const outputPrefix = path.join(runDir, 'transcript')
  await mkdir(runDir, { recursive: true })
  try {
    await writeFile(inputPath, audio)
    await activeRuntime.execute(config.executablePath, [
      '-m', config.modelPath,
      '-f', inputPath,
      '-otxt',
      '-of', outputPrefix,
      '-np',
    ])
    const text = (await readFile(`${outputPrefix}.txt`, 'utf8')).trim()
    return text ? { text } : { error: 'Whisper did not detect any speech.' }
  } finally {
    await rm(runDir, { recursive: true, force: true }).catch(() => {})
  }
}
