import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { Attachment, PastedImage } from './chat-types'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'])

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function useFileInput() {
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)

  const handleFilePick = useCallback(async () => {
    const files = await window.api.openFileDialog()
    if (files && files.length > 0) {
      setPendingAttachments((prev) => [...prev, ...files])
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }, [])

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((image) => image.id !== id))
  }, [])

  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    const items = Array.from(event.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    event.preventDefault()

    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue

      const dataUrl = await readFileAsDataUrl(file)
      setPendingImages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          dataUrl,
          name: `image.${item.type.split('/')[1] ?? 'png'}`,
        },
      ])
    }
  }, [])

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragging(true)
  }, [])

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
  }, [])

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault()
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (event: DragEvent) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)

    const files = Array.from(event.dataTransfer.files)

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (IMAGE_EXTS.has(ext) || file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file)
        setPendingImages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), dataUrl, name: file.name },
        ])
        continue
      }

      const path = (file as File & { path?: string }).path || ''
      if (!path) continue

      setPendingAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: file.name, path, size: file.size },
      ])
    }
  }, [])

  return {
    pendingAttachments,
    pendingImages,
    isDragging,
    dragDepthRef,
    handleFilePick,
    removeAttachment,
    removeImage,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setPendingAttachments,
    setPendingImages,
  }
}
