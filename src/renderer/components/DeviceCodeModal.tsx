interface DeviceCodeModalProps {
  userCode: string
  verificationUri: string
  onCancel: () => void
}

export function DeviceCodeModal({ userCode, verificationUri, onCancel }: DeviceCodeModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="GitHub device code"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-sm text-center">
        <h2 className="text-lg font-semibold mb-2">Enter this code on GitHub</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Copy the code below and enter it at GitHub to authorize.
        </p>
        <div
          className="text-3xl font-mono font-bold tracking-widest bg-gray-100 dark:bg-gray-700 rounded-lg py-3 px-4 mb-4 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          onClick={() => navigator.clipboard.writeText(userCode)}
          title="Click to copy"
        >
          {userCode}
        </div>
        <p className="text-xs text-gray-400 mb-4">Click the code to copy it</p>
        <a
          href={verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          Open GitHub →
        </a>
        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-gray-400 dark:border-gray-500 border-t-transparent rounded-full animate-spin" />
          Waiting for authorization…
        </p>
        <button
          onClick={onCancel}
          className="block w-full mt-3 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
