# Roadmap: DRY / Consistency / Smoothness Refactor

Drafted 2026-07-18.

## Summary

A full-repo analysis (desktop Electron app + Android companion) surfaced ~25 findings across five themes the user asked to improve: DRY, reusable/matching components, consistent state handling, UI smoothness & animation fluidity, and graceful error handling. A first pass of the safe, high-leverage items has **already been implemented** on the `main` working tree (see "Completed in this pass" below). The remaining, higher-risk items are captured here as phased documents so they can be picked up incrementally.

Documents move from `roadmap/roadmap-new/` to `roadmap/roadmap-in-progress/` when work starts, mirroring the `bugs/bug-new` → `bug-in-progress` lifecycle.

### Key findings that shaped this roadmap

**Desktop renderer (`src/renderer/`)**
- Six near-identical delete/discard dialogs re-declared the same focus/Escape/red-icon/footer markup.
- Two competing modal conventions: `ModalShell` (16 users, has focus trap) vs 11 hand-rolled `fixed inset-0` modals.
- All 10 `components/section-pane/*` panes repeat header/search/skeleton/empty-state scaffolding.
- Click-outside logic re-implemented in 7+ files despite `DropdownPanel.tsx` existing.
- Duplicate toast system (`Toast.tsx` local `useToasts` + `Toast` type) shadowing the store's `uiSlice` toasts.
- `hasIpcError` predicate copy-pasted in 3 files vs canonical `isApiError` (`src/shared/types.ts:2261`).
- Error surfacing inconsistent: toast-on-fail vs silent `.catch(() => {})` (16× in `SettingsPanel`) vs rich in-message errors; single app-level `ErrorBoundary` only.
- No chat-list virtualization; `ChatMessages.updateVisibleMessages` did an O(n) `getBoundingClientRect` sweep on every scroll event.
- `framer-motion` used in exactly 1 file; the rest are CSS keyframes; only `stream-fade-in` honoured `prefers-reduced-motion`.

**Main process (`src/main/`)**
- Build-process management cloned between `build-handlers.ts` and `android-handlers.ts` (spawn + log-dedup + close→DB + cancel), plus an identical `rowToRecord`.
- Provider routing ladder (openai→anthropic→compat→azure) reimplemented in `chat-provider-dispatch.ts`, `orchestrator.ts`, and `agent-turn-runner.ts`.
- Provider HTTP plumbing duplicated: `httpsRequest` ×3, HTTP-error parse ×7, Azure functions near-cloning OpenAI, thinking-budget maps ×2.
- ~30 hand-written `rowTo*` snake→camel mappers with no shared helper.
- 137 `broadcastToMobile` calls, usually line-adjacent to an identical `webContents.send`.
- CLI adapters (`claude.ts`/`codex.ts`/`hermes.ts`) each reimplement the spawn + stdout line-buffer + JSONL parse loop; `stripAnsi` copy-pasted ×2.
- 221 empty `catch {}` across 67 files; inconsistent IPC result shapes; `ws-handlers.ts` (3627 lines) has no `safeHandle` equivalent.

**Android companion (`android/`)**
- Five near-verbatim `*GeneratorViewModel.kt` clones (agent/skill/project/schedule/artifact); empty `ui/featuregenerator/` stub.
- `WsRepository.kt` (133KB global `object`): duplicated `WebSocketListener` + reconnect rule across `doConnect`/`doConnectWithFallbacks`; two divergent send paths, one of which silently dropped commands when disconnected.
- ~200 `collectAsState` call sites, zero lifecycle-aware; 70 `runCatching`-to-null with no `Log.e`.
- 319-variant `WsEvent.kt` + 147KB `WsEventParser.kt` hand-mirror the desktop's TS contracts with no codegen.
- OTA update flow collapsed every failure into one message, no download progress, no retry.

## Completed in this pass (not roadmap work — already on the working tree)

| Theme | What shipped |
|---|---|
| DRY / components (renderer) | `ConfirmDialog` (6 dialogs migrated), `useClickOutside` (7 sites + `DropdownPanel`), `section-pane/pane-primitives.tsx` (skeleton/empty adopted across 10 panes), `Button` `dangerSolid` variant, deleted dead `PhaseBar` + duplicate `useToasts`, consolidated `hasIpcError`→`isApiError`. |
| DRY (main) | `build-runner.ts` (shared spawn/log/close/cancel + `mapBuildRecord`), `providers/streaming.ts` + `http-client` `httpsRequestUrl`/`providerHttpError` (OpenAI/Azure/Anthropic HTTP consolidated), `streamProviderMessage` router (orchestrator + agent-turn-runner deduped), `cli-adapters/utils.ts` `createLineBuffer`/`createOpenBlockTracker`/`stripAnsi`, `emit-utils.ts` `emitToAll`, `db-row-mapper.ts` `mapRow`. |
| DRY / state (Android) | Generic `GeneratorViewModel<Spec>` base; all 5 generator ViewModels migrated; empty stub removed. |
| State / errors | Per-surface `ErrorBoundary`s around chat + lazy panels; id-array reducer reference-churn guards; `android:start-command` result-shape normalized to `{ error }`; fire-and-forget promises now logged. |
| Smoothness | rAF-coalesced `ChatMessages` scroll visibility recompute; global `prefers-reduced-motion` opt-out. |
| Android robustness | `collectAsStateWithLifecycle` migration (~200 sites); unified WS listener close-policy + queue-or-fail `send`; `Log.e`/`Log.w` on connection + update failures; OTA per-stage errors, download progress, retry, disconnected messaging, stale-APK pruning. |

Verification for the completed pass: `npm run typecheck`, `npm run lint` (2 pre-existing warnings only), `npm test` (renderer 570 pass), `gradlew testDebugUnitTest` + `assembleDebug` (green).

## Finding → document map

| Deferred item | Document |
|---|---|
| `emitToAll` / `mapRow` full sweeps across all call sites | [REFACTOR_PHASE2_ADOPTION_MIGRATIONS.md](../roadmap-new/REFACTOR_PHASE2_ADOPTION_MIGRATIONS.md) |
| Generator modals / panels → `ModalShell`; pane header/search adoption | [REFACTOR_PHASE2_ADOPTION_MIGRATIONS.md](../roadmap-new/REFACTOR_PHASE2_ADOPTION_MIGRATIONS.md) |
| `registerWsCommand` wrapper; empty-catch triage + ESLint ratchet | [REFACTOR_PHASE3_ERRORS_AND_STATE.md](../roadmap-new/REFACTOR_PHASE3_ERRORS_AND_STATE.md) |
| `reportError` helper for renderer silent catches; `uiSlice` split | [REFACTOR_PHASE3_ERRORS_AND_STATE.md](../roadmap-new/REFACTOR_PHASE3_ERRORS_AND_STATE.md) |
| Motion tokens; framer-motion removal; Android `NexyMotion` | [REFACTOR_PHASE4_UI_SMOOTHNESS_MOTION.md](../roadmap-new/REFACTOR_PHASE4_UI_SMOOTHNESS_MOTION.md) |
| `WsEvent`/`WsEventParser` codegen; WsRepository decomposition/DI; ws-handlers registry | [DEFERRED_WS_PROTOCOL_CODEGEN.md](../roadmap-new/DEFERRED_WS_PROTOCOL_CODEGEN.md) |
| Chat list virtualization; Android bespoke-screen rewrites | [DEFERRED_DEEP_UI_REWRITES.md](../roadmap-new/DEFERRED_DEEP_UI_REWRITES.md) |

## Common verification gates

Every phase's PRs must pass, per `.claude/CLAUDE.md`:
- `npm run typecheck`, `npm run lint`, `npm test` (both Vitest projects).
- Android: `gradlew testDebugUnitTest` (parity/reducer/parser tests are the gates) + `gradlew assembleDebug`.
- App-level smoke via the `nexy-app-check` skill after adoption batches and any perf work.
- Manual visual pass on migrated modals/panes (focus trap, Escape, dark/light) — Vitest won't catch visual regressions.

## Deferred-items register (rationale)

| Item | Why deferred |
|---|---|
| `WsEvent.kt`/`WsEventParser.kt` codegen (319 variants) | Standalone tooling project; blast radius is the whole Android app. Prereq: a shared schema source of truth. |
| `WsRepository` decomposition / DI | 133KB global `object`, 56 UI references, no DI framework in the app — an architecture decision, not a refactor. Acute bugs already fixed on the singleton. |
| `ws-handlers.ts` full registry rewrite | 3627 lines; pairs naturally with the codegen project's shared command registry. |
| Chat list virtualization | Behavioural risk to scroll anchoring / streaming autoscroll; justify via post-rAF-fix profiling. |
| `uiSlice` full split | Catch-all slice works; restructure with render-profiling evidence, not speculatively. |
| Android bespoke-screen rewrites (ChatScreen 86KB, AgentConfigScreen 86KB, ProjectConfigScreen 52KB) | Each is a multi-day UI rewrite with high visual-regression risk; do per-screen. |
