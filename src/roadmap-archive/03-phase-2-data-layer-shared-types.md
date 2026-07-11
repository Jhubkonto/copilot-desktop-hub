# Phase 2 — Data Layer & Shared Types

Status: **DONE** (implemented together with Phase 3 in the same session, since the type changes and the executor/scheduler logic that consumes them were tightly coupled). Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases.

## Implementation notes

`src/shared/types.ts`: `AutomatedWorkflowStep.model?: string` added (alternative to `agentId?`). `AutomatedWorkflowRunSummary.projectId` widened to `string | null`. New `ScheduledTaskTargetType`/`ScheduledTaskWorkflowSpec` types; `ScheduledTask`/`ScheduledTaskCreateInput`/`ScheduledTaskUpdateInput` gained `targetType`/`workflowSpecs`; `ScheduledRun` gained `workflowRunIds`. Two new IPC channels added to both `IpcReturnMap` and the `IpcChannels` union: `automated-workflow-runs:list-all` and `scheduler:list-workflow-templates` (both return `AutomatedWorkflowRunSummary[]`) — these exist now so Phase 5/6/7 have a channel to wire into, though their preload wrappers and Android mirrors are still Phase 5's job.

`src/main/automated-workflow-runs.ts`: `RunRow`/`StepRow` widened for the new columns; `rowToRunStep` threads `model`; `listAutomatedWorkflowRuns(projectId: string | null)` uses `WHERE project_id IS ?` (not `=`, which never matches NULL); new `listAllAutomatedWorkflowRuns()`; `saveAutomatedWorkflowRunFromSpec` takes `projectId: string | null` and a new optional 5th `scheduleTag` param (`{ scheduledRunId, specSortOrder }`) written into the new columns on insert only (never on the replace-in-place update path, since that's for user-driven regeneration of an unstarted plan, not scheduler-spawned runs); new `findAutomatedWorkflowRunByScheduleTag(scheduledRunId, specSortOrder)` for Phase 3's idempotency guard. New `automated-workflow-runs:list-all` IPC handler registered.

**Verification result**: TypeScript compiles cleanly project-wide (confirmed by running `npm run typecheck` after each change and fixing every surfaced call site — see Phase 3's notes for what those were). Full `main` suite: 779/779 passed. Full `renderer` suite: 529/529 passed (confirming the `AutomatedWorkflowRunSummary.projectId` nullability widening didn't silently break any renderer consumer — none exist yet since Phase 6 UI hasn't landed).

## Goal

Thread Phase 1's schema changes through `src/shared/types.ts` and the main-process CRUD layer (`automated-workflow-runs.ts`, `scheduler-engine.ts`). Pure plumbing — no behavior change, no executor logic yet. This phase's job is purely to make the new columns type-safe and readable/writable from application code.

## Depends on / Blocks

- **Depends on**: Phase 1 (the columns/tables this phase types and CRUDs must already exist).
- **Blocks**: Phase 3 (executor/scheduler logic needs these types and CRUD functions), Phase 4 (generator needs the `model` field on the type).

## Architectural design choices & reasoning

1. **`AutomatedWorkflowStep.model?: string` is an alternative to `agentId?`, not an addition alongside a skill list.** This is the direct type-level consequence of Phase 1's schema choice — no `skillIds` field exists or is planned. Keep both fields optional and mutually-exclusive-by-convention (not enforced at the type level, since TypeScript doesn't cleanly express "at most one of these two" without a discriminated union, and introducing one here would ripple into every place that constructs a step — simpler to leave both optional and enforce the resolution order in Phase 3's executor logic instead).
2. **`AutomatedWorkflowRunSummary.projectId` widens from `string` to `string | null`.** This is a breaking type change for anything that currently assumes a run always has a project — deliberately so, since finding every such call site is exactly the point of doing this in its own phase before any executor/UI logic depends on it. Expect the TypeScript compiler to surface every affected call site as an error; that's the intended mechanism for catching all of them.
3. **`listAutomatedWorkflowRuns(projectId: string | null)` uses `WHERE project_id IS ?`, not `WHERE project_id = ?`.** SQL `=` never matches `NULL` (even `NULL = NULL` is `NULL`, not true), so a naive `=`-based query would silently return zero rows for project-less runs. SQLite's `IS`/`IS NOT` operators are NULL-safe and must be used here specifically because this column just became nullable in Phase 1.
4. **New `listAllAutomatedWorkflowRuns()` function, additive.** This doesn't replace the project-scoped `listAutomatedWorkflowRuns` — it's a new query for the future global pane (Phase 6/7), returning every run regardless of project. Keeping both functions (rather than making the existing one accept an "all" sentinel value) keeps each call site's intent explicit.
5. **Schedule CRUD additions (`dbListScheduledTaskWorkflows`/`dbSetScheduledTaskWorkflows`) live in the same file as existing `scheduled_tasks`/`scheduled_runs` CRUD** (`scheduler-engine.ts`), not a new file — this codebase's existing convention keeps a feature's whole persistence layer in one file rather than splitting by table.

## Itemized todo checklist

### `src/shared/types.ts`
- [ ] `AutomatedWorkflowStep` gains `model?: string`.
- [ ] `AutomatedWorkflowRunStep` (which extends `AutomatedWorkflowStep`) automatically inherits `model?: string` — confirm no separate declaration needs updating.
- [ ] `AutomatedWorkflowRunSummary.projectId: string` → `string | null`.
- [ ] `ScheduledTask`, `ScheduledTaskCreateInput`, `ScheduledTaskUpdateInput` gain `targetType: 'chat' | 'automated_workflow'`.
- [ ] Same three types gain `workflowSpecs?: { workflowSpecJson: string; sourceRunId: string | null; confirmationMode: 'gated' | 'auto' }[]`.
- [ ] `ScheduledRun` gains `workflowRunIds: string[] | null`.
- [ ] Grep the codebase for every existing usage of `AutomatedWorkflowRunSummary.projectId` and fix each TypeScript error surfaced by the nullability widening — do not silently cast/assert around them; each one needs a real decision (treat as project-less, or is a project genuinely guaranteed at that call site and if so why).

### `src/main/automated-workflow-runs.ts`
- [ ] Thread the new `model` column through `insertSteps` (write) and `loadRunSteps`/`rowToRunStep` (read) — a plain column read/write, no join-table logic needed.
- [ ] `listAutomatedWorkflowRuns(projectId: string | null)`: change the signature and the underlying SQL to `WHERE project_id IS ?` (bind `null` directly — verify the SQLite driver in use, `better-sqlite3`, binds JS `null` to SQL `NULL` correctly for an `IS` comparison).
- [ ] Add `listAllAutomatedWorkflowRuns(): AutomatedWorkflowRunSummary[]` — no `WHERE` clause on project at all.
- [ ] `saveAutomatedWorkflowRunFromSpec`'s first parameter (`projectId`) becomes `string | null`; confirm the `INSERT` binds `null` correctly for a project-less run.
- [ ] Confirm/update the sql.js-based test shim (per this repo's `main`-project Vitest setup) still round-trips a `NULL` `project_id` correctly — sql.js and better-sqlite3 can differ subtly in NULL-binding behavior, worth an explicit check.

### `src/main/scheduler-engine.ts`
- [ ] `rowToTask` reads the new `target_type` column into `ScheduledTask.targetType`.
- [ ] `dbCreateTask`/`dbUpdateTask` write `target_type` (defaulting to `'chat'` if not specified, matching the column's DB default).
- [ ] Add `dbListScheduledTaskWorkflows(taskId: string): ScheduledTask['workflowSpecs']` — reads `scheduled_task_workflows` rows ordered by `sort_order`.
- [ ] Add `dbSetScheduledTaskWorkflows(taskId: string, specs: ...)` — replaces the full set of attached specs for a task (delete-then-reinsert within a transaction is the simplest correct approach, matching how other "set the full list" operations in this codebase are typically implemented — confirm against `reorderSkillsForAgent`'s pattern in `skills.ts` for precedent).
- [ ] Thread `ScheduledRun.workflowRunIds` read/write for the new `workflow_run_ids_json` column (JSON-stringify on write, parse on read, `null` when absent — same pattern as other `_json` columns in this file).

## Verification

- [ ] Round-trip test: save an `AutomatedWorkflowStep` with `model` set (and `agentId` unset), fetch it back, confirm the field survives.
- [ ] `listAutomatedWorkflowRuns(null)` returns only project-less runs; `listAutomatedWorkflowRuns('some-project-id')` behavior is unchanged from before this phase.
- [ ] `listAllAutomatedWorkflowRuns()` returns both project-scoped and project-less runs together.
- [ ] `dbSetScheduledTaskWorkflows` followed by `dbListScheduledTaskWorkflows` round-trips the full ordered list, including `sourceRunId: null` and both `confirmationMode` values.
- [ ] TypeScript compiles cleanly project-wide after the `AutomatedWorkflowRunSummary.projectId` nullability change — i.e., every call site was actually fixed, not suppressed.
- [ ] Existing test suites for both touched files (`automated-workflow-runs.test.ts`, `scheduler-*.test.ts`) still pass, confirming no accidental behavior change beyond what's newly added.
