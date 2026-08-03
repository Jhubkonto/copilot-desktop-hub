import { Pause, Play, RotateCcw, Settings2, Square } from 'lucide-react'
import { useState } from 'react'
import type { SpokenPlaybackState } from '../../hooks/useSpokenOutput'
import type { SpokenOutputSettings } from '../../lib/spoken-output'
import { SUPERTONIC_LANGUAGES } from '../../../shared/neural-tts'

interface SpokenOutputControlsProps {
  state: SpokenPlaybackState
  kind: 'response' | 'quick-recap' | 'ai-recap'
  model?: string | null
  voices: SpeechSynthesisVoice[]
  settings: SpokenOutputSettings
  supertonicReady: boolean
  onSettingsChange: (settings: SpokenOutputSettings) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onReplay: () => void
}

export function SpokenOutputControls({
  state,
  kind,
  model,
  voices,
  settings,
  supertonicReady,
  onSettingsChange,
  onPause,
  onResume,
  onStop,
  onReplay,
}: SpokenOutputControlsProps) {
  const [showSettings, setShowSettings] = useState(false)
  const label = kind === 'quick-recap'
    ? 'Short version'
    : kind === 'ai-recap'
      ? `AI summary${model ? ` · ${model}` : ''}`
      : 'Reading response'

  return (
    <div
      className="mt-2 rounded-xl border border-blue-200/70 bg-blue-50/70 p-2.5 text-xs text-blue-900 dark:border-blue-800/70 dark:bg-blue-950/30 dark:text-blue-100"
      role="region"
      aria-label="Spoken output controls"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto font-medium" aria-live="polite">
          {state === 'preparing' ? `Preparing ${label.toLowerCase()}…` : state === 'paused' ? `${label} paused` : label}
        </span>
        <ControlButton
          label={state === 'paused' ? 'Resume' : 'Pause'}
          icon={state === 'paused' ? Play : Pause}
          onClick={state === 'paused' ? onResume : onPause}
        />
        <ControlButton label="Stop" icon={Square} onClick={onStop} />
        <ControlButton label="Replay" icon={RotateCcw} onClick={onReplay} />
        <ControlButton
          label="Speech settings"
          icon={Settings2}
          onClick={() => setShowSettings((value) => !value)}
          pressed={showSettings}
        />
      </div>
      {showSettings && (
        <div className="mt-2 grid gap-2 border-t border-blue-200/60 pt-2 dark:border-blue-800/60 sm:grid-cols-2">
          <label className="grid gap-1 sm:col-span-2">
            <span>Speech engine</span>
            <select
              value={settings.engine}
              onChange={(event) => onSettingsChange({ ...settings, engine: event.target.value === 'supertonic' ? 'supertonic' : 'system' })}
              className="min-w-0 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-blue-800 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="system">System voices</option>
              <option value="supertonic" disabled={!supertonicReady}>
                Supertonic neural voices{supertonicReady ? '' : ' (install in Settings)'}
              </option>
            </select>
          </label>
          {settings.engine === 'system' ? <label className="grid gap-1">
            <span>Installed voice</span>
            <select
              value={settings.voiceUri ?? ''}
              onChange={(event) => onSettingsChange({ ...settings, voiceUri: event.target.value || null })}
              className="min-w-0 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-blue-800 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">System default</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label> : <>
            <label className="grid gap-1">
              <span>Neural voice</span>
              <select
                value={settings.supertonicSpeakerId}
                onChange={(event) => onSettingsChange({ ...settings, supertonicSpeakerId: Number(event.target.value) })}
                className="min-w-0 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-blue-800 dark:bg-gray-900 dark:text-gray-100"
              >
                {Array.from({ length: 10 }, (_, id) => <option key={id} value={id}>Voice {id + 1}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span>Language</span>
              <select
                value={settings.supertonicLanguage}
                onChange={(event) => onSettingsChange({ ...settings, supertonicLanguage: event.target.value as SpokenOutputSettings['supertonicLanguage'] })}
                className="min-w-0 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-gray-800 dark:border-blue-800 dark:bg-gray-900 dark:text-gray-100"
              >
                {SUPERTONIC_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          </>}
          <label className="grid gap-1">
            <span>Speed: {settings.rate.toFixed(1)}×</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.rate}
              onChange={(event) => onSettingsChange({ ...settings, rate: Number(event.target.value) })}
            />
          </label>
          {settings.engine === 'system' && <label className="grid gap-1">
            <span>Pitch: {settings.pitch.toFixed(1)}</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.pitch}
              onChange={(event) => onSettingsChange({ ...settings, pitch: Number(event.target.value) })}
            />
          </label>}
          {settings.engine === 'system' && <div className="grid gap-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.offlineOnly}
                onChange={(event) => onSettingsChange({ ...settings, offlineOnly: event.target.checked })}
              />
              Offline voices only
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoPlay}
                onChange={(event) => onSettingsChange({ ...settings, autoPlay: event.target.checked })}
              />
              Auto-play new responses
            </label>
          </div>}
        </div>
      )}
    </div>
  )
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  pressed,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white/80 px-2 py-1 text-blue-700 hover:bg-white dark:border-blue-800 dark:bg-gray-900/70 dark:text-blue-200"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  )
}
