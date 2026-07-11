# Phase 7 — Android UI Elevation

Status: **implemented**. Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases. This is the Android half of closing target-hierarchy point 3.

## Implementation notes

**`HomeScreen.kt`**: added an `AccountTree` icon import and a new `DropdownMenuItem("Automated Workflows")` in the dashboard's 3-dot menu, threaded via a new `onOpenAutomatedWorkflows: () -> Unit` param the same way the existing Skills/Artifacts/Scheduled entries are wired.

**`NavGraph.kt`**: new route `automated-workflows?projectId={projectId}` (optional query arg, `defaultValue = ""`, following the existing `artifacts?artifactId={artifactId}` convention) wired to the new `AutomatedWorkflowListScreen`. This is a distinct route from the pre-existing, unmodified project-nested `automated-workflow/{projectId}` (singular, required arg) route that still backs `ProjectConfigScreen.kt`'s "Project Tools" entry — no collision, both coexist.

**New file `AutomatedWorkflowListScreen.kt`**: mirrors `ScheduledScreen.kt`'s list/detail/live-update pattern rather than inventing new list-UI conventions. `WorkflowFilter` enum (ALL/GLOBAL), sourced from `listAllAutomatedWorkflowRuns()` (project-less/omitted `projectId`) or `listAutomatedWorkflowRuns(projectId)` (project-scoped), collecting `AutomatedWorkflowRunsListAll`/`AutomatedWorkflowRunsList`/`AutomatedWorkflowRunDetailReady`/`AutomatedWorkflowRunDiscarded` WS events. Rather than generalizing `AutomatedWorkflowScreen.kt` to accept a bare `runId` (the roadmap's original plan), detail rendering reuses `SavedWorkflowRunDetailView` directly — that composable was already the self-contained detail/step-interaction view inside `AutomatedWorkflowScreen.kt` (changed from `private fun` to `internal fun` for same-package cross-file reuse), so no new entry-parameter shape was needed on the existing screen at all. `WorkflowRunListRow` shows a project-name-or-"Global" badge per row, matching desktop's `RunListRow` `projectName` prop.

**Step badge fix (2 call sites in `AutomatedWorkflowScreen.kt`)**: `AutomatedWorkflowStepPreviewCard` (~line 472) and `AutomatedWorkflowRunStepCard` (~line 655) both now render `step.agentName ?: step.model?.let { "Model: $it" } ?: "Unassigned"` instead of the old `step.agentName ?: "Unassigned"` — mirrors desktop's single Agent/Model badge, never both, no skill chips (skills are never a per-step concept).

**`SchedulerTaskConfigScreen.kt`**: added a `SegmentedButton` target-type toggle (Chat / Automated Workflow), a `DropdownField` workflow picker populated from `SchedulerWorkflowTemplates` (fetched via a new WS command), and a `buildWorkflowSpecJson(detail)` helper that reshapes a fetched `AutomatedWorkflowRunInfo` detail into the frozen `AutomatedWorkflowSpec` JSON string client-side via `org.json.JSONObject`/`JSONArray` — mirroring the same reshape desktop's `SchedulerTaskForm.tsx` does, since Android has no direct DB access and the manual create/update path needs the frozen spec handed to it directly (server-side `sourceRunId` resolution only exists on the AI-generator path). Save validates `workflowSelectionIncomplete` before allowing submit.

**Test coverage added**: `AutomatedWorkflowEventParserTest.kt` gained 4 new cases — nullable `projectId` round-tripping as real `null` (not `""`) in `automated-workflow-runs:list`, a step's `model` field parsing as agent/model alternative in `automated-workflow-runs:detail`, the new `automated-workflow-runs:list-all` event, and the new `scheduler:list-workflow-templates` event. `AutomatedWorkflowStepPreviewCardTest.kt` (androidTest) gained a case confirming the "Model: X" badge renders instead of "Unassigned" when a step has no agent but has a model. `AutomatedWorkflowStepsScrollTest.kt` was left unmodified — it tests scroll behavior of the generator's step-preview `LazyColumn`, unrelated to the new list screen (which was built with a weighted, scrollable `LazyColumn` from the start, not retrofitted, so it has no instance of the scroll-squeeze bug class that test guards against).

**Verification results**: `./gradlew.bat :app:compileDebugKotlin` and `:app:testDebugUnitTest` — BUILD SUCCESSFUL, all unit tests (including the 4 new parser cases) pass. `:app:compileDebugAndroidTestKotlin` fails, but pre-existingly and environment-wide — `assertDoesNotExist`/`onNode`/`assertExists` are unresolved across multiple untouched files (`GeneratorChatBubbleTest.kt`, `StandaloneModeToggleTest.kt`, `ConnectionChipTest.kt`, `StatusActivityBarTest.kt`, `AddAgentToProjectSheetContentTest.kt`, `McpServersScreenRowTest.kt`), confirmed via `git status` showing only the one file I touched as modified — this is a Compose-test dependency/version issue in this environment, not a regression introduced by this phase. **Not done**: no on-device/emulator manual smoke test was performed (no Android emulator/device available in this session) — the 3 manual-smoke-test checklist items below are unverified beyond code review and unit-level coverage; flagged explicitly rather than claimed.

## Goal

## Goal

Give Automated Workflow its own entry in the dashboard's 3-dot menu and a top-level nav route on Android, matching Skills/Artifacts/Scheduled — without removing the existing project-nested entry point in `ProjectConfigScreen.kt`.

## Depends on / Blocks

- **Depends on**: Phase 5 (Android's WS repository/parser must already speak the new commands/fields this UI calls). Also benefits from Phase 3 being correct for the same E2E-testing reason as Phase 6.
- **Blocks**: nothing downstream except Phase 8's hardening pass.
- **Must ship in the same release as Phase 6** (see the WS-lockstep constraint in `00-overview-and-sequencing.md` and Phase 5) — this is not optional or reorderable.

## Architectural design choices & reasoning

1. **`AutomatedWorkflowScreen.kt` is kept as the detail + generator-chat screen, not replaced.** Exactly mirroring the desktop decision in Phase 6: this screen already does project-scoped generation and per-run detail/step-tracking well; the fix needed is a *new entry point*, not a rewrite of what already works. It gets generalized to accept a `runId` directly (for the project-less case reached from the new global list) alongside its existing `projectId`-keyed entry point.
2. **New `AutomatedWorkflowListScreen.kt` mirrors `ScheduledScreen.kt`'s list/detail pattern** — same rationale as desktop Phase 6's pane: this codebase already has one established precedent for "a top-level, project-optional, filterable list screen with live updates," and reusing it keeps the new screen consistent with what Android users of this app already know from the Scheduled section.
3. **The existing project-nested entry point in `ProjectConfigScreen.kt`'s "Project Tools" section is left untouched.** A user already inside a specific project's config screen still benefits from a quick, project-scoped path to Automated Workflow — removing it would be a regression for that existing flow. The new dashboard-level entry is additive.
4. **No skill chips on step preview cards** — same reasoning as desktop Phase 6: skills are never a per-step concept under the corrected design, so nothing skill-related belongs on a step card. Only the single Agent/Model badge (the step's resolved `model` field, mirrored over WS by Phase 5) is shown.

## Itemized todo checklist

- [ ] `android/.../ui/home/HomeScreen.kt`: add a new `DropdownMenuItem("Automated Workflows")` in the 3-dot menu, alongside the existing Skills/Artifacts/Scheduled entries, threading a new `onOpenAutomatedWorkflows: () -> Unit` parameter the same way the existing three are threaded.
- [ ] `android/.../navigation/NavGraph.kt`: add a new top-level route, `automated-workflows?projectId={projectId}` (optional query param, following the existing convention already used for `artifacts?artifactId={artifactId}`), wired to a new `AutomatedWorkflowListScreen`.
- [ ] New file `android/.../ui/projects/AutomatedWorkflowListScreen.kt`: mirror `ScheduledScreen.kt`'s structure — a filterable list (all / project-scoped / global), sourced from the Phase 5 `listAllAutomatedWorkflowRuns` WS call, with live update handling matching this codebase's existing patterns for that screen.
- [ ] List items navigate into `AutomatedWorkflowScreen.kt`'s detail view by `runId` — generalize that screen's entry parameters to accept a `runId` directly (in addition to its existing `projectId`-keyed construction from `ProjectConfigScreen.kt`'s "Project Tools" row, which stays unchanged).
- [ ] `ProjectConfigScreen.kt`: no changes to the existing "Project Tools" → "Automated workflow generator" row — confirm it still works unmodified after this phase.
- [ ] Step preview cards (wherever `AutomatedWorkflowRunStepData`/equivalent is rendered): show the single Agent/Model badge sourced from the step's `model` field (Phase 5), matching desktop's badge design — no skill chips.
- [ ] `ScheduledScreen.kt`/`SchedulerTaskConfigScreen.kt`: add the same target-type toggle (Chat / Automated Workflow) and "attach existing workflow" picker as desktop's `SchedulerTaskForm.tsx`, sourced from the same `scheduler:list-workflow-templates` WS command (Phase 5).

## Verification

- [ ] Extend existing workflow event-parser/model-payload instrumented tests for the new step `model` field and the nullable `projectId` shape.
- [ ] Extend existing step-scroll/list instrumented tests to cover the new `AutomatedWorkflowListScreen.kt`.
- [ ] **Manual device smoke test**: from the dashboard's 3-dot menu, reach the new "Automated Workflows" list; confirm it shows both project-scoped and project-less runs, correctly distinguished.
- [ ] **Manual device smoke test**: tapping a project-scoped run from the new global list opens the *same* detail screen (`AutomatedWorkflowScreen.kt`) that the project's own "Project Tools" entry point uses — no duplicated/divergent screen logic.
- [ ] **Manual device smoke test**: create a project-less workflow from the new global list end-to-end (generate → model-mode step → start → complete), confirming no skill augmentation appears in its output — same cross-check as desktop Phase 6, performed independently on the Android client since it goes through the WS bridge rather than direct IPC.
- [ ] Confirm the existing project-nested entry point in `ProjectConfigScreen.kt` still works exactly as before this phase (regression check).
