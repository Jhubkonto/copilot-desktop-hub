import { Paperclip, X } from 'lucide-react'
import type { Attachment, PastedImage } from '../../hooks/chat-types'

interface AttachmentBarProps {
  attachments: Attachment[]
  images: PastedImage[]
  onRemoveAttachment: (id: string) => void
  onRemoveImage: (id: string) => void
}

export function AttachmentBar({
  attachments,
  images,
  onRemoveAttachment,
  onRemoveImage,
}: AttachmentBarProps) {
  if (attachments.length === 0 && images.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((image) => (
        <div key={image.id} className="relative group/img inline-flex">
          <img
            src={image.dataUrl}
            alt={image.name}
            className="h-16 w-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
          />
          <button
            type="button"
            onClick={() => onRemoveImage(image.id)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
            aria-label="Remove image"
          >
            <X className="w-2.5 h-2.5" />
          </button>
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
