import { RefreshCw } from 'lucide-react'

interface Props {
  mobileEnabled: boolean
  mobileQr: string | null
  mobileClients: number
  mobileLoading: boolean
  mobileLocalIp: string
  mobilePairingUrl: string | null
  mobileExternalUrl: string
  onSetMobileExternalUrl: (v: string) => void
  onToggle: () => void
  onRegenerateToken: () => void
  onSaveExternalUrl: () => void
  onRefreshStatus: () => void
}

export function MobileTab({
  mobileEnabled, mobileQr, mobileClients, mobileLoading,
  mobileLocalIp, mobilePairingUrl, mobileExternalUrl,
  onSetMobileExternalUrl, onToggle, onRegenerateToken, onSaveExternalUrl, onRefreshStatus,
}: Props) {
  return (
    <>
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Android companion app</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Let your phone approve tool calls and monitor agent output over local WiFi.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Enable mobile server</p>
          <p className="text-xs text-gray-500">Starts a local WebSocket server on your network</p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={mobileLoading}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50"
          style={{ backgroundColor: mobileEnabled ? '#3b82f6' : '#d1d5db' }}
          aria-checked={mobileEnabled}
          role="switch"
        >
          <span
            className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200"
            style={{ transform: mobileEnabled ? 'translateX(16px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {mobileEnabled && (
        <>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Local IP</span>
              <span className="font-mono text-gray-800 dark:text-gray-200">{mobileLocalIp}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-gray-500">Pairing URL</span>
              <span className="font-mono text-right text-gray-800 dark:text-gray-200 break-all">
                {mobilePairingUrl ?? 'Not available'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Connected devices</span>
              <span className="font-mono text-gray-800 dark:text-gray-200">{mobileClients}</span>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 px-4 py-3 space-y-2">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Secure external URL</p>
              <p className="text-xs text-gray-500">
                Optional. Use a public TLS endpoint such as Tailscale Funnel or a reverse proxy that forwards to this mobile server.
              </p>
            </div>
            <input
              value={mobileExternalUrl}
              onChange={(e) => onSetMobileExternalUrl(e.target.value)}
              placeholder="wss://your-host.example/mobile"
              className="w-full px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">Leave blank for local LAN pairing over ws://.</p>
              <button
                type="button"
                onClick={onSaveExternalUrl}
                disabled={mobileLoading}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Save URL
              </button>
            </div>
          </div>

          {mobileQr ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-gray-500 text-center">Scan with the Nexy Android app to pair</p>
              <img
                src={mobileQr}
                alt="Pairing QR code"
                className="rounded-lg border border-gray-200 dark:border-gray-700"
                style={{ width: 200, height: 200 }}
              />
              <button
                type="button"
                onClick={onRegenerateToken}
                disabled={mobileLoading}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-50"
              >
                <RefreshCw className="w-3 h-3" />
                Regenerate pairing code
              </button>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="w-[200px] h-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
          )}

          <button
            type="button"
            onClick={onRefreshStatus}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Refresh status
          </button>
        </>
      )}
    </>
  )
}
