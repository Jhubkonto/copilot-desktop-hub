import { useEffect, useRef, useState } from 'react'
import { Copy, Play, Sparkles, Loader2, Braces } from 'lucide-react'
import type { AvailableModelEntry, AvailableModelGroup, ManualWorkflowGeneratorMessage, ManualWorkflowSpec } from '../../../shared/types'
import type { ProjectAgent, ProjectConfig } from '../../store/types'
import { useAppStore } from '../../store/app-store'
import { ModelPicker } from '../chat/ModelPicker'
import { VoiceInputButton } from '../chat/VoiceInputButton'
import { DropdownPanel } from '../DropdownPanel'

interface Props {
  projectId: string
  members: ProjectAgent[]
  projectConfig: ProjectConfig
  onStartWorkflowStep: (agentId: string | null, prompt: string) => Promise<void>
  onToast: (message: string, type: 'success' | 'error' | 'info') => void
}

function stripSpecTags(content: string): string {
  return content.replace(/<manual-workflow-spec>[\s\S]*?<\/manual-workflow-spec>/g, '').trim()
}

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const displayContent = stripSpecTags(content)
  if (!displayContent) return null

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-blue-500 text-white rounded-2xl rounded-tr-sm px-3 py-1.5 text-xs whitespace-pre-wrap">
          {displayContent}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-1.5 text-xs text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
        {displayContent}
      </div>
    </div>
  )
}

export function WorkflowTab({ projectId, members, projectConfig, onStartWorkflowStep, onToast }: Props) {
  const authState = useAppStore((s) => s.authState)
  const catalogModels = useAppStore((s) => s.catalogModels)
  const globalDefaultModel = useAppStore((s) => s.globalDefaultModel)
  const hasGeneratorBackend = authState.authenticated || authState.cliInstalled
  const [messages, setMessages] = useState<ManualWorkflowGeneratorMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [spec, setSpec] = useState<ManualWorkflowSpec | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [missedSpec, setMissedSpec] = useState(false)
  const [genModel, setGenModel] = useState<string | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableModelGroup[]>([])
  const [showVariablePicker, setShowVariablePicker] = useState(false)
  const modelPickerRef = useRef<HTMLButtonElement>(null)
  const variablePickerRef = useRef<HTMLButtonElement>(null)
  const streamingTextRef = useRef('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.listAvailableModels().then(setAvailableGroups).catch(() => {})
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  useEffect(() => {
    const offToken = window.api.onManualWorkflowGeneratorToken((chunk) => {
      streamingTextRef.current += chunk
      setStreamingText((current) => current + chunk)
    })
    const offSpec = window.api.onManualWorkflowGeneratorSpecReady((incoming) => {
      setSpec(incoming)
      setMissedSpec(false)
    })
    const offDone = window.api.onManualWorkflowGeneratorDone(({ hasSpec }) => {
      const capturedText = streamingTextRef.current
      const clean = stripSpecTags(capturedText)
      if (clean) {
        setMessages((prev) => [...prev, { role: 'assistant', content: clean }])
      }
      setIsGenerating(false)
      setStreamingText('')
      streamingTextRef.current = ''
      if (!hasSpec && !clean) setMissedSpec(true)
    })
    return () => { offToken(); offSpec(); offDone() }
  }, [])

  const sendMessage = async (userText: string) => {
    const trimmed = userText.trim()
    if (!trimmed || isGenerating) return
    const nextMessages: ManualWorkflowGeneratorMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInputText('')
    setIsGenerating(true)
    setMissedSpec(false)
    setStreamingText('')
    streamingTextRef.current = ''
    try {
      const result = await window.api.manualWorkflowGeneratorChat(projectId, nextMessages, genModel ?? undefined)
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(String((result as { error: unknown }).error))
      }
    } catch (error) {
      setIsGenerating(false)
      onToast(error instanceof Error ? error.message : 'Failed to generate workflow', 'error')
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

  const handleCopyPrompt = async (prompt: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(prompt)
      onToast('Step prompt copied', 'success')
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Failed to copy prompt', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-xs font-semibold">Manual workflow generator</span>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          Describe a project goal and refine it in conversation. The assistant will generate a reusable delegation plan with copyable prompts for each step.
        </p>
      </div>

      {!hasGeneratorBackend && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          No provider or supported CLI backend is configured. Add an API key or install a CLI backend in Settings before generating a workflow.
        </p>
      )}

      {projectConfig.workflowMode !== 'manual-delegation' && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          This project's workflow mode is set to "{projectConfig.workflowMode === 'orchestrated' ? 'Orchestrated' : 'Single'}". You can still generate a plan here — switch to Manual mode in the Team tab if you want to execute it as manual delegation.
        </p>
      )}

      <div className="rounded-md border border-blue-200/70 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 p-3 space-y-3">
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {members.length > 0 ? `${members.length} project agent${members.length === 1 ? '' : 's'} available` : 'No project agents assigned yet'}
        </span>

        {messages.length > 0 && (
          <div className="max-h-56 overflow-y-auto space-y-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 px-3 py-2">
            {messages.map((msg, i) => (
              <ChatBubble key={i} role={msg.role} content={msg.content} />
            ))}
            {isGenerating && streamingText && <ChatBubble role="assistant" content={streamingText} />}
            {isGenerating && !streamingText && (
              <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating…
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}

        <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-white/90 dark:bg-gray-900/60 focus-within:ring-1 focus-within:ring-blue-400">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder={messages.length > 0 ? 'Reply to refine the workflow…' : 'Describe the project goal or milestone you want the team to execute.'}
            className="w-full resize-none bg-transparent px-2.5 pt-2 pb-1.5 text-xs text-gray-800 dark:text-gray-100 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1 border-t border-blue-100 dark:border-blue-900/40">
            <div className="flex items-center gap-0.5">
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
                    disabled={projectConfig.variables.length === 0}
                    title={projectConfig.variables.length === 0 ? 'No project variables defined (Settings → General)' : 'Insert a project variable'}
                    className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Insert project variable"
                  >
                    <Braces className="w-4 h-4" />
                  </button>
                }
              >
                <div className="max-h-48 overflow-y-auto py-1">
                  {projectConfig.variables.length === 0 ? (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 px-3 py-2 italic">No project variables defined</p>
                  ) : projectConfig.variables.map((v) => (
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
              onClick={() => { void sendMessage(inputText) }}
              disabled={isGenerating || !inputText.trim() || !hasGeneratorBackend}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {messages.length > 0 ? 'Send' : 'Generate workflow'}
            </button>
          </div>
        </div>

        {missedSpec && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            No structured workflow was returned yet. Reply above with more detail about the goal or expected deliverables.
          </p>
        )}
        {spec && (
          <div className="space-y-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/70 p-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{spec.title}</p>
              {spec.goalSummary && (
                <p className="text-[11px] text-gray-600 dark:text-gray-300">{spec.goalSummary}</p>
              )}
              {spec.assumptions.length > 0 && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Assumptions: {spec.assumptions.join(' • ')}
                </p>
              )}
            </div>
            <div className="space-y-2">
              {spec.steps.map((step, index) => (
                <div key={step.id} className="rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">
                        {index + 1}. {step.title}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {step.agentName ?? 'Unassigned'}{step.expectedOutput ? ` · Output: ${step.expectedOutput}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { void handleCopyPrompt(step.prompt) }}
                        className="inline-flex items-center gap-1 rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => { void onStartWorkflowStep(step.agentId ?? null, step.prompt) }}
                        className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-900/60 px-2 py-1 text-[10px] text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        <Play className="w-3 h-3" />
                        Start in chat
                      </button>
                    </div>
                  </div>
                  {step.summary && (
                    <p className="text-[11px] text-gray-600 dark:text-gray-300">{step.summary}</p>
                  )}
                  <pre className="whitespace-pre-wrap rounded bg-gray-50 dark:bg-gray-800 px-2.5 py-2 text-[10px] text-gray-700 dark:text-gray-200">
                    {step.prompt}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
