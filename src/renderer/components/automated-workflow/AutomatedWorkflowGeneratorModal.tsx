import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, Braces, X } from 'lucide-react'
import type {
  AvailableModelEntry,
  AvailableModelGroup,
  AutomatedWorkflowGeneratorMessage,
  AutomatedWorkflowRunDetail,
  AutomatedWorkflowSpec,
} from '../../../shared/types'
import { isApiError } from '../../../shared/types'
import { useAppStore } from '../../store/app-store'
import { ModelPicker } from '../chat/ModelPicker'
import { VoiceInputButton } from '../chat/VoiceInputButton'
import { DropdownPanel } from '../DropdownPanel'
import { clearAutomatedWorkflowGeneration, trackAutomatedWorkflowGeneration } from '../BackgroundActivityBridges'
import { ChatBubble, stripSpecTags } from './AutomatedWorkflowShared'

interface AutomatedWorkflowGeneratorModalProps {
  /** null generates a standalone, project-less workflow; a project id scopes generation to that
   *  project's context (its agents apply as candidates, its variables can be inserted). */
  projectId: string | null
  /** Shown in the header when generating for a project — omit for the global/standalone entry point. */
  projectName?: string
  /** Only offered when generating for a project — matches the project-scoped tab's existing
   *  variable-insertion capability; a project-less plan has no project variables to offer. */
  projectVariables?: { key: string; value: string }[]
  onClose: () => void
  onCreated: (run: AutomatedWorkflowRunDetail) => void
}

// Same overlay/modal chrome as every other AI generator (ScheduleGeneratorModal, SkillGeneratorModal,
// AgentGeneratorModal, ArtifactGeneratorModal) — the automated workflow generator was previously
// embedded inline inside its host pane's content area instead of using this established pattern.
export function AutomatedWorkflowGeneratorModal({
  projectId,
  projectName,
  projectVariables = [],
  onClose,
  onCreated,
}: AutomatedWorkflowGeneratorModalProps) {
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const addToast = useAppStore((s) => s.addToast)
  const authState = useAppStore((s) => s.authState)
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled

  const [messages, setMessages] = useState<AutomatedWorkflowGeneratorMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [missedSpec, setMissedSpec] = useState(false)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [showVariablePicker, setShowVariablePicker] = useState(false)
  const [saving, setSaving] = useState(false)
  // The plan generated so far, already persisted as a 'pending' run — kept open (not committed
  // to the caller) so the user can keep chatting to refine it. Each subsequent spec-ready updates
  // this same run in place rather than creating a new one, as long as it's still all-pending
  // (nothing started yet) — mirrors the pre-modal inline generator's exact reuse/branch logic.
  const [savedRun, setSavedRun] = useState<AutomatedWorkflowRunDetail | null>(null)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const variablePickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const genModelRef = useRef<string | null>(null)
  const savedRunRef = useRef<AutomatedWorkflowRunDetail | null>(null)
  genModelRef.current = genModel
  savedRunRef.current = savedRun

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const offToken = window.api.onAutomatedWorkflowGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onAutomatedWorkflowGeneratorSpecReady(async (incoming: AutomatedWorkflowSpec) => {
      setMissedSpec(false)
      setSaving(true)
      const current = savedRunRef.current
      const reuseId = current && current.steps.every((s) => s.status === 'pending') ? current.id : null
      try {
        const saved = await window.api.saveAutomatedWorkflowRunFromSpec(projectId, incoming, genModelRef.current, reuseId)
        if (saved && !isApiError(saved)) setSavedRun(saved)
      } catch (error) {
        addToast(error instanceof Error ? error.message : 'Failed to save workflow plan', 'error')
      } finally {
        setSaving(false)
      }
    })
    const offDone = window.api.onAutomatedWorkflowGeneratorDone(({ hasSpec }) => {
      clearAutomatedWorkflowGeneration(projectId)
      const clean = stripSpecTags(streamingTextRef.current)
      if (clean) setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      setIsGenerating(false)
      setStreamingText('')
      streamingTextRef.current = ''
      if (!hasSpec && !clean) setMissedSpec(true)
    })
    return () => { offToken(); offSpec(); offDone() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectId/genModel read via refs/closure at effect-registration time is fine here; addToast/onClose/onCreated are stable from the caller
  }, [projectId])

  const sendMessage = async (userText: string) => {
    const trimmed = userText.trim()
    if (!trimmed || isGenerating) return
    const nextMessages: AutomatedWorkflowGeneratorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInputText('')
    setIsGenerating(true)
    trackAutomatedWorkflowGeneration(projectId)
    setMissedSpec(false)
    setStreamingText('')
    streamingTextRef.current = ''
    try {
      const result = await window.api.automatedWorkflowGeneratorChat(projectId, nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (error) {
      setIsGenerating(false)
      addToast(error instanceof Error ? error.message : 'Failed to generate workflow', 'error')
    } finally {
      clearAutomatedWorkflowGeneration(projectId)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(inputText)
    }
  }

  const handleInsertVariable = (key: string) => {
    setInputText((current) => `${current}{{${key}}}`)
    setShowVariablePicker(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Generate automated workflow">
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ width: 'min(720px, 96vw)', height: 'min(640px, 90vh)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {projectName ? `New Workflow — ${projectName}` : 'New Standalone Workflow'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3 shrink-0 space-y-1.5">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {projectId
              ? 'Describe the project goal or milestone you want the team to execute. Each step runs via an assigned agent (that agent\'s own skills apply) or a plain model of your choice.'
              : 'Describe a goal. This plan has no project — each step runs via whichever agent or model you (or the planner) choose; steps with no agent run as a plain model with no skill augmentation.'}
          </p>
          {!hasGeneratorBackend && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              No provider or supported CLI backend is configured. Add an API key or install a CLI backend in Settings before generating a workflow.
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-5 py-3 gap-3">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 px-3 py-2">
            {messages.length === 0 && !isGenerating && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500 select-none">
                <Sparkles className="w-7 h-7 opacity-40" />
                <p className="text-xs text-center max-w-[220px]">Describe what you want done — you'll get a step-by-step plan to review before it runs.</p>
              </div>
            )}
            {messages.map((msg, i) => <ChatBubble key={i} role={msg.role} content={msg.content} />)}
            {isGenerating && streamingText && <ChatBubble role="assistant" content={streamingText} />}
            {isGenerating && !streamingText && (
              <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating…
              </div>
            )}
            {saving && (
              <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving plan…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {savedRun && !isGenerating && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-green-200 dark:border-green-900/50 bg-green-50/60 dark:bg-green-950/20 px-3 py-2 shrink-0">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-green-700 dark:text-green-300 truncate">Plan ready: {savedRun.title}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">{savedRun.stepCounts.total} step{savedRun.stepCounts.total === 1 ? '' : 's'} · keep chatting to refine, or use it now</p>
              </div>
              <button
                type="button"
                onClick={() => { onCreated(savedRun); onClose() }}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-green-700 shrink-0"
              >
                Use this plan
              </button>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus-within:ring-1 focus-within:ring-blue-400 shrink-0">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              disabled={isGenerating || saving}
              placeholder={messages.length > 0 ? 'Reply to refine the workflow…' : 'Describe the goal you want a step-by-step plan for.'}
              className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1 border-t border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-0.5">
                {projectId && (
                  <DropdownPanel
                    open={showVariablePicker}
                    onClose={() => setShowVariablePicker(false)}
                    align="left"
                    width="w-56"
                    trigger={
                      <button
                        type="button"
                        ref={variablePickerRef}
                        onClick={() => setShowVariablePicker((v) => !v)}
                        disabled={projectVariables.length === 0}
                        title={projectVariables.length === 0 ? 'No project variables defined (Settings → General)' : 'Insert a project variable'}
                        className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        aria-label="Insert project variable"
                      >
                        <Braces className="w-4 h-4" />
                      </button>
                    }
                  >
                    <div className="max-h-48 overflow-y-auto py-1">
                      {projectVariables.length === 0 ? (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 px-3 py-2 italic">No project variables defined</p>
                      ) : projectVariables.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => handleInsertVariable(v.key)}
                          className="w-full text-left flex flex-col px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                          <span className="font-mono">{`{{${v.key}}}`}</span>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{v.value}</span>
                        </button>
                      ))}
                    </div>
                  </DropdownPanel>
                )}
                <ModelPicker
                  value={genModel ?? 'default'}
                  availableGroups={availableGroups}
                  catalogModels={catalogModels}
                  globalDefaultModel={globalDefaultModel ?? undefined}
                  includeDefault={true}
                  buttonRef={modelPickerRef}
                  buttonClassName="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded-md transition-colors max-w-[120px]"
                  onSelectDefault={() => setGenModel(null)}
                  onSelectAvailableModel={(group: AvailableModelGroup, model: AvailableModelEntry) => {
                    const id = group.sourceType === 'cli' ? `${group.sourceKey}:${model.id}` : model.id
                    setGenModel(id)
                  }}
                />
                <VoiceInputButton disabled={isGenerating} onText={(text) => setInputText((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)} />
              </div>
              <button
                type="button"
                onClick={() => void sendMessage(inputText)}
                disabled={isGenerating || saving || !inputText.trim() || !hasGeneratorBackend}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {messages.length > 0 ? 'Send' : 'Generate workflow'}
              </button>
            </div>
          </div>
          {missedSpec && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
              No structured workflow was returned yet. Reply above with more detail about the goal or expected deliverables.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
