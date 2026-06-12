import { useRef } from 'react'
import { Sun, Moon, Plug, Cpu } from 'lucide-react'
import { getModelLabel } from '../../../shared/models'
import type { AvailableModelGroup } from '@shared/types'

interface Props {
  theme: string
  toggleTheme: () => void
  effectiveModel: string
  effectiveProvider: string
  autoStart: boolean
  autoClipboard: boolean
  defaultModel: string
  defaultModelSearch: string
  showDefaultModelMenu: boolean
  defaultModelMenuRect: DOMRect | null
  availableModelGroups: AvailableModelGroup[]
  modelIds: string[]
  temperature: number
  maxTokens: number
  catalogModels: import('@shared/types').CatalogModel[] | undefined
  onToggleAutoStart: () => void
  onToggleAutoClipboard: () => void
  onSetDefaultModel: (id: string) => void
  onSetDefaultModelSearch: (q: string) => void
  onSetShowDefaultModelMenu: (show: boolean) => void
  onSetDefaultModelMenuRect: (rect: DOMRect | null) => void
  onSetTemperature: (t: number) => void
  onSetMaxTokens: (n: number) => void
  onSaveAdvanced: () => void
  onOpenMcp: () => void
  defaultModelMenuRef: React.RefObject<HTMLDivElement | null>
  defaultModelButtonRef: React.RefObject<HTMLButtonElement | null>
}

export function GeneralTab({
  theme, toggleTheme,
  effectiveModel, effectiveProvider,
  autoStart, autoClipboard,
  defaultModel, defaultModelSearch, showDefaultModelMenu, defaultModelMenuRect,
  availableModelGroups, modelIds,
  temperature, maxTokens,
  catalogModels,
  onToggleAutoStart, onToggleAutoClipboard,
  onSetDefaultModel, onSetDefaultModelSearch, onSetShowDefaultModelMenu, onSetDefaultModelMenuRect,
  onSetTemperature, onSetMaxTokens, onSaveAdvanced,
  onOpenMcp,
  defaultModelMenuRef, defaultModelButtonRef,
}: Props) {
  return (
    <>
      {/* Theme */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Theme</p>
          <p className="text-xs text-gray-500">Switch between light and dark mode</p>
        </div>
        <button
          onClick={toggleTheme}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          <span className="flex items-center gap-1.5">
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </span>
        </button>
      </div>

      {/* Active model */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Active model</p>
          <p className="text-xs text-gray-500">Current chat model and provider</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{getModelLabel(effectiveModel, catalogModels)}</p>
          <p className="text-[11px] text-gray-500">{effectiveProvider}</p>
        </div>
      </div>

      {/* Auto-start */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Start on login</p>
          <p className="text-xs text-gray-500">Automatically launch when you log in</p>
        </div>
        <button
          onClick={onToggleAutoStart}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoStart ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoStart ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Auto clipboard on focus */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Auto-read clipboard on focus</p>
          <p className="text-xs text-gray-500">Automatically paste clipboard text when app gains focus</p>
        </div>
        <button
          onClick={onToggleAutoClipboard}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoClipboard ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoClipboard ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Global Hotkey */}
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Global Hotkey</p>
        <p className="text-xs text-gray-500 mt-1">
          <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs font-mono">
            {window.api.platform === 'darwin' ? 'Cmd+Shift+H' : 'Ctrl+Shift+H'}
          </kbd>{' '}
          to show/hide the app
        </p>
      </div>

      {/* MCP Servers */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">MCP Servers</p>
          <p className="text-xs text-gray-500">Manage Model Context Protocol servers</p>
        </div>
        <button
          onClick={onOpenMcp}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          <span className="flex items-center gap-1.5">
            <Plug className="w-3.5 h-3.5" />
            Configure
          </span>
        </button>
      </div>

      {/* Advanced generation settings */}
      <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-gray-400" />
            Advanced
          </p>
          <p className="text-xs text-gray-500">Default model and generation parameters</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Default model</label>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Fallback used when no agent or project default is set</p>
          <div className="relative" ref={defaultModelMenuRef}>
            <button
              ref={defaultModelButtonRef}
              type="button"
              onClick={() => {
                if (defaultModelButtonRef.current) {
                  onSetDefaultModelMenuRect(defaultModelButtonRef.current.getBoundingClientRect())
                }
                onSetShowDefaultModelMenu(!showDefaultModelMenu)
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {(() => {
                  for (const g of availableModelGroups) {
                    const m = g.models.find((m) => m.id === defaultModel)
                    if (m) return getModelLabel(m.id, catalogModels) !== m.id ? getModelLabel(m.id, catalogModels) : m.label
                  }
                  return getModelLabel(defaultModel, catalogModels)
                })()}
              </span>
              <svg className="w-4 h-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showDefaultModelMenu && defaultModelMenuRect && (
              <div
                className="fixed z-50 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg flex flex-col"
                style={{ top: defaultModelMenuRect.bottom + 4, left: defaultModelMenuRect.left, width: defaultModelMenuRect.width }}
              >
                <div className="p-1.5 border-b border-gray-100 dark:border-gray-700">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search models..."
                    value={defaultModelSearch}
                    onChange={(e) => onSetDefaultModelSearch(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div className="overflow-auto max-h-56 p-1">
                  {(availableModelGroups.length > 0
                    ? availableModelGroups
                    : [{ sourceKey: 'catalog', sourceLabel: 'Models', sourceType: 'provider' as const, models: modelIds.map((id) => ({ id, label: getModelLabel(id, catalogModels) })) }]
                  ).map((group) => {
                    const q = defaultModelSearch.toLowerCase()
                    const filtered = q
                      ? group.models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
                      : group.models
                    if (filtered.length === 0) return null
                    return (
                      <div key={group.sourceKey}>
                        <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 mt-0.5 first:border-t-0 first:mt-0">
                          {group.sourceLabel}
                        </div>
                        {filtered.map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${model.id === defaultModel ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                            onClick={() => { onSetDefaultModel(model.id); onSetShowDefaultModelMenu(false) }}
                          >
                            {getModelLabel(model.id, catalogModels) !== model.id ? getModelLabel(model.id, catalogModels) : model.label}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                  {defaultModelSearch && (availableModelGroups.length > 0 ? availableModelGroups : []).every((g) => !g.models.some((m) => m.id.toLowerCase().includes(defaultModelSearch.toLowerCase()) || m.label.toLowerCase().includes(defaultModelSearch.toLowerCase()))) && (
                    <p className="px-2 py-2 text-xs text-gray-400 dark:text-gray-500">No models match "{defaultModelSearch}"</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Temperature: {temperature.toFixed(1)}</label>
          <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => onSetTemperature(Number.parseFloat(e.target.value))} className="w-full accent-blue-500" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max tokens</label>
          <input
            type="number" min={256} max={16384} step={256} value={maxTokens}
            onChange={(e) => onSetMaxTokens(Number.parseInt(e.target.value, 10) || 4096)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={onSaveAdvanced}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
        >
          Save advanced settings
        </button>
      </div>
    </>
  )
}
