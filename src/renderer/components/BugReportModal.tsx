import { useMemo, useState } from 'react'
import { Bug, Image, ScrollText } from 'lucide-react'
import { Button, ModalShell, TextareaField, TextField } from './ui/primitives'

interface BugReportDraft {
  title?: string
  description?: string
}

interface BugReportModalProps {
  draft: BugReportDraft
  onClose: () => void
  onSubmitted: (reportId: string) => void
}

export function BugReportModal({ draft, onClose, onSubmitted }: BugReportModalProps) {
  const [title, setTitle] = useState(draft.title ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [includeScreenshot, setIncludeScreenshot] = useState(true)
  const [includeLog, setIncludeLog] = useState(true)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = useMemo(() => title.trim().length > 0 && !submitting, [title, submitting])

  async function capturePreview() {
    setError(null)
    const result = await window.api.captureScreen()
    if ('dataUrl' in result) {
      setScreenshotPreview(result.dataUrl)
      return result.dataUrl
    }
    setError(result.error || 'Screenshot capture failed')
    return null
  }

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const screenshotDataUrl =
        includeScreenshot && !screenshotPreview ? await capturePreview() : screenshotPreview
      const result = await window.api.captureErrorReport({
        title,
        description,
        includeLog,
        includeScreenshot,
        screenshotDataUrl,
      })
      onSubmitted(result.reportId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      title="Report Bug"
      description="Capture a local report with the context needed for self-healing."
      icon={<Bug className="h-4 w-4 text-red-500" />}
      maxWidth="max-w-2xl"
      height="max-h-[88vh]"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Submitting...' : 'Submit report'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What broke?"
          autoFocus
        />
        <TextareaField
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={6}
          placeholder="What were you doing, what happened, and what did you expect?"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeScreenshot}
              onChange={(event) => setIncludeScreenshot(event.target.checked)}
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                <Image className="h-4 w-4" /> Screenshot
              </span>
              <span className="mt-1 block text-xs text-gray-500">Capture the current screen for context.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeLog}
              onChange={(event) => setIncludeLog(event.target.checked)}
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                <ScrollText className="h-4 w-4" /> Error log
              </span>
              <span className="mt-1 block text-xs text-gray-500">Attach the latest stored error entries.</span>
            </span>
          </label>
        </div>
        {includeScreenshot && (
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Screenshot preview</p>
              <Button onClick={() => void capturePreview()} disabled={submitting}>Capture preview</Button>
            </div>
            {screenshotPreview ? (
              <img
                src={screenshotPreview}
                alt="Bug report screenshot preview"
                className="mt-3 max-h-56 w-full rounded-lg border border-gray-200 object-contain dark:border-gray-700"
              />
            ) : (
              <p className="mt-3 text-xs text-gray-500">A screenshot will be captured when you submit.</p>
            )}
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      </div>
    </ModalShell>
  )
}
