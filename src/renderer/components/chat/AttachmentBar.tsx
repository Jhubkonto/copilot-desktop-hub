import { Eye, Loader2, Paperclip, Type, X } from 'lucide-react'
import type { Attachment, PastedImage } from '../../hooks/chat-types'
import { ImagePreview } from '../ImagePreview'

interface AttachmentBarProps {
  attachments: Attachment[]
  images: PastedImage[]
  onRemoveAttachment: (id: string) => void
  onRemoveImage: (id: string) => void
  onToggleImageMode?: (id: string) => void
}

export function AttachmentBar({
  attachments,
  images,
  onRemoveAttachment,
  onRemoveImage,
  onToggleImageMode,
}: AttachmentBarProps) {
  if (attachments.length === 0 && images.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((image) => (
        <div key={image.id} className="relative group/img inline-flex flex-col items-center gap-0.5">
          <div className="relative">
            <ImagePreview
              src={image.dataUrl}
              alt={image.name}
              thumbnailClassName="h-16 w-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
            />
            {image.mode === 'text' && !image.ocrPending && (
              <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
                <Type className="w-5 h-5 text-white" />
              </div>
            )}
            {image.ocrPending && (
              <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            )}
          </div>
          {image.label && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 max-w-[64px] truncate leading-tight">
              {image.label}
            </span>
          )}
          {image.mode === 'text' && image.ocrText && !image.ocrPending && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 max-w-[64px] truncate leading-tight" title={image.ocrText}>
              OCR ready
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemoveImage(image.id)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
            aria-label="Remove image"
          >
            <X className="w-2.5 h-2.5" />
          </button>
          {onToggleImageMode && (
            <button
              type="button"
              onClick={() => onToggleImageMode(image.id)}
              disabled={image.ocrPending}
              className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity disabled:cursor-not-allowed"
              title={image.mode === 'text' ? 'Switch to Vision mode' : 'Switch to Text (OCR) mode'}
              aria-label={image.mode === 'text' ? 'Switch to Vision mode' : 'Switch to Text (OCR) mode'}
            >
              {image.mode === 'text' ? (
                <Eye className="w-2.5 h-2.5" />
              ) : (
                <Type className="w-2.5 h-2.5" />
              )}
            </button>
          )}
        </div>
      ))}
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
        >
          <Paperclip className="w-3 h-3" />
          {attachment.name}
          <button
            type="button"
            onClick={() => onRemoveAttachment(attachment.id)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-0.5"
            aria-label={`Remove ${attachment.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
