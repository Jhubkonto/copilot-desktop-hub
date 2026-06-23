import type { ProviderInfo } from './types'
import { TabHeader } from './TabHeader'

interface Props {
  authMode: string
  providers: ProviderInfo[]
  editingProvider: string | null
  apiKeyInput: string
  azureEndpoint: string
  testResult: { valid: boolean; error?: string } | null
  testing: boolean
  onSetEditingProvider: (name: string | null) => void
  onSetApiKeyInput: (v: string) => void
  onSetAzureEndpoint: (v: string) => void
  onSetTestResult: (r: { valid: boolean; error?: string } | null) => void
  onSaveKey: () => void
  onTestKey: () => void
  onRemoveKey: (provider: string) => void
}

export function ProvidersTab({
  authMode, providers,
  editingProvider, apiKeyInput, azureEndpoint, testResult, testing,
  onSetEditingProvider, onSetApiKeyInput, onSetAzureEndpoint, onSetTestResult,
  onSaveKey, onTestKey, onRemoveKey,
}: Props) {
  return (
    <>
      <TabHeader title="API Providers" description="Configure API keys for OpenAI, Anthropic, and other providers." />

      {authMode === 'byok' && providers.every((p) => !p.configured) && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-1">
          <span className="text-blue-500 shrink-0 mt-0.5">🔑</span>
          <p className="text-xs text-blue-700 dark:text-blue-300">
            You're in API key mode — configure at least one provider below to start chatting.
          </p>
        </div>
      )}
      {providers.map((provider) => (
        <div key={provider.name} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{provider.label}</span>
              {provider.name === 'copilot' ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">Default</span>
              ) : provider.configured ? (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">✓ Configured</span>
              ) : (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">Not configured</span>
              )}
            </div>
            {provider.name !== 'copilot' && (
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    onSetEditingProvider(editingProvider === provider.name ? null : provider.name)
                    onSetApiKeyInput('')
                    onSetTestResult(null)
                  }}
                  className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {editingProvider === provider.name ? 'Cancel' : 'Set Key'}
                </button>
                {provider.configured && (
                  <button
                    onClick={() => onRemoveKey(provider.name)}
                    className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">Models: {provider.models.join(', ')}</p>

          {editingProvider === provider.name && (
            <div className="mt-3 space-y-2">
              {provider.name === 'azure' && (
                <input
                  type="text"
                  value={azureEndpoint}
                  onChange={(e) => onSetAzureEndpoint(e.target.value)}
                  placeholder="Azure endpoint (e.g. https://myresource.openai.azure.com)"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => onSetApiKeyInput(e.target.value)}
                placeholder={`Enter ${provider.label} API key...`}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {testResult && (
                <p className={`text-xs ${testResult.valid ? 'text-green-500' : 'text-red-500'}`}>
                  {testResult.valid ? '✓ API key is valid' : `✗ ${testResult.error || 'Invalid key'}`}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onTestKey}
                  disabled={!apiKeyInput.trim() || testing}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  {testing ? 'Testing...' : 'Test'}
                </button>
                <button
                  onClick={onSaveKey}
                  disabled={!apiKeyInput.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 font-medium"
                >
                  Save Key
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        API keys are stored securely using OS-level encryption. Select a provider model
        in chat, project, or agent settings to use it.
      </p>
    </>
  )
}
