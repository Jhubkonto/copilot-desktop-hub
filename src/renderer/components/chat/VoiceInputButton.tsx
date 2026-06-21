import { Loader2, Mic } from 'lucide-react'
import { useCallback } from 'react'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { useAppStore } from '../../store/app-store'

export function VoiceInputButton({ onText, disabled = false }: { onText: (text: string) => void; disabled?: boolean }) {
  const addToast = useAppStore((state) => state.addToast)
  const onError = useCallback((message: string) => addToast(message, 'error'), [addToast])
  const { voiceState, toggleVoice } = useVoiceInput(onText, onError)
  return (
    <button
      type="button"
      onClick={toggleVoice}
      disabled={disabled || voiceState === 'transcribing'}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${voiceState === 'recording' ? 'text-red-600 bg-red-50 dark:bg-red-900/30' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
      title={voiceState === 'recording' ? 'Stop recording' : voiceState === 'transcribing' ? 'Transcribing locally…' : 'Voice input'}
      aria-label={voiceState === 'recording' ? 'Stop voice recording' : 'Start voice input'}
      aria-pressed={voiceState === 'recording'}
    >
      {voiceState === 'transcribing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
    </button>
  )
}
