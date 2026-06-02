import { useState } from 'react'
import { BotMessageSquare, X, ChevronDown } from 'lucide-react'
import type { ChatMessage, CliCostSummary } from '../../hooks/chat-types'
import { TerminalMessageList } from './TerminalMessageList'
import { TerminalInput } from './TerminalInput'

const CLAUDE_MODELS = [
  { id: 'default', label: 'Default' },
  { id: 'claude-opus-4-5', label: 'Opus 4.5' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

interface SmartTerminalPanelProps {
  messages: ChatMessage[]
  streamingContent: string
  isGenerating: boolean
  cliCost: CliCostSummary | null
  onSend: (text: string, model?: string) => void
  onStop: () => void
  onClose: () => void
}

export function SmartTerminalPanel({
  messages,
  streamingContent,
  isGenerating,
  cliCost,
  onSend,
  onStop,
  onClose,
}: SmartTerminalPanelProps) {
  const [selectedModel, setSelectedModel] = useState('default')
  const [showModelPicker, setShowModelPicker] = useState(false)

  const currentModelLabel = CLAUDE_MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 h-10 shrink-0 border-b border-gray-800 bg-gray-900">
        <BotMessageSquare className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-gray-300 select-none font-mono">Smart Terminal</span>

        {/* Model selector */}
        <div className="relative ml-2">
          <button
            type="button"
            onClick={() => setShowModelPicker((v) => !v)}
            disabled={isGenerating}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors disabled:opacity-50 font-mono"
          >
            {currentModelLabel}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showModelPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded border border-gray-700 bg-gray-900 shadow-lg py-1">
              {CLAUDE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setSelectedModel(m.id); setShowModelPicker(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors ${
                    m.id === selectedModel
                      ? 'text-purple-300 bg-purple-900/30'
                      : 'text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  {m.label}
                  {m.id !== 'default' && <span className="ml-1 text-gray-600">{m.id}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <X className="w-3 h-3" />
            Back to chat
          </button>
        </div>
      </div>

      {/* Message list + cost footer */}
      <TerminalMessageList
        messages={messages}
        streamingContent={streamingContent}
        isGenerating={isGenerating}
        cliCost={cliCost}
      />

      {/* Input */}
      <TerminalInput
        isGenerating={isGenerating}
        onSend={(text) => onSend(text, selectedModel === 'default' ? undefined : selectedModel)}
        onStop={onStop}
      />
    </div>
  )
}
