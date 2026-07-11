# Phase 8 — Hardening & Cleanup

Status: **implemented — roadmap complete (Phases 0-8)**. Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases. Final phase.

## Implementation notes

**Crash-recovery regression test**: added `'recovers a schedule-spawned run (tagged with scheduled_run_id/spec_sort_order) identically to a manually-created one'` to `src/main/__tests__/automated-workflow-executor.test.ts`'s "crash recovery" describe block. Seeds a run via `saveAutomatedWorkflowRunFromSpec(..., { scheduledRunId: 'sched-run-1', specSortOrder: 0 })`, forces both the run and its step to `status='running'`, runs `recoverStuckAutomatedWorkflowRuns()`, and confirms it's marked `failed` with the same explanatory message a manually-created stuck run gets — plus an explicit assertion that the `scheduled_run_id`/`spec_sort_order` tag columns survive the recovery sweep untouched. Passed as expected on first run: `recoverStuckAutomatedWorkflowRuns()` keys purely on `status`, with no special-casing anywhere for how the row was created, so no executor code changes were needed — this confirms the hypothesis in this phase's "Architectural design choices" section above.

**Retention/pruning gap — flagged, not fixed (see design choice #2 above)**: `automated_workflow_runs` has no retention or pruning policy today. Unlike `scheduled_runs` (pruned to the last 20 runs per task, >90 days, via logic in `scheduler-engine.ts`), a run created directly via `saveAutomatedWorkflowRunFromSpec` — including one spawned repeatedly by a recurring schedule through this roadmap's Phase 3 scheduler→workflow branching — accumulates forever. This predates this roadmap (workflow runs were never pruned even for manually-created ones) but is now exercised more heavily by recurring schedules. **Not fixed in this pass** — flagged here as a known follow-up requiring its own design (retention window? per-task cap? tied to the owning `scheduled_task`'s lifecycle?) rather than silently expanding this phase's scope.

**Opportunistic `workflowMode` audit fixes** — all three from hierarchy doc §7 applied:
1. **Silent invisible progress (desktop + Android)**: `ChatWindow.tsx`'s two `useEffect`s gating the live workflow-run banner (`loadActiveWorkflowRun` on project-id/mount, and the `onAutomatedWorkflowRunsChanged` push-update handler) no longer require `projectWorkflowMode === 'automated-delegation'` — only `chatProjectId` being set. Mirrored on Android in `ChatScreen.kt`: the `LaunchedEffect(statusProjectId, chatProjectWorkflowMode, connectionState)` polling effect and the `AutomatedWorkflowRunDetailReady` event handler both dropped the same `"automated-delegation"` gate. A workflow run started in a `'single-agent'` or `'orchestrated'` project now surfaces in the live chat banner on both platforms, matching Automated Workflow's status as a fully independent, top-level feature rather than something tied to a specific project mode. The separate `workflowModeInfo`/`chatProjectWorkflowMode` mode-badge displays (unrelated UI, showing which mode a project is configured for) were left untouched — only the run-visibility gating changed.
2. **Stale Android copy**: `ProjectConfigScreen.kt`'s Variables-section description ("...in the manual workflow generator...") and the Workflow-mode description ("...manual delegation workflow...") both updated to say "automated workflow generator" / "automated delegation workflow", closing out the leftover `manual-delegation` → `automated-delegation` rename.
3. **Inaccurate desktop copy**: `AutomatedWorkflowTab.tsx`'s off-mode notice no longer claims switching to Automated mode is needed "to execute it as automated delegation" (never true — execution has always been unconditional on `workflowMode`); now states plainly that Automated Workflow runs independently of the project's workflow-mode setting.

**Verification results**: `npx vitest run src/main/__tests__/automated-workflow-executor.test.ts` — 18/18 passed (17 pre-existing + 1 new). Full desktop suite (`npm test`): 135 files / 1319 tests passed. `npm run typecheck`: clean. `npm run lint`: clean except one pre-existing, unrelated warning (`chatwindow.test.tsx:18`, an unused test variable predating this phase — confirmed via `git status` showing that file already modified before this phase's work began). Android: `:app:compileDebugKotlin` and `:app:testDebugUnitTest` — BUILD SUCCESSFUL after the `ChatScreen.kt`/`ProjectConfigScreen.kt` copy/gating edits. **Not done**: the 3 "manual check"/on-device verification items below (visually confirming the banner appears in non-automated-delegation projects, reading the corrected Android strings in the running app, reading the corrected desktop copy in the running app) were not performed — no browser/Electron window or Android emulator was available in this session. Confirmed via code review, types, lint, and the full automated test suite instead; flagged explicitly per this roadmap's established honesty convention (see Phase 6/7's equivalent notes) rather than claimed.

**Final documentation pass**: Phase 0's "Findings" section was already marked `Status: DONE` when Phase 0 was executed earlier in this effort — nothing further to close out there. All of Phases 0-7's "Implementation notes" sections are in place (this phase's own notes above complete the set). The roadmap's 9 phases (0-8) are now fully implemented.

## Goal

## Goal

Close out the roadmap with regression coverage for the new schedule-spawned execution path, flag (without necessarily fixing) a pre-existing gap this feature exercises more heavily, and opportunistically fix a few still-valid defects from the earlier `workflowMode` integration audit while this UI is already being touched.

## Depends on / Blocks

- **Depends on**: all of Phases 0-7. This is explicitly the last phase.
- **Blocks**: nothing — it's the end of the roadmap.

## Architectural design choices & reasoning

1. **Crash-recovery regression check, not new code.** `recoverStuckAutomatedWorkflowRuns()` sweeps any run stuck in `status='running'` at startup. It keys purely on that status column, with no special-casing for how the run was created — so a schedule-spawned run (tagged with `scheduled_run_id`/`spec_sort_order` from Phase 1) should already be recovered identically to a manually-created one. The task here is to *verify* this is actually true with a test, not to write new recovery logic — if the test fails, that's a genuine bug to fix, but the default expectation is that it passes unmodified.
2. **Retention/pruning is flagged, not fixed, in this phase.** `scheduled_runs` already has a pruning policy (last 20 runs per task, >90 days). `automated_workflow_runs` has none today, and this roadmap's Phase 3 (scheduler → workflow branching) means a single recurring schedule can now spawn many workflow runs over time — accumulating unbounded. This is a pre-existing gap (workflow runs were never pruned even before this roadmap), just one this feature exercises more than before. Explicitly scoped out of this roadmap's required work — flag it clearly enough that it doesn't get lost, but don't silently expand this phase's scope to include designing a new retention policy.
3. **The `workflowMode` audit defects are opportunistic, not required.** These three defects were found in an earlier, narrower investigation (documented in the hierarchy doc's §7) before this bigger restructure was scoped. None of them block this roadmap's goals, but two of them (the stale Android copy) are one-line text fixes, and the third (silent invisible progress) touches the exact same chat-banner code this roadmap's UI phases already modify — fixing them here is cheap precisely because the surrounding code is already open for changes, not because they're part of the original ask.

## Itemized todo checklist

### Regression coverage
- [ ] Write a test: seed a `running`-status `automated_workflow_runs` row tagged with a non-null `scheduled_run_id`/`spec_sort_order` (as if mid-execution when the app crashed), run the startup crash-recovery sweep, confirm it's marked `failed` with the same explanatory message a manually-created stuck run would get — no different treatment.

### Retention-policy flag (documentation only, not implementation)
- [ ] Add a clearly-marked note (in this file's "Findings" section below, or wherever this project tracks known follow-ups) stating: `automated_workflow_runs` has no retention/pruning policy; this was already true before this roadmap but is now exercised more, since a recurring schedule can spawn many runs over time. Not fixed in this pass.

### Opportunistic `workflowMode` audit fixes (see hierarchy doc §7 for full context)
- [ ] **Silent invisible progress**: while touching `ChatWindow.tsx`'s (desktop) and `ChatScreen.kt`'s (Android) live workflow-run banner code in Phases 6/7, reconsider whether banner visibility should still be gated on `workflowMode === 'automated-delegation'` at all, now that Automated Workflow is a fully independent, top-level feature per this roadmap. Fixing this means a workflow run started in any project mode is visible in the live chat banner, not just `'automated-delegation'` mode.
- [ ] **Stale pre-rename copy on Android**: fix `ProjectConfigScreen.kt:580`'s description text (currently "...manual delegation workflow...") and `:502`'s reference to "...the manual workflow generator..." — both orphaned leftovers from the earlier `manual-delegation` → `automated-delegation` rename, now doubly stale given this roadmap's UI changes are already touching nearby code.
- [ ] **Inaccurate desktop copy**: fix `AutomatedWorkflowTab.tsx:605-609`'s claim that switching workflow modes is needed "to execute it as automated delegation" — untrue both before and after this roadmap; execution has always been unconditional.

### Final documentation pass
- [ ] Update the hierarchy doc's (or this directory's) tracking of Phase 0's open verification item once it's actually resolved, if it wasn't already closed out when Phase 0 was executed.
- [ ] Confirm every phase file's "Verification" checklist in this directory has been fully worked through before considering the overall roadmap complete.

## Verification

- [ ] Crash-recovery regression test (above) passes.
- [ ] Full existing test suite (main + renderer + Android instrumented tests) passes after all opportunistic fixes in this phase.
- [ ] Manual check: a workflow run started in a project whose `workflowMode` is `'single-agent'` or `'orchestrated'` now shows live progress in the chat banner (if that fix was applied) — previously this was silently invisible.
- [ ] Manual check: the two corrected Android copy strings read correctly in the running app.
- [ ] Manual check: `AutomatedWorkflowTab.tsx`'s copy no longer claims a mode switch is required for execution.
