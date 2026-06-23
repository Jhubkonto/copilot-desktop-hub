import { useEffect, useMemo, useState } from 'react'
import { Bug, Image, ScrollText } from 'lucide-react'
import { Button, ModalShell, TextareaField, TextField, ToggleSwitch } from './ui/primitives'
import type { ErrorLogEntry } from '../../shared/types'

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
  const [logPreview, setLogPreview] = useState<ErrorLogEntry[] | null>(null)
  const [logPreviewLoading, setLogPreviewLoading] = useState(false)

  const canSubmit = useMemo(() => title.trim().length > 0 && !submitting, [title, submitting])

  async function capturePreview() {
    setError(null)
    const result = await window.api.captureWindowScreenshot()
    if ('dataUrl' in result) {
      setScreenshotPreview(result.dataUrl)
      return result.dataUrl
    }
    setError(result.error || 'Screenshot capture failed')
    return null
  }

  useEffect(() => {
    if (!includeLog || logPreview !== null) return
    setLogPreviewLoading(true)
    window.api.getRecentErrors(20)
      .then((entries) => setLogPreview(entries))
      .catch(() => setLogPreview([]))
      .finally(() => setLogPreviewLoading(false))
  }, [includeLog, logPreview])

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
      description="Capture a local report with the context needed for remote-editing."
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
          <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
            <span>
              <span className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                <Image className="h-4 w-4" /> Screenshot
              </span>
              <span className="mt-1 block text-xs text-gray-500">Capture the current Nexy window for context.</span>
            </span>
            <ToggleSwitch
              checked={includeScreenshot}
              onChange={setIncludeScreenshot}
              size="sm"
              ariaLabel="Include screenshot"
            />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
            <span>
              <span className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                <ScrollText className="h-4 w-4" /> Error log
              </span>
              <span className="mt-1 block text-xs text-gray-500">Attach the latest stored error entries.</span>
            </span>
            <ToggleSwitch
              checked={includeLog}
              onChange={setIncludeLog}
              size="sm"
              ariaLabel="Include error log"
            />
          </div>
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
        {includeLog && (
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">Error log preview</p>
              {logPreview && (
                <span className="text-xs text-gray-500">Showing last {logPreview.length} (up to 100 attached)</span>
              )}
            </div>
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-700 dark:bg-gray-900/40">
              {logPreviewLoading && <p className="text-gray-500">Loading...</p>}
              {!logPreviewLoading && logPreview && logPreview.length === 0 && (
                <p className="text-gray-500">No recent error log entries.</p>
              )}
              {!logPreviewLoading && logPreview?.map((entry) => (
                <div key={entry.id} className="flex gap-2 font-mono">
                  <span className="shrink-0 text-gray-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className={`shrink-0 uppercase ${entry.level === 'error' ? 'text-red-600 dark:text-red-400' : entry.level === 'warn' ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500'}`}>
                    {entry.level}
                  </span>
                  <span className="truncate text-gray-700 dark:text-gray-300">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      </div>
    </ModalShell>
  )
}
