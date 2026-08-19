import { useState } from 'react'
import { Button, ToggleSwitch } from '../ui/primitives'
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
  whisperCppPath: string
  whisperModelPath: string
  whisperInstalling: boolean
  whisperReady: boolean
  onSetWhisperCppPath: (path: string) => void
  onSetWhisperModelPath: (path: string) => void
  onSaveWhisper: () => void
  onInstallWhisper: () => void
}

export function VoiceAudioTab({
  whisperCppPath,
  whisperModelPath,
  whisperInstalling,
  whisperReady,
  onSetWhisperCppPath,
  onSetWhisperModelPath,
  onSaveWhisper,
  onInstallWhisper,
}: Props) {
  const [showManualVoiceSetup, setShowManualVoiceSetup] = useState(false)
  const [voiceDockEnabled, setVoiceDockEnabled] = useState(() => localStorage.getItem('nexy.voiceDock.enabled') === 'true')
  const [pushToTalkShortcut, setPushToTalkShortcut] = useState<PushToTalkShortcut | null>(
    () => readPushToTalkShortcut(localStorage),
  )
  const [capturingShortcut, setCapturingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  const setDockEnabled = (enabled: boolean) => {
    setVoiceDockEnabled(enabled)
    localStorage.setItem('nexy.voiceDock.enabled', String(enabled))
    window.dispatchEvent(new Event('nexy.voiceDock.settingsChanged'))
  }

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

  return (
    <>
      <TabHeader title="Voice & audio" description="Voice input, the floating Voice Dock, and speech engine settings." />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Voice Dock</p>
          <p className="text-xs text-gray-500">Show a movable microphone beside the chat composer.</p>
        </div>
        <ToggleSwitch checked={voiceDockEnabled} onChange={() => setDockEnabled(!voiceDockEnabled)} ariaLabel="Voice Dock" />
      </div>

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
            <Button variant="primary" onClick={onSaveWhisper} disabled={whisperInstalling} className="rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-gray-100">
              Save manual paths
            </Button>
          </div>
        )}
        <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Push-to-talk shortcut</p>
          <p className="mb-2 text-xs text-gray-500">Hold the shortcut while Nexy is focused. Release any key to stop and transcribe.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-push-to-talk-capture={capturingShortcut ? 'true' : undefined}
              onClick={() => { setCapturingShortcut(true); setShortcutError(null) }}
              onKeyDown={capturingShortcut ? capturePushToTalkShortcut : undefined}
              className={`min-w-36 rounded-lg border px-3 py-2 text-xs font-medium ${capturingShortcut ? 'border-nexy-accent bg-nexy-accent/10 text-nexy-accent' : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200'}`}
              aria-label="Change push-to-talk shortcut"
            >
              {capturingShortcut ? 'Press shortcut…' : formatPushToTalkShortcut(pushToTalkShortcut)}
            </button>
            <Button variant="secondary" onClick={() => savePushToTalkShortcut(suggestedPushToTalkShortcut())} className="rounded-lg">Use suggestion</Button>
            {pushToTalkShortcut && <Button variant="secondary" onClick={() => savePushToTalkShortcut(null)} className="rounded-lg">Clear</Button>}
          </div>
          {shortcutError && <p className="mt-2 text-xs text-nexy-error" role="alert">{shortcutError}</p>}
        </div>
      </div>
    </>
  )
}
