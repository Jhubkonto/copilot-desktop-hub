import { useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { BookOpen, Camera, ClipboardPaste, Eye, Loader2, Mic, Package, Paperclip, SendHorizontal, Square, X } from 'lucide-react'
import { ContextInspector } from '../ContextInspector'
import { AttachmentBar } from './AttachmentBar'
import { AtContextMenu } from './AtContextMenu'
import { SlashCommandMenu } from './SlashCommandMenu'
import { ModelPicker } from './ModelPicker'
import { CliLockedModelBadge } from './CliLockedModelBadge'
import { ChatModePicker } from './ChatModePicker'
import type { AgentConfig, AvailableModelEntry, AvailableModelGroup } from '../../../shared/types'
import type { AtContextOption, ChatMessage, ContextRef, LocalAttachment, PastedImage } from '../../hooks/chat-types'
import type { SlashCommandDef } from '../../slash-commands'
import { useAppStore } from '../../store/app-store'


interface ChatComposerProps {
  input: string
  inputRef: RefObject<HTMLTextAreaElement | null>
  messages: ChatMessage[]
  activeAgent: AgentConfig | null
  authenticated: boolean
  isOnline: boolean
  isGenerating: boolean
  /** A slash command (e.g. /code-execute) is running an await that can take a while — unlike
   * isGenerating this has no in-flight stream to cancel, so it disables sending without
   * swapping to the Stop-generation button. */
  isRunningCommand?: boolean
  rateLimitRemainingSec: number
  conversationId: string | null
  effectiveModel: string
  modelSourceLabel?: string
  pendingAttachments: LocalAttachment[]
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
  onOpenPromptLibrary?: () => void
  onAttachArtifact?: () => void
  voiceState: 'idle' | 'recording' | 'transcribing'
  onToggleVoice: () => void
  onCancelVoice: () => void
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
  availableGroups: AvailableModelGroup[]
  onSelectAvailableModel: (group: AvailableModelGroup, model: AvailableModelEntry) => void
  isEditingMessage: boolean
  onCancelEdit: () => void
  onStop: () => void | Promise<void>
  onSend: () => void | Promise<void>
  cliLockedModels?: AvailableModelEntry[]
  onSelectCliModel?: (modelId: string) => void
  lockModelToAgentBackend?: boolean
  conversationThinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  conversationFullAutoApproveOverride?: boolean | null
  conversationTerminalSandboxOverride?: boolean | null
  onSetConversationMode?: (mode: {
    thinkingEffortOverride?: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
    fullAutoApproveOverride?: boolean | null
    terminalSandboxOverride?: boolean | null
  }) => void
}

export function ChatComposer({
  input,
  inputRef,
  messages,
  activeAgent,
  authenticated,
  isOnline,
  isGenerating,
  isRunningCommand = false,
  rateLimitRemainingSec,
  conversationId,
  effectiveModel,
  modelSourceLabel,
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
  onOpenPromptLibrary,
  onAttachArtifact,
  voiceState,
  onToggleVoice,
  onCancelVoice,
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
  availableGroups,
  onSelectAvailableModel,
  isEditingMessage,
  onCancelEdit,
  onStop,
  onSend,
  cliLockedModels,
  onSelectCliModel,
  lockModelToAgentBackend = false,
  conversationThinkingEffortOverride = null,
  conversationFullAutoApproveOverride = null,
  conversationTerminalSandboxOverride = null,
  onSetConversationMode,
}: ChatComposerProps) {
  const [showModePicker, setShowModePicker] = useState(false)
  const catalogModels = useAppStore((state) => state.catalogModels)
  const globalDefaultModel = useAppStore((state) => state.globalDefaultModel)
  const agentBackend = activeAgent?.backend
  const isCliLocked = lockModelToAgentBackend && (agentBackend === 'claude-cli' || agentBackend === 'codex-cli' || agentBackend === 'hermes-cli')

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
              conversationId={conversationId}
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
              aria-expanded={showSlashMenu || showAtMenu || undefined}
              aria-controls={showSlashMenu ? 'slash-command-menu' : showAtMenu ? 'at-context-menu' : undefined}
              aria-activedescendant={
                showSlashMenu ? `slash-opt-${selectedSlashIndex}` :
                showAtMenu ? `at-opt-${selectedAtIndex}` :
                undefined
              }
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
                {onOpenPromptLibrary && (
                  <button
                    type="button"
                    onClick={onOpenPromptLibrary}
                    disabled={isGenerating}
                    className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Insert prompt"
                    aria-label="Insert prompt"
                  >
                    <BookOpen className="w-4 h-4" />
                  </button>
                )}
                {onAttachArtifact && (
                  <button
                    type="button"
                    onClick={onAttachArtifact}
                    disabled={isGenerating}
                    className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Attach artifact"
                    aria-label="Attach artifact"
                  >
                    <Package className="w-4 h-4" />
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
                  title="Open context inspector"
                  aria-label="Open context inspector"
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
              <div className="relative flex items-center">
                {isCliLocked ? (
                  <CliLockedModelBadge
                    backend={agentBackend as 'claude-cli' | 'codex-cli' | 'hermes-cli'}
                    modelId={effectiveModel === 'default' ? null : effectiveModel}
                    models={cliLockedModels ?? []}
                    catalogModels={catalogModels}
                    onSelectModel={onSelectCliModel ?? (() => {})}
                  />
                ) : (
                  <ModelPicker
                    value={effectiveModel}
                    sourceLabel={modelSourceLabel}
                    availableGroups={availableGroups}
                    catalogModels={catalogModels}
                    globalDefaultModel={globalDefaultModel}
                    buttonRef={modelPickerRef}
                    onSelectDefault={() => {
                      if (conversationId) {
                        void onSetConversationModel('default')
                      } else {
                        onSetPendingModel(null)
                      }
                    }}
                    onSelectAvailableModel={onSelectAvailableModel}
                  />
                )}
                {onSetConversationMode && (
                  <ChatModePicker
                    open={showModePicker}
                    onOpenChange={setShowModePicker}
                    thinkingEffortOverride={conversationThinkingEffortOverride}
                    fullAutoApproveOverride={conversationFullAutoApproveOverride}
                    terminalSandboxOverride={conversationTerminalSandboxOverride}
                    onChange={onSetConversationMode}
                  />
                )}
              </div>
                {voiceState === 'recording' && (
                  <button
                    type="button"
                    onClick={onCancelVoice}
                    className="p-1.5 rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    title="Cancel recording"
                    aria-label="Cancel voice recording"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleVoice}
                  disabled={isGenerating || voiceState === 'transcribing'}
                  className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${voiceState === 'recording' ? 'text-red-600 bg-red-50 dark:bg-red-900/30' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                  title={voiceState === 'recording' ? 'Stop recording' : voiceState === 'transcribing' ? 'Transcribing locally…' : 'Voice input'}
                  aria-label={voiceState === 'recording' ? 'Stop voice recording' : 'Start voice input'}
                  aria-pressed={voiceState === 'recording'}
                >
                  {voiceState === 'transcribing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                </button>
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
                      isRunningCommand ||
                      ((!input.trim() && pendingImages.length === 0 && pendingAttachments.length === 0) ||
                        !isOnline ||
                        !authenticated ||
                        rateLimitRemainingSec > 0)
                    }
                    className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                      !isRunningCommand &&
                      (input.trim() || pendingImages.length > 0 || pendingAttachments.length > 0) &&
                      isOnline &&
                      authenticated &&
                      rateLimitRemainingSec === 0
                        ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300'
                        : 'bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                    aria-label={isRunningCommand ? 'Running command…' : 'Send message'}
                    title={isRunningCommand ? 'A command is still running…' : undefined}
                  >
                    {isRunningCommand ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
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
