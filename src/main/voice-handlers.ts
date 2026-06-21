import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { app } from 'electron'
import extractZip from 'extract-zip'
import path from 'path'
import { promisify } from 'util'
import { getDatabase } from './database'
import { safeHandle } from './safe-handle'

const execFileAsync = promisify(execFile)
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const WHISPER_VERSION = 'v1.9.1'
const WINDOWS_BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`
const BASE_EN_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'

function setting(key: string): string {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value?.trim() ?? ''
}

function config() {
  const executablePath = setting('whisper_cpp_path') || process.env.NEXY_WHISPER_CPP_PATH || ''
  const modelPath = setting('whisper_model_path') || process.env.NEXY_WHISPER_MODEL_PATH || ''
  return {
    executablePath,
    modelPath,
    ready: Boolean(executablePath && modelPath && existsSync(executablePath) && existsSync(modelPath)),
  }
}

async function download(url: string, destination: string, expected: 'zip' | 'model'): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Nexy-Desktop/0.9' },
  })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (expected === 'zip' && !(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new Error('The official whisper.cpp download did not return a valid ZIP archive. Please try again later.')
  }
  if (expected === 'model' && bytes.byteLength < 10 * 1024 * 1024) {
    throw new Error('The Whisper model download was incomplete. Please try again.')
  }
  await writeFile(destination, bytes)
}

async function findFile(directory: string, fileName: string): Promise<string | null> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath
    if (entry.isDirectory()) {
      const nested = await findFile(fullPath, fileName)
      if (nested) return nested
    }
  }
  return null
}

export function registerVoiceHandlers(): void {
  safeHandle('voice:get-status', () => config())

  safeHandle('voice:install-local', async () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return { error: 'Automatic whisper.cpp setup currently supports Windows x64. Configure paths manually on this platform.' }
    }
    const installDir = path.join(app.getPath('userData'), 'voice', `whisper.cpp-${WHISPER_VERSION}`)
    const zipPath = path.join(installDir, 'whisper-bin-x64.zip')
    const modelPath = path.join(installDir, 'models', 'ggml-base.en.bin')
    await mkdir(path.dirname(modelPath), { recursive: true })
    try {
      let executablePath = await findFile(installDir, 'whisper-cli.exe')
      if (!executablePath) {
        await download(WINDOWS_BINARY_URL, zipPath, 'zip')
        await extractZip(zipPath, { dir: installDir })
        executablePath = await findFile(installDir, 'whisper-cli.exe')
      }
      if (!executablePath) throw new Error('The whisper.cpp archive did not contain whisper-cli.exe.')
      if (!existsSync(modelPath)) await download(BASE_EN_MODEL_URL, modelPath, 'model')
      const db = getDatabase()
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('whisper_cpp_path', executablePath)
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('whisper_model_path', modelPath)
      return { installed: true, executablePath, modelPath }
    } finally {
      await rm(zipPath, { force: true }).catch(() => {})
    }
  })

  safeHandle('voice:transcribe', async (_event, audio: Uint8Array) => {
    const current = config()
    if (!current.ready) {
      return { error: 'Install local Whisper in Settings → General, or configure valid executable and model paths.' }
    }
    if (!(audio instanceof Uint8Array) || audio.byteLength < 44 || audio.byteLength > MAX_AUDIO_BYTES) {
      return { error: 'Invalid or oversized voice recording.' }
    }

    const runDir = path.join(app.getPath('temp'), `nexy-whisper-${randomUUID()}`)
    const inputPath = path.join(runDir, 'input.wav')
    const outputPrefix = path.join(runDir, 'transcript')
    await mkdir(runDir, { recursive: true })
    try {
      await writeFile(inputPath, audio)
      await execFileAsync(current.executablePath, [
        '-m', current.modelPath,
        '-f', inputPath,
        '-otxt',
        '-of', outputPrefix,
        '-np',
      ], { timeout: 180_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      const text = (await readFile(`${outputPrefix}.txt`, 'utf8')).trim()
      return text ? { text } : { error: 'Whisper did not detect any speech.' }
    } finally {
      await rm(runDir, { recursive: true, force: true }).catch(() => {})
    }
  })
}
