import { useEffect, useState, type ReactNode } from 'react'
import { Activity, ChevronDown, ChevronUp, FileText, MessageSquare, X, Zap } from 'lucide-react'
import type { ContextRef, ContextSnapshot } from '../hooks/chat-types'
import type {
  ConversationCompressionDraft,
  ConversationCompressionPreview,
  StructuredConversationSummary,
} from '../../shared/types'

interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

interface PastedImage {
  id: string
  dataUrl: string
  name: string
}

interface ContextInspectorProps {
  systemPrompt: string
  contextRefs: ContextRef[]
  attachments: Attachment[]
  images: PastedImage[]
  historyMessages: { role: string }[]
  currentInput: string
  model: string
  conversationId?: string | null
  onClose: () => void
}

/** Tokens per resolved @ref (rough estimate before actual resolution). */
const REF_TOKEN_ESTIMATE: Record<string, number> = {
  workspace: 500,
  git: 200,
  'git-diff': 800,
  file: 300,
  wiki: 1000,
}

function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4))
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}k`
  return `~${n}`
}

const MAX_TOKENS = 16000

const SUMMARY_SECTION_LABELS: Array<[keyof StructuredConversationSummary, string]> = [
  ['goals', 'Goals'],
  ['decisions', 'Decisions'],
  ['constraints', 'Constraints'],
  ['filesTouched', 'Files touched'],
  ['commandsRun', 'Commands run'],
  ['openQuestions', 'Open questions'],
  ['nextActions', 'Next actions'],
  ['recentContextNotes', 'Recent context notes'],
]

function listToText(items: string[]): string {
  return items.join('\n')
}

function textToList(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function ContextRow({
  label,
  detail,
  value,
  children,
}: {
  label: string
  detail?: string
  value?: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{label}</p>
          {detail && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 break-words">{detail}</p>}
        </div>
        {value && <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{value}</span>}
      </div>
      {children}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  )
}

/** Collapsible panel showing what will be included in the next message payload. */
export function ContextInspector({
  systemPrompt,
  contextRefs,
  attachments,
  images,
  historyMessages,
  currentInput,
  conversationId,
  onClose,
}: ContextInspectorProps) {
  const [showPrompt, setShowPrompt] = useState(false)
  const [showCompression, setShowCompression] = useState(false)
  const [compressionPreview, setCompressionPreview] = useState<ConversationCompressionPreview | null>(null)
  const [compressionDraft, setCompressionDraft] = useState<ConversationCompressionDraft | null>(null)
  const [compressionError, setCompressionError] = useState<string | null>(null)
  const [isPreparingCompression, setIsPreparingCompression] = useState(false)
  const [isSavingCompression, setIsSavingCompression] = useState(false)

  useEffect(() => {
    if (!conversationId) {
      setCompressionPreview(null)
      return
    }
    let cancelled = false
    window.api.getConversationCompressionPreview(conversationId)
      .then((preview) => {
        if (!cancelled) setCompressionPreview(preview)
      })
      .catch(() => {
        if (!cancelled) setCompressionPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, historyMessages.length])

  const prepareManualCompression = async () => {
    if (!conversationId || isPreparingCompression) return
    setCompressionError(null)
    setIsPreparingCompression(true)
    try {
      const draft = await window.api.prepareConversationCompressionSummary(conversationId)
      setCompressionDraft(draft)
      setShowCompression(true)
    } catch {
      setCompressionError('Unable to prepare compression summary.')
    } finally {
      setIsPreparingCompression(false)
    }
  }

  const updateDraftSection = (key: keyof StructuredConversationSummary, value: string) => {
    setCompressionDraft((draft) => {
      if (!draft) return draft
      return {
        ...draft,
        sections: {
          ...draft.sections,
          [key]: textToList(value),
        },
      }
    })
  }

  const saveManualCompression = async () => {
    if (!compressionDraft || isSavingCompression) return
    setCompressionError(null)
    setIsSavingCompression(true)
    try {
      const preview = await window.api.saveConversationCompressionSummary({
        conversationId: compressionDraft.conversation_id,
        summarizedMessageCount: compressionDraft.summarized_message_count,
        retainedMessageCount: compressionDraft.retained_message_count,
        estimatedTokensBefore: compressionDraft.estimated_tokens_before,
        targetBudget: compressionDraft.target_budget,
        strategy: compressionDraft.strategy,
        sections: compressionDraft.sections,
      })
      setCompressionPreview(preview)
      setCompressionDraft(null)
    } catch {
      setCompressionError('Unable to save compression summary.')
    } finally {
      setIsSavingCompression(false)
    }
  }

  const systemTokens = estimateTokens(systemPrompt.length)
  const refTokens = contextRefs.reduce((sum, r) => sum + (REF_TOKEN_ESTIMATE[r.key] ?? 300), 0)
  const attachTokens = attachments.reduce((sum, a) => sum + estimateTokens(a.size), 0)
  const historyTokens = historyMessages.length * 200
  const inputTokens = estimateTokens(currentInput.length)
  const totalTokens = systemTokens + refTokens + attachTokens + historyTokens + inputTokens

  const pct = Math.min(1, totalTokens / MAX_TOKENS)
  const barColor =
    pct >= 0.8 ? 'bg-red-500' : pct >= 0.5 ? 'bg-amber-500' : 'bg-emerald-500'
  const countColor =
    pct >= 0.8
      ? 'text-red-500'
      : pct >= 0.5
        ? 'text-amber-500'
        : 'text-gray-500 dark:text-gray-400'

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Context inspector"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-5xl h-[84vh] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 shadow-2xl flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" />
              Context inspector
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Review the payload that will be included with the next message.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close context inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-200 ${barColor}`}
                  style={{ width: `${(pct * 100).toFixed(1)}%` }}
                />
              </div>
              <span className={`shrink-0 text-xs font-medium tabular-nums ${countColor}`}>
                {fmtTokens(totalTokens)} / {fmtTokens(MAX_TOKENS)} tokens
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard label="System" value={fmtTokens(systemTokens)} />
              <StatCard label="@refs" value={`${contextRefs.length}`} />
              <StatCard label="Files" value={`${attachments.length}`} />
              <StatCard label="Images" value={`${images.length}`} />
              <StatCard label="History" value={`${historyMessages.length}`} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
            <div className="space-y-4">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Payload sources</h3>
                {systemPrompt.length > 0 && (
                  <ContextRow label="System prompt" value={`${fmtTokens(systemTokens)} tok`}>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                      onClick={() => setShowPrompt((v) => !v)}
                    >
                      {showPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showPrompt ? 'Hide prompt' : 'Show prompt'}
                    </button>
                    {showPrompt && (
                      <pre className="mt-2 text-[11px] leading-5 text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-mono bg-gray-50 dark:bg-gray-950/60 rounded-lg border border-gray-200 dark:border-gray-700 p-3 max-h-48 overflow-auto">
                        {systemPrompt}
                      </pre>
                    )}
                  </ContextRow>
                )}
                {contextRefs.length > 0 ? contextRefs.map((ref, i) => (
                  <ContextRow
                    key={`${ref.token}-${i}`}
                    label={ref.token}
                    detail="Resolved when the next message is dispatched."
                    value={`${fmtTokens(REF_TOKEN_ESTIMATE[ref.key] ?? 300)} tok`}
                  />
                )) : (
                  <ContextRow label="@refs" detail="No explicit context references attached." />
                )}
                {attachments.length > 0 ? attachments.map((att) => (
                  <ContextRow
                    key={att.id}
                    label={att.name}
                    detail={`${att.size.toLocaleString()} bytes`}
                    value={`${fmtTokens(estimateTokens(att.size))} tok`}
                  />
                )) : (
                  <ContextRow label="File attachments" detail="No files attached to the draft message." />
                )}
              </section>
            </div>

            <aside className="space-y-4">
              <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Current chat</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">History</span>
                    <span className="font-medium text-gray-700 dark:text-gray-200">{historyMessages.length} messages</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">Draft input</span>
                    <span className="font-medium text-gray-700 dark:text-gray-200">{fmtTokens(inputTokens)} tok</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">Images</span>
                    <span className="font-medium text-gray-700 dark:text-gray-200">{images.length || 'None'}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-gray-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Compression</h3>
                </div>
                {compressionPreview ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <StatCard label="Summary" value={compressionPreview.has_summary ? `${compressionPreview.summarized_message_count}` : 'Off'} />
                      <StatCard label="Retained" value={`${compressionPreview.retained_message_count}`} />
                      <StatCard label="Omitted" value={`${compressionPreview.omitted_message_count}`} />
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => setShowCompression((value) => !value)}
                    >
                      {showCompression ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {showCompression ? 'Hide details' : 'Show details'}
                    </button>
                    {!compressionPreview.has_summary && (
                      <p className="text-xs text-gray-500">
                        No rolling summary yet. Recent history will be sent until compression starts.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Compression preview is unavailable for this draft.</p>
                )}
              </section>
            </aside>
          </div>

          {compressionPreview && showCompression && (
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">Compression preview</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Inspect or replace the rolling summary used for long conversations.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!conversationId || isPreparingCompression}
                  onClick={prepareManualCompression}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 px-3 py-1.5 text-xs font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-60"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {isPreparingCompression ? 'Preparing...' : 'Compress now'}
                </button>
              </div>

              {compressionError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                  {compressionError}
                </div>
              )}

              {compressionDraft && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/30 p-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard label="Will summarize" value={`${compressionDraft.summarized_message_count}`} />
                    <StatCard label="Will retain" value={`${compressionDraft.retained_message_count}`} />
                    <StatCard label="Original" value={`${fmtTokens(compressionDraft.estimated_tokens_before)} tok`} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {SUMMARY_SECTION_LABELS.map(([key, label]) => (
                      <label key={key} className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
                        <textarea
                          value={listToText(compressionDraft.sections[key])}
                          onChange={(event) => updateDraftSection(key, event.target.value)}
                          className="h-24 w-full resize-y rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-xs leading-5 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="One item per line"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCompressionDraft(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSavingCompression}
                      onClick={saveManualCompression}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-60 font-medium"
                    >
                      {isSavingCompression ? 'Saving...' : 'Save summary'}
                    </button>
                  </div>
                </div>
              )}

              {compressionPreview.has_summary && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {compressionPreview.sections && Object.entries(compressionPreview.sections)
                      .filter(([, values]) => values.length > 0)
                      .map(([key, values]) => (
                        <span key={key} className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] text-gray-600 dark:text-gray-300">
                          {key}: {values.length}
                        </span>
                      ))}
                  </div>
                  {compressionPreview.sections?.nextActions.length ? (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/30 p-3">
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Next actions</p>
                      <ul className="mt-2 list-disc pl-4 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                        {compressionPreview.sections.nextActions.slice(0, 3).map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/** Read-only panel shown inside a MessageBubble when a context snapshot is present. */
export function ContextSnapshotBadge({ snapshot }: { snapshot: ContextSnapshot }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        aria-label="Toggle context snapshot"
        onClick={() => setExpanded((v) => !v)}
      >
        ⓘ Context snapshot
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
          {snapshot.systemPrompt && (
            <div>
              <span className="font-medium">System Prompt:</span>{' '}
              <span className="italic">{snapshot.systemPrompt.slice(0, 120)}{snapshot.systemPrompt.length > 120 ? '…' : ''}</span>
            </div>
          )}
          {snapshot.contextRefs.length > 0 && (
            <div>
              <span className="font-medium">@refs:</span>{' '}
              {snapshot.contextRefs.map((r) => r.token).join(', ')}
            </div>
          )}
          {snapshot.attachments.length > 0 && (
            <div>
              <span className="font-medium">Files:</span> {snapshot.attachments.map((a) => a.name).join(', ')}
            </div>
          )}
          <div className="flex gap-3">
            <span><span className="font-medium">History:</span> {snapshot.historyLength} messages</span>
            <span><span className="font-medium">Model:</span> {snapshot.model}</span>
            <span><span className="font-medium">~{snapshot.estimatedTokens}</span> tok total</span>
          </div>
        </div>
      )}
    </div>
  )
}
