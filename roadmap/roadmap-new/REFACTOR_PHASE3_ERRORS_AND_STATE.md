# Roadmap: Phase 3 — Error Handling & State Consistency

Drafted 2026-07-18. **Status: PARTIAL — acute fixes landed; systemic hardening below.**

## Summary

Phase 3 makes error handling graceful and consistent across both platforms. The acute, user-visible bugs are **already fixed** (per-surface error boundaries, silent-drop WS send, id-array re-render churn, success-shaped-with-error IPC returns, OTA per-stage errors). The remaining work is systemic: a uniform renderer error-reporting pattern, a WS-command safety wrapper for the mobile surface, and a lint ratchet to stop new silent catches accruing.

## Landed already

- Renderer: `ErrorBoundary` now wraps `ChatWindow` and the lazy panel/modal `Suspense` block separately (was app-root only). Reducer reference-churn guards added to `markConversationDoneGenerating`/`clearConversationPending` (mirroring the `markConversationRead` fix).
- Main: `android:start-command` throws (safeHandle → `{ error }`) instead of returning `{ buildId, error }`; renderer callsite surfaces it via toast. Fire-and-forget promises (`publishArtifactToFeed`, Anthropic model refresh) now `.catch`→`debugLog`.
- Android: unified WS `onClosed` close-code policy across both connect paths; `send()` now queues-or-fails instead of silently dropping; `Log.e`/`Log.w` on connection + update failures; OTA flow got typed `UpdateException` stages, download progress, retry flag, disconnected messaging, stale-APK pruning.

## Issue → item map (remaining)

| # | Issue | Priority · Effort · Risk |
|---|---|---|
| 1 | Renderer `reportError`/`useApiCall` pattern for silent `.catch(() => {})` | P2 · M · med |
| 2 | `registerWsCommand` wrapper for `ws-handlers.ts` | P2 · M · med |
| 3 | Empty-`catch {}` triage + ESLint `no-empty` ratchet | P2 · M · low |
| 4 | Raw `ipcMain.handle` → sender-validated wrapper (window controls) | P3 · S · low |
| 5 | `uiSlice` catch-all split (model catalog + conversation-status out) | P3 · M · med |

---

## Item 1 — Renderer `reportError` pattern

**Goal:** Replace the ~16 silent `.catch(() => {})` in `SettingsPanel.tsx` and the 5 in `store/app-store.ts` `hydrate` with a single helper that checks `isApiError`, toasts via `uiSlice`, and logs. Best-effort reads (theme load) stay silent but go through an explicit `ignoreError()` marker so intent is visible.

**Key changes:** Add `reportError(scope, err, toastMessage?)` to the store or a `hooks/useApiCall.ts`. `hydrate` failures should surface a degraded-state toast rather than vanishing. Audit each existing silent catch and classify: surface / ignore-explicitly.

**Acceptance criteria:** A forced IPC failure in Settings shows a toast; hydrate failure shows a degraded-state notice; no bare `.catch(() => {})` remains in `SettingsPanel`/`app-store` (enforced by review).

## Item 2 — `registerWsCommand` wrapper

**Goal:** `ws-handlers.ts` (3627 lines, ~357 hand-written try/catch sites) has no `safeHandle` equivalent, so mobile error shaping is entirely independent of the IPC path. Introduce `registerWsCommand(name, handler)` that catches, logs, and replies with a uniform `{ event, error }` envelope.

**Key changes:** Add the registry helper alongside `ws-server.ts`; convert the ~20 highest-traffic commands first (chat send, generator start/confirm, project/agent CRUD). Full conversion is tracked with the codegen project ([DEFERRED_WS_PROTOCOL_CODEGEN.md](DEFERRED_WS_PROTOCOL_CODEGEN.md)).

**Acceptance criteria:** Converted commands return the uniform error envelope on throw; Android `ProviderTestResult`-style consumers still parse; parser fixture tests unaffected.

## Item 3 — Empty-catch triage + ratchet

**Goal:** 221 empty `catch {}` across 67 files hide regressions (notably provider stream parsers swallowing parse errors — already the one mandatory fix). Triage the rest and add an ESLint `no-empty` (allowEmptyCatch:false) rule so new ones can't accrue.

**Key changes:** Introduce a `logSwallowed(scope, err)` debug logger; convert genuinely-best-effort catches to explicit `/* intentional: <reason> */`. Enable the lint rule with an allowlist of the reviewed remainder, then burn the allowlist down over time.

**Acceptance criteria:** `no-empty` enabled; provider stream parsers log malformed chunks at debug level; lint passes.

## Item 4 — Raw `ipcMain.handle` wrapper

**Goal:** `index.ts:244–269` (window controls) and `screen-capture.ts:86` bypass `safeHandle`'s sender validation + error shaping. They already call `validateSender` inline, but a thin `safeHandleRaw` (validate + try/catch, no return-shape assumption for void ops) would make the pattern uniform.

**Acceptance criteria:** Window controls behave identically; sender validation centralized.

## Item 5 — `uiSlice` split

**Goal:** `uiSlice.ts` (362 lines) is a catch-all (theme, toasts, tool approvals, per-conversation status arrays, model catalog). Extract model-catalog and conversation-status tracking into their own slices to shrink its surface. **Do only with render-profiling evidence** — see [DEFERRED_DEEP_UI_REWRITES.md](DEFERRED_DEEP_UI_REWRITES.md).

**Acceptance criteria:** Store hydration unchanged; all slice tests pass; no new re-render regressions.

## Verification

Per-batch gates as in README. For Item 2, drive a mobile command end-to-end via `nexy-app-check` connected-mode smoke.
