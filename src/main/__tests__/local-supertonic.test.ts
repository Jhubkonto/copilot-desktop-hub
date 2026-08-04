import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import path from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}))

import {
  createSupertonicWorkerRequest,
  encodeMonoPcm16Wave,
  getSupertonicStatus,
  isCompleteSupertonicModel,
  SUPERTONIC_DOWNLOAD_BYTES,
  SUPERTONIC_MODEL_VERSION,
} from '../local-supertonic'

const roots: string[] = []
const requiredFiles = [
  'duration_predictor.int8.onnx',
  'text_encoder.int8.onnx',
  'vector_estimator.int8.onnx',
  'vocoder.int8.onnx',
  'tts.json',
  'unicode_indexer.bin',
  'voice.bin',
]

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local Supertonic', () => {
  it('keeps native audio buffers internal to the isolated speech process', () => {
    const request = createSupertonicWorkerRequest({
      text: 'Hello',
      speakerId: 2,
      speed: 1,
      language: 'en',
    })

    expect(request.generation.enableExternalBuffer).toBe(false)
  })

  it('falls back to a supported language before invoking the native runtime', () => {
    const request = createSupertonicWorkerRequest({
      text: 'Hello',
      speakerId: 0,
      speed: 1,
      language: 'auto' as never,
    })

    expect(request.generation.language).toBe('en')
  })

  it('only marks a model ready when every required file exists and is non-empty', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nexy-supertonic-test-'))
    roots.push(root)
    expect(await isCompleteSupertonicModel(root)).toBe(false)
    await Promise.all(requiredFiles.map((name) => writeFile(path.join(root, name), 'model-data')))
    expect(await isCompleteSupertonicModel(root)).toBe(true)

    const status = await getSupertonicStatus(root)
    expect(status).toMatchObject({
      installed: true,
      ready: true,
      modelVersion: SUPERTONIC_MODEL_VERSION,
      downloadBytes: SUPERTONIC_DOWNLOAD_BYTES,
      licenseName: 'OpenRAIL-M',
    })
  })

  it('encodes clipped float samples as a valid mono PCM16 WAV', () => {
    const wave = encodeMonoPcm16Wave(new Float32Array([-2, -0.5, 0, 0.5, 2]), 24_000)
    const view = Buffer.from(wave)
    expect(view.toString('ascii', 0, 4)).toBe('RIFF')
    expect(view.toString('ascii', 8, 12)).toBe('WAVE')
    expect(view.readUInt16LE(22)).toBe(1)
    expect(view.readUInt32LE(24)).toBe(24_000)
    expect(view.toString('ascii', 36, 40)).toBe('data')
    expect(view.readInt16LE(44)).toBe(-32_768)
    expect(view.readInt16LE(52)).toBe(32_767)
  })
})
