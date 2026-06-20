# Android ↔ Desktop Tight-Coupling & Wake Signalling Roadmap

> **Goal:** Make the Android ↔ Desktop connection frictionless and resilient — automatic LAN discovery, the ability for Android to wake a sleeping desktop, the desktop holding a wakelock while a mobile client is active, and robust session re-establishment after sleep/IP changes.
>
> **Existing infrastructure:** QR pairing (ZXing), OkHttp WebSocket client, FCM push (tool approvals), `PairedServerStore` (AES-256 encrypted), self-signed TLS cert pinning, `local-feed-server.ts` (HTTP on LAN).

---

## Phase 1 — Desktop Wakelock While Mobile Client Connected

Prevent the desktop from sleeping while an Android device is actively connected.

- [x] **P1.1** Import `powerSaveBlocker` from Electron in `ws-server.ts`
- [x] **P1.2** Track a single `wakeLockId: number | null` module-level variable in `ws-server.ts`
- [x] **P1.3** Call `powerSaveBlocker.start('prevent-app-suspension')` when the first mobile client is added to `mobileClients` (inside the `connection` handler, after token validation)
- [x] **P1.4** Call `powerSaveBlocker.stop(wakeLockId)` when `mobileClients` empties (inside `ws.on('close')`)
- [x] **P1.5** Ensure `powerSaveBlocker.stop()` is called on app quit / `ws-server` teardown
- [x] **P1.6** Add a `ws_wakelock_enabled` setting (default `true`) to the `settings` table; skip blocker if disabled
- [x] **P1.7** Expose a `ws:wakelockEnabled` IPC toggle in `ws-handlers.ts` so the desktop UI can surface a Settings toggle

---

## Phase 2 — `powerMonitor` Resume Hook (Ensure Server Is Running After Sleep)

Make the desktop guarantee the WS server restarts cleanly after waking from sleep.

- [x] **P2.1** Import `powerMonitor` from Electron in `main.ts` (or wherever the app lifecycle lives)
- [x] **P2.2** Subscribe `powerMonitor.on('resume', ...)` to call `startWsServerIfNeeded()` — a guard that checks whether `ws-server` is already listening and starts it if not
- [x] **P2.3** Ensure `ws-server.ts` exposes a `startWsServerIfNeeded()` export that is idempotent (no-op if already listening)
- [x] **P2.4** Log a `[ws-server] resumed from sleep, server listening` message on successful re-listen

---

## Phase 3 — Desktop Sends MAC Address at Pairing Time

Give Android the information it needs to send a Wake-on-LAN magic packet.

- [x] **P3.1** In `ws-server.ts`, compute the desktop's MAC address from `os.networkInterfaces()` — select the interface whose IPv4 address matches the address the WS server is bound to
- [x] **P3.2** Compute the broadcast address for that subnet (e.g. `192.168.1.255` from IP `192.168.1.42` + mask `255.255.255.0`)
- [x] **P3.3** Extend the `connected` event payload to include `macAddress: string` and `broadcastAddress: string` alongside the existing `version` and `feedUrl`
- [x] **P3.4** Add `macAddress: String?` and `broadcastAddress: String?` fields to `PairedServerProfile` in `PairedServerStore.kt`
- [x] **P3.5** Parse `macAddress` and `broadcastAddress` from the `connected` WsEvent in `WsEventParser.kt` and persist them to the active profile via `PairedServerStore`
- [x] **P3.6** Update `WsEvent.Connected` data class in `WsEvent.kt` to include the two new fields

---

## Phase 4 — Android Sends Wake-on-LAN Magic Packet

Allow Android to wake a sleeping desktop over LAN.

- [x] **P4.1** Implement `WakeOnLanHelper.kt` in `android/.../data/` — a pure utility object with `sendMagicPacket(macAddress: String, broadcastAddress: String)` using `DatagramSocket`
  - 6 bytes of `0xFF` followed by 16 repetitions of the 6-byte MAC — standard WoL magic packet format
  - Sends to `broadcastAddress` on UDP port 9 (standard WoL port)
  - Requires `CHANGE_NETWORK_STATE` or simply `INTERNET` permission (already held)
- [x] **P4.2** Add a `wakeDesktop()` suspend fun to `WsRepository` that reads `macAddress` and `broadcastAddress` from the active profile and calls `WakeOnLanHelper`
- [x] **P4.3** In `SettingsViewModel.kt` (or a new `ConnectionViewModel`), expose a `wakeDesktop()` action
- [x] **P4.4** Add a "Wake Desktop" button to the Settings / Connection screen — only shown when:
  - `connectionState == DISCONNECTED || reconnectExhausted == true`
  - `activeProfile.macAddress != null`
- [x] **P4.5** After sending the magic packet, automatically restart the reconnect loop in `WsRepository` (reset `reconnectExhausted`, clear `lastError`, call `doConnect()`)
- [x] **P4.6** Show a short "Magic packet sent — waiting for desktop…" snackbar while reconnecting post-WoL

---

## Phase 5 — FCM Desktop-Online Notification (Desktop Tells Android It's Awake)

Let the desktop push a wake signal to Android via FCM when it comes online, so Android can reconnect automatically without the user having to open the app.

- [ ] **P5.1** In `ws-server.ts` (or a new `fcm-push.ts` helper), implement `sendFcmPush(deviceTokens: string[], payload: object)` — POST to `https://fcm.googleapis.com/fcm/send` with `priority: "high"` using the existing Firebase server key stored in `settings`
- [ ] **P5.2** On `powerMonitor.on('resume')` and on app startup, call `sendFcmPush` with `{ type: 'desktop:online', wsUrl: currentPairingUrl }` to all `fcm_token`s in the `mobile_clients` table
- [ ] **P5.3** In `NexyFcmService.kt`, handle `type == 'desktop:online'`:
  - Update the stored `endpoint` in `PairedServerStore` if `wsUrl` differs from the current one
  - Call `WsRepository.connect()` if not already connected
  - No notification shown — this is a silent background reconnect trigger
- [ ] **P5.4** Ensure this FCM message is sent as `content_available: true` (iOS) / `priority: "high"` (Android) to bypass Doze mode
- [ ] **P5.5** Add a `desktop:ip-changed` FCM message type that carries a new `wsUrl` without triggering an immediate connect — just updates the stored profile. Sent by the desktop when `os.networkInterfaces()` detects an IP change (see Phase 6)

---

## Phase 6 — Desktop IP Change Detection & mDNS Fallback

Handle DHCP IP reassignment so Android doesn't need a re-scan of the QR code.

- [ ] **P6.1** In `ws-server.ts`, poll `os.networkInterfaces()` every 30 seconds and compare to the last-known LAN IP
- [ ] **P6.2** If the IP changes:
  - Update the pairing URL
  - Regenerate / re-serve the QR code (already handled by `getQrCode()`)
  - Send `desktop:ip-changed` FCM push (Phase 5.5) to all registered `device_id`s with the new `wsUrl`
- [ ] **P6.3** Register an mDNS service advertisement on the desktop using the `bonjour` npm package (or `mdns`):
  - Service type: `_nexy._tcp`
  - Service name: `Nexy Desktop`
  - Port: `16717`
  - TXT record: `token=<token>` (allows Android to re-pair without QR)
- [ ] **P6.4** In `PairingScreen.kt`, add a "Discover on Network" section below the QR scanner:
  - Use Android `NsdManager` to browse `_nexy._tcp.local`
  - Show discovered desktops as tappable list items
  - On tap, fetch the pairing token from the TXT record and call `WsRepository.connect()`
- [ ] **P6.5** Store `mDnsName: String?` (e.g. `nexy-desktop.local`) in `PairedServerProfile` for use as a hostname fallback when the stored IP fails

---

## Phase 7 — Heartbeat & Resilient Reconnection

Replace the current hard-stop reconnect exhaustion with an indefinitely resilient reconnect strategy.

- [x] **P7.1** Add WebSocket PING frames on the desktop side in `ws-server.ts` — send `ws.ping()` to each `mobileClient` every 30 seconds via `setInterval`
- [x] **P7.2** OkHttp handles PONG automatically; add a `pingIntervalMillis(30_000)` setting to the `OkHttpClient.Builder` in `WsRepository.kt` to enable the client-side ping/pong keepalive
- [x] **P7.3** Replace the current fixed 3-second retry / 5-attempt-max logic in `WsRepository.kt` with exponential backoff:
  - Delays: 1s, 2s, 4s, 8s, 16s, 30s (cap)
  - After 6 attempts, transition to "slow polling" mode: retry every 60 seconds indefinitely
  - Remove `reconnectExhausted` as a terminal state — replace with a `ConnectionState.POLLING` state
- [x] **P7.4** Add `ConnectionState.POLLING` to the `ConnectionState` enum and update `ConnectionChip` in `HomeScreenHelpers.kt` to show "Searching…" in amber for this state
- [ ] **P7.5** On each reconnect attempt in slow polling mode, try:
  1. Stored `endpoint` IP first
  2. Resolve `mDnsName` via `NsdManager` if stored IP fails
- [x] **P7.6** When Android app comes to foreground (`onResume` in the main Activity), immediately trigger a reconnect attempt if not already connected — don't wait for the next polling interval

---

## Phase 8 — Desktop Auto-Start on Login / Wake

Ensure the desktop WS server is running when Android tries to reconnect after a WoL wake.

- [ ] **P8.1** On first successful pairing, call `app.setLoginItemSettings({ openAtLogin: true })` in Electron (Windows + macOS) so Nexy starts automatically on login/boot
- [ ] **P8.2** Show a prompt to the user on first pairing: "Start Nexy automatically when your computer starts? This allows your phone to wake your desktop remotely." — with Accept / Not Now
- [ ] **P8.3** Store the user's preference in `settings` as `auto_start_enabled`; respect it in subsequent calls
- [ ] **P8.4** On macOS, call `sudo pmset womp 1` (or surface instructions) after pairing to enable WoL — show a one-time informational dialog
- [ ] **P8.5** On Windows, surface a one-time "Enable Wake-on-LAN" guide dialog after pairing — pointing to Device Manager → NIC → Power Management → "Allow this device to wake the computer"

---

## Phase 9 — Settings & UX Polish

Surface the new capabilities to the user cleanly.

- [ ] **P9.1** Add a "Desktop Connection" section to Android Settings screen showing:
  - Current profile name, endpoint, connection state
  - "Wake Desktop" button (Phase 4)
  - "Forget Desktop" button (existing)
  - "WoL enabled" toggle (per-profile)
- [ ] **P9.2** Add a wakelock status indicator to the desktop tray icon tooltip: "Nexy — Android connected (wakelock active)" vs "Nexy — No mobile clients"
- [ ] **P9.3** Show a non-intrusive banner in `HomeScreen` when `connectionState == POLLING`: "Looking for your desktop… [Wake it up]"
- [ ] **P9.4** Add connection diagnostics to the existing `ConnectionDiagnostics` data class: `macAddress`, `wolEnabled`, `mDnsName`, `lastWolSentAt`
- [ ] **P9.5** Write a brief "Remote Desktop Mode" help section in the in-app settings explaining WoL requirements (wired ethernet recommended, BIOS setting, auto-start)

---

## Implementation Notes

**Dependencies (desktop):**
- `powerSaveBlocker` — built-in Electron API, zero new deps
- `powerMonitor` — built-in Electron API, zero new deps
- `bonjour` — npm package for mDNS advertisement (`npm install bonjour`)
- `os.networkInterfaces()` — Node.js built-in, already available

**Dependencies (Android):**
- `DatagramSocket` — standard Java SDK, already available
- `NsdManager` — Android SDK, no new Gradle dependency
- `WorkManager` — for reliable background reconnect from FCM wake (already likely in deps)

**WoL reliability caveat:** WoL over Wi-Fi is unreliable on many home routers — broadcast packets may not reach sleeping wireless NICs. Wired ethernet is required for reliable WoL. The UI should surface this caveat (Phase 8 / Phase 9).

**FCM dependency:** Phases 5 requires a Firebase project with a server key. This is already a manual step noted in the Android README. If FCM is not configured, the system degrades gracefully — WoL + manual reconnect still work.
