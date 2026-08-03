import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ImagePreviewProps {
  src: string
  previewSrc?: string
  alt: string
  thumbnailClassName: string
}

export function ImagePreview({ src, previewSrc = src, alt, thumbnailClassName }: ImagePreviewProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <>
      <button
        type="button"
        className="block cursor-zoom-in rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-nexy-project-blue"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label={`Preview ${alt}`}
      >
        <img src={src} alt={alt} className={thumbnailClassName} />
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[1000]"
          aria-modal="true"
          role="dialog"
        >
          <button
            type="button"
            className="flex h-screen w-screen cursor-zoom-out items-center justify-center bg-black/90 p-4 focus:outline-none"
            onClick={() => setOpen(false)}
            aria-label={`Close preview of ${alt}`}
          >
            <img
              src={previewSrc}
              alt={alt}
              className="h-full w-full object-contain [image-rendering:auto]"
            />
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
