import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClipboard } = vi.hoisted(() => ({
  mockClipboard: {
    readImage: vi.fn(),
    readText: vi.fn()
  }
}))

vi.mock('electron', () => ({
  clipboard: mockClipboard,
  BrowserWindow: vi.fn(),
  desktopCapturer: { getSources: vi.fn() },
  ipcMain: { handle: vi.fn(), off: vi.fn(), once: vi.fn(), removeHandler: vi.fn() },
  screen: {
    getAllDisplays: vi.fn().mockReturnValue([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }]),
    getCursorScreenPoint: vi.fn(),
    getDisplayNearestPoint: vi.fn()
  },
  systemPreferences: { getMediaAccessStatus: vi.fn() }
}))

import { readClipboardContent } from '../screen-capture'

function makeImage(options: {
  empty?: boolean
  width?: number
  height?: number
  dataUrl?: string
} = {}) {
  return {
    isEmpty: vi.fn().mockReturnValue(options.empty ?? false),
    getSize: vi.fn().mockReturnValue({ width: options.width ?? 100, height: options.height ?? 100 }),
    resize: vi.fn().mockImplementation(() => makeImage({ ...options, width: 1568, height: 784 })),
    toDataURL: vi.fn().mockReturnValue(options.dataUrl ?? 'data:image/png;base64,abc')
  }
}

describe('readClipboardContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns image data when the clipboard contains an image', () => {
    mockClipboard.readImage.mockReturnValue(makeImage({ dataUrl: 'data:image/png;base64,image' }))
    mockClipboard.readText.mockReturnValue('ignored')

    expect(readClipboardContent()).toEqual({ type: 'image', dataUrl: 'data:image/png;base64,image' })
  })

  it('returns text when there is no image but text exists', () => {
    mockClipboard.readImage.mockReturnValue(makeImage({ empty: true }))
    mockClipboard.readText.mockReturnValue('clipboard text')

    expect(readClipboardContent()).toEqual({ type: 'text', text: 'clipboard text' })
  })

  it('returns null when both image and text are empty', () => {
    mockClipboard.readImage.mockReturnValue(makeImage({ empty: true }))
    mockClipboard.readText.mockReturnValue('')

    expect(readClipboardContent()).toBeNull()
  })

  it('returns null when text is only whitespace', () => {
    mockClipboard.readImage.mockReturnValue(makeImage({ empty: true }))
    mockClipboard.readText.mockReturnValue('   ')

    expect(readClipboardContent()).toBeNull()
  })
})
