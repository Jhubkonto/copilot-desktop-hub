import { useEffect, useState } from 'react'
import { NexyIcon } from '../ui/icons/NexyIcon'
import { getModelLabel } from '../../../shared/models'
import { Button, ToggleSwitch } from '../ui/primitives'
import type { AvailableModelGroup } from '@shared/types'
import type { UiStyle } from '../../store/types'
import type { SupertonicStatus } from '@shared/neural-tts'
import { SUPERTONIC_LANGUAGES } from '@shared/neural-tts'
import {
  readSpokenOutputSettings,
  writeSpokenOutputSettings,
  type SpokenOutputSettings,
} from '../../lib/spoken-output'
import { TabHeader } from './TabHeader'
import {
  formatPushToTalkShortcut,
  readPushToTalkShortcut,
  shortcutFromKeyboardEvent,
  suggestedPushToTalkShortcut,
  validatePushToTalkShortcut,
  writePushToTalkShortcut,
  type PushToTalkShortcut,
} from '../../lib/push-to-talk-shortcut'

interface Props {
  theme: string
  toggleTheme: () => void
  uiStyle: UiStyle
  onSetUiStyle: (style: UiStyle) => void
  effectiveModel: string
  effectiveProvider: string
  autoStart: boolean
  runInBackground: boolean
  autoClipboard: boolean
  defaultModel: string
  defaultModelSearch: string
  showDefaultModelMenu: boolean
  defaultModelMenuRect: DOMRect | null
  availableModelGroups: AvailableModelGroup[]
  modelIds: string[]
  temperature: number
  maxTokens: number
  whisperCppPath: string
  whisperModelPath: string
  whisperInstalling: boolean
  whisperReady: boolean
  supertonicStatus: SupertonicStatus | null
  supertonicInstalling: boolean
  catalogModels: import('@shared/types').CatalogModel[] | undefined
  onToggleAutoStart: () => void
  onToggleRunInBackground: () => void
  onToggleAutoClipboard: () => void
  onSetDefaultModel: (id: string) => void
  onSetDefaultModelSearch: (q: string) => void
  onSetShowDefaultModelMenu: (show: boolean) => void
  onSetDefaultModelMenuRect: (rect: DOMRect | null) => void
  onSetTemperature: (t: number) => void
  onSetMaxTokens: (n: number) => void
  onSetWhisperCppPath: (path: string) => void
  onSetWhisperModelPath: (path: string) => void
  onSaveWhisper: () => void
  onInstallWhisper: () => void
  onInstallSupertonic: () => void
  onRemoveSupertonic: () => void
  onPreviewSupertonic: () => void
  onSaveAdvanced: () => void
  onOpenMcp: () => void
  defaultModelMenuRef: React.RefObject<HTMLDivElement | null>
  defaultModelButtonRef: React.RefObject<HTMLButtonElement | null>
}

export function GeneralTab({
  theme, toggleTheme, uiStyle, onSetUiStyle,
  effectiveModel, effectiveProvider,
  autoStart, runInBackground, autoClipboard,
  defaultModel, defaultModelSearch, showDefaultModelMenu, defaultModelMenuRect,
  availableModelGroups, modelIds,
  temperature, maxTokens,
  whisperCppPath, whisperModelPath, whisperInstalling, whisperReady,
  supertonicStatus, supertonicInstalling,
  catalogModels,
  onToggleAutoStart, onToggleRunInBackground, onToggleAutoClipboard,
  onSetDefaultModel, onSetDefaultModelSearch, onSetShowDefaultModelMenu, onSetDefaultModelMenuRect,
  onSetTemperature, onSetMaxTokens, onSaveAdvanced,
  onSetWhisperCppPath, onSetWhisperModelPath, onSaveWhisper, onInstallWhisper,
  onInstallSupertonic, onRemoveSupertonic, onPreviewSupertonic,
  onOpenMcp,
  defaultModelMenuRef, defaultModelButtonRef,
}: Props) {
  const [showManualVoiceSetup, setShowManualVoiceSetup] = useState(false)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState<PushToTalkShortcut | null>(
    () => readPushToTalkShortcut(localStorage),
  )
  const [capturingShortcut, setCapturingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)
  const [speechSettings, setSpeechSettings] = useState<SpokenOutputSettings>(
    () => readSpokenOutputSettings(localStorage),
  )

  const updateSpeechSettings = (next: SpokenOutputSettings) => {
    setSpeechSettings(next)
    writeSpokenOutputSettings(localStorage, next)
    window.dispatchEvent(new Event('nexy:spoken-output-settings-changed'))
  }

  useEffect(() => {
    if (supertonicStatus && !supertonicStatus.ready && speechSettings.engine === 'supertonic') {
      updateSpeechSettings({ ...speechSettings, engine: 'system' })
    }
  }, [speechSettings, supertonicStatus])

  const savePushToTalkShortcut = (shortcut: PushToTalkShortcut | null) => {
    writePushToTalkShortcut(localStorage, shortcut)
    setPushToTalkShortcut(shortcut)
    setShortcutError(null)
    setCapturingShortcut(false)
  }

  const capturePushToTalkShortcut = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setCapturingShortcut(false)
      setShortcutError(null)
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!shortcut) return
    const error = validatePushToTalkShortcut(shortcut)
    if (error) {
      setShortcutError(error)
      return
    }
    savePushToTalkShortcut(shortcut)
  }
  useEffect(() => { void window.api.getVersion().then(setDesktopVersion).catch(() => setDesktopVersion(null)) }, [])
  return (
    <>
      <TabHeader title="General" description="Appearance, default model, and app behaviour." />

      <div className="flex items-center justify-between">
        <div><p className="text-sm font-medium text-gray-800 dark:text-gray-100">Nexy desktop version</p><p className="text-xs text-gray-500">Version currently running on this computer</p></div>
        <span className="font-mono text-xs text-gray-700 dark:text-gray-200">v{desktopVersion ?? 'Unknown'}</span>
      </div>

      {/* Theme */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Theme</p>
          <p className="text-xs text-gray-500">Switch between light and dark mode</p>
        </div>
        <Button
          variant="secondary"
          onClick={toggleTheme}
          className="border-2 rounded-none border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <span className="flex items-center gap-1.5">
            <NexyIcon name={theme === 'dark' ? 'spark' : 'milestone'} size={14} />
            {theme === 'dark' ? 'Light' : 'Dark'}
          </span>
        </Button>
      </div>

      {/* Visual style is independent from light/dark appearance. */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">UI style</p>
          <p className="text-xs text-gray-500">Choose the visual language without changing brightness</p>
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="UI style">
          {(['classic', '8bit'] as const).map((style) => (
            <Button
              key={style}
              variant={uiStyle === style ? 'primary' : 'secondary'}
              onClick={() => onSetUiStyle(style)}
              aria-pressed={uiStyle === style}
            >
              {style === 'classic' ? 'Classic' : '8-bit'}
            </Button>
          ))}
        </div>
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
        <ToggleSwitch checked={autoStart} onChange={() => onToggleAutoStart()} ariaLabel="Start on login" />
      </div>

      {/* Tray-resident execution */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Run in background</p>
          <p className="text-xs text-gray-500">Closing the window keeps Nexy in the tray so scheduled tasks can run</p>
        </div>
        <ToggleSwitch checked={runInBackground} onChange={() => onToggleRunInBackground()} ariaLabel="Run in background" />
      </div>
      {runInBackground && !autoStart && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 -mt-2">
          Enable Start on login too if schedules should be armed automatically after you sign in.
        </p>
      )}

      {/* Auto clipboard on focus */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Auto-read clipboard on focus</p>
          <p className="text-xs text-gray-500">Automatically paste clipboard text when app gains focus</p>
        </div>
        <ToggleSwitch checked={autoClipboard} onChange={() => onToggleAutoClipboard()} ariaLabel="Auto-read clipboard on focus" />
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
        <Button
          variant="secondary"
          onClick={onOpenMcp}
          className="border-2 rounded-none border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          <span className="flex items-center gap-1.5">
            <NexyIcon name="tool" size={14} />
            Configure
          </span>
        </Button>
      </div>

      {/* Advanced generation settings */}
      <div className="p-3 rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Local voice input</p>
          <p className="text-xs text-gray-500">Nexy downloads and configures whisper.cpp on Windows and Linux, or installs it through Homebrew on macOS. Audio is never uploaded.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={onInstallWhisper} disabled={whisperInstalling} className="rounded-lg">
            {whisperInstalling ? 'Downloading and installing…' : whisperReady ? 'Reinstall local Whisper' : 'Install local Whisper (~150 MB)'}
          </Button>
          <span className={`text-xs ${whisperReady ? 'text-nexy-success' : 'text-gray-500'}`}>
            {whisperReady ? 'Ready' : 'Not installed'}
          </span>
        </div>
        <p className="text-[11px] text-gray-500">This is a one-time setup of the speech engine and English model. macOS requires Homebrew; manual paths remain available on every platform.</p>
        <button type="button" onClick={() => setShowManualVoiceSetup((shown) => !shown)} className="text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 underline">
          {showManualVoiceSetup ? 'Hide manual setup' : 'Manual setup (advanced)'}
        </button>
        {showManualVoiceSetup && (
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">whisper-cli executable</label>
              <input value={whisperCppPath} onChange={(event) => onSetWhisperCppPath(event.target.value)} placeholder="Path to whisper-cli.exe" className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Whisper model</label>
              <input value={whisperModelPath} onChange={(event) => onSetWhisperModelPath(event.target.value)} placeholder="Path to a ggml model file" className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            </div>
            <Button
              variant="primary"
              onClick={onSaveWhisper}
              disabled={whisperInstalling}
              className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-gray-100"
            >
              Save manual paths
            </Button>
          </div>
        )}
        <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Push-to-talk shortcut</p>
          <p className="mb-2 text-xs text-gray-500">
            Hold the shortcut while Nexy is focused. Release any key to stop and transcribe.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-push-to-talk-capture={capturingShortcut ? 'true' : undefined}
              onClick={() => {
                setCapturingShortcut(true)
                setShortcutError(null)
              }}
              onKeyDown={capturingShortcut ? capturePushToTalkShortcut : undefined}
              className={`min-w-36 rounded-lg border px-3 py-2 text-xs font-medium ${
                capturingShortcut
                  ? 'border-nexy-accent bg-nexy-accent/10 text-nexy-accent'
                  : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'
              }`}
              aria-label="Change push-to-talk shortcut"
            >
              {capturingShortcut ? 'Press shortcut…' : formatPushToTalkShortcut(pushToTalkShortcut)}
            </button>
            <Button variant="secondary" onClick={() => savePushToTalkShortcut(suggestedPushToTalkShortcut())} className="rounded-lg">
              Use suggestion
            </Button>
            {pushToTalkShortcut && (
              <Button variant="secondary" onClick={() => savePushToTalkShortcut(null)} className="rounded-lg">
                Clear
              </Button>
            )}
          </div>
          {shortcutError && <p className="mt-2 text-xs text-nexy-error" role="alert">{shortcutError}</p>}
        </div>
      </div>

      <div className="p-3 rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Local neural voice output</p>
          <p className="text-xs text-gray-500">Supertonic 3 reads responses with ten natural voices in 31 languages. Synthesis stays on this computer after the one-time model download.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!supertonicStatus?.ready ? (
            <Button
              variant="primary"
              onClick={onInstallSupertonic}
              disabled={supertonicInstalling || supertonicStatus?.supported === false}
              className="rounded-lg"
            >
              {supertonicInstalling ? 'Downloading and verifying…' : 'Install Supertonic (~129 MB)'}
            </Button>
          ) : <>
            <Button variant="secondary" onClick={onPreviewSupertonic} className="rounded-lg">Preview voice</Button>
            <Button variant="secondary" onClick={onRemoveSupertonic} className="rounded-lg">Remove model</Button>
          </>}
          <span className={`text-xs ${supertonicStatus?.ready ? 'text-nexy-success' : 'text-gray-500'}`}>
            {supertonicStatus?.ready ? 'Ready' : supertonicStatus?.supported === false ? 'Unsupported on this platform' : 'Not installed'}
          </span>
        </div>
        <p className="text-[11px] text-gray-500">Model: Supertonic 3 int8 · OpenRAIL-M license. System voices remain available as the zero-download fallback.</p>
        <div className="grid gap-3 border-t border-gray-200 pt-3 dark:border-gray-700 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Speech engine</span>
            <select
              value={speechSettings.engine}
              onChange={(event) => updateSpeechSettings({ ...speechSettings, engine: event.target.value === 'supertonic' ? 'supertonic' : 'system' })}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="system">System voices</option>
              <option value="supertonic" disabled={!supertonicStatus?.ready}>Supertonic neural voices</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Speed: {speechSettings.rate.toFixed(1)}×</span>
            <input type="range" min="0.5" max="2" step="0.1" value={speechSettings.rate} onChange={(event) => updateSpeechSettings({ ...speechSettings, rate: Number(event.target.value) })} />
          </label>
          {speechSettings.engine === 'supertonic' && <>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Neural voice</span>
              <select
                value={speechSettings.supertonicSpeakerId}
                onChange={(event) => updateSpeechSettings({ ...speechSettings, supertonicSpeakerId: Number(event.target.value) })}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              >
                {Array.from({ length: 10 }, (_, id) => <option key={id} value={id}>Voice {id + 1}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Language</span>
              <select
                value={speechSettings.supertonicLanguage}
                onChange={(event) => updateSpeechSettings({ ...speechSettings, supertonicLanguage: event.target.value as SpokenOutputSettings['supertonicLanguage'] })}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              >
                {SUPERTONIC_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </>}
        </div>
      </div>

      <div className="p-3 rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
            <NexyIcon name="settings" size={14} className="text-gray-400" />
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

        <Button
          variant="primary"
          onClick={onSaveAdvanced}
          className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
        >
          Save advanced settings
        </Button>
      </div>
    </>
  )
}
