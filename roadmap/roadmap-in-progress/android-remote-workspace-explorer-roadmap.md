# Android Remote Workspace File Explorer Roadmap

Status: **planning document**. No code has been changed as part of producing this document — it is a research report plus a phased implementation roadmap for future work. All file:line citations reflect the codebase at the time of writing.

## 1. Why this document exists

Today, a project's workspace directory (`ProjectConfig.rootDirectory`) can only be set by typing/pasting an absolute path or by using the desktop app's own native OS folder picker (`dialog.showOpenDialog`, wired to the `file:open-dialog` IPC channel). When the Nexy Android companion app is paired to the desktop app in remote-desktop ("connected") mode over the existing WebSocket channel, there is no way to browse the desktop's filesystem from the phone and pick a directory — the user has to be physically at the desktop, or already know the exact path to type on Android.

This document:
1. Documents the current-state WebSocket, project/workspace, and Android UI architecture relevant to this gap, with citations (§2).
2. Lays out the target behavior for a remote, phone-driven directory browser that writes back into a project's `rootDirectory` (§3).
3. Lays out a phased roadmap to build it, reusing existing building blocks wherever they already exist rather than duplicating them (§4).
4. Lists every open design decision that was defaulted (or already confirmed with the user) rather than left implicit, for reviewer sign-off (§5).

## 2. Current-state architecture

### 2.1 WebSocket transport and trust model

`src/main/ws-server.ts` runs a `wss` WebSocket server over `https` on a fixed port (16717) with a self-signed TLS certificate persisted in `settings`. Pairing is a shared-secret model: a random 24-byte hex `token` (`ws_token` setting) is embedded in the pairing QR code/URL (`getPairingUrl`/`getQrDataUrl`), and every inbound connection must supply it as a `?token=` query param (checked at `connection`, `ws-server.ts:313`) plus every subsequent JSON command must repeat it in the payload (`ws-server.ts:328-335`) or the socket is closed with code 4001. On connect, the server immediately pushes a `connected` event (`ws-server.ts:326`) carrying `feedUrl` (for Android's OTA update check, sourced from `local-feed-server.ts`'s `getFeedLanUrl`), MAC/broadcast address, and mDNS name.

Two message shapes exist on this one connection:
- **Outbound pushes**: `broadcastToMobile(event)` (`ws-server.ts:157-163`) iterates all `connectedClients` and sends unsolicited JSON — used for things like `project:renamed`/`project:deleted` (`ws-handlers.ts:918,926`) and `chat:tool-call-event` (`tool-loop.ts:159`).
- **Command dispatch**: a single handler registered once via `setWsCommandHandler` (`ws-server.ts:274`) receives every inbound command and runs it through one large `if (command === '...')` chain in `src/main/ws-handlers.ts` (2886 lines) covering chat, conversations, agents, projects, remote-edit, model listing, scheduler, and generator commands.

**No filesystem-listing command exists in this chain today.**

### 2.2 Existing local-only directory-listing building block (directly reusable)

`src/main/file-handlers.ts:137-143` registers a desktop-local IPC channel:

```ts
safeHandle('fs:list-directory', (_event, path: string, depth?: number) => {
  if (!path) throw new Error('Path is required')
  if (!existsSync(path)) throw new Error(`Directory does not exist: ${path}`)
  const stat = statSync(path)
  if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${path}`)
  return listDirectoryEntries(path, depth ?? 3, '')
})
```

`listDirectoryEntries(rootPath, maxDepth, relBase)` (`file-handlers.ts:158-194`) recursively walks the tree up to `maxDepth` levels, skipping a fixed `FS_IGNORE` set (`.git`, `node_modules`, `dist`, `.next`, `__pycache__`, `.cache`, `coverage`, `.nyc_output`, `build`, `out`, and a few OS junk files — `file-handlers.ts:152-156`), returning a flat `DirectoryEntry[]` of `{name, relativePath, type: 'file'|'dir'}`. Unreadable entries and unreadable directories are both silently swallowed into an empty result (`file-handlers.ts:172-177`) — there is no way today to distinguish "this directory is genuinely empty" from "this directory could not be read" (permissions, etc.). This function takes an absolute path directly with no path-traversal guard beyond the ignore-list — acceptable for its current trusted, desktop-local IPC caller, but worth re-examining once the same function is reachable from a remote client (see §5).

Sibling building blocks:
- `file:get-recent-dirs`/`file:add-recent-dir` (`file-handlers.ts:120-135`): a simple MRU list of up to 5 paths, persisted as a JSON array under the `recent_directories` key in the `settings` table.
- `DirectoryPicker.tsx` (renderer) + native `dialog.showOpenDialog` (`file:open-dialog`): the existing desktop-local UX for picking a workspace directory, which the remote flow should feel consistent with (recent dirs at the top, confirm-then-inspect flow) without literally reusing renderer code (Android has its own UI stack).

### 2.3 The "set workspace" write path already exists and needs no changes

`ProjectConfig` (`src/shared/types.ts:305-330`) has `rootDirectory: string` and `workspaceInfo: ProjectWorkspaceMetadata | null` (`types.ts:230-240`: `{rootDirectory, exists, isLikelyCodingWorkspace, isGitRepo, branch, ...}`). Both the write and the validation paths are **already exposed over WebSocket**:

- `project:update-config` (`ws-handlers.ts:930-945`) already accepts and persists a `rootDirectory` patch:
  ```ts
  if (command === 'project:update-config') {
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id) return
    const existing = db.prepare('SELECT config_json FROM projects WHERE id = ?').get(id) as { config_json: string | null } | undefined
    const current = { ...parseProjectConfig(existing?.config_json ?? null) } as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (typeof data.instructions === 'string') patch.instructions = data.instructions
    if (typeof data.rootDirectory === 'string') patch.rootDirectory = data.rootDirectory
    // ...
  }
  ```
- `project:inspect-workspace` (`IpcReturnMap` entry, `types.ts:1852`) validates a `rootDirectory` into `ProjectWorkspaceMetadata`, i.e. confirms it exists, whether it's a git repo, etc.

This means the only genuinely missing piece is **read-side browsing** — a way for the phone to see the desktop's directory tree at all before it can hand a chosen path to the already-working write path.

### 2.4 Android architecture

`android/app/src/main/java/io/nexy/android/data/WsRepository.kt` (2399 lines) is a singleton `object WsRepository : WsClient` owning the WebSocket connection: `send(command, data)` / `sendOrQueue(...)` for outbound commands, and a shared `events: Flow<WsEvent>` plus assorted `StateFlow`s for inbound state. `WsEventParser.kt` (2541 lines) maps each inbound `event` string to a typed `WsEvent` sealed-class case. Screens follow an `AndroidViewModel` pattern (e.g. `RemoteEditViewModel.kt`) that calls into `WsRepository` and collects from `events`, exposing `StateFlow`s to Compose screens. Navigation is a flat Jetpack Compose `NavGraph.kt` with routes like `"remote-edit/{reportId}"` and optional-query-param routes such as `"artifacts?artifactId={artifactId}"`; `AutomatedWorkflowScreen.kt` is an example of a screen keyed by a required `projectId` nav argument.

**No file-explorer or directory-picker UI exists on Android today.** The one visually-similar component, `FileTreeView.kt`, only renders an already-fetched *flat list* of relative paths belonging to a code-change diff (the remote-edit/self-heal feature) — it is not a live, navigable remote directory browser and pulls no data over the wire itself.

`ConnectionScreen.kt`'s `EffectiveConnectionMode` (`CONNECTED` vs `STANDALONE_BY_CHOICE`) is the existing, already-used gate for "is a desktop actually reachable right now" — the natural guard for showing or hiding a "browse desktop files" entry point, since standalone mode has no desktop to browse.

## 3. Target behavior

From Android, **only while `EffectiveConnectionMode.CONNECTED`**, the user gets a "Browse desktop files" entry point from two places: (a) a project's workspace row (wherever `rootDirectory`/`workspaceInfo` is currently surfaced, e.g. inside `ProjectConfigScreen.kt`), and (b) the project-creation flow, as an alternative to typing a path manually. Selecting it opens a folder-only remote browser:

- Breadcrumb bar showing the current path, tap any crumb to jump up.
- A list of the current directory's children — folders are tappable (navigate in); files are shown **dimmed and non-tappable**, not hidden outright, so the browsing experience still reads as a real file explorer rather than a bare folder picker.
- A "Select this folder" action available at any depth, not just leaves.
- A recent-directories quick-access row at the top, reusing the same `recent_directories` setting the desktop `DirectoryPicker` already writes to (§2.2) — no duplicate storage needed, it's a shared setting, not scoped per-surface.
- On selection: call `project:update-config` with the chosen `rootDirectory`, then `project:inspect-workspace` to refresh and show the same exists/git-repo confirmation the desktop `DirectoryPicker` already shows.

Per the confirmed decision in §5, this reuses the existing WS pairing-token trust model as its only access control — no additional confirmation dialog or settings toggle gates remote browsing, consistent with the fact that a paired device can already trigger desktop builds and patch arbitrary project config over the same channel.

## 4. Phased roadmap

Sequencing follows this codebase's established precedent (see `automated-workflow-hierarchy-roadmap.md` §5 in this same directory): backend/WS layer → Android data layer → Android UI → hardening, with desktop and Android changes ready together since `ws-handlers.ts` does raw string-matching on command names with no protocol versioning — an Android build expecting a response shape a desktop build doesn't yet send will silently misbehave rather than error cleanly.

### Phase 0 — Protocol mechanism verification (do first)

Confirm exactly how existing **query-style** WS commands that must answer only the requesting client (e.g. `project:list`, `project:get-config`) return their result today — `broadcastToMobile` fans out to every paired client, which is correct for change notifications but wrong for "here are the contents of the folder you just asked about." The new directory-listing command must follow whatever request/response correlation mechanism those existing query commands already use (a response event carrying a request id, a dedicated one-shot event name, or similar). This directly shapes both the desktop handler's response shape and the Android `WsRepository` sender's design in Phase 1/2, so it needs to be nailed down before either is written, not assumed.

### Phase 1 — Desktop WS command layer

- New WS command `fs:list-directory` in `ws-handlers.ts`, reusing `listDirectoryEntries()` (`file-handlers.ts:158-194`) as-is for the walk logic, but called with **`depth = 1`** and a new `dirsOnly` filter flag, with the client re-requesting on each folder tap (lazy, on-demand expansion) rather than the local IPC caller's recursive `depth = 3` default. This is a deliberate deviation: depth-3 recursion was sized for a fast, synchronous, same-process IPC call — reusing it verbatim over a WebSocket/mobile-network hop risks large, slow payloads for anything but a small tree. `dirsOnly` avoids shipping file entries the mobile UI won't render as tappable anyway (files still need to come through for the "dimmed, visible but non-tappable" requirement in §3, so this should be a display-hint flag included per entry rather than an actual server-side filter — reconsider naming to `includeFiles` returning both types with a `type` field, which the existing `DirectoryEntry` shape already provides).
- New WS command `fs:get-start-roots` returning the platform home directory plus the existing `recent_directories` setting list, as the browser's initial landing state. Windows drive-letter enumeration (`A:`–`Z:` existence probing) is **not** required for v1 — flagged as a stretch item in §5; home directory + recents is sufficient to reach any typical project location.
- Add a **large-directory guard**: cap returned entries at a fixed limit (e.g. 2000) with a `truncated: boolean` flag in the response, protecting both the WS payload size and the Android list UI from an unexpectedly huge folder that isn't already caught by `FS_IGNORE` (e.g. a large media directory).
- Add an explicit `error?: string` field to the response to distinguish "this directory could not be read" (permission denied, etc.) from "this directory is legitimately empty" — today's `listDirectoryEntries` collapses both to an empty array (`file-handlers.ts:172-177`), which is fine for the existing trusted local caller but would read as a confusing blank screen over a remote UI.
- No changes needed to `project:update-config` or `project:inspect-workspace` — both already do exactly what's needed (§2.3).

**Phase 1 verification**: unit test the new handler against a stubbed filesystem tree (depth-1 truncation, `FS_IGNORE` filtering preserved, `truncated` flag fires past the cap, `error` field set for an unreadable directory); manual test that `fs:get-start-roots` returns a sane landing set on both Windows and macOS/Linux dev machines.

### Phase 2 — Android data layer

- `WsRepository`: new `listDirectory(path: String)` / `getStartRoots()` senders, following whatever request/response mechanism Phase 0 confirmed.
- `WsEventParser.kt`: new parsed-response case(s) for the directory listing and start-roots responses.
- New `FileExplorerViewModel.kt` (same `AndroidViewModel` shape as `RemoteEditViewModel.kt`): holds the current path, a breadcrumb stack, the current children list, loading/error/truncated state, and issues a fresh `listDirectory` call on each navigation step (no client-side caching of deeper levels needed given the lazy depth-1 design).

**Phase 2 verification**: extend the existing WS event-parser test file for the new response shape(s); ViewModel unit test for breadcrumb push/pop and error/truncated state propagation.

### Phase 3 — Android UI

- New `FileExplorerScreen.kt` (Compose): breadcrumb bar, scrollable folder/file list (folders tappable with a folder icon and chevron, files dimmed/non-tappable), a persistent bottom "Select this folder" action bar showing the current path, a recent-directories row at the top of the root view, and pull-to-refresh.
- `NavGraph.kt`: new route `file-explorer?projectId={projectId}` — `projectId` optional, following the existing `artifacts?artifactId={artifactId}` convention — so the same screen serves both "pick a workspace for project X" and a hypothetical future standalone browse use.
- Entry points: a "Browse desktop files" action added to `ProjectConfigScreen.kt`'s workspace row (visible/enabled only when `EffectiveConnectionMode.CONNECTED`, per §3) and to the project-creation flow as an alternative to manual path entry.
- On "Select this folder": call `project:update-config` (existing command, §2.3) with the chosen path, then `project:inspect-workspace` to refresh `workspaceInfo` and surface an exists/git-repo confirmation, mirroring the desktop `DirectoryPicker`'s existing confirm UX rather than inventing a new one.

**Phase 3 verification**: Compose UI test for breadcrumb navigation and folder-tap-to-navigate/file-tap-is-no-op; manual device smoke test pairing a real Android build to a real desktop build — browse into a nested folder, select it, and confirm the desktop project's `rootDirectory` updates and `workspaceInfo` reflects the new path.

### Phase 4 — Hardening

- UX for the `truncated` flag (e.g. "showing first 2000 of N items — narrow your search" banner).
- UX for the `error` field (distinct from an empty-folder state — e.g. "can't read this folder" with a retry action).
- Handle a desktop disconnect mid-browse gracefully (existing `WsRepository` connection-state handling should already surface this to any screen collecting its events — confirm reuse, don't build a parallel disconnect-detection path).

**Phase 4 verification**: manual test disconnecting the desktop mid-browse and confirming the explorer screen shows a clear reconnect/error state rather than hanging on a stale list.

## 5. Consolidated open-decisions log

1. **No additional access gate beyond the existing WS pairing-token trust model** — confirmed with the user. This is a materially broader capability than existing per-project file operations (a paired phone can now enumerate the entire desktop filesystem, not just a chosen project's files), but is treated as consistent with the existing trust boundary rather than requiring a new confirmation dialog or settings toggle.
2. **Depth-1 lazy/on-tap browsing over WS**, instead of reusing the local IPC caller's recursive depth-3 default — a payload-size and responsiveness tradeoff specific to the WS/mobile transport, not a change to the existing local `fs:list-directory` IPC channel's behavior.
3. **Windows drive-letter root enumeration deferred** — v1 starts from the home directory and existing recent-directories list only; revisit if users report needing to reach a non-home-rooted drive (e.g. a `D:\projects` layout) that recents doesn't already cover.
4. **Files are shown dimmed, not hidden**, in the picker list — preserves a real-file-explorer feel over a bare folder-only picker, at the cost of the response needing to include files (filtered for display, not filtered server-side).
5. **Request/response correlation mechanism is not yet confirmed** (Phase 0) — this roadmap assumes one already exists for other query-style commands (`project:list` etc.) and that the new command should follow it, but the exact mechanism must be verified against the actual `ws-handlers.ts`/`WsRepository.kt` code before Phase 1 is implemented, not assumed from this document alone.
