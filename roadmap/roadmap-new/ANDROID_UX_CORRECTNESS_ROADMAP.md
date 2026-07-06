# Android UX & Correctness Roadmap — Connection Modes, Workflows, Settings Clarity

## Context

A hands-on pass of the Android companion app surfaced 8 distinct problems: confusing connection/mode status, a non-functional Manual Workflow Generator, missing descriptions across Project and Agent settings, an awkward settings layout, a broken "Add agent" list, unclear standalone API-key behavior, and inconsistent settings UI components.

A prior roadmap (`roadmap/roadmap-new/ANDROID_UX_PARITY_ROADMAP.md`, `READY_FOR_REVIEW.md`) claimed several of these were already fixed — a standalone-mode toggle, CLI-model filtering, a Manual Workflow screen. Direct investigation of the current code (not the prior roadmap's claims) shows that work is either cosmetic, half-wired, or actively broken:

- The "toggle" is a clickable colored-dot chip, not a switch, and sits directly beside the connection-status chip with no explanation of how the two relate.
- CLI-model filtering logic is fully wired on Android but is a permanent no-op because desktop's `model:list` handler never sets the flag Android filters on — so it has never actually filtered anything.
- The Manual Workflow screen's backend wiring is complete and correct, but a Compose layout bug (`fillMaxSize()` on a sibling placeholder) pushes the chat input and Generate button off-screen whenever there's no active session — which is *every* first visit. It looks unfinished; it's one wrong modifier.
- The "Add agent" list showing repeated "Agent" text is a sync-snapshot key mismatch (Android looks for a `config_json` wrapper key that desktop never sends — desktop flattens agent fields onto the row root and nests project fields under `config`, not `config_json`), not a string-resource or list-rendering bug.
- The standalone provider-key confusion is two different Android screens using two different definitions of "configured" (one merges in desktop's flag, one requires a real local key), plus a key-handoff feature whose WS command name doesn't match between Android and desktop, so accepting a handoff dead-ends.

This roadmap fixes the real root causes first (cheap, high-confidence, unblock everything else), then addresses the mode-clarity redesign, then settings content/layout/consistency — in that order so later phases build on a codebase that isn't lying about its own state to the user.

**Confirmed scope for the Manual Workflow item (per user decision):** fix the Android layout bug to restore parity with desktop's existing generator. Desktop's own "Manual Workflow Generator" is AI-chat-only (no hand-authored step form) and doesn't persist generated plans anywhere on either platform — this roadmap does not add either capability, only fixes the Android-specific regression.

## Validation Policy (every phase)

This is primarily a Kotlin/Compose codebase; only a few phases touch desktop TypeScript. Apply whichever set matches the files changed in that phase — never skip a phase gate:

- **Android** (touched in nearly every phase): `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — this is the project's lint check + typecheck (Kotlin compilation) + build test + unit test suite in one command.
- **Desktop** (only when `src/main/**` or `src/renderer/**` changed): `npm run lint` (eslint) && `npm run typecheck` && `npm test` && `npm run build`.
- **New unit tests are mandatory for every phase that introduces new logic** — not just running the existing suite. Each phase below names what needs new/extended coverage.
- No phase is done until its gate passes with zero new lint warnings and zero skipped tests.

---

## Phase 1 — Critical Bug Fixes (unblocks everything else)

**Goal:** Fix the four root-cause bugs that make later, more visible work (mode redesign, key clarity, workflow polish) meaningless if left in place.

- [x] Fix `ManualWorkflowScreen.kt`'s empty-state layout bug: the placeholder `Column` uses `fillMaxSize()` while the input `OutlinedTextField` + send button are unweighted siblings further down, so the description text consumes the whole screen and pushes the input off-screen on every first visit. Changed the placeholder to `fillMaxWidth()` so the input is always reachable.
- [x] Fix the "Add agent to project" duplicate-"Agent" bug at its real source: `LocalDataRepository.kt` `applySyncSnapshot()` agent branch reads `row.jsonObjectOrString("config_json")`, but desktop's `buildSnapshot()` (`src/main/standalone-sync.ts:381–389`) spreads agent config fields directly onto the row root with no wrapper key. Extracted a testable `agentFieldsFromSnapshotRow()` that reads `name`/`icon`/`backend`/`cliModel` straight off `row`.
- [x] Fix the sibling project-sync bug in the same function: desktop nests project config under a `config` key (`standalone-sync.ts:377`), not `config_json`. Extracted a testable `projectFieldsFromSnapshotRow()` using the corrected key name so `rootDirectory` and other project config actually survive sync instead of always defaulting to null/`"{}"`.
- [x] Fix CLI models leaking into every dropdown in standalone mode: Android's `ModelPickerSheet`/`filterModelsForMode` were correctly wired everywhere already, but desktop's `model:list` handler (`src/main/ws-handlers.ts`, CLI-model construction sites) never set `isCliSourced` on the model objects it sends — so Android's filter (`WsEventParser.kt:281`, `ModelFiltering.kt`) always saw `false` and never excluded anything. Added `isCliSourced: true` to all four Claude-CLI/Codex-CLI model-construction sites.
- [x] Fix the broken consent-gated API-key handoff round trip for the leg that's otherwise fully wired: Android sent WS command `provider:request-key-handoff` with field `providerId` (`WsRepository.kt:1157`), but desktop's dispatcher listens for `provider:key-handoff-confirm` with field `provider` (`src/main/ws-handlers.ts:1160`) — fixed the command name and field name to match. Desktop's reply also used field names (`provider`, `value`) that didn't match Android's parser (`providerId`, `keyValue`) — fixed `WsEventParser.kt`'s `provider:key-handoff-value` (and `-request`) cases to match desktop's actual field names. **Scope note:** deeper investigation found the *other* leg of this feature — desktop proactively notifying Android of an available key, and desktop's own "Send Key" approval button — has no working code path at all (the WS command that would trigger it is never sent by anyone, and the IPC channel the "Send Key" button invokes has no registered handler in `providers.ts`). That's a real design gap (today, once this fix lands, desktop replies with the key immediately on request with zero desktop-side human approval, contradicting the "consent required on both ends" design intent) — left for Phase 3, which already scopes a security review of this exact path.

**Phase gate — ✅ PASSED 2026-07-05**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL in 4m 38s (54 tasks, 0 new warnings)
- [x] Desktop (ws-handlers.ts touched): `npm run lint && npm run typecheck && npm test && npm run build` — all clean (1259 tests passed, build succeeded)
- [x] New/updated unit tests: added `SyncSnapshotFieldsTest.kt` (4 tests) covering `agentFieldsFromSnapshotRow`/`projectFieldsFromSnapshotRow` against desktop-shaped fixtures; added `ProviderKeyHandoffParsingTest.kt` (2 tests) covering the corrected field names; extended `ws-handlers.test.ts`'s `model:list` tests with `isCliSourced` assertions (4 updated + 1 new test)
- [ ] Manual on-device check: open Manual Workflow Generator on a project with no prior session and confirm the input box and Generate button are visible; open "Add agent" and confirm real agent names appear. *(Requires a physical/emulator device — not run in this session.)*

---

## Phase 2 — Connection & Standalone Mode Clarity (Item 1)

**Goal:** Make "connected/connecting/disconnected" (actual reachability) and "remote/standalone" (user's chosen mode) visually and conceptually distinct, with a real toggle instead of a second badge.

- [x] Replace `StandaloneModeToggle.kt`'s clickable colored-dot chip with an actual Material3 `Switch`, matching the `Switch` pattern already established in `GlobalSettingsScreen.kt`'s `GlobalSettingsToggleRow`. Now labeled "Standalone mode" with a real on/off `Switch`, not a second "● Remote"/"● Standalone" text chip that visually mimicked `ConnectionChip`.
- [x] Redesigned `HomeScreen.kt`'s top bar so it shows exactly one status indicator (`ConnectionChip`). The mode toggle was removed from the top bar entirely and moved into the existing connection bottom sheet (opened by tapping the chip), where there's room for the Switch plus its explanatory copy — a clearly separate, distinctly-styled control instead of two same-shaped badges side by side.
- [x] The toggle's subtitle now explains the relationship inline in both states: ON — "Using only your locally-configured API keys. Works without a desktop, but CLI models and desktop file/git context stay unavailable."; OFF — "Using the connected desktop's models and CLI backends when it's reachable." Shown identically everywhere the toggle appears.
- [x] `ConnectionScreen.kt`/`SettingsScreenSections.kt`'s `ConnectionSection` already called the shared `StandaloneModeToggle` composable, so it picked up the Switch redesign and new copy automatically — no separate edit needed there.
- [ ] Manually verify that toggling standalone mode now visibly changes dropdown contents everywhere, since Phase 1 made the filter actually take effect. *(Requires a device — not run in this session.)*

**Phase gate — ✅ PASSED (automated portion) 2026-07-05**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL in 3m 6s, 0 warnings
- [x] New unit/instrumented tests: added `StandaloneModeToggleTest.kt` (androidTest) asserting the control is a real toggleable `Switch` with correct on/off state and copy, and that clicking it invokes the callback with the flipped value. Compiles clean via `lintAnalyzeDebugAndroidTest`; actual execution requires `connectedDebugAndroidTest` on an emulator/device, consistent with this project's existing testing limitation (no device attached in this environment).
- [ ] Manual on-device walkthrough: toggle standalone on/off with the desktop both reachable and unreachable; confirm at a glance which indicator means what. *(Not run in this session.)*

---

## Phase 3 — Standalone API Key Clarity (Item 7)

**Goal:** One consistent definition of "this provider is usable right now," and a working key-handoff flow.

- [x] Reconciled the two conflicting "configured" definitions: `ProviderInfo` gained a `configuredOnDesktopOnly: Boolean` field; `mergeProviders` (extracted to a testable top-level `mergeProviderLists` in `ProvidersViewModel.kt`) now sets `configured` from the real local key only — never from desktop's flag — and sets `configuredOnDesktopOnly` when desktop has it but this device doesn't. `GlobalSettingsScreen.kt` was already local-only-correct and needed no logic change.
- [x] Updated `ProvidersScreen.kt`'s status badge to use the shared `NexyStatusBadge` (retiring the private `ProviderStatusBadge` duplicate's custom `Surface`) with three distinct states: "Connected" (real local key), "Desktop only" (tertiary color, with an explanatory caption), "Not set". Menu text also now distinguishes "Add key on this device" from "Update key on this device", and a "Request key from desktop" action appears only in the desktop-only state.
- [x] Added a direct CTA into both "no usable standalone key" messages in `GlobalSettingsScreen.kt` (the standalone-model picker note and the temperature/max-tokens gating note): an "Open API Providers" button now navigates straight to the key-entry screen instead of leaving a dead end. Wired via a new `onOpenProviders` param threaded through `NavGraph.kt`.
- [x] Designed and wired the missing desktop-approval leg, per your decision to require human approval on both ends:
  - Android's `confirmProviderKeyHandoff()` now sends WS command `provider:key-handoff-request` (not the auto-approving `-confirm`) — this only triggers desktop's existing "Send Key" banner (`ProvidersTab.tsx`), it never transmits the key by itself.
  - Added the missing `safeHandle('provider:key-handoff-confirm', ...)` IPC handler in `providers.ts` — the *only* code path that actually transmits the key value, reachable solely via an explicit "Send Key" click on desktop. It broadcasts `provider:key-handoff-value` to Android and notifies desktop's own windows the key was sent.
  - Removed the old WS-command branch in `ws-handlers.ts` that auto-replied with the key on request with zero human gate (a real security gap Phase 1 surfaced) — its request-side half is unchanged and still shows the desktop banner; its confirm-side half is now exclusively the new IPC handler.
  - Added a "Request key from desktop" action in `ProvidersScreen.kt` for desktop-only-configured providers, giving Android a real entry point into this flow (previously nothing ever triggered it).
- [ ] Run `/security-review` on the key-handoff path before considering it done (new secret-transmission code path). *(Not run in this session — recommend before shipping.)*

**Phase gate — ✅ PASSED (automated portion) 2026-07-06**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL in 4m 36s, 0 new warnings
- [x] Desktop: `npm run lint && npm run typecheck && npm test && npm run build` — all clean (1261 tests passed, up from 1259)
- [x] New unit tests: `ProviderMergeTest.kt` (5 tests) covering local-only/desktop-only/both/neither states and sort order; `providers.test.ts` gained 2 tests for the new `provider:key-handoff-confirm` handler (success path broadcasts + notifies; missing-key path rejects without transmitting)
- [ ] Manual on-device: complete one full key handoff with a real paired desktop. *(Requires a device — not run in this session.)*

---

## Phase 4 — Manual Workflow Generator Parity Verification (Item 2, remaining polish)

**Goal:** Confirm full parity with desktop's existing generator now that Phase 1 fixed the layout bug, and guard against the same class of bug recurring.

- [x] **Found and fixed a deeper parity gap while verifying this**: desktop's `manual-workflow-generator:spec-ready` event already sends the full step data (`prompt`, `agentName`, `expectedOutput`, `id`), but Android's parser discarded everything except a flattened `"title: summary"` string — so even after Phase 1's layout fix, a generated plan had no prompt to act on and no agent/output info, matching desktop's `WorkflowTab.tsx` fields but none of its usefulness. Added `ManualWorkflowStepInfo` (mirrors desktop's `ManualWorkflowStep`), updated the parser to extract all fields, and added a `ManualWorkflowStepCard` composable showing title/agent/output/summary plus a "Copy prompt" action (clipboard, matching desktop's "Copy" button) for each step.
- [x] Confirmed the chat-history area is already bounded/scrollable (`LazyColumn` with `weight(1f)`, `ManualWorkflowScreen.kt:156–166`) — only the empty-state placeholder had the `fillMaxSize()` bug fixed in Phase 1, so no further scroll fix was needed here.
- [x] Added an inline note (shown in the empty state, alongside the existing description) setting the same expectation as desktop: the plan is generated fresh each time and isn't saved, so copy what you need before leaving.
- [x] **Scope note**: "Start in chat" per step (desktop's other action button, which directly launches a chat turn) was deliberately left out — wiring it needs a conversation-creation entry point this screen doesn't have today, and guessing at one risked a half-working feature. "Copy prompt" covers the same underlying need (get the prompt out to use it) with much lower risk. Flagging this as a known, explicitly-scoped-out gap rather than a silent omission.

**Phase gate — ✅ PASSED 2026-07-06**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL in 4m 7s, 0 new warnings
- [x] New/updated tests: extended `ManualWorkflowEventParserTest.kt` (now 7 tests) to verify full step-field parsing instead of the old flattened string; added `ManualWorkflowStepCardTest.kt` (androidTest, 4 tests) covering title/agent/output/summary rendering and Copy-button visibility. Unit tests pass; androidTest compiles clean but requires a device to actually execute (consistent with this project's existing limitation).
- [ ] Manual on-device: full generator flow start-to-finish, including using the Copy action. *(Not run in this session.)*

---

## Phase 5 — Project Settings Layout & Descriptions (Items 3, 4)

**Goal:** Fix the awkward bottom-of-screen link dump and add missing descriptions throughout Project Settings.

- [x] Restructured the 4 bottom items in `ProjectConfigScreen.kt` ("View project changes", "View project wiki", "View project artifacts", "Manual workflow generator" — previously 4 bare `TextButton`s under a comment literally noting "not collapsible") into a proper "Project Tools" `NexyExpandableSection`, matching every other section on this screen. Used `SettingsNavRow` (already defined in `SettingsScreenSections.kt`, module-internal) instead of building new markup — it already provides exactly the title + one-line description + chevron + divider shape this needed.
- [x] Verified the actual semantics before writing descriptions (rather than guessing) by reading `chat-context-builder.ts` and `orchestrator.ts`, then added descriptions to every previously-undocumented project option:
  - Instruction mode dropdown — describes exactly what each of the 4 modes does to the assembled prompt (confirmed `replace` and `standalone` currently behave identically in the code — described accurately as such rather than inventing a fictitious distinction)
  - Paths / root directory — what it's used for and what happens when left blank
  - Variables — clarified substitution applies to chat messages, project instructions, *and* the workflow generator (confirmed in code — broader than it first appeared)
  - Scope (in/out glob rules) — confirmed these are injected into every chat message, with "out of scope" as a hard instruction, not just descriptive metadata
  - Milestones — confirmed the "active" milestone is injected into every chat message
  - Max delegation depth — what the 1–10 number controls and the cost/latency tradeoff
  - Agents list "Set primary" — confirmed via `orchestrator.ts` that "primary" means the orchestration leader, described accordingly
  - The 4 relocated bottom items — via their new `SettingsNavRow` descriptions
- [x] Left the fields that already had descriptions (Enable instructions, Orchestration, Show team activity) untouched as the copy-style baseline.

**Phase gate — ✅ PASSED 2026-07-06**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL in 2m 55s, 0 warnings
- [ ] New unit/UI test: skipped deliberately — the relocated section and every new description are assembled entirely from already-tested shared components (`NexyExpandableSection`, `SettingsNavRow`) with no new logic of their own; a dedicated Compose test would just re-verify those components render, which they already have coverage for. Flagging this explicitly rather than silently skipping it.
- [ ] Manual: read through Project Settings top-to-bottom confirming every option explains itself and the bottom section no longer looks crammed in. *(Not run in this session.)*

---

## Phase 6 — Agent Settings Descriptions (Item 6)

**Goal:** Every agent-config option explains what it does and why you'd change it.

- [x] Added a `helperText` slot to `NexyInputValidation` (`NexyUx.kt:449+`) — shown as a caption below the field, automatically suppressed whenever `errorMessage` is present so the two never compete for the same space.
- [x] Ported the confirmed-accurate desktop copy from `SettingsTab.tsx` into the matching `AgentConfigScreen.kt` fields: Memory ("Always appended to the system prompt in every message..."), Backend ("CLI tool must be installed and authenticated..."), Thinking effort ("Extended reasoning... Claude CLI, Anthropic, and o-series models"), Root directory ("Working directory for CLI tool execution... project's own root directory takes priority").
- [x] Wrote new descriptive copy for the previously-undocumented fields — but verified actual behavior in the source first rather than guessing, and one turned out not to match assumptions: `responseFormat` (Response format) is stored and offered as a dropdown on both platforms but is **never actually read when building a prompt** (confirmed via search across `chat-context-builder.ts`, `chat-handlers.ts`, `providers.ts`) — the description says so honestly ("doesn't currently change the model's actual output") instead of inventing plausible-sounding behavior that isn't real. Also added: Max tokens, Temperature, Approval level (Auto/Always ask/Disabled), MCP server trust level (Auto/Always ask/Block), Custom Commands purpose.
- [x] Covered the remaining bare fields from the audit: Icon, Backend section intro, CLI model, Skills section (corrected from an assumed "order = priority override" to the actually-verified behavior — skill instructions are concatenated into the system prompt in list order), Context directories/files, Tool instructions field, Knowledge Files section.

**Phase gate — ✅ PASSED 2026-07-06**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL in 3m 3s, 0 warnings
- [x] New test: `NexyInputValidationTest.kt` (androidTest, 2 tests) verifying helper text displays when no error, and that an error message takes precedence over helper text. Compiles clean; execution requires a device (consistent with this project's existing limitation).
- [ ] Manual: read through Agent Settings top-to-bottom confirming every option explains itself. *(Not run in this session.)*

---

## Phase 7 — Settings UI Consistency Sweep (Item 8)

**Goal:** One shared component set and spacing scale across all Settings screens.

- [x] Added `NexySpacing` (`ui/theme/Spacing.kt`, 4/8/12/16/24dp scale) alongside `Theme.kt`/`Type.kt`. Applied it isn't yet blanket-rolled out across every existing dp literal in the app — doing that as a repo-wide sweep with no device available to visually verify each screen would be a large, risky diff for a token-consistency change. The token now exists as the canonical reference for new/touched code; broader migration is left as incremental follow-up rather than a risky one-shot rewrite.
- [x] Standardized on `NexyListRow` as the canonical row for content needing custom leading/trailing slots (extended it with `leading` and `subtitleContent` composable params — previously subtitle was plain-`String`-only and there was no leading slot, which is exactly why `ProvidersScreen`/`CliModelsScreen` never adopted it and hand-rolled their own instead). `SettingsNavRow` remains canonical for simple always-clickable title+detail+chevron rows (already reused for Phase 5's Project Tools section).
- [x] Refactored `ProvidersScreen.kt`'s `ProviderRow`: replaced the custom `Surface`+`Row` with alternating stripe coloring (`index % 2 == 0`) with `NexyListRow` (badge + caption as `subtitleContent`, the "⋮" menu as `trailing`); removed the now-unused `index` parameter and switched `itemsIndexed` back to `items`.
- [x] Refactored `CliModelsScreen.kt`'s `CliModelRow` the same way: the installed/not-found icon badge is now `leading`, version/path is `subtitleContent`, the status label is `trailing` — same dead code (`index`, alternating stripe) removed.
- [x] Refactored `ConnectionScreen.kt`: "Local data and synchronization" now uses `SettingsSectionHeader` instead of a raw `Text(titleSmall)`; the "Discard local change?" `AlertDialog` is now `NexyConfirmDialog`, matching the destructive-confirm pattern used elsewhere (e.g. `ProvidersScreen.kt`).
- [x] Refactored `BackupRecoveryScreen.kt` (previously a flat `Column`, no sectioning) onto the `SettingsSectionHeader`/`Surface` pattern already used consistently by `AppearanceScreen.kt`/`UpdatesScreen.kt`/`NotificationsScreen.kt`.
- [x] Cleaned up stray fully-qualified `androidx.compose.ui.Modifier...` references in favor of a proper import: `ConnectionScreen.kt`, `AppearanceScreen.kt`, `UpdatesScreen.kt`, `NotificationsScreen.kt`.

**Phase gate — ✅ PASSED 2026-07-06**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL, 0 warnings
- [x] New test: `NexyListRowTest.kt` (androidTest, 4 tests) covering the new `leading`/`subtitleContent` slots, precedence over plain `subtitle`, and click handling — a regression guard against `ProvidersScreen`/`CliModelsScreen` re-diverging onto bespoke row implementations again.
- [ ] Manual: side-by-side visual pass across every touched settings screen confirming consistent padding/typography/row style. *(Not run in this session — no device available.)*

---

## Phase 8 — Final Regression, Parity Re-Audit & Docs

**Goal:** Confirm the whole set of 8 original complaints is actually resolved, not just individually plausible in isolation.

- [x] Re-ran the full validation matrix (desktop + Android) across the entire branch, not just per-phase deltas.
- [ ] Manually re-walk all 8 original user-reported issues end-to-end on-device against this roadmap's numbering. *(No device/emulator available in this session — see "Known gaps" below.)*
- [x] Updated `roadmap/roadmap-new/ANDROID_DESKTOP_PARITY_MATRIX.md` (added a dated note pointing to this roadmap for the corrected status of the Providers/Connection/Standalone items it covers) and `docs/android-standalone.md` (added "Standalone mode toggle" section and expanded "Direct provider chat" with the configured-locally-vs-desktop-only distinction and the key-handoff flow).
- [x] Confirmed-out-of-scope items, recorded here so they aren't silently re-attempted later:
  - No hand-authored (non-AI) workflow step editor, and no persistence of generated workflow plans — confirmed as a decision in Phase 4, matching desktop's own existing behavior on both counts.
  - "Start in chat" per workflow step (desktop has this; Android only got "Copy prompt") — needs a conversation-creation entry point this screen doesn't have; flagged in Phase 4 rather than guessed at.
  - Full app-wide adoption of `NexySpacing` tokens — introduced the token file and used it as the reference, but did not rewrite every existing dp literal across the app (Phase 7) to avoid an unverifiable, risky repo-wide diff.
  - Android consent-only alternative to desktop approval for key handoff — Phase 3 implemented the "desktop must approve" design per your decision; the simpler "Android consent only" alternative was explicitly not built.

**Phase gate — ✅ PASSED (automated portion) 2026-07-06**
- [x] Android: `cd android && .\gradlew.bat lint testDebugUnitTest assembleDebug` — BUILD SUCCESSFUL, 0 warnings. 203 unit tests passing across 35 test files (up from ~180 before this roadmap).
- [x] Desktop: `npm run lint && npm run typecheck && npm test && npm run build` — all clean. 1261 tests passing (up from 1259 before this roadmap).
- [ ] Full manual acceptance pass against the original 8 numbered complaints. *(Not run in this session — every phase above notes this same gap. Recommended before shipping: install the debug APK on a device/emulator and walk through items 1–8 against this app's actual behavior, plus run `connectedDebugAndroidTest` for the ~15 new androidTest cases added across this roadmap.)*

---

## Summary

All 8 reported issues were traced to real, verifiable root causes (not just polish) and fixed:

1. **Connection/standalone mode confusion** — the "toggle" was a second status-chip look-alike; now a real `Switch`, moved out of the top bar into the connection sheet, with copy explaining what each mode means.
2. **Manual workflow generator unusable** — a Compose layout bug hid the input box; fixed, plus a deeper gap found and fixed where generated steps' prompts/agent/output were parsed and then discarded, leaving nothing to act on.
3. **Project options lacked descriptions** — added, verifying real behavior in the source for each (and correcting two wrong assumptions in the process: `replace`/`standalone` instruction modes are currently identical, and skill order affects prompt concatenation order, not a priority override).
4. **Awkward bottom-of-screen links** — regrouped into a proper expandable "Project Tools" section using the existing `SettingsNavRow` component.
5. **"Add agent" showing duplicate names** — a sync-snapshot field-name mismatch, not a rendering bug; fixed at the source.
6. **Agent settings lacked descriptions** — added across ~20 fields, porting confirmed-accurate desktop copy where it existed and writing new copy where it didn't (including honestly documenting that "Response format" doesn't currently do anything, rather than inventing behavior).
7. **Standalone API key confusion** — two screens disagreed on what "configured" meant; unified, plus discovered and fixed that the key-handoff feature had no working human-approval step on either platform.
8. **Inconsistent settings UI** — introduced a spacing token file, extended and finally wired up the previously-unused `NexyListRow`, and retired duplicated hand-rolled row/dialog code in four screens.

Every phase's automated gate (Android `lint`/`testDebugUnitTest`/`assembleDebug`, desktop `lint`/`typecheck`/`test`/`build`) passed with zero regressions and zero new warnings. The one consistently-skipped gate across every phase is on-device manual verification and `connectedDebugAndroidTest` execution — this environment has no attached emulator/device, matching a limitation already documented in `ANDROID_STANDALONE_ROADMAP.md`. Treat this roadmap's fixes as code-verified, not yet UX-verified on a real device.
