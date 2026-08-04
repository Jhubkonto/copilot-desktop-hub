import { createHash, randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, open, readdir, rename, rm, stat } from 'fs/promises'
import { app, utilityProcess } from 'electron'
import path from 'path'
import { promisify } from 'util'
import type {
  SupertonicStatus,
  SupertonicSynthesisInput,
  SupertonicSynthesisResult,
} from '../shared/neural-tts'
import { SUPERTONIC_LANGUAGES } from '../shared/neural-tts'

const execFileAsync = promisify(execFile)
const SYNTHESIS_TIMEOUT_MS = 2 * 60_000

export const SUPERTONIC_MODEL_VERSION = 'supertonic-3-tts-int8-2026-05-11'
export const SUPERTONIC_ARCHIVE_NAME = `sherpa-onnx-${SUPERTONIC_MODEL_VERSION}.tar.bz2`
export const SUPERTONIC_DOWNLOAD_URL =
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${SUPERTONIC_ARCHIVE_NAME}`
export const SUPERTONIC_DOWNLOAD_BYTES = 128_774_318
export const SUPERTONIC_SHA256 = '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427'
export const SUPERTONIC_LICENSE_URL = 'https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE'

const REQUIRED_MODEL_FILES = [
  'duration_predictor.int8.onnx',
  'text_encoder.int8.onnx',
  'vector_estimator.int8.onnx',
  'vocoder.int8.onnx',
  'tts.json',
  'unicode_indexer.bin',
  'voice.bin',
] as const

let installInProgress = false
interface SherpaAudio {
  samples: Float32Array
  sampleRate: number
}

interface SupertonicWorkerResult {
  ok: boolean
  samples?: Float32Array
  sampleRate?: number
  error?: string
}

function platformSupported(): boolean {
  return (process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'ia32'))
    || ((process.platform === 'linux' || process.platform === 'darwin')
      && (process.arch === 'x64' || process.arch === 'arm64'))
}

export function getSupertonicModelDirectory(): string {
  return process.env.NEXY_SUPERTONIC_MODEL_PATH
    || path.join(app.getPath('userData'), 'voice', SUPERTONIC_MODEL_VERSION)
}

function modelFilePaths(directory: string) {
  return {
    durationPredictor: path.join(directory, 'duration_predictor.int8.onnx'),
    textEncoder: path.join(directory, 'text_encoder.int8.onnx'),
    vectorEstimator: path.join(directory, 'vector_estimator.int8.onnx'),
    vocoder: path.join(directory, 'vocoder.int8.onnx'),
    ttsJson: path.join(directory, 'tts.json'),
    unicodeIndexer: path.join(directory, 'unicode_indexer.bin'),
    voiceStyle: path.join(directory, 'voice.bin'),
  }
}

export async function isCompleteSupertonicModel(directory: string): Promise<boolean> {
  for (const fileName of REQUIRED_MODEL_FILES) {
    const filePath = path.join(directory, fileName)
    if (!existsSync(filePath) || (await stat(filePath)).size === 0) return false
  }
  return true
}

export async function getSupertonicStatus(
  directory = getSupertonicModelDirectory(),
): Promise<SupertonicStatus> {
  const supported = platformSupported()
  const installed = await isCompleteSupertonicModel(directory).catch(() => false)
  return {
    supported,
    installed,
    ready: supported && installed,
    installing: installInProgress,
    modelDirectory: directory,
    modelVersion: SUPERTONIC_MODEL_VERSION,
    downloadBytes: SUPERTONIC_DOWNLOAD_BYTES,
    licenseName: 'OpenRAIL-M',
    licenseUrl: SUPERTONIC_LICENSE_URL,
    ...(!supported ? { error: `Supertonic is unavailable for ${process.platform}/${process.arch}.` } : {}),
  }
}

async function downloadVerifiedArchive(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Nexy-Desktop/1.0' },
  })
  if (!response.ok || !response.body) throw new Error(`Supertonic download failed (${response.status}).`)

  const file = await open(destination, 'wx')
  const digest = createHash('sha256')
  let received = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > SUPERTONIC_DOWNLOAD_BYTES) throw new Error('Supertonic download exceeded its expected size.')
      digest.update(value)
      await file.write(value)
    }
  } finally {
    await file.close()
  }
  if (received !== SUPERTONIC_DOWNLOAD_BYTES || digest.digest('hex') !== SUPERTONIC_SHA256) {
    throw new Error('Supertonic model verification failed. The incomplete download was discarded.')
  }
}

async function findModelRoot(directory: string): Promise<string | null> {
  if (await isCompleteSupertonicModel(directory).catch(() => false)) return directory
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = await findModelRoot(path.join(directory, entry.name))
    if (nested) return nested
  }
  return null
}

export async function installSupertonicModel(): Promise<SupertonicStatus> {
  if (!platformSupported()) throw new Error(`Supertonic is unavailable for ${process.platform}/${process.arch}.`)
  if (installInProgress) throw new Error('Supertonic installation is already in progress.')

  const target = getSupertonicModelDirectory()
  if (await isCompleteSupertonicModel(target).catch(() => false)) return getSupertonicStatus(target)

  installInProgress = true
  const parent = path.dirname(target)
  const token = randomUUID()
  const archive = path.join(parent, `.supertonic-${token}.tar.bz2`)
  const staging = path.join(parent, `.supertonic-${token}`)
  try {
    await mkdir(staging, { recursive: true })
    await downloadVerifiedArchive(SUPERTONIC_DOWNLOAD_URL, archive)
    await execFileAsync('tar', ['-xjf', archive, '-C', staging], {
      timeout: 5 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    const extractedRoot = await findModelRoot(staging)
    if (!extractedRoot) throw new Error('The verified Supertonic archive did not contain the expected model files.')
    await mkdir(parent, { recursive: true })
    await rm(target, { recursive: true, force: true })
    await rename(extractedRoot, target)
    return getSupertonicStatus(target)
  } finally {
    installInProgress = false
    await rm(archive, { force: true }).catch(() => {})
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

export async function removeSupertonicModel(): Promise<SupertonicStatus> {
  if (installInProgress) throw new Error('Wait for the Supertonic installation to finish before removing it.')
  await rm(getSupertonicModelDirectory(), { recursive: true, force: true })
  return getSupertonicStatus()
}

export function createSupertonicWorkerRequest(input: SupertonicSynthesisInput) {
  const directory = getSupertonicModelDirectory()
  const language = SUPERTONIC_LANGUAGES.some(([code]) => code === input.language)
    ? input.language
    : 'en'
  return {
    model: {
      supertonic: modelFilePaths(directory),
      debug: false,
      numThreads: Math.max(1, Math.min(4, Number(process.env.NEXY_SUPERTONIC_THREADS) || 2)),
      provider: 'cpu',
    },
    maxNumSentences: 1,
    generation: {
      text: input.text,
      // External native buffers are forbidden by Electron's sandbox and previously
      // raised an uncaught exception instead of rejecting generateAsync().
      enableExternalBuffer: false,
      speakerId: input.speakerId,
      speed: input.speed,
      language,
    },
  }
}

async function generateInUtilityProcess(input: SupertonicSynthesisInput): Promise<SherpaAudio> {
  const directory = getSupertonicModelDirectory()
  if (!(await isCompleteSupertonicModel(directory))) {
    throw new Error('Supertonic is not installed. Install it in Settings → General first.')
  }

  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'supertonic-worker.cjs'), [], {
      serviceName: 'Nexy Supertonic speech',
      stdio: 'pipe',
    })
    let settled = false
    let stderr = ''
    const finish = (error?: Error, audio?: SherpaAudio) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) {
        child.kill()
        reject(error)
      }
      else resolve(audio!)
    }
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000)
    })
    child.once('spawn', () => child.postMessage(createSupertonicWorkerRequest(input)))
    child.once('message', (message: SupertonicWorkerResult) => {
      if (!message?.ok || !message.samples || !message.sampleRate) {
        finish(new Error(message?.error || 'Supertonic synthesis failed.'))
        return
      }
      finish(undefined, {
        samples: message.samples instanceof Float32Array
          ? message.samples
          : new Float32Array(message.samples),
        sampleRate: message.sampleRate,
      })
    })
    child.once('error', (_type, location) => {
      finish(new Error(`The isolated Supertonic process failed${location ? ` at ${location}` : ''}.`))
    })
    child.once('exit', (code) => {
      if (!settled) finish(new Error(
        `The isolated Supertonic process exited unexpectedly (${code}).${stderr ? ` ${stderr.trim()}` : ''}`,
      ))
    })
    const timeout = setTimeout(() => {
      finish(new Error('Supertonic synthesis timed out.'))
    }, SYNTHESIS_TIMEOUT_MS)
  })
}

export function encodeMonoPcm16Wave(samples: Float32Array, sampleRate: number): Uint8Array {
  const output = Buffer.allocUnsafe(44 + samples.length * 2)
  output.write('RIFF', 0)
  output.writeUInt32LE(output.length - 8, 4)
  output.write('WAVE', 8)
  output.write('fmt ', 12)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(sampleRate, 24)
  output.writeUInt32LE(sampleRate * 2, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    output.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), 44 + index * 2)
  }
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
}

export async function synthesizeSupertonic(
  input: SupertonicSynthesisInput,
): Promise<SupertonicSynthesisResult> {
  const text = input.text.trim()
  if (!text) throw new Error('Nothing to speak.')
  if (text.length > 20_000) throw new Error('Spoken output is limited to 20,000 characters at a time.')
  const speakerId = Number.isInteger(input.speakerId) ? Math.min(9, Math.max(0, input.speakerId)) : 0
  const speed = Number.isFinite(input.speed) ? Math.min(2, Math.max(0.5, input.speed)) : 1
  const audio = await generateInUtilityProcess({ ...input, text, speakerId, speed })
  return {
    audio: encodeMonoPcm16Wave(audio.samples, audio.sampleRate),
    sampleRate: audio.sampleRate,
    durationSeconds: audio.samples.length / audio.sampleRate,
  }
}
