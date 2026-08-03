import type { ProviderInfo } from './types'
import { TabHeader } from './TabHeader'
import { NexyIcon } from '../ui/icons/NexyIcon'

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
  pendingKeyHandoffProvider?: string | null
  onRequestKeyHandoff?: (provider: string | null) => void
  onConfirmKeyHandoff?: (provider: string) => void | Promise<void>
}

export function ProvidersTab({
  authMode, providers,
  editingProvider, apiKeyInput, azureEndpoint, testResult, testing,
  onSetEditingProvider, onSetApiKeyInput, onSetAzureEndpoint, onSetTestResult,
  onSaveKey, onTestKey, onRemoveKey,
  pendingKeyHandoffProvider, onRequestKeyHandoff, onConfirmKeyHandoff,
}: Props) {
  return (
    <>
      <TabHeader title="API Providers" description="Configure API keys for OpenAI, Anthropic, and other providers." />

      {authMode === 'byok' && providers.every((p) => !p.configured) && (
        <div className="flex items-start gap-2 p-3 rounded-none bg-nexy-info/10 border-2 border-nexy-info mb-1 shadow-nexy">
          <NexyIcon name="key" size={14} className="text-nexy-info shrink-0 mt-0.5" />
          <p className="text-xs text-nexy-info">
            You're in API key mode — configure at least one provider below to start chatting.
          </p>
        </div>
      )}
      {providers.map((provider) => (
        <div key={provider.name} className="p-3 rounded-none border-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{provider.label}</span>
              {provider.name === 'copilot' ? (
                <span className="text-xs px-1.5 py-0.5 rounded-none border border-nexy-accent bg-nexy-accent/10 text-nexy-accent">Default</span>
              ) : provider.configured ? (
                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-none border border-nexy-success bg-nexy-success/10 text-nexy-success"><NexyIcon name="check" size={10} />Configured</span>
              ) : (
                <span className="text-xs px-1.5 py-0.5 rounded-none border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500">Not configured</span>
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
                  className="text-xs px-2 py-1 rounded-none border border-transparent text-gray-500 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {editingProvider === provider.name ? 'Cancel' : 'Set Key'}
                </button>
                {provider.configured && (
                  <button
                    onClick={() => onRemoveKey(provider.name)}
                    className="text-xs px-2 py-1 rounded-none border border-transparent text-nexy-error hover:border-nexy-error hover:bg-nexy-error/10"
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
                  className="w-full px-3 py-2 text-sm rounded-none border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-nexy-accent"
                />
              )}
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => onSetApiKeyInput(e.target.value)}
                placeholder={`Enter ${provider.label} API key...`}
                className="w-full px-3 py-2 text-sm rounded-none border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-nexy-accent"
              />
              {testResult && (
                <p className={`flex items-center gap-1 text-xs ${testResult.valid ? 'text-nexy-success' : 'text-nexy-error'}`}>
                  <NexyIcon name={testResult.valid ? 'check' : 'error'} size={12} />
                  {testResult.valid ? 'API key is valid' : testResult.error || 'Invalid key'}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onTestKey}
                  disabled={!apiKeyInput.trim() || testing}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-none border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {testing && <NexyIcon name="busy" size={12} />}{testing ? 'Testing...' : 'Test'}
                </button>
                <button
                  onClick={onSaveKey}
                  disabled={!apiKeyInput.trim()}
                  className="text-xs px-3 py-1.5 rounded-none border-2 border-nexy-accent bg-nexy-accent text-nexy-on-accent hover:brightness-110 disabled:opacity-50 font-medium shadow-nexy"
                >
                  Save Key
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {pendingKeyHandoffProvider && (
        <div className="p-3 rounded-none border-2 border-nexy-info bg-nexy-info/10 shadow-nexy">
          <p className="text-sm font-medium text-nexy-info mb-2">
            Key handoff from Android
          </p>
          <p className="text-xs text-gray-700 dark:text-gray-200 mb-3">
            Your Android device is requesting to receive the {providers.find(p => p.name === pendingKeyHandoffProvider)?.label || pendingKeyHandoffProvider} API key from this desktop.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onConfirmKeyHandoff?.(pendingKeyHandoffProvider)}
              className="text-xs px-3 py-1.5 rounded-none border-2 border-nexy-accent bg-nexy-accent text-nexy-on-accent hover:brightness-110 font-medium shadow-nexy"
            >
              Send Key
            </button>
            <button
              onClick={() => onRequestKeyHandoff?.(null)}
              className="text-xs px-3 py-1.5 rounded-none border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        API keys are stored securely using OS-level encryption. Select a provider model
        in chat, project, or agent settings to use it.
      </p>
    </>
  )
}
