interface Props {
  jsonText: string
  jsonError: string
  onSetJsonText: (v: string) => void
  onSetJsonError: (v: string) => void
  onApply: () => void
}

export function JsonTab({ jsonText, jsonError, onSetJsonText, onSetJsonError, onApply }: Props) {
  return (
    <div className="space-y-2">
      <textarea
        value={jsonText}
        onChange={(e) => {
          onSetJsonText(e.target.value)
          onSetJsonError('')
        }}
        rows={24}
        spellCheck={false}
        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
      />
      {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
      <button
        onClick={onApply}
        className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
      >
        Apply JSON
      </button>
    </div>
  )
}
