import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { chmod, mkdir, readdir, rm, writeFile } from 'fs/promises'
import { app } from 'electron'
import extractZip from 'extract-zip'
import path from 'path'
import { promisify } from 'util'
import { getDatabase } from './database'
import { getLocalWhisperConfig, transcribeLocalWhisper } from './local-whisper'
import { safeHandle } from './safe-handle'
import {
  generateAiSpokenOutput,
  getAssistantMessageContext,
  saveMessageSpokenOutput,
} from './spoken-output'
import type { SaveSpokenOutputInput } from '../shared/spoken-output'

const execFileAsync = promisify(execFile)
const WHISPER_VERSION = 'v1.9.1'
const WINDOWS_BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`
const LINUX_X64_BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-ubuntu-x64.tar.gz`
const LINUX_ARM64_BINARY_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-ubuntu-arm64.tar.gz`
const BASE_EN_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'

async function download(url: string, destination: string, expected: 'zip' | 'gzip' | 'model'): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Nexy-Desktop/0.9' },
  })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (expected === 'zip' && !(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new Error('The official whisper.cpp download did not return a valid ZIP archive. Please try again later.')
  }
  if (expected === 'gzip' && !(bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    throw new Error('The official whisper.cpp download did not return a valid tar.gz archive. Please try again later.')
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
  safeHandle('voice:get-status', () => getLocalWhisperConfig())

  safeHandle('voice:install-local', async () => {
    const installDir = path.join(app.getPath('userData'), 'voice', `whisper.cpp-${WHISPER_VERSION}`)
    const archivePath = path.join(installDir, process.platform === 'win32' ? 'whisper-bin.zip' : 'whisper-bin.tar.gz')
    const modelPath = path.join(installDir, 'models', 'ggml-base.en.bin')
    await mkdir(path.dirname(modelPath), { recursive: true })
    try {
      let executablePath: string | null = null
      if (process.platform === 'win32' && process.arch === 'x64') {
        executablePath = await findFile(installDir, 'whisper-cli.exe')
        if (!executablePath) {
          await download(WINDOWS_BINARY_URL, archivePath, 'zip')
          await extractZip(archivePath, { dir: installDir })
          executablePath = await findFile(installDir, 'whisper-cli.exe')
        }
      } else if (process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64')) {
        executablePath = await findFile(installDir, 'whisper-cli')
        if (!executablePath) {
          await download(process.arch === 'arm64' ? LINUX_ARM64_BINARY_URL : LINUX_X64_BINARY_URL, archivePath, 'gzip')
          await execFileAsync('tar', ['-xzf', archivePath, '-C', installDir], { timeout: 120_000 })
          executablePath = await findFile(installDir, 'whisper-cli')
        }
        if (executablePath) await chmod(executablePath, 0o755)
      } else if (process.platform === 'darwin' && (process.arch === 'x64' || process.arch === 'arm64')) {
        try {
          await execFileAsync('brew', ['--prefix', 'whisper-cpp'], { timeout: 30_000 })
        } catch {
          try {
            await execFileAsync('brew', ['install', 'whisper-cpp'], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 })
          } catch {
            throw new Error('Automatic macOS setup requires Homebrew. Install Homebrew, then try again, or configure whisper-cli manually.')
          }
        }
        const { stdout } = await execFileAsync('brew', ['--prefix', 'whisper-cpp'], { timeout: 30_000 })
        executablePath = await findFile(stdout.trim(), 'whisper-cli')
      } else {
        throw new Error(`Automatic whisper.cpp setup is unavailable for ${process.platform}/${process.arch}. Configure the executable and model paths manually.`)
      }
      if (!executablePath) throw new Error('The whisper.cpp installation did not contain whisper-cli.')
      if (!existsSync(modelPath)) await download(BASE_EN_MODEL_URL, modelPath, 'model')
      const db = getDatabase()
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('whisper_cpp_path', executablePath)
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('whisper_model_path', modelPath)
      return { installed: true, executablePath, modelPath }
    } finally {
      await rm(archivePath, { force: true }).catch(() => {})
    }
  })

  safeHandle('voice:transcribe', async (_event, audio: Uint8Array) => {
    return transcribeLocalWhisper(audio)
  })

  safeHandle('voice:save-spoken-output', (_event, input: SaveSpokenOutputInput) => {
    return saveMessageSpokenOutput(getDatabase(), input)
  })

  safeHandle('voice:generate-ai-recap', async (_event, messageId: string) => {
    const db = getDatabase()
    const context = getAssistantMessageContext(db, messageId)
    if (!context) throw new Error('Assistant message not found')
    return generateAiSpokenOutput(db, context, 'ai-recap')
  })
}
