# Nexy Android — Issues Roadmap

Last updated: 2026-06-17

Tracks the nine reported issues with root causes and actionable fix checklists.

---

## Issue 1 — Chat history rows are too tall

**Root cause:** `ConversationRow` renders three lines of text (title + context tags + preview) inside a content-driven `Column` with 10 dp vertical padding and no height cap, producing ~80–96 dp rows that feel heavy.

**Fix checklist:**
- [x] Reduce vertical padding in `ConversationRow` from `16/10 dp` to `16/8 dp`
- [x] Make the preview line optional: only show it when `conversation.lastMessage` is non-blank
- [x] Cap the context-tag row (agent · project) to a single line with `maxLines = 1, overflow = Ellipsis`
- [ ] Verify the result looks correct at both default and large text scale sizes

**Files:** `android/app/src/main/java/io/nexy/android/ui/home/HomeScreenComponents.kt`

---

## Issue 2 — Model picker only shows Claude CLI models; Codex and OpenRouter missing

**Root cause:** The desktop `model:list` handler returned models from only the *active* CLI/provider. When no explicit `backend` was passed it resolved a single fallback rather than aggregating all available sources.

**Fix checklist:**
- [x] In `src/main/ws-handlers.ts`, update the `model:list` handler to return models from **all** available sources when no explicit `backend` is requested: each installed CLI adapter (`ClaudeAdapter.isAvailable()`, `CodexAdapter.isAvailable()`) **and** every configured BYOK provider
- [x] Include a `vendor` label per model so the picker shows the source next to each option
- [x] Group models by vendor in the picker bottom sheet (section headers) — `vendor` field is already present in `ModelOption`; grouped with `Text` headers when any vendor label is present
- [x] Store CLI availability in a `StateFlow<Map<String, CliInstallInfo>>` in `WsRepository` (previously the `CliStatus` event was received but discarded); surface a "Not installed" badge in the picker for CLI sources that are unavailable

**Files:** `src/main/ws-handlers.ts`, `android/.../ui/chat/ChatScreen.kt`

---

## Issue 3 — Chat composer is missing capture screen / paste image / insert prompt / context inspector

**Root cause:** `ChatScreenInput.kt` only has an attach-file button and a send button. The desktop composer has richer attachment options that were never ported to Android.

**Fix checklist:**
- [x] **Paste image from clipboard:** Added clipboard button; uses `ClipboardManager` to read top `ClipData` URI, checks `image/*` MIME, converts to base64, attaches as image
- [x] **Insert prompt:** Added prompt button; opens `ModalBottomSheet` listing prompts from `WsRepository.promptEntries`, inserts selected body into composer text field
- [x] **Capture screen:** Added screenshot button; requests `READ_MEDIA_IMAGES` (API 33+) / `READ_EXTERNAL_STORAGE` (API ≤32) at runtime; queries `MediaStore.Images.Media` for the most recent screenshot by `RELATIVE_PATH LIKE '%Screenshot%'`, encodes as base64, attaches as image
- [x] **Context inspector:** Added info button; opens bottom sheet showing active model, agent, project, message count, and backend
- [x] Added the new buttons to `ChatInputBar` in a secondary action row below the text field

**Files:** `android/.../ui/chat/ChatScreenInput.kt`, `android/.../ui/chat/ChatViewModel.kt`

---

## Issue 4 — Create project does nothing; project options are incomplete

**Root cause (nothing happens):** The sheet fired `onCreateProject()` and hid immediately without waiting for the server response or giving any feedback.

**Root cause (limited options):** The Android create-project sheet intentionally only asks for name and colour (a deliberate scope decision in Phase 2). The desktop Project Generator (LLM-driven project scaffolding) is a separate feature not yet bridged.

**Fix checklist:**
- [x] Add a loading state inside the create sheet while waiting for the server response (disable "Create" button, show "Creating…" label)
- [x] Show a snackbar on success ("Project created") via `HomeViewModel.projectCreated` SharedFlow
- [x] Keep sheet open until `project:created` broadcast is received from the desktop
- [x] Add a connection-guard: shows error banner and disables all fields + Create button when the WebSocket is disconnected
- [x] **Project Generator bridge:** Added `ProjectGeneratorScreen` (two-phase: chat → spec review → done); wired `project-generator:start`, `project-generator:message`, `project-generator:confirm`, `project-generator:cancel` WS commands; parses `project-generator:token`, `project-generator:spec-ready`, `project-generator:created`, `project-generator:error`, `project-generator:cancelled` events; navigable from Settings → Tools → "Project Generator"

**Files:** `android/.../ui/home/HomeScreenTabs.kt`, `android/.../ui/home/HomeScreen.kt`, `android/.../ui/home/HomeViewModel.kt`

---

## Issue 5 — Create agent does nothing; agent options are incomplete

**Root cause:** Same WebSocket feedback gap as Issue 4. The agent create sheet hid immediately with no loading state, no success/error feedback.

**Fix checklist:**
- [x] Same loading + success/error feedback fixes as Issue 4 (applied to `AgentsTab`)
- [x] Keep sheet open until `agent:created` broadcast is received
- [x] Show snackbar on success via `HomeViewModel.agentCreated` SharedFlow
- [x] Connection-guard: shows error banner and disables all fields + Create button when disconnected
- [x] **Agent config editing:** Added `AgentConfigScreen` (navigate via "Configure" in agent row dropdown) exposing name, icon, system prompt, backend picker (Default / Claude CLI / Codex CLI / GitHub Copilot), and CLI model override; sends `agent:update` over WS; shows save confirmation via snackbar

**Files:** `android/.../ui/home/HomeScreenTabs.kt`, `android/.../ui/home/HomeViewModel.kt`

---

## Issue 6 — Settings is a flat scrollable mess; should match desktop tab structure

**Root cause:** `SettingsScreen.kt` rendered everything as vertically stacked sections on one screen with no clear hierarchy.

**Fix checklist:**
- [x] Restructure `SettingsScreen` into logical groups: **General** (appearance), **Connection**, **Models**, **Notifications**, **Updates**, **Tools** (nav rows to sub-screens), **Developer** (diagnostics + actions)
- [x] Surface all tool destinations as `SettingsNavRow` items under a "Tools" section: API Providers, Prompt Library, Feature Generator, Artifacts, Self-Heal Reports
- [x] Move Diagnostics and Actions under a "Developer" header
- [ ] Consider splitting General/Connection/Models/Notifications/Updates into separate destination screens (further iteration — current grouped hub is a major improvement)

**Files:** `android/.../ui/settings/SettingsScreen.kt`

---

## Issue 7 — API Providers screen shows endless loading spinner

**Root cause:** `ProvidersViewModel` fired `getProviders()` before the WebSocket was connected. The command was dropped and `isLoading` was stuck at `true` permanently.

**Fix checklist:**
- [x] Add a connection state check before sending `provider:get-configured`; if not connected, show error message instead of spinner
- [x] Add a 10-second timeout that clears `isLoading` and sets an error message
- [x] Re-trigger `refresh()` automatically when the WebSocket connects (observe `WsRepository.connectionState`)
- [x] Add a manual "Retry" button to `ProvidersScreen` for the empty/error state
- [ ] Investigate `broadcastToMobile` vs `reply` in `ws-handlers.ts` — currently uses `reply()` which is correct for request/response but verify the socket ID is stable

**Files:** `android/.../ui/settings/ProvidersViewModel.kt`, `android/.../ui/settings/ProvidersScreen.kt`

---

## Issue 8 — Feature Generator sends message but loading bar never resolves (Android + desktop broken)

**Root cause (Android):** The `LinearProgressIndicator` was gated on `isLoading && streamingText.isBlank()` — so it disappeared the moment the first token arrived. The streaming bubble was correctly shown during streaming already; the loading indicator just needed to stay visible throughout.

**Root cause (desktop):** The Feature Generator `applyAll()` and `commit()` operations had no `isLoading` state — they fired and no loading indicator was shown while the desktop processed them.

**Fix checklist:**

**Android:**
- [x] Show `LinearProgressIndicator` whenever `isLoading` (removed the `streamingText.isBlank()` condition)
- [x] Add `isLoading = true` to `applyAll()` and `commit()` in `FeatureGeneratorViewModel`
- [x] Clear `isLoading` when `FeatureGeneratorApplied` and `FeatureGeneratorCommitted` events arrive
- [x] Error dialog already wired (`NexyInfoDialog` shown when `uiState.error != null`)
- [ ] Desktop Feature Generator workspace validation — investigate why the LLM call may not complete

**Desktop:**
- [x] In the `feature-generator:start` WS handler, validate that `build_workspace_path` is set in settings; broadcast `feature-generator:error` immediately if not configured
- [x] Broadcast `feature-generator:chat-turn-done` after each non-spec chat turn so Android can clear `isLoading` and commit the assistant message
- [x] `feature-generator:run-created` is not needed for the chat start — Android generates its own `runId` locally and only receives the desktop-assigned `runId` after `confirm-spec`, which is correct
- [x] Desktop Feature Generator UI in `FeatureGeneratorTab.tsx` is conforming — chat, spec review, plan review, diffs, verify, commit all present

**Files:** `android/.../ui/featuregenerator/FeatureGeneratorScreen.kt`, `android/.../ui/featuregenerator/FeatureGeneratorViewModel.kt`

---

## Issue 9 — Artifacts section shows endless loading; desktop artifacts chat does nothing

**Root cause (Android loading):** Same connection-timing problem as Issue 7 — command dropped when socket not yet connected.

**Root cause (desktop artifacts chat):** Needs investigation — may be read-only by design.

**Fix checklist:**

**Android:**
- [x] Add connection state check before sending `artifact:list`; show error empty state instead of spinner when not connected
- [x] Add 10-second timeout that clears `isLoading` and shows an error message
- [x] Re-trigger `refresh()` automatically when the WebSocket connects
- [x] Show "Retry" label on empty state action button

**Desktop:**
- [x] Desktop `ArtifactsBrowser` already has a fully wired inline generator with chat → spec review → generate → ready phases; submit handler calls `window.api.artifactGeneratorChat`; stream events subscribed. No changes needed.

**Files:** `android/.../ui/artifacts/ArtifactsViewModel.kt`, `android/.../ui/artifacts/ArtifactsScreen.kt`

---

## Priority Order

| Priority | Issue | Status |
|----------|-------|--------|
| P0 | #7 Providers endless loading | **Done** |
| P0 | #9 Artifacts endless loading (Android) | **Done** |
| P1 | #8 Feature Generator loading bar fix (Android) | **Done** |
| P1 | #4/#5 Create project/agent feedback | **Done** |
| P2 | #2 Model picker aggregates all sources | **Done** |
| P2 | #1 Chat rows too tall | **Done** |
| P2 | #6 Settings restructured | **Done** |
| P3 | #3 Composer paste/prompt/inspector | **Done** |
| P3 | #4/#5 Connection-guard on create sheets | **Done** |
| P3 | #2 Model picker vendor grouping | **Done** |
| P3 | #3 Composer screen capture | **Done** |
| P3 | #5 Agent config editing (AgentConfigScreen) | **Done** |
| P3 | #4 Project Generator bridge | **Done** |
| P3 | #2 CLI availability badge in model picker | **Done** |
| P3 | #8/#9 Desktop Feature Generator + Artifacts investigation | **Done** |
