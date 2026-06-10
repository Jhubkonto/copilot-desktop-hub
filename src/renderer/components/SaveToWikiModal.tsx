import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import type { WikiEntry } from '../../shared/types'
import { Button, ModalShell } from './ui/primitives'

interface SaveToWikiModalProps {
  projectId: string
  conversationId: string
  messageId: string
  initialContent: string
  onSaved: (entry: WikiEntry) => void
  onClose: () => void
}

function deriveInitialTitle(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\\n/g, '\n')
  const firstLine = normalized.match(/^[^\n]*/)?.[0]?.trim() ?? ''
  const stripped = firstLine.replace(/^#{1,6}\s+/, '').trim()
  return stripped.slice(0, 80) || 'New wiki entry'
}

function addUniqueTag(tags: string[], value: string): string[] {
  const next = value.trim().replace(/^,+|,+$/g, '')
  if (!next || tags.includes(next)) return tags
  return [...tags, next]
}

export function SaveToWikiModal({
  projectId,
  conversationId,
  messageId,
  initialContent,
  onSaved,
  onClose,
}: SaveToWikiModalProps) {
  const [title, setTitle] = useState(() => deriveInitialTitle(initialContent))
  const [body, setBody] = useState(initialContent)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const previewTags = useMemo(
    () => addUniqueTag(tags, tagInput),
    [tagInput, tags],
  )

  const commitTagInput = useCallback(() => {
    setTags((prev) => addUniqueTag(prev, tagInput))
    setTagInput('')
  }, [tagInput])

  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Title is required')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const entry = await window.api.createWikiEntry(
        projectId,
        trimmedTitle,
        body,
        addUniqueTag(tags, tagInput),
        { conversationId, messageId },
      )
      onSaved(entry)
      onClose()
    } catch {
      setError('Failed to save wiki entry')
    } finally {
      setSaving(false)
    }
  }, [body, conversationId, messageId, onClose, onSaved, projectId, tagInput, tags, title])

  return (
    <ModalShell
      title="Save to project wiki"
      icon={<BookOpen className="w-4 h-4 text-blue-500 shrink-0" />}
      ariaLabel="Save to project wiki"
      maxWidth="max-w-lg"
      height=""
      bodyClassName="p-5 space-y-4"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} className="px-4 py-2 text-sm">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{saving ? 'Saving...' : 'Save to wiki'}</span>
          </Button>
        </>
      }
    >
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Title
          </label>
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New wiki entry"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            aria-label="Wiki title"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Tags
          </label>
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                commitTagInput()
              } else if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
                event.preventDefault()
                setTags((prev) => prev.slice(0, -1))
              }
            }}
            placeholder="Add tags and press comma or Enter"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            aria-label="Wiki tags"
          />
          {previewTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {previewTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
                >
                  <span>{tag}</span>
                  {tags.includes(tag) && (
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((value) => value !== tag))}
                      className="rounded-full text-blue-500 hover:text-blue-700 dark:hover:text-blue-200"
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Body
          </label>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            className="w-full resize-y rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
            aria-label="Wiki body"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}
    </ModalShell>
  )
}
