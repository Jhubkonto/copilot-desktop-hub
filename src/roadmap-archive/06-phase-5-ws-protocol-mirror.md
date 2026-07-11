# Phase 5 — Cross-Platform WS Protocol Mirror

Status: **DONE**. Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases.

## Implementation notes

**Desktop (`ws-handlers.ts`)**: `automated-workflow-runs:list` now accepts a null/omitted `projectId` (project-less listing) instead of requiring one; new `automated-workflow-runs:list-all` (mirrors `listAllAutomatedWorkflowRuns()`); `automated-workflow-runs:save-spec` no longer requires `projectId`. New `scheduler:list-workflow-templates` returns the same global run list for the "attach an existing workflow" picker. `scheduler:create`/`scheduler:update` needed **no changes at all** — they already pass the whole payload straight through to `dbCreateTask`/`dbUpdateTask` as a generically-typed input object, so `targetType`/`workflowSpecs` flow through automatically once Android's UI (Phase 7) includes them in the JSON it sends.

**Android data models**: `AutomatedWorkflowRunInfo.projectId` → `String?`; `AutomatedWorkflowRunStepData`/`AutomatedWorkflowStepInfo` gained nullable `model`; `ScheduledTask` gained `targetType`/`workflowSpecs` (new `ScheduledTaskWorkflowSpec` data class); `ScheduledRun` gained `workflowRunIds`; `ScheduleGeneratorSpec` gained `targetType`/`sourceRunId`. New `WsEvent` types: `AutomatedWorkflowRunsListAll`, `SchedulerWorkflowTemplates`.

**Android parsing (`WsEventParser.kt`) — the actual bug this phase was designed to catch**: `parseAutomatedWorkflowRun`'s `projectId = obj.optString("projectId")` and the `"automated-workflow-runs:list"` case's `data?.optString("projectId") ?: return` both silently coerced a JSON `null` to `""` (empty string) rather than a real Kotlin `null` — `optString` never returns null. Both fixed to use `nullableString`. Added parse cases for `automated-workflow-runs:list-all` and `scheduler:list-workflow-templates`. Added `model` parsing to both step-shaped parsers, `targetType`/`workflowSpecs` to `parseScheduledTask`, `workflowRunIds` to `parseScheduledRun`, `targetType`/`sourceRunId` to `parseScheduleGeneratorSpec`.

**Android repository (`WsRepository.kt`)**: `saveAutomatedWorkflowRun`/`listAutomatedWorkflowRuns` take `projectId: String?`, omitting the key entirely (not sending an explicit JSON null) when absent — matches desktop's `typeof data.projectId === 'string' ? ... : null` treatment of "missing" and "null" as the same thing. New `listAllAutomatedWorkflowRuns()`/`schedulerListWorkflowTemplates()`. Found and fixed **two** `ScheduleGeneratorSpec.toPayload()` implementations (one top-level in `WsRepository.kt`, one private inside `ScheduleGeneratorViewModel.kt` used by `confirmSpec()`) — both needed `targetType`/`sourceRunId` added, or a user confirming a workflow-targeted schedule spec would have silently had those fields dropped on the way back to the server.

**Compile-time fallout found and fixed**: `ChatScreen.kt`'s workflow banner "View" button called `onOpenAutomatedWorkflow?.invoke(bannerRun.projectId)` — broke once `projectId` became nullable; fixed with `bannerRun.projectId?.let { ... }` (the banner only ever shows for a run tied to the current chat's project in practice, but the type system can't know that, so this degrades gracefully instead of force-unwrapping).

**Verification result**: `ws-handlers.test.ts` — added 3 tests (`:list-all` returns every run, `:list` treats a missing projectId as project-less rather than an error, `scheduler:list-workflow-templates` replies with candidates). Full `main` suite: 786/786 passed (783 + 3 new). Android: `compileDebugKotlin`, `compileDebugUnitTestKotlin`, and `testDebugUnitTest` all succeed with no new warnings beyond one pre-existing, unrelated one.

## Goal

Mirror every new/changed IPC channel from Phases 1-4 into the WebSocket protocol (`src/main/ws-handlers.ts`) and the Android Kotlin client (`WsEventParser.kt`, `WsEvent.kt`, `WsRepository.kt`), so the Android app can drive and observe the new capabilities exactly like the desktop renderer does over IPC.

## Depends on / Blocks

- **Depends on**: Phases 2-4 (the IPC surface and data shapes being mirrored must be finalized — this phase should not run concurrently with changes to what it's mirroring).
- **Blocks**: Phase 6 and Phase 7 both need this phase's WS commands to exist before their UI can call them.
- **Must ship in the same release as Phase 6 and Phase 7** — see the cross-cutting constraint in `00-overview-and-sequencing.md`. This is not a soft recommendation: `src/main/ws-server.ts` does raw string-matching on command names with no protocol versioning, so a desktop build with this phase's changes deployed against an Android build still on the old shapes (or vice versa) will silently break, not gracefully degrade or version-negotiate.

## Architectural design choices & reasoning

1. **Why every change needs a hand-written mirror rather than a shared schema/codegen approach**: this is an existing, pre-established constraint of the codebase, not a choice made by this roadmap — `ws-handlers.ts` dispatches via sequential `if (command === '...')` string checks, and the Android side hand-parses JSON payloads in Kotlin. There's no shared IDL or codegen step today. This phase follows that existing (imperfect but consistent) pattern rather than introducing a new one mid-roadmap.
2. **Widening an existing command's payload shape (e.g. `projectId: string` → `string | null`) is riskier than adding a brand-new command.** A brand-new Android build simply won't send/expect a field it doesn't know about yet; but an *existing* field changing its nullability means the Android JSON parser must be updated to tolerate a `null` or absent value it previously always expected non-null — a naive Kotlin `!!`-style force-unwrap or a `require(field != null)` assumption anywhere in the existing parse path will crash on the first project-less run it encounters. Auditing existing parse code for this class of assumption is as important as adding the new fields.
3. **New commands needed, concretely**: `automated-workflow-runs:list-all` (global listing), widened `automated-workflow-runs:save-spec`/`:list`/`:get` (nullable `projectId`), widened `scheduler:create`/`:update` (new `targetType`/`workflowSpecs` fields), and likely a new `scheduler:list-workflow-templates`-style command so the "attach existing workflow to a schedule" picker (Phase 6/7 UI) can fetch candidate runs over WS — Android has no direct DB access, everything must go through this bridge.
4. **The manual smoke-test matrix (mismatched builds) is the actual mitigation for the lack of versioning, not a nice-to-have.** Since there's no protocol version negotiation, the only way to catch a breaking mismatch before a real user does is to deliberately pair an old client against a new server (and vice versa) and watch what happens. This should become a standing item on this project's release checklist generally, not just a one-time check for this feature.

## Itemized todo checklist

### Desktop WS handlers (`src/main/ws-handlers.ts`)
- [ ] Add `automated-workflow-runs:list-all` — wraps `listAllAutomatedWorkflowRuns()` (Phase 2), no project filter.
- [ ] Widen `automated-workflow-runs:save-spec`/`:list`/`:get` handlers to accept/pass through `projectId: string | null` instead of assuming a string.
- [ ] Widen `scheduler:create`/`:update` handlers to accept `targetType` and `workflowSpecs` in the incoming payload, passing them through to the Phase 2/3 backend functions.
- [ ] Add `scheduler:list-workflow-templates` (or similarly named) — returns a lightweight list of existing `AutomatedWorkflowRunSummary` rows suitable for a picker UI to attach to a schedule.
- [ ] Confirm every new/changed handler follows this file's existing try/catch-and-reply convention (an error must produce a reply event, never be silently swallowed) — this file has had this exact bug before for other features; don't reintroduce it here.

### Android data models (`android/app/src/main/java/io/nexy/android/data/model/WsEvent.kt`)
- [ ] `AutomatedWorkflowRunInfo`/equivalent: `projectId` becomes nullable.
- [ ] `AutomatedWorkflowRunStepData`/equivalent: add nullable `model: String?`.
- [ ] `ScheduledTask`: add `targetType: String` and `workflowSpecs: List<...>?`.
- [ ] `ScheduledRun`: add `workflowRunIds: List<String>?`.
- [ ] New event/response types for `automated-workflow-runs:list-all` and `scheduler:list-workflow-templates`.

### Android parsing (`android/app/src/main/java/io/nexy/android/data/WsEventParser.kt`)
- [ ] Audit every existing parse path that reads `projectId` off an Automated Workflow payload — confirm none of them force-unwrap or otherwise assume non-null, fix any that do.
- [ ] Add parse cases for the new/widened commands and fields above.

### Android repository (`android/app/src/main/java/io/nexy/android/data/WsRepository.kt`)
- [ ] Add corresponding request functions: `listAllAutomatedWorkflowRuns()`, `listSchedulerWorkflowTemplates()`, widened `saveAutomatedWorkflowRun(projectId: String?, ...)`, widened `createScheduledTask(...)`/`updateScheduledTask(...)` accepting the new fields.

## Verification

- [ ] Extend the existing scheduler WS test file to cover the new/widened command variants (both request-shape and response-shape).
- [ ] **Manual smoke test — old Android, new desktop**: pair a pre-Phase-5 Android build against a post-Phase-5 desktop build; confirm the Android app degrades gracefully (ignores unrecognized new fields, doesn't crash on any existing command whose payload gained a new optional field) rather than throwing on an unexpected shape.
- [ ] **Manual smoke test — new Android, old desktop**: the reverse pairing; confirm the Android app's new UI (once Phase 6/7 land) fails gracefully (e.g. "feature unavailable" / disabled state) against a desktop build that doesn't yet speak the new commands, rather than hanging or crashing.
- [ ] Confirm this smoke-test matrix is documented somewhere as a standing release-checklist item beyond just this one feature, given the protocol's permanent lack of versioning.
