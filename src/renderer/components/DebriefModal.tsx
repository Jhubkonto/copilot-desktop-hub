import { useEffect, useRef, useState } from 'react'
import { BookOpen, BrainCircuit, Loader2, X } from 'lucide-react'
import { ModalShell } from './ui/primitives'
import { QuizModal } from './QuizModal'
import type { Debrief, DebriefSection } from '../../shared/types'

interface DebriefModalProps {
  conversationId: string
  conversationTitle: string
  projectId: string | null
  model: string
  onClose: () => void
  initialDebrief?: Debrief | null
}

type Step = 'generating' | 'review' | 'storage'

function formatMarkdown(title: string, section: DebriefSection): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const toolLines = section.commandsAndTools.map((t) => `- ${t}`).join('\n') || '- None'
  return [
    `# Debrief: ${title}`,
    `Generated: ${date}`,
    '',
    '## Summary',
    section.summary,
    '',
    '## Commands & Tools Used',
    toolLines,
    '',
    '## How to Reproduce',
    section.reproductionGuide,
    '',
    '## Mental Model / Approach',
    section.mentalModel,
  ].join('\n')
}

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'
const TEXTAREA_CLASS = 'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none'

export function DebriefModal({ conversationId, conversationTitle, projectId, model, onClose, initialDebrief }: DebriefModalProps) {
  const [step, setStep] = useState<Step>(initialDebrief ? 'review' : 'generating')
  const [debrief, setDebrief] = useState<Debrief | null>(initialDebrief ?? null)
  const [error, setError] = useState<string | null>(null)
  const [edited, setEdited] = useState<DebriefSection>(() =>
    initialDebrief
      ? { summary: initialDebrief.summary, commandsAndTools: [...initialDebrief.commandsTools], reproductionGuide: initialDebrief.reproductionGuide, mentalModel: initialDebrief.mentalModel }
      : { summary: '', commandsAndTools: [], reproductionGuide: '', mentalModel: '' }
  )
  const [tagInput, setTagInput] = useState('')

  const [showQuizModal, setShowQuizModal] = useState(false)

  // Storage action states
  const [savingWiki, setSavingWiki] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [exportingMd, setExportingMd] = useState(false)
  const [actionToasts, setActionToasts] = useState<string[]>([])

  const generatedRef = useRef(!!initialDebrief)

  const showToast = (msg: string) => {
    setActionToasts((prev) => [...prev, msg])
    setTimeout(() => setActionToasts((prev) => prev.slice(1)), 3000)
  }

  useEffect(() => {
    if (generatedRef.current) return
    generatedRef.current = true

    window.api.generateDebrief(conversationId, projectId, model || undefined)
      .then((result) => {
        setDebrief(result)
        setEdited({
          summary: result.summary,
          commandsAndTools: [...result.commandsTools],
          reproductionGuide: result.reproductionGuide,
          mentalModel: result.mentalModel,
        })
        setStep('review')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Generation failed')
      })
  }, [conversationId, projectId, model])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const addTag = () => {
    const val = tagInput.trim()
    if (!val) return
    setEdited((prev) => ({ ...prev, commandsAndTools: [...prev.commandsAndTools, val] }))
    setTagInput('')
  }

  const removeTag = (index: number) => {
    setEdited((prev) => ({
      ...prev,
      commandsAndTools: prev.commandsAndTools.filter((_, i) => i !== index),
    }))
  }

  const handleSaveWiki = async () => {
    if (!projectId || !debrief) return
    setSavingWiki(true)
    try {
      const body = formatMarkdown(conversationTitle, edited)
      await window.api.createWikiEntry(projectId, `Debrief: ${conversationTitle}`, body, ['debrief'], { conversationId })
      showToast('Saved to Wiki')
    } catch {
      showToast('Failed to save to Wiki')
    } finally {
      setSavingWiki(false)
    }
  }

  const handleSavePrompt = async () => {
    if (!debrief) return
    setSavingPrompt(true)
    try {
      const body = [
        `Summary: ${edited.summary}`,
        `Commands & Tools: ${edited.commandsAndTools.join(', ')}`,
        `How to Reproduce:\n${edited.reproductionGuide}`,
        `Mental Model:\n${edited.mentalModel}`,
      ].join('\n\n')
      await window.api.createPrompt({
        title: `Debrief: ${conversationTitle}`,
        body,
        description: 'AI-generated session debrief',
        category: 'Debrief',
        tags: ['debrief', 'session'],
        scope: projectId ? 'project' : 'global',
        project_id: projectId ?? null,
      })
      showToast('Saved as Prompt')
    } catch {
      showToast('Failed to save as Prompt')
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleExportMd = async () => {
    setExportingMd(true)
    try {
      const content = formatMarkdown(conversationTitle, edited)
      const path = await window.api.saveTextFile('debrief.md', content)
      if (path) showToast('Exported as Markdown')
    } catch {
      showToast('Failed to export Markdown')
    } finally {
      setExportingMd(false)
    }
  }

  return (
    <>
    <ModalShell
      title="Session Debrief"
      icon={<BookOpen className="w-4 h-4" />}
      maxWidth="max-w-2xl"
      height="h-auto"
      onClose={onClose}
    >
      {/* Toast notifications */}
      {actionToasts.length > 0 && (
        <div className="absolute top-14 right-4 flex flex-col gap-1 z-10">
          {actionToasts.map((msg, i) => (
            <div key={i} className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs px-3 py-1.5 rounded-lg shadow">
              {msg}
            </div>
          ))}
        </div>
      )}

      {/* Step: Generating */}
      {step === 'generating' && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-16" role="status" aria-live="polite">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Generating debrief…</p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <p className="text-sm text-red-500">{error}</p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                generatedRef.current = false
                setError(null)
                setStep('generating')
              }}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
            >
              Retry
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>Summary</label>
            <textarea
              rows={4}
              className={TEXTAREA_CLASS}
              value={edited.summary}
              onChange={(e) => setEdited((prev) => ({ ...prev, summary: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>Commands & Tools</label>
            <div className="flex flex-wrap gap-1.5 mb-1">
              {edited.commandsAndTools.map((tag, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs">
                  {tag}
                  <button onClick={() => removeTag(i)} className="hover:text-indigo-500">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Add command or tool…"
              className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              onBlur={addTag}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>How to Reproduce</label>
            <textarea
              rows={6}
              className={TEXTAREA_CLASS}
              value={edited.reproductionGuide}
              onChange={(e) => setEdited((prev) => ({ ...prev, reproductionGuide: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>Mental Model / Approach</label>
            <textarea
              rows={4}
              className={TEXTAREA_CLASS}
              value={edited.mentalModel}
              onChange={(e) => setEdited((prev) => ({ ...prev, mentalModel: e.target.value }))}
            />
          </div>

          <div className="flex justify-between pt-1">
            <button
              onClick={() => setStep('generating')}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Back
            </button>
            <button
              onClick={() => setStep('storage')}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
            >
              Continue to Storage
            </button>
          </div>
        </div>
      )}

      {/* Step: Storage */}
      {step === 'storage' && (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Save your debrief in one or more places. All actions are independent.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleSaveWiki}
              disabled={savingWiki || !projectId}
              title={!projectId ? 'No project selected' : undefined}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingWiki ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save to Wiki
            </button>

            <button
              onClick={handleSavePrompt}
              disabled={savingPrompt}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50 transition-colors"
            >
              {savingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save as Prompt
            </button>

            <button
              onClick={handleExportMd}
              disabled={exportingMd}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50 transition-colors"
            >
              {exportingMd ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Export Markdown
            </button>

            <button
              onClick={() => setShowQuizModal(true)}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 transition-colors"
            >
              <BrainCircuit className="w-4 h-4" />
              Quiz Me
            </button>
          </div>

          <div className="flex justify-between pt-1">
            <button
              onClick={() => setStep('review')}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Back
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </ModalShell>

    {showQuizModal && (
      <QuizModal conversationId={conversationId} onClose={() => setShowQuizModal(false)} />
    )}
  </>
  )
}
