import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const {
  BrowserWindowMock,
  mockClipboard,
  mockDesktopCapturer,
  mockIpcMain,
  mockScreen,
  mockSystemPreferences,
} = vi.hoisted(() => ({
  BrowserWindowMock: vi.fn(),
  mockClipboard: {
    readImage: vi.fn(),
    readText: vi.fn(),
  },
  mockDesktopCapturer: {
    getSources: vi.fn(),
  },
  mockIpcMain: {
    handle: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
  },
  mockScreen: {
    getAllDisplays: vi.fn().mockReturnValue([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }]),
    getCursorScreenPoint: vi.fn(),
    getDisplayNearestPoint: vi.fn(),
  },
  mockSystemPreferences: { getMediaAccessStatus: vi.fn() },
}))

vi.mock('electron', () => ({
  clipboard: mockClipboard,
  BrowserWindow: BrowserWindowMock,
  desktopCapturer: mockDesktopCapturer,
  ipcMain: mockIpcMain,
  screen: mockScreen,
  systemPreferences: mockSystemPreferences,
}))

import {
  cacheExternalWindowLabel,
  captureWithRegionSelection,
  consumeSuppressFocusEvent,
  getLastExternalWindowLabel,
  readClipboardContent,
} from '../screen-capture'

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
    toDataURL: vi.fn().mockReturnValue(options.dataUrl ?? 'data:image/png;base64,abc'),
  }
}

function makeNativeImage(dataUrl = 'data:image/png;base64,cropped') {
  return {
    resize: vi.fn().mockReturnThis(),
    toJPEG: vi.fn().mockReturnValue(Buffer.from('preview')),
    crop: vi.fn().mockReturnValue({
      getSize: vi.fn().mockReturnValue({ width: 400, height: 300 }),
      resize: vi.fn().mockReturnThis(),
      toDataURL: vi.fn().mockReturnValue(dataUrl),
    }),
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

describe('external window label caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caches the first non-app window label', async () => {
    mockDesktopCapturer.getSources.mockResolvedValue([
      { name: 'Nexy' },
      { name: 'VS Code' },
    ])

    await cacheExternalWindowLabel('Nexy')

    expect(getLastExternalWindowLabel()).toBe('VS Code')
    expect(mockDesktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    })
  })

  it('clears the cached label when querying sources fails', async () => {
    mockDesktopCapturer.getSources.mockRejectedValue(new Error('boom'))

    await cacheExternalWindowLabel('Nexy')

    expect(getLastExternalWindowLabel()).toBeUndefined()
  })
})

describe('captureWithRegionSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeSuppressFocusEvent()
    vi.useFakeTimers()
    mockScreen.getCursorScreenPoint.mockReturnValue({ x: 10, y: 10 })
    mockScreen.getDisplayNearestPoint.mockReturnValue({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('includes the cached window label in successful captures', async () => {
    mockDesktopCapturer.getSources
      .mockResolvedValueOnce([{ name: 'VS Code' }])
      .mockResolvedValueOnce([
        { display_id: '1', thumbnail: makeNativeImage('data:image/png;base64,region') },
      ])

    await cacheExternalWindowLabel('Nexy')

    const overlayHandlers = new Map<string, (...args: unknown[]) => void>()
    mockIpcMain.once.mockImplementation((channel: string, handler: (...args: unknown[]) => void) => {
      overlayHandlers.set(channel, handler)
    })

    let closedHandler: (() => void) | undefined
    const overlayWindow = {
      webContents: { send: vi.fn() },
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      focus: vi.fn(() => {
        overlayHandlers.get('overlay:submit')?.(
          { sender: overlayWindow.webContents },
          { x: 5, y: 6, width: 120, height: 80 },
        )
      }),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'closed') closedHandler = handler
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(() => closedHandler?.()),
    }
    BrowserWindowMock.mockImplementation(function () {
      return overlayWindow
    })

    const mainWindow = {
      hide: vi.fn(),
      show: vi.fn(),
    }

    const resultPromise = captureWithRegionSelection(mainWindow as never)
    await vi.advanceTimersByTimeAsync(400)
    const result = await resultPromise

    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,region',
      windowLabel: 'VS Code',
    })
    expect(mainWindow.hide).toHaveBeenCalledOnce()
    expect(mainWindow.show).toHaveBeenCalledOnce()
  })

  it('sets and consumes the focus suppression flag after showing the main window', async () => {
    mockDesktopCapturer.getSources.mockResolvedValue([
      { display_id: '1', thumbnail: makeNativeImage() },
    ])

    const overlayHandlers = new Map<string, (...args: unknown[]) => void>()
    mockIpcMain.once.mockImplementation((channel: string, handler: (...args: unknown[]) => void) => {
      overlayHandlers.set(channel, handler)
    })

    let closedHandler: (() => void) | undefined
    const overlayWindow = {
      webContents: { send: vi.fn() },
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      focus: vi.fn(() => {
        overlayHandlers.get('overlay:submit')?.(
          { sender: overlayWindow.webContents },
          { x: 1, y: 1, width: 50, height: 50 },
        )
      }),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'closed') closedHandler = handler
      }),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(() => closedHandler?.()),
    }
    BrowserWindowMock.mockImplementation(function () {
      return overlayWindow
    })

    const resultPromise = captureWithRegionSelection({ hide: vi.fn(), show: vi.fn() } as never)
    await vi.advanceTimersByTimeAsync(400)
    await resultPromise

    expect(consumeSuppressFocusEvent()).toBe(true)
    expect(consumeSuppressFocusEvent()).toBe(false)
  })
})
