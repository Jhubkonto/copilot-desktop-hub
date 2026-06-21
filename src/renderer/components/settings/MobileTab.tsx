import { RefreshCw, CheckCircle2, ChevronDown, ChevronUp, Plus, Trash2, Globe, Wifi, Pencil, Check, X } from 'lucide-react'
import { ToggleSwitch } from '../ui/primitives'
import { useState, useRef, useEffect } from 'react'
import type { WsUrlProfile } from '@shared/types'

const IS_MAC = navigator.userAgent.includes('Macintosh')
const IS_WIN = navigator.userAgent.includes('Windows')

interface Props {
  mobileEnabled: boolean
  mobileQr: string | null
  mobileClients: number
  mobileLoading: boolean
  mobileLocalIp: string
  mobilePairingUrl: string | null
  urlProfiles: WsUrlProfile[]
  onSaveProfiles: (profiles: WsUrlProfile[]) => void
  onToggle: () => void
  onRegenerateToken: () => void
  onRefreshStatus: () => void
  // FCM (moved from DeveloperTab)
  fcmStatus: { configured: boolean; projectId?: string } | null
  fcmJsonDraft: string
  fcmSaving: boolean
  fcmError: string | null
  onSetFcmJsonDraft: (v: string) => void
  onSaveFcmServiceAccount: () => void
  // Auto-start
  autoStartEnabled: boolean
  onToggleAutoStart: () => void
}

interface EditingProfile {
  id: string
  label: string
  url: string
}

function UrlProfileRow({
  profile,
  onActivate,
  onDelete,
  onUpdate,
  disabled,
}: {
  profile: WsUrlProfile
  onActivate: () => void
  onDelete: () => void
  onUpdate: (label: string, url: string) => void
  disabled: boolean
}) {
  const [editing, setEditing] = useState<EditingProfile | null>(null)
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) labelRef.current?.focus()
  }, [editing])

  function startEdit() {
    setEditing({ id: profile.id, label: profile.label, url: profile.url })
  }

  function commitEdit() {
    if (!editing) return
    const url = editing.url.trim()
    if (url && !url.startsWith('wss://')) return // keep editing, show error inline
    onUpdate(editing.label.trim() || 'Unnamed', url)
    setEditing(null)
  }

  function cancelEdit() {
    setEditing(null)
  }

  const urlError = editing && editing.url.trim() && !editing.url.trim().startsWith('wss://')

  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors ${profile.active ? 'border-blue-500/60 bg-blue-50/50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40'}`}>
      {editing ? (
        <div className="space-y-1.5">
          <input
            ref={labelRef}
            value={editing.label}
            onChange={(e) => setEditing((prev) => prev && { ...prev, label: e.target.value })}
            placeholder="Profile label (e.g. Tailscale)"
            className="w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
          <input
            value={editing.url}
            onChange={(e) => setEditing((prev) => prev && { ...prev, url: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit() }}
            placeholder="wss://your-host.example/mobile"
            className={`w-full px-2 py-1 rounded border text-xs bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 ${urlError ? 'border-red-400 focus:ring-red-400/50' : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500/50'}`}
          />
          {urlError && <p className="text-[10px] text-red-500">URL must start with wss://</p>}
          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={commitEdit}
              disabled={!!urlError || !editing.url.trim()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <Check className="w-3 h-3" /> Save
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onActivate}
            disabled={disabled || profile.active}
            title={profile.active ? 'Active profile' : 'Set as active'}
            className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${profile.active ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{profile.label}</span>
              {profile.active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium">active</span>
              )}
            </div>
            <p className="text-[11px] font-mono text-gray-400 truncate">{profile.url || <span className="text-gray-400 italic">no URL set</span>}</p>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={startEdit}
              disabled={disabled}
              className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function MobileTab({
  mobileEnabled, mobileQr, mobileClients, mobileLoading,
  mobileLocalIp, mobilePairingUrl, urlProfiles,
  onSaveProfiles, onToggle, onRegenerateToken, onRefreshStatus,
  fcmStatus, fcmJsonDraft, fcmSaving, fcmError, onSetFcmJsonDraft, onSaveFcmServiceAccount,
  autoStartEnabled, onToggleAutoStart,
}: Props) {
  const [fcmExpanded, setFcmExpanded] = useState(false)
  const [wolGuideExpanded, setWolGuideExpanded] = useState(false)

  const activeProfile = urlProfiles.find((p) => p.active)
  const isUsingLan = !activeProfile

  function addProfile() {
    const newProfile: WsUrlProfile = {
      id: crypto.randomUUID(),
      label: 'New profile',
      url: '',
      active: urlProfiles.length === 0,
    }
    onSaveProfiles([...urlProfiles, newProfile])
  }

  function activateProfile(id: string) {
    onSaveProfiles(urlProfiles.map((p) => ({ ...p, active: p.id === id })))
  }

  function deleteProfile(id: string) {
    const next = urlProfiles.filter((p) => p.id !== id)
    // If we deleted the active one, deactivate all (fall back to LAN)
    const hadActive = urlProfiles.find((p) => p.id === id)?.active
    if (hadActive && next.length > 0) {
      // keep all inactive — LAN fallback
    }
    onSaveProfiles(next)
  }

  function updateProfile(id: string, label: string, url: string) {
    onSaveProfiles(urlProfiles.map((p) => p.id === id ? { ...p, label, url } : p))
  }

  function useLocalLan() {
    onSaveProfiles(urlProfiles.map((p) => ({ ...p, active: false })))
  }

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
        <ToggleSwitch
          checked={mobileEnabled}
          onChange={() => onToggle()}
          disabled={mobileLoading}
          size="sm"
          ariaLabel="Enable mobile server"
        />
      </div>

      {mobileEnabled && (
        <>
          {/* Status card */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Local IP</span>
              <span className="font-mono text-gray-800 dark:text-gray-200">{mobileLocalIp}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500">Connection</span>
              <span className="flex items-center gap-1 text-gray-800 dark:text-gray-200">
                {isUsingLan
                  ? <><Wifi className="w-3 h-3 text-blue-500" /> Local LAN</>
                  : <><Globe className="w-3 h-3 text-indigo-500" /> {activeProfile?.label}</>
                }
              </span>
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

          {/* URL Profiles */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Connection profiles</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Save multiple endpoints — Tailscale Funnel, reverse proxy, etc. One profile is active at a time; the QR code points to it.
                </p>
              </div>
            </div>

            {/* LAN option */}
            <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${isUsingLan ? 'border-blue-500/60 bg-blue-50/50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
              <button
                type="button"
                onClick={useLocalLan}
                disabled={mobileLoading || isUsingLan}
                title={isUsingLan ? 'Active' : 'Use local LAN'}
                className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${isUsingLan ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'}`}
              />
              <Wifi className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-100">Local LAN</span>
                  {isUsingLan && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium">active</span>
                  )}
                </div>
                <p className="text-[11px] font-mono text-gray-400">{mobileLocalIp}:16717</p>
              </div>
            </div>

            {/* External profiles */}
            {urlProfiles.map((profile) => (
              <UrlProfileRow
                key={profile.id}
                profile={profile}
                onActivate={() => activateProfile(profile.id)}
                onDelete={() => deleteProfile(profile.id)}
                onUpdate={(label, url) => updateProfile(profile.id, label, url)}
                disabled={mobileLoading}
              />
            ))}

            <button
              type="button"
              onClick={addProfile}
              disabled={mobileLoading}
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              Add external profile
            </button>
          </div>

          {mobileClients === 0 && (
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3">
              <p className="text-xs font-medium text-blue-800 dark:text-blue-300 mb-1">First time? Here's how to pair:</p>
              <ol className="text-xs text-blue-700 dark:text-blue-400 space-y-0.5 list-none">
                <li>1. Download the <span className="font-medium">Nexy</span> app from the Play Store</li>
                <li>2. Open the app and tap <span className="font-medium">Scan QR code</span></li>
                <li>3. Point your camera at the code below</li>
              </ol>
            </div>
          )}

          {mobileQr ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-gray-500 text-center">Scan with the Nexy Android app to pair</p>
              <img
                src={mobileQr}
                alt="Pairing QR code"
                className="rounded-lg border border-gray-200 dark:border-gray-700"
                style={{ width: 200, height: 200 }}
              />
              <p className="text-xs text-gray-400 text-center">
                This code never expires. Regenerate it if your device was lost or you want to revoke access.
              </p>
              <button
                type="button"
                onClick={onRegenerateToken}
                disabled={mobileLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
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

          {/* FCM Push Notifications */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
            <button
              type="button"
              className="flex items-center justify-between w-full text-left"
              onClick={() => setFcmExpanded((v) => !v)}
            >
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-2">
                  FCM Push Notifications
                  {fcmStatus?.configured && (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fcmStatus?.configured
                    ? `Active — project: ${fcmStatus.projectId}`
                    : 'Not configured — push notifications disabled'}
                </p>
              </div>
              {fcmExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {fcmExpanded && (
              <>
                <p className="text-xs text-gray-500">
                  Sends push notifications to offline devices when tool approvals are requested. Paste your Firebase service account JSON key below. Get it from Firebase Console → Project Settings → Service accounts → Generate new private key.
                </p>
                <textarea
                  value={fcmJsonDraft}
                  onChange={(e) => onSetFcmJsonDraft(e.target.value)}
                  placeholder={'{\n  "type": "service_account",\n  "project_id": "my-project",\n  ...\n}'}
                  rows={4}
                  className="w-full font-mono text-[10px] p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 resize-none"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={onSaveFcmServiceAccount}
                    disabled={fcmSaving || !fcmJsonDraft.trim()}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  >
                    {fcmSaving ? 'Saving…' : 'Save configuration'}
                  </button>
                  {fcmError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{fcmError}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Auto-start */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Launch at login</p>
              <p className="text-xs text-gray-500">Start Nexy automatically when you log into your computer</p>
            </div>
            <ToggleSwitch
              checked={autoStartEnabled}
              onChange={onToggleAutoStart}
              size="sm"
              ariaLabel="Launch at login"
            />
          </div>

          {/* WoL setup guide */}
          {(IS_MAC || IS_WIN) && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <button
                type="button"
                className="flex items-center justify-between w-full text-left"
                onClick={() => setWolGuideExpanded((v) => !v)}
              >
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Wake on LAN setup</p>
                  <p className="text-xs text-gray-500 mt-0.5">Allow your phone to wake this computer from sleep</p>
                </div>
                {wolGuideExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {wolGuideExpanded && (
                <div className="text-xs text-gray-600 dark:text-gray-400 space-y-2">
                  {IS_MAC && (
                    <>
                      <p className="font-medium text-gray-800 dark:text-gray-200">macOS</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Open <span className="font-mono">System Settings → Energy Saver</span></li>
                        <li>Enable <span className="font-medium">Wake for network access</span></li>
                        <li>Or run in Terminal: <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">sudo pmset -a womp 1</span></li>
                      </ol>
                    </>
                  )}
                  {IS_WIN && (
                    <>
                      <p className="font-medium text-gray-800 dark:text-gray-200">Windows</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Open <span className="font-medium">Device Manager</span></li>
                        <li>Expand <span className="font-medium">Network Adapters</span>, right-click your LAN adapter</li>
                        <li>Go to <span className="font-medium">Power Management</span> and enable <span className="font-medium">Allow this device to wake the computer</span></li>
                        <li>In BIOS/UEFI, enable <span className="font-medium">Wake on LAN</span></li>
                      </ol>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
