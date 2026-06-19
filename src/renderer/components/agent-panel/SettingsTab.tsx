import { X, Folder, FileText, Plus, ExternalLink } from 'lucide-react'
import type { AgentConfig } from '../../../shared/types'
import { ToggleSwitch } from '../ui/primitives'

const EMOJI_OPTIONS = ['🤖', '🔍', '🐛', '💡', '📝', '🎨', '🔧', '🚀', '🧠', '⚡', '🛡️', '📊']
const FORMAT_OPTIONS = ['default', 'concise', 'detailed', 'code-only'] as const

interface Props {
  config: AgentConfig
  onUpdateField: <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => void
  newGlob: string
  onSetNewGlob: (v: string) => void
  onAddIgnoredGlob: () => void
  onRemoveIgnoredGlob: (i: number) => void
  newCmdName: string
  newCmdDesc: string
  newCmdPrompt: string
  onSetNewCmdName: (v: string) => void
  onSetNewCmdDesc: (v: string) => void
  onSetNewCmdPrompt: (v: string) => void
  onAddCustomCommand: () => void
  onRemoveCustomCommand: (i: number) => void
  onAddDirectories: () => void
  onAddFiles: () => void
  onRemoveContextDir: (i: number) => void
  onRemoveContextFile: (i: number) => void
  onPickRootDirectory: () => void
  onOpenCliSettings: () => void
}

export function SettingsTab({
  config, onUpdateField,
  newGlob, onSetNewGlob, onAddIgnoredGlob, onRemoveIgnoredGlob,
  newCmdName, newCmdDesc, newCmdPrompt,
  onSetNewCmdName, onSetNewCmdDesc, onSetNewCmdPrompt,
  onAddCustomCommand, onRemoveCustomCommand,
  onAddDirectories, onAddFiles, onRemoveContextDir, onRemoveContextFile,
  onPickRootDirectory, onOpenCliSettings,
}: Props) {
  const contextRules = config.contextRules ?? { ignoredGlobs: [], autoInjectWorkspace: false, autoInjectGit: false }

  return (
    <>
      {/* Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Name</label>
        <input
          value={config.name}
          onChange={(e) => onUpdateField('name', e.target.value)}
          placeholder="Agent name..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Icon */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Icon</label>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            value={config.icon}
            onChange={(e) => onUpdateField('icon', e.target.value)}
            maxLength={2}
            className="w-12 text-center px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => onUpdateField('icon', emoji)}
              className={`w-8 h-8 rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${config.icon === emoji ? 'bg-gray-200 dark:bg-gray-700 ring-1 ring-gray-400' : ''}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">System Prompt</label>
        <textarea
          value={config.systemPrompt}
          onChange={(e) => onUpdateField('systemPrompt', e.target.value)}
          placeholder="Instructions for the agent..."
          rows={6}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* Agent Memory */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Agent Memory</label>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">Always appended to the system prompt in every message.</p>
        <textarea
          value={config.memory ?? ''}
          onChange={(e) => onUpdateField('memory', e.target.value)}
          placeholder="Persistent notes the agent always has access to..."
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>

      {/* Response Format */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Response Format</label>
        <select
          value={config.responseFormat}
          onChange={(e) => onUpdateField('responseFormat', e.target.value as AgentConfig['responseFormat'])}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {FORMAT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Chat Backend */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Chat Backend</label>
        <select
          value={config.backend ?? ''}
          onChange={(e) => {
            const val = e.target.value
            onUpdateField('backend', val === '' ? undefined : val as AgentConfig['backend'])
          }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Auto (BYOK key, or Claude CLI if no key)</option>
          <option value="claude-cli">Force Claude CLI (claude --print)</option>
          <option value="codex-cli">OpenAI Codex CLI (codex)</option>
          <option value="gh-copilot">GitHub Copilot CLI (gh copilot suggest)</option>
        </select>
        {config.backend && (
          <div className="flex items-start justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>CLI tool must be installed and authenticated.</span>
            <button
              type="button"
              onClick={onOpenCliSettings}
              className="shrink-0 flex items-center gap-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Setup instructions
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Temperature */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Temperature: {config.temperature.toFixed(1)}</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={config.temperature}
          onChange={(e) => onUpdateField('temperature', parseFloat(e.target.value))}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      {/* Max Tokens */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Max Tokens</label>
        <input
          type="number"
          value={config.maxTokens}
          onChange={(e) => onUpdateField('maxTokens', parseInt(e.target.value) || 4096)}
          min={256}
          max={128000}
          step={256}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Thinking */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Thinking</span>
            <p className="text-xs text-gray-400 mt-0.5">Extended reasoning for Claude CLI, Anthropic, and OpenRouter o-series</p>
          </div>
          <ToggleSwitch
            checked={!!config.thinkingEffort && config.thinkingEffort !== 'disabled'}
            onChange={(on) => onUpdateField('thinkingEffort', on ? 'medium' : 'disabled')}
            ariaLabel="Enable thinking"
          />
        </div>
        {config.thinkingEffort && config.thinkingEffort !== 'disabled' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Effort</label>
            <select
              value={config.thinkingEffort}
              onChange={(e) => onUpdateField('thinkingEffort', e.target.value as AgentConfig['thinkingEffort'])}
              className="flex-1 px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
        )}
      </div>

      {/* Agentic Mode */}
      <div className="space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.agenticMode}
            onChange={(e) => onUpdateField('agenticMode', e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
          />
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Agentic Mode</span>
        </label>
      </div>

      {/* Context Directories */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context Directories</label>
        {config.contextDirectories.length > 0 && (
          <div className="space-y-1">
            {config.contextDirectories.map((dir, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                <span className="flex-1 truncate" title={dir}>
                  <Folder className="w-3 h-3 inline mr-1" />{dir}
                </span>
                <button
                  onClick={() => onRemoveContextDir(i)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  aria-label="Remove directory"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={onAddDirectories} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Plus className="w-3 h-3" />
          Add Directory
        </button>
      </div>

      {/* Context Files */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context Files</label>
        {config.contextFiles.length > 0 && (
          <div className="space-y-1">
            {config.contextFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
                <span className="flex-1 truncate" title={file}>
                  <FileText className="w-3 h-3 inline mr-1" />{file}
                </span>
                <button
                  onClick={() => onRemoveContextFile(i)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  aria-label="Remove file"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={onAddFiles} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          <Plus className="w-3 h-3" />
          Add Files
        </button>
      </div>

      {/* Root Directory */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Root Directory</label>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs text-gray-600 dark:text-gray-400 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 min-h-[32px]">
            {config.rootDirectory ? config.rootDirectory : <span className="italic text-gray-400 dark:text-gray-500">Inherit global CWD</span>}
          </span>
          <button
            onClick={onPickRootDirectory}
            className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
            aria-label="Pick root directory"
          >
            <Folder className="w-3 h-3" />
            Browse
          </button>
          {config.rootDirectory && (
            <button
              onClick={() => onUpdateField('rootDirectory', '')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              aria-label="Clear root directory"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Context Rules */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context Rules</label>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={contextRules.autoInjectWorkspace}
              onChange={(e) => onUpdateField('contextRules', { ...contextRules, autoInjectWorkspace: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">Auto-inject <code className="font-mono">@workspace</code></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={contextRules.autoInjectGit}
              onChange={(e) => onUpdateField('contextRules', { ...contextRules, autoInjectGit: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600 accent-blue-500"
            />
            <span className="text-xs text-gray-600 dark:text-gray-400">Auto-inject <code className="font-mono">@git</code></span>
          </label>
        </div>
        {/* Ignored Globs */}
        <div className="space-y-1">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">Ignored glob patterns (workspace summary)</p>
          {contextRules.ignoredGlobs.map((g, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400">
              <code className="flex-1 font-mono truncate">{g}</code>
              <button
                onClick={() => onRemoveIgnoredGlob(i)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                aria-label={`Remove glob ${g}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              value={newGlob}
              onChange={(e) => onSetNewGlob(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddIgnoredGlob() } }}
              placeholder="**/node_modules/**"
              className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={onAddIgnoredGlob}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Add glob pattern"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Custom Commands */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Custom Slash Commands</label>
        {(config.customCommands ?? []).map((cmd, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <div className="flex items-center justify-between">
              <code className="font-mono text-blue-600 dark:text-blue-400">{cmd.name}</code>
              <button
                onClick={() => onRemoveCustomCommand(i)}
                className="text-gray-400 hover:text-red-500 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label={`Remove command ${cmd.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {cmd.description && <p className="text-gray-400 dark:text-gray-500 italic">{cmd.description}</p>}
            <p className="text-[11px] text-gray-400 truncate">{cmd.prompt}</p>
          </div>
        ))}
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-2 space-y-1.5">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">New command</p>
          <div className="flex gap-1.5">
            <input
              value={newCmdName}
              onChange={(e) => onSetNewCmdName(e.target.value)}
              placeholder="/command-name"
              className="w-32 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <input
              value={newCmdDesc}
              onChange={(e) => onSetNewCmdDesc(e.target.value)}
              placeholder="Short description"
              className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <textarea
            value={newCmdPrompt}
            onChange={(e) => onSetNewCmdPrompt(e.target.value)}
            placeholder="Prompt text loaded into the input when this command is invoked..."
            rows={2}
            className="w-full px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <button
            onClick={onAddCustomCommand}
            disabled={!newCmdName.trim()}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Command
          </button>
        </div>
      </div>
    </>
  )
}
