# Remote Dev from Android Roadmap

## Summary

Enable a full remote-development loop from the Android companion: trigger desktop builds, stream
progress to the phone, have the desktop self-update and relaunch, and have Android auto-reconnect
— all without touching the PC. An AI-assisted code-editing path (via the existing self-heal stack)
completes the loop so a developer can describe a change on Android, watch it land, build, deploy,
and reconnect without ever sitting at the desktop.

Feasibility is high across all phases:

- ~70–80 % of required infrastructure already exists (WS command dispatch, build pipeline,
  local feed server, self-heal, OkHttp reconnect, encrypted token storage).
- No new external dependencies required.
- Each phase is independently shippable and usable.

---

## Architecture Recap (what already exists)

| Layer | File | Key capability |
|---|---|---|
| WS server | `src/main/ws-server.ts` | `broadcastToMobile()`, `setWsCommandHandler()`, port 16717 |
| WS command dispatch | `src/main/ws-handlers.ts` | `registerWsHandlers()` — 50+ commands already wired |
| Build pipeline | `src/main/build-handlers.ts` | `typecheck → test → build → package` via `BUILD_COMMANDS`; streams `build:log-chunk` |
| Local feed server | `src/main/local-feed-server.ts` | Serves installer + YAML over HTTP; `getFeedLanUrl(ip)` |
| Self-heal | `src/main/self-heal-handlers.ts` | Investigation → fix → verification → git-commit pipeline |
| Android WS client | `android/.../WsRepository.kt` | OkHttp3; `doConnectWithFallbacks()`; reconnect with backoff 1 → 2 → 4 → 8 → 16 → 30 → 60 s |
| Android event parser | `android/.../WsEventParser.kt` | 150+ sealed event types, ready to extend |
| Android token store | `android/.../PairedServerStore.kt` | AES-256-GCM; token embedded in every WS URL + message |
| Android build UI | `android/.../BuildDashboardScreen.kt` | Already shows build records, preflight, signing |

---

## Phase 1 — Remote Build Trigger & Progress Stream

**Goal:** Tap a button on Android to kick off a desktop build and watch live log output arrive.

### Implementation

#### Desktop — `src/main/ws-handlers.ts`

Add a new WS command handler for `build:start-from-mobile`:

```typescript
case 'build:start-from-mobile': {
  const { command, workspacePath } = data as {
    command: BuildCommandName
    workspacePath?: string
  }
  const buildId = generateBuildId()
  // mark as mobile-initiated so Phase 2 auto-update can detect it
  startBuildFromMobile({ buildId, command, workspacePath, mobileInitiated: true }, reply)
  break
}

case 'build:cancel-from-mobile': {
  const { buildId } = data as { buildId: string }
  cancelMobileBuild(buildId)
  break
}
```

#### Desktop — `src/main/build-handlers.ts`

Add `startBuildFromMobile()` function that mirrors `build:start-command` IPC logic but:
- Sets `mobileInitiated = 1` on the `build_records` row (new column, see DB migration below).
- For each log line, calls both `win.webContents.send('build:log-chunk', ...)` **and**
  `broadcastToMobile({ event: 'build:log-chunk', data: { buildId, line } })`.
- On process exit, calls `broadcastToMobile({ event: 'build:command-done', data: { buildId, status, exitCode } })`.

#### Desktop — `src/main/database-migrations.ts`

Append a new migration entry:

```typescript
{
  version: <next>,
  sql: `ALTER TABLE build_records ADD COLUMN mobile_initiated INTEGER NOT NULL DEFAULT 0;`
}
```

Never edit existing migration entries; append only.

#### Android — `WsEvent.kt`

Add to the sealed class:

```kotlin
data class BuildLogChunk(val buildId: String, val line: String) : WsEvent()
data class BuildCommandDone(val buildId: String, val status: String, val exitCode: Int?) : WsEvent()
```

#### Android — `WsEventParser.kt`

Add cases in `parseWsEvent()`:

```kotlin
"build:log-chunk" -> WsEvent.BuildLogChunk(
    buildId = obj.getString("buildId"),
    line = obj.getString("line")
)
"build:command-done" -> WsEvent.BuildCommandDone(
    buildId = obj.getString("buildId"),
    status = obj.getString("status"),
    exitCode = obj.optInt("exitCode").takeIf { obj.has("exitCode") }
)
```

#### Android — `WsRepository.kt`

Add convenience send methods:

```kotlin
fun startDesktopBuild(command: String, workspacePath: String? = null) {
    send("build:start-from-mobile", buildMap {
        put("command", command)
        workspacePath?.let { put("workspacePath", it) }
    })
}

fun cancelDesktopBuild(buildId: String) {
    send("build:cancel-from-mobile", mapOf("buildId" to buildId))
}
```

#### Android — `BuildDashboardScreen.kt`

Add a "Desktop Build" card section above the existing build records list:
- `DropdownMenu` for command selection: `typecheck | test | build | package`.
- "Start Build" button → `WsRepository.startDesktopBuild(selectedCommand)`.
- "Cancel" button (visible while running) → `WsRepository.cancelDesktopBuild(activeBuildId)`.
- `LazyColumn` of log lines fed by `BuildLogChunk` events collected into a `SnapshotStateList`.
- Status chip (Running / Success / Failed) updated by `BuildCommandDone`.

### Phase 1 Completion Checklist

- [x] `build:start-from-mobile` WS command handler added in `ws-handlers.ts`
- [x] `build:cancel-from-mobile` WS command handler added in `ws-handlers.ts`
- [x] `startBuildFromMobile()` function added in `build-handlers.ts`, logs streamed to mobile
- [x] `build:command-done` WS push event emitted on build completion
- [x] DB migration adds `mobile_initiated` column to `build_records`
- [x] `BuildLogChunk` and `BuildCommandDone` sealed classes added in `WsEvent.kt`
- [x] Parser cases added in `WsEventParser.kt`
- [x] `startDesktopBuild()` / `cancelDesktopBuild()` added in `WsRepository.kt`
- [x] "Desktop Build" UI section added in `BuildDashboardScreen.kt` with live log view
- [ ] Manual test: tap "Start Build (typecheck)" on Android → log lines stream in; deliberate type error shows failure

---

## Phase 2 — Self-Update After Build

**Goal:** After a successful `package` build initiated from Android, the desktop publishes the
installer to the local feed, notifies Android, and relaunches itself — no desktop interaction
required.

### Implementation

#### Desktop — `src/main/build-handlers.ts`

In the `package` build success handler, check the `mobile_initiated` flag on the build record.
If set:

```typescript
if (record.mobileInitiated && record.command === 'package' && record.status === 'success') {
  // publish artifact to feed
  await publishArtifactToFeed(record)
  // warn Android before restarting
  broadcastToMobile({ event: 'update:restarting', data: { eta: 10, version: record.version } })
  // give Android time to receive the event
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, 2000)
}
```

`publishArtifactToFeed()` reuses the existing `build:publish-update` IPC logic from
`build-handlers.ts` — extract it into a shared helper so both the IPC handler and this
auto-update path can call it.

#### Desktop — `ws-handlers.ts` (optional manual trigger)

Also add `build:update-from-artifact` WS command for cases where the user wants to manually
trigger update from a previous successful build:

```typescript
case 'build:update-from-artifact': {
  const { buildId } = data as { buildId: string }
  const record = getBuildRecord(buildId)
  await publishArtifactToFeed(record)
  broadcastToMobile({ event: 'update:restarting', data: { eta: 10, version: record.version } })
  setTimeout(() => { app.relaunch(); app.exit(0) }, 2000)
  break
}
```

#### Android — `WsEvent.kt`

```kotlin
data class UpdateRestarting(val eta: Int, val version: String?) : WsEvent()
```

#### Android — `WsEventParser.kt`

```kotlin
"update:restarting" -> WsEvent.UpdateRestarting(
    eta = obj.optInt("eta", 10),
    version = obj.optString("version").takeIf { it.isNotEmpty() }
)
```

#### Android — `WsRepository.kt`

In the event handler that dispatches parsed events, intercept `UpdateRestarting`:

```kotlin
is WsEvent.UpdateRestarting -> {
    intentionalRestartExpected = true  // Phase 3 uses this
    _updateRestartingEvent.emit(event)
}
```

#### Android — `BuildDashboardScreen.kt`

Observe `updateRestartingEvent` flow; show a `Snackbar` or modal banner:
> "Desktop is installing v{version} and restarting — reconnecting automatically…"

Also add a "Apply Update" button in the build record card for successful `package` builds,
which sends `build:update-from-artifact` with the record's `buildId`.

### Phase 2 Completion Checklist

- [x] `publishArtifactToFeed()` extracted as shared helper in `build-handlers.ts`
- [x] Auto-update block added in `package` build success handler (checks `mobile_initiated`)
- [x] `update:restarting` WS push event emitted before `app.relaunch()`
- [x] `build:update-from-artifact` manual WS command handler added in `ws-handlers.ts`
- [x] `UpdateRestarting` sealed class added in `WsEvent.kt`
- [x] Parser case added in `WsEventParser.kt`
- [x] `intentionalRestartExpected` flag set in `WsRepository.kt` on `UpdateRestarting`
- [x] Toast/banner shown on Android during restart window
- [x] "Apply Update" button added to successful `package` build record card
- [ ] Manual test: trigger `package` build from Android → desktop relaunches → new version visible in `WorkspaceInfo` after reconnect

---

## Phase 3 — Android Auto-Reconnect on Intentional Restart

**Goal:** Android detects the WS drop caused by the Phase 2 relaunch and reconnects aggressively,
resuming the session within ~5–15 seconds.

The backoff schedule (1 → 2 → 4 → 8 → 16 → 30 s) already exists in `WsRepository.kt`.
The only gap: close codes 4001/4002 currently prevent reconnect (they signal intentional unpair).
A desktop relaunch may close with one of these codes. The fix is a flag that overrides that guard.

### Implementation

#### Android — `WsRepository.kt`

1. Add field (line ~187, near `currentToken`):

```kotlin
private var intentionalRestartExpected = false
```

2. Set it to `true` when `UpdateRestarting` event is received (see Phase 2 above — already placed
   in the event dispatcher).

3. In `onClosed()`, replace the early-exit guard:

```kotlin
// before:
if (code == 4001 || code == 4002) return  // intentional unpair, do not reconnect

// after:
if ((code == 4001 || code == 4002) && !intentionalRestartExpected) return
intentionalRestartExpected = false  // consumed
scheduleReconnect()
```

4. In `onMessage()` for the `connected` handshake event, clear the flag as a safety reset:

```kotlin
if (event is WsEvent.Connected) {
    intentionalRestartExpected = false
    // ... existing connected handling
}
```

5. The existing `scheduleReconnect()` with exponential backoff handles the retry loop — no new
   logic needed. The desktop comes back on the same port (16717) with the same TLS cert; the
   cached `PairedServerConfig.connectUrl` (token + fingerprint) is valid immediately.

#### Android — Connection status composable

In whichever composable renders the connection status indicator (likely in the top app bar or
a dedicated `ConnectionStatusBanner`), add a new state:

```kotlin
val label = when {
    isIntentionalRestartExpected && !isConnected -> "Reconnecting after update…"
    isConnected -> "Connected"
    else -> "Disconnected"
}
```

Expose `intentionalRestartExpected` via a `StateFlow<Boolean>` on `WsRepository` so the UI
can observe it without coupling to internals.

### Phase 3 Completion Checklist

- [x] `intentionalRestartExpected: Boolean` field added in `WsRepository.kt`
- [x] Field set to `true` when `UpdateRestarting` event received
- [x] `onClosed()` guard updated to allow reconnect when `intentionalRestartExpected = true`
- [x] Flag cleared after first successful `connected` handshake post-restart
- [x] `intentionalRestartExpected` exposed as `StateFlow<Boolean>` for UI observation
- [x] Connection indicator shows "Reconnecting after update…" state
- [ ] End-to-end test: trigger Phase 2 flow → Android drops connection → auto-reconnects within 15 s without user action → connection indicator returns to green

---

## Phase 4 — AI-Assisted Code Editing from Android

**Goal:** Developer describes a code change in Nexy chat on Android; the AI uses the existing
self-heal pipeline to write and apply the diff to the desktop workspace.

The core pipeline (`self-heal:start-investigation → start-fix → commit-to-workspace → git-commit`)
is **already fully wired** in `ws-handlers.ts` and handled in Android's `WsEventParser.kt`.
This phase closes the remaining UX gaps.

### Implementation

#### Gap 1 — Self-heal entry point from chat

**Android — Chat message long-press menu or composer slash command:**

Add a `/ fix` slash command (or a long-press "Investigate with AI" option on an error message).
On trigger, pre-fill the investigation screen's description field with the selected message text
and navigate to the self-heal investigation flow.

Implementation points:
- `SLASH_COMMANDS` array equivalent on Android (look for `SlashCommandHandler` or similar).
- Pass the prefill text via `NavController` argument to the self-heal start screen.
- The `self-heal:start-investigation` WS command already accepts `{ description: string }`.

#### Gap 2 — Diff review card on Android

**Android — Self-heal fix review screen:**

After `self-heal:fix-done` is received and `stagedFiles` is non-empty, show an expandable card
per file. Tapping "View diff" calls `self-heal:get-staged-diff` with the `relativePath` and
renders the unified diff in a monospaced scrollable text block (highlight `+` lines green,
`-` lines red using `SpannableString` or Compose `AnnotatedString`).

The WS command `self-heal:get-staged-diff` already exists and returns `{ diff: string }`.

#### Gap 3 — "Apply + Rebuild" one-tap flow

**Android — Self-heal commit success handler:**

After `self-heal:git-commit` succeeds (look for the reply/event from that WS command), show a
"Rebuild now" `OutlinedButton`. Tapping it calls:

```kotlin
WsRepository.startDesktopBuild("build")  // Phase 1 method
```

This wires the AI edit → rebuild path into a single tap after the commit.

#### Gap 4 — Inline tool approval in chat

**Android — Chat message list:**

`tool:approval-request` events currently show as a notification. Ensure they also inject an
inline "approval card" message into the chat `LazyColumn` at the bottom of the active
conversation. The card shows tool name + arguments, with "Approve" / "Deny" buttons that
call `WsRepository.send("tool:approve", ...)` / `send("tool:reject", ...)`.

The existing `WsEvent` types for tool approval are already defined — this is purely a UI change
in the chat screen composable.

### Phase 4 Completion Checklist

- [x] `/fix` slash command (or long-press) added to Android chat UI
- [x] Self-heal investigation screen accepts prefill description via nav argument
- [x] Expandable per-file diff card shown after `self-heal:fix-done` in fix review screen
- [x] `self-heal:get-staged-diff` called on demand and diff rendered with +/- highlighting
- [x] "Rebuild now" button shown after successful `self-heal:git-commit`
- [x] Button triggers `startDesktopBuild("build")` from Phase 1
- [x] `tool:approval-request` events rendered as inline approval cards in chat message list
- [x] Approve/Deny buttons in card send correct WS commands
- [ ] End-to-end test: describe a rename in Android chat → AI applies diff → review diff card → commit → tap Rebuild → build succeeds

---

## Phase 5 — File Browser + Direct Editor (Optional / Future)

**Goal:** Browse the desktop filesystem and edit files directly from Android without AI
mediation. This is the highest-effort phase and is optional if Phase 4 proves sufficient.

### Implementation

#### Desktop — new WS commands in `ws-handlers.ts`

```typescript
case 'fs:list-dir': {
  const { path } = data as { path: string }
  const entries = await listDir(sanitizePath(path, workspacePath))
  reply({ event: 'fs:dir-listing', data: { path, entries } })
  break
}

case 'fs:read-file': {
  const { path } = data as { path: string }
  const content = await readFile(sanitizePath(path, workspacePath), { maxBytes: 100_000 })
  reply({ event: 'fs:file-content', data: { path, content } })
  break
}

case 'fs:write-file': {
  const { path, content } = data as { path: string; content: string }
  const safe = sanitizePath(path, workspacePath)
  const approved = await requestApproval(mainWindow.webContents, 'fileWrite', { path: safe }, `Write ${safe}`)
  if (!approved) { reply({ event: 'fs:write-denied', data: { path } }); break }
  await writeFile(safe, content)
  reply({ event: 'fs:write-done', data: { path } })
  break
}
```

`sanitizePath()` — new helper that resolves the path relative to `workspacePath` (from DB
`workspace_path` setting) and throws if the resolved path escapes the workspace root
(simple `path.resolve` + `startsWith` check).

Reuse `executeTool('fileRead', ...)` and `executeTool('fileWrite', ...)` from `tools.ts`
rather than re-implementing file I/O — they already enforce the 100 KB limit and buffer logic.

#### Android — `WsEvent.kt`

```kotlin
data class FsDirListing(val path: String, val entries: List<FsEntry>) : WsEvent()
data class FsFileContent(val path: String, val content: String) : WsEvent()
data class FsWriteDone(val path: String) : WsEvent()
data class FsWriteDenied(val path: String) : WsEvent()

data class FsEntry(val name: String, val type: String, val size: Long?, val modified: Long?)
```

#### Android — `WsEventParser.kt`

Add cases for `fs:dir-listing`, `fs:file-content`, `fs:write-done`, `fs:write-denied`.

#### Android — `WsRepository.kt`

Add `listDir(path)`, `readFile(path)`, `writeFile(path, content)` send helpers.

#### Android — New `FileBrowserScreen.kt`

Composable with:
- Breadcrumb navigation bar (current path, tap to go up).
- `LazyColumn` of `FsEntry` items: folder icon → navigate into; file icon → open editor.
- Triggered by `fs:list-dir`; entries from `FsDirListing` events.

#### Android — New `FileEditorScreen.kt`

- Load file content via `fs:read-file` on screen open.
- Display in a `BasicTextField` (or `WebView` + Monaco for syntax highlighting).
- Floating "Save" button → `fs:write-file`; on `FsWriteDenied`, show toast "Write denied by desktop".
- On `FsWriteDone`, show success toast and optionally offer "Rebuild now" (Phase 1 method).

### Phase 5 Completion Checklist

- [ ] `sanitizePath()` helper added in `ws-handlers.ts` (workspace-root sandboxing)
- [ ] `fs:list-dir` WS command handler added, returns dir entries
- [ ] `fs:read-file` WS command handler added, returns file content (100 KB cap)
- [ ] `fs:write-file` WS command handler added, routes through `requestApproval()`
- [ ] `FsDirListing`, `FsFileContent`, `FsWriteDone`, `FsWriteDenied`, `FsEntry` added in `WsEvent.kt`
- [ ] Parser cases added in `WsEventParser.kt`
- [ ] `listDir()`, `readFile()`, `writeFile()` send helpers added in `WsRepository.kt`
- [ ] `FileBrowserScreen.kt` created with breadcrumb nav and entry list
- [ ] `FileEditorScreen.kt` created with load/edit/save flow
- [ ] Write denial handled gracefully in editor UI
- [ ] Path traversal test: attempt `../../../etc/passwd` → rejected by `sanitizePath()`
- [ ] End-to-end test: browse to `src/main/ws-server.ts` on Android, add a comment, save → file updated on desktop

---

## Build Order & Estimates

| Phase | Effort | Dependency |
|---|---|---|
| Phase 1: Remote build trigger | 1–2 days | None |
| Phase 2: Self-update after build | 1 day | Phase 1 |
| Phase 3: Auto-reconnect | 0.5 day | Phase 2 |
| Phase 4: AI code editing UX polish | 1–2 days | Phase 1 (for rebuild button) |
| Phase 5: File browser + editor | 3–4 days | Phase 1 (for fs commands) |

**Phases 1–3 total: ~3 days** for a fully working remote-build-and-self-update loop.
**Phases 1–4 total: ~4–5 days** for the complete AI-driven remote dev workflow.
