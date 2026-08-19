import { useEffect, useState } from 'react'
import { Activity, ChevronDown, ChevronUp, FileText, MessageSquare, Zap } from 'lucide-react'
import type { ContextRef, ContextSnapshot } from '../hooks/chat-types'
import type {
  ConversationCompressionDraft,
  ConversationCompressionPreview,
  StructuredConversationSummary,
} from '../../shared/types'
import { Button, InfoRow, ModalShell, StatCard, TextareaField } from './ui/primitives'
import { CONTEXT_INSPECTOR_MAX_TOKENS, REF_TOKEN_ESTIMATE, estimateTokens } from '../lib/context-token-estimate'

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

function fmtTokens(n: number): string {
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}k`
  return `~${n}`
}

const MAX_TOKENS = CONTEXT_INSPECTOR_MAX_TOKENS

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
    <ModalShell
      title="Context inspector"
      description="Review the payload that will be included with the next message."
      icon={<Activity className="w-4 h-4 text-gray-400" />}
      onClose={onClose}
    >
      <div className="space-y-5 text-xs text-gray-700 dark:text-gray-300">
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
                  <InfoRow label="System prompt" value={`${fmtTokens(systemTokens)} tok`}>
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
                  </InfoRow>
                )}
                {contextRefs.length > 0 ? contextRefs.map((ref, i) => (
                  <InfoRow
                    key={`${ref.token}-${i}`}
                    label={ref.token}
                    detail="Resolved when the next message is dispatched."
                    value={`${fmtTokens(REF_TOKEN_ESTIMATE[ref.key] ?? 300)} tok`}
                  />
                )) : (
                  <InfoRow label="@refs" detail="No explicit context references attached." />
                )}
                {attachments.length > 0 ? attachments.map((att) => (
                  <InfoRow
                    key={att.id}
                    label={att.name}
                    detail={`${att.size.toLocaleString()} bytes`}
                    value={`${fmtTokens(estimateTokens(att.size))} tok`}
                  />
                )) : (
                  <InfoRow label="File attachments" detail="No files attached to the draft message." />
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
                    {compressionPreview.has_summary && (
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-gray-500">Tokens before → after</span>
                        <span className="font-medium text-gray-700 dark:text-gray-200 tabular-nums">
                          {fmtTokens(compressionPreview.estimated_tokens_before)} → {fmtTokens(compressionPreview.estimated_tokens_after)}
                        </span>
                      </div>
                    )}
                    <Button
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => setShowCompression((value) => !value)}
                    >
                      {showCompression ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {showCompression ? 'Hide details' : 'Show details'}
                    </Button>
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
                <Button
                  variant="primary"
                  disabled={!conversationId || isPreparingCompression || historyMessages.length <= 6}
                  onClick={prepareManualCompression}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {isPreparingCompression ? 'Preparing...' : 'Compress now'}
                </Button>
              </div>

              {historyMessages.length <= 6 && (
                <p className="text-xs text-gray-500">
                  Manual compression is a forced preview/edit tool — it works below the automatic threshold too,
                  but needs at least 7 messages in this chat to have something worth summarizing.
                </p>
              )}

              {compressionError && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                  {compressionError}
                </div>
              )}

              {compressionDraft && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/30 p-4 space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard label="Will summarize" value={`${compressionDraft.summarized_message_count}`} />
                    <StatCard label="Will retain" value={`${compressionDraft.retained_message_count}`} />
                    <StatCard label="Original" value={`${fmtTokens(compressionDraft.estimated_tokens_before)} tok`} />
                    <StatCard label="After" value={`${fmtTokens(compressionDraft.estimated_tokens_after)} tok`} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {SUMMARY_SECTION_LABELS.map(([key, label]) => (
                      <TextareaField
                          key={key}
                          label={label}
                          value={listToText(compressionDraft.sections[key])}
                          onChange={(event) => updateDraftSection(key, event.target.value)}
                          className="h-24 text-xs leading-5"
                          placeholder="One item per line"
                        />
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      onClick={() => setCompressionDraft(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={isSavingCompression}
                      onClick={saveManualCompression}
                    >
                      {isSavingCompression ? 'Saving...' : 'Save summary'}
                    </Button>
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
    </ModalShell>
  )
}

/** Read-only panel shown inside a MessageBubble when a context snapshot is present. */
export function ContextSnapshotBadge({ snapshot }: { snapshot: ContextSnapshot | null | undefined }) {
  const [expanded, setExpanded] = useState(false)

  // Snapshots are persisted JSON and older app versions did not always write every
  // field. Treat the parsed value as untrusted at this boundary so one historical
  // message cannot take down the entire chat pane.
  if (!snapshot || typeof snapshot !== 'object') return null

  const contextRefs = Array.isArray(snapshot.contextRefs)
    ? snapshot.contextRefs.filter((ref) => ref && typeof ref.token === 'string')
    : []
  const attachments = Array.isArray(snapshot.attachments)
    ? snapshot.attachments.filter((attachment) => attachment && typeof attachment.name === 'string')
    : []
  const historyLength = typeof snapshot.historyLength === 'number' ? snapshot.historyLength : 0
  const estimatedTokens = typeof snapshot.estimatedTokens === 'number' ? snapshot.estimatedTokens : 0
  const model = typeof snapshot.model === 'string' ? snapshot.model : 'Unknown'
  const systemPrompt = typeof snapshot.systemPrompt === 'string' ? snapshot.systemPrompt : ''
  const serverModel = typeof snapshot.serverModel === 'string' ? snapshot.serverModel : null
  const serverCompression =
    snapshot.serverCompression &&
    typeof snapshot.serverCompression.compressedMessageCount === 'number' &&
    typeof snapshot.serverCompression.retainedMessageCount === 'number'
      ? snapshot.serverCompression
      : null
  const modelChanged = Boolean(serverModel && serverModel !== model)
  const hasRealUsage = typeof snapshot.serverInputTokens === 'number'
  const nextRequest = snapshot.nextRequest && typeof snapshot.nextRequest.inputTokens === 'number' ? snapshot.nextRequest : null
  const turnTotal = snapshot.turnTotal && typeof snapshot.turnTotal.inputTokens === 'number' ? snapshot.turnTotal : null
  const isInteresting =
    historyLength > 0 ||
    contextRefs.length > 0 ||
    attachments.length > 0 ||
    Boolean(serverCompression) ||
    modelChanged ||
    hasRealUsage ||
    Boolean(nextRequest) ||
    Boolean(turnTotal)
  if (!isInteresting) return null

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
          {systemPrompt && (
            <div>
              <span className="font-medium">System Prompt:</span>{' '}
              <span className="italic">{systemPrompt.slice(0, 120)}{systemPrompt.length > 120 ? '…' : ''}</span>
            </div>
          )}
          {contextRefs.length > 0 && (
            <div>
              <span className="font-medium">@refs:</span>{' '}
              {contextRefs.map((r) => r.token).join(', ')}
            </div>
          )}
          {attachments.length > 0 && (
            <div>
              <span className="font-medium">Files:</span> {attachments.map((a) => a.name).join(', ')}
            </div>
          )}
          <div className="flex gap-3">
            <span><span className="font-medium">History:</span> {historyLength} messages</span>
            <span><span className="font-medium">Model:</span> {model}</span>
            {!hasRealUsage && <span><span className="font-medium">~{estimatedTokens}</span> tok total (estimate)</span>}
          </div>
          {hasRealUsage && (
            <div>
              <span className="font-medium">Actual usage:</span>{' '}
              {snapshot.serverInputTokens} input{typeof snapshot.serverOutputTokens === 'number' ? ` / ${snapshot.serverOutputTokens} output` : ''} tok
              <span className="text-gray-400 dark:text-gray-500"> (estimate was ~{estimatedTokens})</span>
            </div>
          )}
          {nextRequest && (
            <div>
              <span className="font-medium">Next request:</span>{' '}
              {nextRequest.inputTokens.toLocaleString()} input tok · {nextRequest.quality} ({nextRequest.source})
            </div>
          )}
          {turnTotal && (
            <div>
              <span className="font-medium">Turn total:</span>{' '}
              {turnTotal.inputTokens.toLocaleString()} input / {turnTotal.outputTokens.toLocaleString()} output tok · {turnTotal.requestCount} request{turnTotal.requestCount === 1 ? '' : 's'}
            </div>
          )}
          {modelChanged && (
            <div className="text-amber-600 dark:text-amber-400">
              Actually sent to <span className="font-medium">{serverModel}</span> (routing overrode the requested model)
            </div>
          )}
          {serverCompression && (
            <div>
              <span className="font-medium">Rolling compression:</span>{' '}
              {serverCompression.compressedMessageCount} messages summarized, {serverCompression.retainedMessageCount} kept verbatim
            </div>
          )}
        </div>
      )}
    </div>
  )
}
