import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpokenOutput } from '../../hooks/useSpokenOutput'

class MockUtterance {
  text: string
  voice: SpeechSynthesisVoice | null = null
  rate = 1
  pitch = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const localVoice = {
  default: true,
  lang: 'en-US',
  localService: true,
  name: 'Local voice',
  voiceURI: 'local-voice',
} as SpeechSynthesisVoice
const remoteVoice = {
  ...localVoice,
  default: false,
  localService: false,
  name: 'Remote voice',
  voiceURI: 'remote-voice',
} as SpeechSynthesisVoice

const speech = {
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  speak: vi.fn(),
  getVoices: vi.fn(() => [remoteVoice, localVoice]),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}

describe('useSpokenOutput', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: speech,
    })
  })

  it('uses a local installed voice and exposes playback controls', () => {
    const { result } = renderHook(() => useSpokenOutput())

    act(() => result.current.speakResponse('message-1', '**Hello** `hiddenCode()`'))
    const utterance = speech.speak.mock.calls[0][0] as unknown as MockUtterance

    expect(utterance.text).toBe('Hello')
    expect(utterance.voice).toBe(localVoice)
    expect(result.current.state).toBe('speaking')
    expect(result.current.active?.messageId).toBe('message-1')

    act(() => result.current.pause())
    expect(speech.pause).toHaveBeenCalledOnce()
    expect(result.current.state).toBe('paused')

    act(() => result.current.resume())
    expect(speech.resume).toHaveBeenCalledOnce()

    act(() => result.current.stop())
    expect(speech.cancel).toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('creates Quick Recap locally before speaking', () => {
    const { result } = renderHook(() => useSpokenOutput())
    const longResponse = `${'A useful sentence. '.repeat(40)}\n\`\`\`ts\nconst hidden = true\n\`\`\``

    act(() => result.current.speakQuickRecap('message-2', longResponse))
    const utterance = speech.speak.mock.calls[0][0] as unknown as MockUtterance

    expect(utterance.text.length).toBeLessThanOrEqual(420)
    expect(utterance.text).not.toContain('hidden')
    expect(result.current.active?.kind).toBe('quick-recap')
  })

  it('speaks a persisted provider recap and exposes its model label', async () => {
    const generateAiRecap = vi.fn().mockResolvedValue({
      messageId: 'message-3',
      spokenText: 'The provider recap.',
      outputKind: 'ai-recap',
      generationKind: 'provider',
      model: 'openai:gpt-test',
      createdAt: 1,
      updatedAt: 1,
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { generateAiRecap },
    })
    const { result } = renderHook(() => useSpokenOutput())

    await act(async () => result.current.speakAiRecap('message-3'))

    expect(generateAiRecap).toHaveBeenCalledWith('message-3')
    expect(result.current.active).toMatchObject({
      messageId: 'message-3',
      kind: 'ai-recap',
      model: 'openai:gpt-test',
    })
    expect((speech.speak.mock.calls[0][0] as MockUtterance).text).toBe('The provider recap.')
  })

  it('deduplicates repeated AI Recap requests while generation is pending', async () => {
    let resolveRecap: (value: null) => void = () => {}
    const generateAiRecap = vi.fn(() => new Promise<null>((resolve) => {
      resolveRecap = resolve
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { generateAiRecap },
    })
    const { result } = renderHook(() => useSpokenOutput())

    let firstRequest!: Promise<void>
    act(() => {
      firstRequest = result.current.speakAiRecap('message-4')
      void result.current.speakAiRecap('message-4')
    })
    expect(generateAiRecap).toHaveBeenCalledOnce()

    resolveRecap(null)
    await act(async () => firstRequest)
  })
})
