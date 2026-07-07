# Round 4 Hands-On Fixes — Quiz/Debrief Crashes, Sync Loop, App Icon, CLI Models Styling

## Context

A live test session against both running apps (desktop + Android, connected) surfaced 5 concrete bugs, each root-caused via direct investigation (no guessing):

1. **"Quiz me on this"** throws `Cannot read properties of undefined (reading 'length')`.
2. **"Debrief session"** throws `result.commandsTools is not iterable`.
3. **Live sync loop**: desktop console spams `[ws] command: sync:push` multiple times/sec; Android shows a flickering "Syncing N changes…" banner.
4. **Android launcher icon** looks like an oversized "N" that spans outside its circular mask, unlike the clean desktop icon.
5. **CLI Models settings screen** has inconsistent row heights and checkbox-like icons instead of the `ProvidersScreen` badge style.

### Root causes (confirmed via code reading, not speculation)

**1 & 2 — same bug pattern.** `src/main/safe-handle.ts` converts any thrown `Error` into a *resolved* `{ error: string }`, not a rejected promise. Every IPC call site in the codebase checks `isApiError(result)` before touching success-shaped fields — except `QuizModal.tsx` and `DebriefModal.tsx`. When the main process throws (`No debrief found — generate a debrief first.` for Quiz; `Conversation has no messages to debrief` / `Failed to parse debrief JSON` / no-provider for Debrief), these two modals skip straight to `res.questions.length` / `[...result.commandsTools]` on the error object, crashing instead of showing the real message. Confirmed this predates the recent DebriefModal intro-step change (the `.then()` body is byte-for-byte unchanged in `git diff`).

**3 — sync tight loop.** In `LocalDataRepository.discardOrphanedOperations()` (`android/.../data/local/LocalDataRepository.kt:250-266`), any failed operation that isn't a message referencing a deleted conversation falls into `else { retryOperation(op.operationId) }`. `retryOperation` → `SyncDao.retry()` (`LocalDaos.kt:226-227`) runs `UPDATE ... SET state='pending', nextAttemptAt=0`, which **erases the exponential backoff that `markFailed()` just wrote** moments earlier in the same `SyncError` handler (`WsRepository.kt:533-547`). That handler then unconditionally calls `flushStandaloneOutbox()`, which re-reads `pendingOutbox(now, limit)` (`nextAttemptAt <= now`) — since `nextAttemptAt` was just reset to 0, the same operation is instantly eligible again. Result: push → error → markFailed(backoff) → retry(wipes backoff) → flush → push → … forever, for any non-message (or non-orphaned-message) failure. The Android banner flicker is a faithful reflection of the outbox row's `state` thrashing `pending`↔`failed`.

**4 — icon.** `android/app/src/main/res/drawable/ic_launcher_foreground.xml` is a 108×108dp viewport with the "N" glyph's bounding box at x:[22,86] y:[20,88] — a direct port of the desktop icon's flat-canvas proportions (where the glyph fills ~62% of a plain square, correct for a non-masked PNG). Adaptive icons guarantee only an inner safe zone of ~66dp diameter (33dp radius from center 54,54); the glyph's corners sit ~46.7dp from center — well outside that, so circular/squircle launcher masks clip the bar corners. `minSdk = 26`, so 100% of supported devices render via this adaptive XML (the legacy static `mipmap-*/ic_launcher.webp` rasters are effectively dead weight, unused at runtime, not worth regenerating).

**5 — CLI Models styling.** `NexyListRow` itself has no fixed height — height is purely a function of what each caller passes into `subtitleContent`. `ProvidersScreen`'s `ProviderRow` renders a `subtitleContent` that's (almost) always exactly one line — a `NexyStatusBadge`. `CliModelsScreen`'s `CliModelRow` instead renders a `leading` icon swatch (`Icons.Default.Check`/`Close` in a colored square — this is what reads as a "checkbox") plus a `subtitleContent` with 0, 1, or 2 conditional text lines (`version`, `path` shown independently) plus a separate `trailing` "Installed"/"Not found" text — three different places encoding overlapping information, and up to 2 variable subtitle lines versus Providers' near-constant 1.

## Fix plan

### Phase 1 — Quiz & Debrief: surface real errors instead of crashing

- `src/renderer/components/QuizModal.tsx`: in the `window.api.generateQuiz(...).then((res) => ...)` callback, add `if (isApiError(res)) { setError(res.error); return }` before accessing `res.questions`, importing `isApiError` from `@shared/types` (matches the pattern already used in `skillSlice.ts`, `ChatWindow.tsx:920`, `SchedulerTaskForm.tsx:75`).
- `src/renderer/components/DebriefModal.tsx`: same guard in the `window.api.generateDebrief(...).then((result) => ...)` callback before spreading `result.commandsTools` — `if (isApiError(result)) { setError(result.error); return }`.
- No main-process changes needed — the underlying thrown messages (`No debrief found — generate a debrief first.`, `Conversation has no messages to debrief`, `Failed to parse debrief JSON from AI response`, no-provider message) are already clear; they just need to reach the UI's existing `error` state/display instead of being masked by a crash.
- **Verify the Android variants too.** Android's Quiz/Debrief flows go over the WS protocol rather than desktop's IPC (`android/.../ui/quiz/QuizViewModel.kt`, `android/.../ui/debrief/DebriefViewModel.kt`), and the desktop WS command handlers (`ws-handlers.ts:2560-2605`) already `.catch()` failures into distinct `quiz:error`/`debrief:error` events rather than folding them into the success shape — `QuizViewModel` and `DebriefViewModel` already branch on `WsEvent.QuizError`/`WsEvent.DebriefError` into an `Error` UI state, so this specific bug pattern (crashing on an error-shaped success object) looks structurally not applicable there. That's a read of the code, not a live test — confirm on-device that triggering Quiz/Debrief from Android with no prior debrief / no messages / no provider configured actually surfaces the error message cleanly and doesn't crash or hang, the same scenarios that broke on desktop.

**Phase gate — ✅ PASSED 2026-07-06:** `npm run lint && npm run typecheck && npm test && npm run build` all green (1269 tests). Added a regression test to each of `QuizModal.test.tsx`/`DebriefModal.test.tsx` asserting an `{ error }`-shaped IPC response sets the error state and does not throw. Android's Quiz/Debrief flows confirmed structurally unaffected by code reading (WS-event architecture, not IPC) — on-device confirmation still outstanding, no emulator/device available in this environment.

### Phase 2 — Kill the sync tight loop (Android)

- `LocalDataRepository.discardOrphanedOperations()` (`LocalDataRepository.kt:250-266`): remove the `else { retryOperation(op.operationId) }` branch entirely. A non-orphaned failed operation is already correctly left in `state='failed'` with the proper backoff `nextAttemptAt` from the preceding `markFailed()` loop — nothing further needs to happen to it; it becomes naturally eligible again once its backoff elapses, since `pendingOutbox()`'s query already matches `state IN ('pending','failed')`. `retryOperation`/`SyncDao.retry()` stays reserved for the user-initiated "Retry change" button, where an explicit `nextAttemptAt=0` reset is the intended behavior.
- Leave the `WsRepository.SyncError` handler's `flushStandaloneOutbox()` call as-is — with the backoff no longer being wiped, it's now harmless (finds nothing newly eligible from the just-failed batch) and still useful for pushing any other pending operations queued behind it.
- Update the stale comment at `LocalDataRepository.kt:245-249` ("reset to pending so it retries on its own") to describe the corrected behavior (retries once its backoff elapses on a future flush trigger, not instantly).

**Phase gate — ✅ PASSED 2026-07-06:** `lint testDebugUnitTest assembleDebug` all green (0 lint issues, 230 tests). Added `markFailedBackoffExcludesOperationFromPendingOutboxUntilItElapses` (instrumented, `NexyDatabaseTest.kt`) asserting `markFailed()`'s backoff holds until it elapses at the DAO level, and that `retry()` (the user-initiated path, correctly left untouched) is what resets it — this is exactly the invariant `discardOrphanedOperations()` now relies on by no longer calling `retryOperation()` on non-orphaned failures. Manual on-device reproduction of the live loop still outstanding, no device available in this environment.

### Phase 3 — Android launcher icon: fit the glyph inside the adaptive-icon safe zone

- `android/app/src/main/res/drawable/ic_launcher_foreground.xml`: rescale the "N" path ~0.65× toward the viewport center (54,54), keeping it centered and preserving proportions, so the bar corners land inside the ~33dp safe-zone radius instead of ~46.7dp. New path (replaces the existing `pathData`):
  ```
  M 33.2,31.9 L 41,31.9 L 41,76.1 L 33.2,76.1 Z
  M 67,31.9 L 74.8,31.9 L 74.8,76.1 L 67,76.1 Z
  M 41,31.9 L 50.1,31.9 L 67,76.1 L 57.9,76.1 Z
  ```
  (Background layer and colors are untouched — only the foreground glyph's coordinates change.)
- No changes needed to the static `mipmap-*/ic_launcher*.webp` fallbacks — `minSdk = 26` means every supported device renders the adaptive XML, not these legacy rasters.

**Phase gate — ✅ PASSED 2026-07-06 (build only):** `assembleDebug` succeeds. Visual on-device confirmation that the N no longer clips still outstanding, no emulator/device available in this environment.

### Phase 4 — CLI Models screen: match Providers' fixed-height badge pattern

- `android/app/src/main/java/io/nexy/android/ui/settings/CliModelsScreen.kt`, `CliModelRow`: remove the `leading` check/close icon swatch (the checkbox-like element) and the separate `trailing` "Installed"/"Not found" text. Replace with a `CliStatusBadge(installed: Boolean)` composable mirroring `ProvidersScreen.kt`'s `ProviderStatusBadge` (`NexyStatusBadge` with `"Installed"`/`"Not found"` labels, `primary`/`onSurfaceVariant` colors at 0.15 alpha container — same visual language as `"Connected"`/`"Not set"`).
- Collapse `version`/`path` into a single optional second subtitle line (e.g. `"v1.2.3 · /usr/local/bin/claude"`, joining only the non-null parts with `" · "`), so each row has at most 2 subtitle lines — badge (always) + one optional detail line — matching `ProviderRow`'s own "badge, plus optional one more line" shape and its resulting height consistency.

**Phase gate — ✅ PASSED 2026-07-06:** `lint testDebugUnitTest assembleDebug` all green (0 lint issues, 230 tests). Added `CliModelRowTest.kt` (instrumented, mirrors `McpServersScreenRowTest.kt`'s pattern) asserting the badge renders with the right label for both installed/not-found states. Note: this new test — like 7 pre-existing Compose androidTest files from earlier rounds (`ConnectionChipTest.kt`, `McpServersScreenRowTest.kt`, etc.) — compiles cleanly on its own but `compileDebugAndroidTestKotlin` as a whole fails in this environment due to a pre-existing, unrelated Compose-UI-testing dependency resolution issue that predates this roadmap and was never caught because it's outside the `lint testDebugUnitTest assembleDebug` gate. Not fixed here (out of scope); flagged for a separate look. Manual: side-by-side visual check of Providers vs. CLI Models rows still outstanding, no device available in this environment.

### Phase 5 — Final regression

- Re-run both validation gates end-to-end (Android: `lint testDebugUnitTest assembleDebug`; Desktop: `lint && typecheck && test && build`).
- Manually re-walk all 5 items: trigger Quiz/Debrief on a conversation with no prior debrief and confirm a clear error message (not a crash); watch desktop console + Android banner during a sync failure and confirm no tight loop; visually check the launcher icon and the CLI Models screen.

**Phase gate — ✅ PASSED 2026-07-06 (automated only):** Android — 0 lint issues, 230/230 unit tests, `assembleDebug` succeeds. Desktop — lint clean, typecheck clean, 1269/1269 tests, production build succeeds. **Outstanding, not achievable in this environment:** all 5 items' manual/on-device/visual confirmation (no Android emulator or device, no way to run the live desktop+Android connected repro for the sync loop) — these are called out per-phase above rather than claimed as done.

**Leave changes uncommitted** (matches this session's established convention) unless told otherwise.
