import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentBar } from '../../renderer/components/chat/AttachmentBar'
import type { PastedImage } from '../../renderer/hooks/chat-types'

function makeImage(overrides: Partial<PastedImage> = {}): PastedImage {
  return {
    id: 'img-1',
    name: 'Screen capture',
    dataUrl: 'data:image/png;base64,abc',
    ...overrides,
  }
}

describe('AttachmentBar — OCR toggle', () => {
  it('renders a toggle button with "Switch to Text" label when onToggleImageMode is provided', () => {
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage()]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
        onToggleImageMode={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i })).toBeInTheDocument()
  })

  it('does NOT render a toggle button when onToggleImageMode is absent', () => {
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage()]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument()
  })

  it('calls onToggleImageMode with the image id when clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage({ id: 'img-42' })]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
        onToggleImageMode={onToggle}
      />,
    )
    await user.click(screen.getByRole('button', { name: /switch to text \(ocr\) mode/i }))
    expect(onToggle).toHaveBeenCalledWith('img-42')
  })

  it('disables the toggle button while ocrPending is true', () => {
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage({ ocrPending: true })]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
        onToggleImageMode={vi.fn()}
      />,
    )
    // Toggle button is still rendered but disabled
    const toggle = screen.getByRole('button', { name: /switch to text \(ocr\) mode/i })
    expect(toggle).toBeDisabled()
  })

  it('shows "Switch to Vision mode" label when image is in text mode', () => {
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage({ mode: 'text', ocrText: 'some text' })]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
        onToggleImageMode={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /switch to vision mode/i })).toBeInTheDocument()
  })

  it('shows "OCR ready" label when mode is text and ocrText is present', () => {
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage({ mode: 'text', ocrText: 'detected text' })]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
        onToggleImageMode={vi.fn()}
      />,
    )
    expect(screen.getByText('OCR ready')).toBeInTheDocument()
  })

  it('does NOT show "OCR ready" label while ocrPending is true', () => {
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage({ mode: 'text', ocrText: 'text', ocrPending: true })]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
        onToggleImageMode={vi.fn()}
      />,
    )
    expect(screen.queryByText('OCR ready')).not.toBeInTheDocument()
  })

  it('calls onRemoveImage when remove button is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage({ id: 'img-99' })]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={onRemove}
        onToggleImageMode={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove image/i }))
    expect(onRemove).toHaveBeenCalledWith('img-99')
  })

  it('opens an image preview and closes it when the preview is clicked', async () => {
    const user = userEvent.setup()
    render(
      <AttachmentBar
        attachments={[]}
        images={[makeImage()]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Preview Screen capture' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close preview of Screen capture' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing when both attachments and images are empty', () => {
    const { container } = render(
      <AttachmentBar
        attachments={[]}
        images={[]}
        onRemoveAttachment={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
