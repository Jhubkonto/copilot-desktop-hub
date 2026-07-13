import { useCallback, useEffect, useState } from 'react'
import type { ErrorReportEntry } from '@shared/types'
import { isApiError } from '@shared/types'
import type { Conversation } from '../../store/types'
import { PlanPreview } from '../CodeChangePlanPreview'

const STEP_LABELS: Record<string, string> = {
  describe: 'Describe',
  'plan-review': 'Review Plan',
  executing: 'Execute',
  verifying: 'Verify',
  'final-review': 'Review',
  attention: 'Review Plan',
}
const STEP_ORDER = ['describe', 'plan-review', 'executing', 'verifying', 'final-review']

function stepIndex(step: string): number {
  if (step === 'attention') return STEP_ORDER.indexOf('plan-review')
  const idx = STEP_ORDER.indexOf(step)
  return idx === -1 ? 0 : idx
}

/**
 * Chat-hijack surface for a dedicated Code Changes conversation: the conversation's transcript
 * is entirely replaced by this 6-step wizard for the lifetime of the request (see
 * `conversations.kind === 'code-change'` in ChatWindow.tsx).
 */
export function CodeChangeWizard({ conversation }: { conversation: Conversation }) {
  const [reportId, setReportId] = useState<string | null>(null)
  const [report, setReport] = useState<ErrorReportEntry | null>(null)
  const [description, setDescription] = useState('')
  const [revisionNotes, setRevisionNotes] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const refreshReport = useCallback(async () => {
    const result = await window.api.getCodeChangeReportForConversation(conversation.id)
    if (isApiError(result)) {
      setError(result.error)
      return null
    }
    setReport(result)
    setReportId(result?.id ?? null)
    return result
  }, [conversation.id])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    refreshReport().finally(() => {
      if (!cancelled) setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refreshReport])

  const step = report?.step ?? 'describe'

  const handleSubmitDescription = async () => {
    if (!reportId || !description.trim()) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.api.submitCodeChangeDescription(reportId, description.trim())
      if (isApiError(result)) {
        setError(result.error)
        return
      }
      await refreshReport()
    } finally {
      setIsLoading(false)
    }
  }

  const handleAccept = async () => {
    if (!reportId) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.api.acceptCodeChangePlan(reportId)
      if (isApiError(result)) {
        setError(result.error)
        return
      }
      await refreshReport()
    } finally {
      setIsLoading(false)
    }
  }

  const handleRevise = async () => {
    if (!reportId || !revisionNotes.trim()) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.api.reviseCodeChangePlan(reportId, revisionNotes.trim())
      if (isApiError(result)) {
        setError(result.error)
        return
      }
      setRevisionNotes('')
      await refreshReport()
    } finally {
      setIsLoading(false)
    }
  }

  const handlePush = async () => {
    if (!reportId) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.api.pushCodeChange(reportId)
      if (isApiError(result)) {
        setError(result.error)
        return
      }
      setSuccessMessage('Changes pushed successfully')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-6 pt-6 px-4 pb-8">
        <CodeChangeStepBar currentStep={step} />

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            {error}
          </div>
        )}

        {step === 'describe' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Describe the change</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">What code changes do you want to make?</p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              placeholder="Describe the changes you want..."
            />
            <button
              onClick={() => void handleSubmitDescription()}
              disabled={!description.trim() || isLoading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isLoading ? 'Analyzing...' : 'Generate Plan'}
            </button>
          </div>
        )}

        {(step === 'plan-review' || step === 'attention') && report && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Review Plan</h2>
            <PlanPreview report={report} />
            <div className="flex gap-2">
              <button
                onClick={() => void handleAccept()}
                disabled={isLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isLoading ? 'Executing...' : 'Accept & Execute'}
              </button>
            </div>
            <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
              <textarea
                value={revisionNotes}
                onChange={(e) => setRevisionNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-200 bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                placeholder="Revision notes (optional)"
              />
              <button
                onClick={() => void handleRevise()}
                disabled={!revisionNotes.trim() || isLoading}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300"
              >
                Revise Plan
              </button>
            </div>
          </div>
        )}

        {step === 'executing' && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Executing changes</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Generating patch and applying changes...</p>
          </div>
        )}

        {step === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Verifying changes</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Running verification commands...</p>
          </div>
        )}

        {step === 'final-review' && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Final Review</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300">Changes committed locally.</p>
            {successMessage && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/20 dark:text-green-300">
                {successMessage}
              </div>
            )}
            <button
              onClick={() => void handlePush()}
              disabled={isLoading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isLoading ? 'Pushing...' : 'Push to Remote'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CodeChangeStepBar({ currentStep }: { currentStep: string }) {
  const currentIndex = stepIndex(currentStep)
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex gap-1">
        {STEP_ORDER.map((s, idx) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${
              idx < currentIndex
                ? 'bg-blue-300 dark:bg-blue-800'
                : idx === currentIndex
                  ? 'bg-blue-600'
                  : 'bg-gray-200 dark:bg-gray-700'
            }`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
        {STEP_ORDER.map((s) => (
          <span key={s}>{STEP_LABELS[s]}</span>
        ))}
      </div>
    </div>
  )
}
