import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatWindow } from '../../renderer/components/ChatWindow'
import { setupMockApi, type MockApi } from '../../test/mocks/api'
import { createMockAppStore, setupStoreMock } from '../../test/mocks/store'

const { useAppStore } = vi.hoisted(() => ({
  useAppStore: vi.fn(),
}))

vi.mock('../../renderer/store/app-store', () => ({
  useAppStore,
}))

let mockApi: MockApi
let mockStore: ReturnType<typeof createMockAppStore>

beforeEach(() => {
  mockApi = setupMockApi()

  mockApi.getMessages.mockResolvedValue([])
  mockApi.onStreamResponse.mockReturnValue(() => {})
  mockApi.onStreamError.mockReturnValue(() => {})
  mockApi.onAutoClipboardFocus.mockImplementation((_cb: () => void | Promise<void>) => {
    return () => {}
  })

  mockApi.readClipboardContent.mockResolvedValue({
    type: 'image',
    dataUrl: 'data:image/png;base64,screenshot',
  })

  mockStore = createMockAppStore({ authState: { authenticated: true, user: null } })
  setupStoreMock(useAppStore, mockStore)
})

async function pasteAndGetImage(user: ReturnType<typeof userEvent.setup>) {
  const previousCount = screen.queryAllByAltText('Clipboard image').length
  await user.click(screen.getByRole('button', { name: 'More message actions' }))
  await user.click(screen.getByRole('menuitem', { name: 'Paste image from clipboard' }))
  await waitFor(() => expect(screen.getAllByAltText('Clipboard image')).toHaveLength(previousCount + 1))
}

describe('ChatWindow — OCR toggle UI', () => {
  it('shows "Switch to Text (OCR) mode" toggle button after adding an image', async () => {
    const user = userEvent.setup()
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    expect(
      screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }),
    ).toBeInTheDocument()
  })

  it('calls ocrImage IPC when the OCR toggle is clicked', async () => {
    const user = userEvent.setup()
    mockApi.ocrImage.mockResolvedValue({ text: 'some extracted text' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))

    await waitFor(() => expect(mockApi.ocrImage).toHaveBeenCalledWith('data:image/png;base64,screenshot'))
  })

  it('shows "OCR ready" label and "Switch to Vision mode" toggle after OCR succeeds', async () => {
    const user = userEvent.setup()
    mockApi.ocrImage.mockResolvedValue({ text: 'extracted content' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))

    await waitFor(() => expect(screen.getByText('OCR ready')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /switch to vision mode/i })).toBeInTheDocument()
  })

  it('shows a toast and keeps vision mode when OCR returns an error', async () => {
    const user = userEvent.setup()
    mockApi.ocrImage.mockResolvedValue({ error: 'engine crash' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))

    await waitFor(() =>
      expect(mockStore.addToast).toHaveBeenCalledWith(expect.stringContaining('OCR failed'), 'error'),
    )
    // Mode should not have changed — toggle still shows "Switch to Text (OCR) mode"
    expect(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i })).toBeInTheDocument()
  })

  it('shows a toast and keeps vision mode when OCR returns empty text', async () => {
    const user = userEvent.setup()
    mockApi.ocrImage.mockResolvedValue({ text: '   ' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))

    await waitFor(() =>
      expect(mockStore.addToast).toHaveBeenCalledWith(expect.stringContaining('No text detected'), 'info'),
    )
    expect(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i })).toBeInTheDocument()
  })

  it('reverts to vision mode when the toggle is clicked again after OCR completes', async () => {
    const user = userEvent.setup()
    mockApi.ocrImage.mockResolvedValue({ text: 'text content' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))
    await waitFor(() => expect(screen.getByText('OCR ready')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /switch to vision mode/i }))

    await waitFor(() =>
      expect(screen.queryByText('OCR ready')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i })).toBeInTheDocument()
  })
})

describe('ChatWindow — OCR send path', () => {
  it('blocks send while an image has ocrPending: true', async () => {
    const user = userEvent.setup()
    let resolveOcr: ((v: { text: string }) => void) | undefined
    mockApi.ocrImage.mockImplementation(
      () => new Promise((resolve) => { resolveOcr = resolve }),
    )
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))
    // OCR is pending — type text and attempt send
    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'tell me about this')
    await user.click(screen.getByRole('button', { name: /send/i }))

    expect(mockApi.sendMessage).not.toHaveBeenCalled()

    // Resolve OCR and send again
    act(() => resolveOcr!({ text: 'extracted content' }))
    await waitFor(() => expect(screen.getByText('OCR ready')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(mockApi.sendMessage).toHaveBeenCalledOnce()
  })

  it('injects OCR text block into message content and excludes the image from vision images', async () => {
    const user = userEvent.setup()
    mockApi.ocrImage.mockResolvedValue({ text: 'detected text from screenshot' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)

    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))
    await waitFor(() => expect(screen.getByText('OCR ready')).toBeInTheDocument())

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'what is this?')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockApi.sendMessage).toHaveBeenCalledOnce())

    const [, content, options] = mockApi.sendMessage.mock.calls[0] as [string, string, { images?: unknown[] }]
    expect(content).toContain('[OCR from: Clipboard image')
    expect(content).toContain('detected text from screenshot')
    expect(content).toContain('what is this?')
    // OCR image should NOT be in vision images sent to LLM
    expect(options.images).toBeUndefined()
  })

  it('sends vision images to LLM and injects OCR text for OCR-mode images side by side', async () => {
    const user = userEvent.setup()
    // First clipboard image → OCR mode
    mockApi.ocrImage.mockResolvedValue({ text: 'text from first' })
    render(<ChatWindow />)
    await pasteAndGetImage(user)
    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))
    await waitFor(() => expect(screen.getByText('OCR ready')).toBeInTheDocument())

    // Second clipboard image → stays as vision
    mockApi.readClipboardContent.mockResolvedValue({
      type: 'image',
      dataUrl: 'data:image/png;base64,second',
    })
    await pasteAndGetImage(user)
    await waitFor(() => expect(screen.getAllByAltText('Clipboard image')).toHaveLength(2))

    const textarea = screen.getByRole('textbox', { name: /message input/i })
    await user.type(textarea, 'analyze both')
    await user.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(mockApi.sendMessage).toHaveBeenCalledOnce())

    const [, content, options] = mockApi.sendMessage.mock.calls[0] as [string, string, { images?: { dataUrl: string }[] }]
    expect(content).toContain('[OCR from: Clipboard image')
    expect(content).toContain('text from first')
    // Only the vision image should be in options.images
    expect(options.images).toHaveLength(1)
    expect(options.images![0].dataUrl).toBe('data:image/png;base64,second')
  })
})
