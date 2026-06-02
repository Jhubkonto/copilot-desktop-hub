import { useState, useRef, useEffect, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { Camera, ChevronDown, ClipboardPaste, Eye, Paperclip, SendHorizontal, Square, X } from 'lucide-react'
import { getAvailableModelIds, getModelLabel, getModelMultiplier } from '../../../shared/models'
import { ContextInspector } from '../ContextInspector'
import { AttachmentBar } from './AttachmentBar'
import { AtContextMenu } from './AtContextMenu'
import { SlashCommandMenu } from './SlashCommandMenu'
import type { AgentConfig } from '../../../shared/types'
import type { AtContextOption, Attachment, ChatMessage, ContextRef, PastedImage } from '../../hooks/chat-types'
import type { SlashCommandDef } from '../../slash-commands'
import { useAppStore } from '../../store/app-store'

const FALLBACK_CLAUDE_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const FALLBACK_CODEX_MODELS: { id: string; label: string }[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
]

interface ChatComposerProps {
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  messages: ChatMessage[]
  activeAgent: AgentConfig | null
  authenticated: boolean
  isOnline: boolean
  isGenerating: boolean
  rateLimitRemainingSec: number
  conversationId: string | null
  effectiveModel: string
  modelSourceLabel?: string
  agentNeedsTools?: boolean
  pendingAttachments: Attachment[]
  pendingImages: PastedImage[]
  showContextInspector: boolean
  contextRefs: ContextRef[]
  showSlashMenu: boolean
  slashFilter: string
  selectedSlashIndex: number
  slashCommands: SlashCommandDef[]
  showAtMenu: boolean
  atFilter: string
  selectedAtIndex: number
  atOptions: AtContextOption[]
  modelPickerRef: RefObject<HTMLButtonElement | null>
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>
  onAttachFiles: () => void | Promise<void>
  onCaptureScreen?: () => void | Promise<void>
  onPasteClipboardImage?: () => void | Promise<void>
  onToggleContextInspector: () => void
  onCloseContextInspector: () => void
  onRemoveAttachment: (id: string) => void
  onRemoveImage: (id: string) => void
  onToggleImageMode?: (id: string) => void
  onRemoveContextToken: (token: string) => void
  onSelectSlashCommand: (command: SlashCommandDef) => void
  onSelectAtOption: (option: AtContextOption) => void
  onCloseSlashMenu: () => void
  onCloseAtMenu: () => void
  onSetConversationModel: (model: string) => void | Promise<void>
  onSetPendingModel: (model: string | null) => void
  onSetCliModel?: (model: string) => void | Promise<void>
  isEditingMessage: boolean
  onCancelEdit: () => void
  onStop: () => void | Promise<void>
  onSend: () => void | Promise<void>
}

export function ChatComposer({
  input,
  inputRef,
  messages,
  activeAgent,
  authenticated,
  isOnline,
  isGenerating,
  rateLimitRemainingSec,
  conversationId,
  effectiveModel,
  modelSourceLabel,
  agentNeedsTools,
  pendingAttachments,
  pendingImages,
  showContextInspector,
  contextRefs,
  showSlashMenu,
  slashFilter,
  selectedSlashIndex,
  slashCommands,
  showAtMenu,
  atFilter,
  selectedAtIndex,
  atOptions,
  modelPickerRef,
  onResizePointerDown,
  onInputChange,
  onKeyDown,
  onPaste,
  onAttachFiles,
  onCaptureScreen,
  onPasteClipboardImage,
  onToggleContextInspector,
  onCloseContextInspector,
  onRemoveAttachment,
  onRemoveImage,
  onToggleImageMode,
  onRemoveContextToken,
  onSelectSlashCommand,
  onSelectAtOption,
  onCloseSlashMenu,
  onCloseAtMenu,
  onSetConversationModel,
  onSetPendingModel,
  onSetCliModel,
  isEditingMessage,
  onCancelEdit,
  onStop,
  onSend,
}: ChatComposerProps) {
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const catalogModels = useAppStore((state) => state.catalogModels)
  const globalDefaultModel = useAppStore((state) => state.globalDefaultModel)
  const authState = useAppStore((state) => state.authState)
  const modelIds = getAvailableModelIds(catalogModels, effectiveModel, agentNeedsTools)
  const agentBackend = activeAgent?.backend
  const isClaudeCli =
    agentBackend === 'claude-cli' ||
    (!agentBackend && authState.mode === 'none' && authState.clis?.claude)
  const isCodexCli =
    agentBackend === 'codex-cli' ||
    (!agentBackend && authState.mode === 'none' && !authState.clis?.claude && authState.clis?.codex)
  const isCliBackend = isClaudeCli || isCodexCli || agentBackend === 'gh-copilot'

  const [cliModels, setCliModels] = useState<{ id: string; label: string }[]>(
    isCodexCli ? FALLBACK_CODEX_MODELS : FALLBACK_CLAUDE_MODELS
  )
  useEffect(() => {
    if (!isClaudeCli && !isCodexCli) return
    const backend = isCodexCli ? 'codex-cli' : 'claude-cli'
    const fallbackModels = isCodexCli ? FALLBACK_CODEX_MODELS : FALLBACK_CLAUDE_MODELS
    let cancelled = false
    window.api.getCliModels(backend)
      .then((models) => {
        if (!cancelled) {
          setCliModels(models.length > 0 ? models : fallbackModels)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCliModels(fallbackModels)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isClaudeCli, isCodexCli])

  // For the auto-fallback case (no agent, CLI detected), the model is stored on
  // the conversation row via onSetConversationModel and flows back as effectiveModel.
  const savedCodexModel = activeAgent?.cliModel
  const savedCodexModelIsAvailable = Boolean(savedCodexModel && cliModels.some((model) => model.id === savedCodexModel))
  const currentCliModel = isCodexCli
    ? (
        savedCodexModelIsAvailable && savedCodexModel
          ? savedCodexModel
          : (effectiveModel !== 'default' && cliModels.some((model) => model.id === effectiveModel) ? effectiveModel : cliModels[0]?.id ?? 'gpt-5.5')
      )
    : (activeAgent?.cliModel ?? (effectiveModel !== 'default' && effectiveModel.startsWith('claude') ? effectiveModel : 'claude-sonnet-4-6'))

  const [showModelMenu, setShowModelMenu] = useState(false)
  const [modelMenuAbove, setModelMenuAbove] = useState(false)
  const [selectedCliModel, setSelectedCliModel] = useState(currentCliModel)
  useEffect(() => {
    setSelectedCliModel(currentCliModel)
  }, [currentCliModel])
  useEffect(() => {
    if (!showModelMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showModelMenu])

  return (
    <div className="border-t border-gray-200 dark:border-gray-700/80 relative">
      <div
        className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-blue-400/50 active:bg-blue-500/60 transition-colors z-10"
        onPointerDown={onResizePointerDown}
        aria-label="Resize input panel"
      />
      <div className="px-4 pb-4 pt-3">
        <div className="max-w-3xl mx-auto">
          <AttachmentBar
            attachments={pendingAttachments}
            images={pendingImages}
            onRemoveAttachment={onRemoveAttachment}
            onRemoveImage={onRemoveImage}
            onToggleImageMode={onToggleImageMode}
          />

          {showContextInspector && (
            <ContextInspector
              systemPrompt={activeAgent?.systemPrompt ?? ''}
              contextRefs={contextRefs}
              attachments={pendingAttachments}
              images={pendingImages}
              historyMessages={messages.filter((message) => message.role !== 'system')}
              currentInput={input}
              model={effectiveModel}
              onClose={onCloseContextInspector}
            />
          )}

          {contextRefs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {contextRefs.map((ref, index) => (
                <span
                  key={`${ref.token}-${index}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
                >
                  {ref.token}
                  <button
                    type="button"
                    onClick={() => onRemoveContextToken(ref.token)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-0.5"
                    aria-label={`Remove ${ref.token}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <SlashCommandMenu
            show={showSlashMenu}
            filter={slashFilter}
            selectedIndex={selectedSlashIndex}
            commands={slashCommands}
            onSelect={onSelectSlashCommand}
            onClose={onCloseSlashMenu}
          />

          <AtContextMenu
            show={showAtMenu}
            filter={atFilter}
            selectedIndex={selectedAtIndex}
            options={atOptions}
            onSelect={onSelectAtOption}
            onClose={onCloseAtMenu}
          />

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-gray-400 dark:focus-within:ring-gray-500 focus-within:border-transparent transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onDragOver={(event) => event.preventDefault()}
              placeholder={
                !authenticated
                  ? 'Sign in to start chatting'
                  : isOnline
                    ? 'Type a message... (paste images with Ctrl+V)'
                    : 'Offline — reconnect to send messages'
              }
              rows={1}
              disabled={!isOnline || !authenticated || rateLimitRemainingSec > 0}
              aria-label="Message input"
              className="chat-input w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={onAttachFiles}
                  disabled={isGenerating}
                  className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Attach files"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                {onCaptureScreen && (
                  <button
                    type="button"
                    onClick={onCaptureScreen}
                    disabled={isGenerating}
                    className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Capture screen"
                    aria-label="Capture screen"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                )}
                {onPasteClipboardImage && (
                  <button
                    type="button"
                    onClick={onPasteClipboardImage}
                    disabled={isGenerating}
                    className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Paste image from clipboard"
                    aria-label="Paste image from clipboard"
                  >
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleContextInspector}
                  className={`p-1.5 rounded-md transition-colors ${
                    showContextInspector
                      ? 'text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700'
                      : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title="Toggle context inspector"
                  aria-label="Toggle context inspector"
                  aria-pressed={showContextInspector}
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
              {isEditingMessage && (
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="px-2 py-1 text-xs rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel edit
                </button>
              )}
              <div className="relative flex items-center" ref={modelMenuRef}>
                 {isCliBackend ? (
                  isClaudeCli || isCodexCli ? (
                    <>
                      <button
                        ref={modelPickerRef}
                        type="button"
                        aria-label={isCodexCli ? 'Codex model' : 'Claude model'}
                        className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded-md transition-colors"
                        onClick={() => {
                          if (!showModelMenu && modelPickerRef.current) {
                            const rect = modelPickerRef.current.getBoundingClientRect()
                            setModelMenuAbove(rect.bottom + 160 > window.innerHeight)
                          }
                          setShowModelMenu((prev) => !prev)
                        }}
                      >
                        <span>
                          {cliModels.find((m) => m.id === selectedCliModel)?.label ?? selectedCliModel}
                        </span>
                        <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
                      </button>
                      {showModelMenu && (
                        <div className={`absolute right-0 z-30 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1 ${modelMenuAbove ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                          {cliModels.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                                m.id === selectedCliModel
                                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                              onClick={() => {
                                setShowModelMenu(false)
                                setSelectedCliModel(m.id)
                                void onSetCliModel?.(m.id)
                              }}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span
                      className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 cursor-default"
                      title="Model is determined by the CLI tool"
                    >
                      gh copilot
                    </span>
                  )
                ) : (
                  <>
                    <button
                      ref={modelPickerRef}
                      type="button"
                      aria-label="Conversation model"
                      title={modelSourceLabel ? `${getModelLabel(effectiveModel, catalogModels)} · via ${modelSourceLabel}` : undefined}
                      className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-1 rounded-md transition-colors max-w-[220px]"
                      onClick={() => {
                        if (!showModelMenu && modelPickerRef.current) {
                          const rect = modelPickerRef.current.getBoundingClientRect()
                          const dropdownHeight = 300
                          setModelMenuAbove(rect.bottom + dropdownHeight > window.innerHeight)
                        }
                        setShowModelMenu((prev) => !prev)
                      }}
                    >
                      <span className="truncate">{getModelLabel(effectiveModel, catalogModels)}</span>
                      {modelSourceLabel && (
                        <span className="shrink-0 text-gray-400 dark:text-gray-500 opacity-80">· {modelSourceLabel}</span>
                      )}
                      <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
                    </button>
                    {showModelMenu && (
                      <div className={`absolute right-0 z-30 w-56 max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1 ${modelMenuAbove ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                        {agentNeedsTools && (
                          <div className="px-2 py-1.5 mb-0.5 text-[10px] text-amber-600 dark:text-amber-400 border-b border-gray-100 dark:border-gray-700 flex items-center gap-1">
                            <span>⚙</span>
                            <span>Showing models that support tool calling</span>
                          </div>
                        )}
                        {modelIds.map((model) => (
                          <button
                            key={model}
                            type="button"
                            className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between gap-2 transition-colors ${
                              model === effectiveModel
                                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                            onClick={() => {
                              setShowModelMenu(false)
                              if (conversationId) {
                                void onSetConversationModel(model)
                              } else {
                                onSetPendingModel(model === 'default' ? null : model)
                              }
                            }}
                          >
                            <span>
                              {model === 'default'
                                ? globalDefaultModel && globalDefaultModel !== 'default'
                                  ? `Global default (${getModelLabel(globalDefaultModel, catalogModels)})`
                                  : 'Global default'
                                : getModelLabel(model, catalogModels)}
                            </span>
                            {getModelMultiplier(model, catalogModels) && (
                              <span className="text-gray-400 dark:text-gray-500 shrink-0">{getModelMultiplier(model, catalogModels)}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
                {isGenerating ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="p-1.5 rounded-md bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors flex items-center justify-center"
                    aria-label="Stop generating"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={
                      ((!input.trim() && pendingImages.length === 0 && pendingAttachments.length === 0) ||
                        !isOnline ||
                        !authenticated ||
                        rateLimitRemainingSec > 0)
                    }
                    className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                      (input.trim() || pendingImages.length > 0 || pendingAttachments.length > 0) &&
                      isOnline &&
                      authenticated &&
                      rateLimitRemainingSec === 0
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300'
                        : 'bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                    aria-label="Send message"
                  >
                    <SendHorizontal className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
