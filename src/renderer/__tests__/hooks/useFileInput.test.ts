import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ClipboardEvent, DragEvent } from 'react'
import { useFileInput } from '../../../renderer/hooks/useFileInput'
import { setupMockApi } from '../../../test/mocks/api'

class MockFileReader {
  result: string | ArrayBuffer | null = 'data:image/png;base64,abc'
  onload: null | (() => void) = null
  onerror: null | (() => void) = null
  error: DOMException | null = null

  readAsDataURL() {
    this.onload?.()
  }
}

beforeEach(() => {
  setupMockApi()
  vi.stubGlobal('FileReader', MockFileReader)
})

describe('useFileInput', () => {
  it('handlePaste adds pasted images to pendingImages', async () => {
    const { result } = renderHook(() => useFileInput())
    const preventDefault = vi.fn()
    const file = new File(['image'], 'paste.png', { type: 'image/png' })

    await act(async () => {
      await result.current.handlePaste({
        clipboardData: {
          items: [
            {
              type: 'image/png',
              getAsFile: () => file,
            },
          ],
        },
        preventDefault,
      } as unknown as ClipboardEvent)
    })

    await waitFor(() => {
      expect(result.current.pendingImages).toHaveLength(1)
      expect(result.current.pendingImages[0]).toMatchObject({ name: 'image.png' })
    })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('removeAttachment removes attachments by id', () => {
    const { result } = renderHook(() => useFileInput())

    act(() => {
      result.current.setPendingAttachments([
        { id: 'a1', name: 'one.txt', path: 'C:\\one.txt', size: 1 },
        { id: 'a2', name: 'two.txt', path: 'C:\\two.txt', size: 2 },
      ])
    })

    act(() => {
      result.current.removeAttachment('a1')
    })

    expect(result.current.pendingAttachments).toEqual([
      { id: 'a2', name: 'two.txt', path: 'C:\\two.txt', size: 2 },
    ])
  })

  it('tracks drag depth and dragging state across enter and leave events', () => {
    const { result } = renderHook(() => useFileInput())
    const event = { preventDefault: vi.fn() } as unknown as DragEvent

    act(() => {
      result.current.handleDragEnter(event)
      result.current.handleDragEnter(event)
    })

    expect(result.current.dragDepthRef.current).toBe(2)
    expect(result.current.isDragging).toBe(true)

    act(() => {
      result.current.handleDragLeave(event)
    })

    expect(result.current.dragDepthRef.current).toBe(1)
    expect(result.current.isDragging).toBe(true)

    act(() => {
      result.current.handleDragLeave(event)
    })

    expect(result.current.dragDepthRef.current).toBe(0)
    expect(result.current.isDragging).toBe(false)
  })

  it('uses Electron webUtils paths for dropped files', async () => {
    const api = setupMockApi()
    api.getPathForFile.mockReturnValue('C:\\drop\\notes.txt')
    const { result } = renderHook(() => useFileInput())
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    await act(async () => {
      await result.current.handleDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [file] },
      } as unknown as DragEvent)
    })

    expect(api.getPathForFile).toHaveBeenCalledWith(file)
    expect(result.current.pendingAttachments).toEqual([
      expect.objectContaining({ name: 'notes.txt', path: 'C:\\drop\\notes.txt', size: 5 }),
    ])
  })

  it('adds selected desktop folders as attachments', async () => {
    const api = setupMockApi()
    api.openDirectoryDialog.mockResolvedValue(['C:\\work\\docs'])
    const { result } = renderHook(() => useFileInput())

    await act(async () => {
      await result.current.handleFolderPick()
    })

    expect(result.current.pendingAttachments).toEqual([
      expect.objectContaining({ name: 'docs', path: 'C:\\work\\docs', type: 'folder' }),
    ])
  })
})
