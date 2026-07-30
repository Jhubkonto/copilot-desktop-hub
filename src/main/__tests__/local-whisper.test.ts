import { mkdir, readdir, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_LOCAL_WHISPER_AUDIO_BYTES,
  transcribeLocalWhisper,
  validateLocalWhisperWav,
} from '../local-whisper'

function wav(payloadBytes = 2): Uint8Array {
  const audio = new Uint8Array(44 + payloadBytes)
  audio.set(new TextEncoder().encode('RIFF'), 0)
  audio.set(new TextEncoder().encode('WAVE'), 8)
  return audio
}

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('local Whisper service', () => {
  it('rejects malformed and oversized WAV input before execution', () => {
    expect(validateLocalWhisperWav(new Uint8Array(12))).toBe('Invalid voice recording.')
    expect(validateLocalWhisperWav(new Uint8Array(44))).toBe('Voice recording must be a WAV file.')
    expect(validateLocalWhisperWav(new Uint8Array(MAX_LOCAL_WHISPER_AUDIO_BYTES + 1)))
      .toBe('Voice recording exceeds the 50 MiB limit.')
    expect(validateLocalWhisperWav(wav())).toBeNull()
  })

  it('executes Whisper and always removes its temporary run directory', async () => {
    const root = await import('fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), 'nexy-whisper-test-')))
    roots.push(root)
    const argsSeen: string[][] = []
    const result = await transcribeLocalWhisper(
      wav(),
      { executablePath: 'whisper-cli', modelPath: 'model.bin', ready: true },
      {
        tempRoot: root,
        execute: async (_executablePath, args) => {
          argsSeen.push(args)
          const outputPrefix = args[args.indexOf('-of') + 1]
          await mkdir(path.dirname(outputPrefix), { recursive: true })
          await writeFile(`${outputPrefix}.txt`, '  hello from Whisper  ')
        },
      },
    )

    expect(result).toEqual({ text: 'hello from Whisper' })
    expect(argsSeen[0]).toContain('model.bin')
    expect(await readdir(root)).toEqual([])
  })

  it('removes temporary audio when Whisper execution fails', async () => {
    const root = await import('fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), 'nexy-whisper-test-')))
    roots.push(root)
    await expect(transcribeLocalWhisper(
      wav(),
      { executablePath: 'whisper-cli', modelPath: 'model.bin', ready: true },
      {
        tempRoot: root,
        execute: async () => {
          throw new Error('inference failed')
        },
      },
    )).rejects.toThrow('inference failed')
    expect(await readdir(root)).toEqual([])
  })

  it('does not create temporary files when Whisper is unavailable', async () => {
    expect(await transcribeLocalWhisper(
      wav(),
      { executablePath: '', modelPath: '', ready: false },
    )).toEqual({
      error: 'Install local Whisper in Settings → General, or configure valid executable and model paths.',
    })
  })
})
