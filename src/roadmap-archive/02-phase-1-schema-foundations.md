# Phase 1 — Schema Foundations

Status: **DONE.** Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases.

## Implementation notes

Migrations 68, 69, 70 added to `src/main/database-migrations.ts` exactly as designed below, with `initializeBaseSchema()` updated in the same change for all four touched tables (`automated_workflow_run_steps`, `automated_workflow_runs`, `scheduled_tasks`, `scheduled_runs`) plus the new `scheduled_task_workflows` table. `ALTER TABLE ... ADD COLUMN ... CHECK (...)` (used for `scheduled_tasks.target_type`) is a proven-working pattern already present in this file (migration 46), so no compatibility concern there.

`src/main/__tests__/database.test.ts` updated: all six hardcoded `toBe(67)` version assertions bumped to `toBe(70)`; added column/table assertions for all five schema changes to the "applies all migrations to a fresh DB" test; added two new dedicated tests — one seeding a v67-shaped DB, inserting a project-scoped run, running the remaining migrations, and confirming the existing row's `project_id` survives unchanged while a new row can now insert with `project_id = NULL`; another confirming existing `scheduled_tasks` rows default to `target_type = 'chat'` after migration 70.

**Verification result**: `database.test.ts` — 13/13 passed (was 11, +2 new). Full `main` project test suite — 772/772 passed across 79 files, confirming this phase's schema-only changes introduced no regressions anywhere else in the main process.

## Goal

Lay down every schema change the rest of the roadmap needs, additive and nullable only: a step-level agent-or-model choice, project-optional workflow runs, and a schedule target-type mechanism. Nothing in this phase changes runtime behavior — it only makes new states representable.

## Depends on / Blocks

- **Depends on**: nothing (first phase after the independent Phase 0).
- **Blocks**: Phase 2 (types/CRUD need these columns to exist), and transitively everything after it.
- Reserves migration versions **68, 69, 70** — confirm these are still the next free versions in `src/main/database-migrations.ts` at implementation time.

## Architectural design choices & reasoning

1. **No skills join table.** The original draft of this roadmap proposed an `automated_workflow_step_skills` join table (mirroring `agent_skills`). That was retracted after the target hierarchy was corrected: skill access must be strictly agent-gated, with **no** per-step skill curation and **no** "all skills available to a bare model" exception. A join table would have modeled a mechanism that doesn't exist in the target design. The actual need is much smaller: a step just needs a second, mutually-exclusive "who fulfills this" column.
2. **`model` column on `automated_workflow_run_steps`, not a new table.** This mirrors the existing nullable `agent_id` column exactly — a step now has two nullable columns (`agent_id`, `model`) instead of one, and whichever is populated (or the fallback logic in Phase 3) determines execution mode. No FK, no join table, minimal schema surface.
3. **Why `automated_workflow_runs.project_id` becomes nullable via table-swap, not `ALTER COLUMN`**: SQLite has no `ALTER COLUMN`. This codebase already has an established table-swap precedent for exactly this kind of change (migrations 47, 49, 65, 66) — recreate the table with the new nullable definition, copy data across, drop the old one, rename, recreate indexes. Follow that precedent exactly rather than inventing a new migration style.
4. **Why `initializeBaseSchema()` must be updated in the same change, not later**: this file maintains two independent descriptions of the schema — the incremental `MIGRATIONS` array and a separate fresh-install baseline function. A brand-new install gets the baseline, then still replays every migration on top of it, so both paths must describe the same end state. The `automated_workflow_*` tables already appear twice in this file today (once per path) — this is not a new risk introduced by this phase, but it is a mistake that's easy to make *again* if this rule isn't stated explicitly per phase.
5. **Why the schedule-target-type design uses a join table (`scheduled_task_workflows`) for "one or many" rather than a single nullable FK column on `scheduled_tasks`**: the target hierarchy explicitly allows a schedule to reference *many* workflows, not just one, so a single column can't represent it — a join-style table with `sort_order` (for defined execution order) is required, following the same PK/sort_order pattern already used by `agent_skills` and `project_agents`.
6. **Why `workflow_spec_json` freezes a copy of the spec rather than only storing a `source_run_id` reference**: a schedule fires repeatedly and independently of whatever happens to the original run it might have been copied from (which could later be edited or discarded) — freezing the spec at attach time means a schedule's behavior doesn't silently change or break if its source run is later modified or deleted. `source_run_id` is kept as an optional *back-link* for UI convenience (e.g. "this schedule was originally copied from run X"), not as the source of truth at execution time.
7. **Why `confirmation_mode` on `scheduled_task_workflows` defaults to `'auto'`, not `'gated'`** (the default used everywhere else in the app): an unattended, timer-fired workflow with `'gated'` confirmation would stall at the first `awaiting_confirmation` step with no human present to approve it. `'auto'` is the only default that makes sense for something a schedule fires on its own; a user can still explicitly choose `'gated'` per attached spec, understanding it will pause until someone opens it (see Phase 3's repurposing of the `'approval_required'` run status for this case).
8. **Why `scheduled_run_id`/`spec_sort_order` are added to `automated_workflow_runs` proactively in this phase, rather than deferred to Phase 3 when they're actually used**: SQLite's table-swap requirement makes adding a nullable column to an existing table cheap when done alongside an already-planned table-swap (this phase is already rebuilding `automated_workflow_runs` for the nullable `project_id` change), but expensive as a *second*, separate table-swap migration later. Bundling avoids that. (Flagged in the open-decisions log as something a reviewer could choose to cut — accepting duplicate-run-on-retry as a known limitation instead — but the default here is to include it.)

## Itemized todo checklist

### Migration 68 — step gains a `model` column
- [ ] In `src/main/database-migrations.ts`, add a new entry to the `MIGRATIONS` array:
  ```sql
  ALTER TABLE automated_workflow_run_steps ADD COLUMN model TEXT;
  ```
- [ ] Update `initializeBaseSchema()`'s `automated_workflow_run_steps` definition to include `model TEXT` directly in the `CREATE TABLE` (not as a follow-up `ALTER`), since a fresh install should just have the final shape.

### Migration 69 — `automated_workflow_runs.project_id` becomes nullable + retry-idempotency columns
- [ ] Write the table-swap migration: create `automated_workflow_runs_v69` (or similar temp name) with `project_id TEXT` (no longer `NOT NULL`), plus new nullable `scheduled_run_id TEXT` and `spec_sort_order INTEGER` columns.
- [ ] Copy all existing rows across via `INSERT INTO ... SELECT ... FROM automated_workflow_runs`.
- [ ] Drop the old table, rename the new one to `automated_workflow_runs`.
- [ ] Recreate `idx_automated_workflow_runs_project_updated` (and any other indexes) against the renamed table.
- [ ] Update `initializeBaseSchema()`'s `automated_workflow_runs` definition to match (nullable `project_id`, plus the two new columns) directly in the `CREATE TABLE`.

### Migration 70 — schedule target-type + one-or-many workflow specs
- [ ] Add `ALTER TABLE scheduled_tasks ADD COLUMN target_type TEXT NOT NULL DEFAULT 'chat' CHECK (target_type IN ('chat', 'automated_workflow'));`
- [ ] Create `scheduled_task_workflows`:
  ```sql
  CREATE TABLE IF NOT EXISTS scheduled_task_workflows (
    task_id            TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
    workflow_spec_json TEXT NOT NULL,
    source_run_id      TEXT,
    confirmation_mode  TEXT NOT NULL CHECK (confirmation_mode IN ('gated','auto')) DEFAULT 'auto',
    sort_order         INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    PRIMARY KEY (task_id, sort_order)
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_task_workflows_task ON scheduled_task_workflows(task_id, sort_order);
  ```
- [ ] Add `ALTER TABLE scheduled_runs ADD COLUMN workflow_run_ids_json TEXT;`
- [ ] Update `initializeBaseSchema()`'s `scheduled_tasks`/`scheduled_runs` definitions and add the new `scheduled_task_workflows` table definition, matching the incremental path exactly.

### Cross-cutting
- [ ] Confirm the actual next-free migration version number against the current `MIGRATIONS` array before assigning 68/69/70 — other work may have landed migrations since this roadmap was written.
- [ ] Double-check every new/changed table appears identically in both `MIGRATIONS` and `initializeBaseSchema()` — this is the single most common mistake this file's dual-schema-source structure invites.

## Verification

- [ ] **Fresh-install parity test**: assert `initializeBaseSchema()`'s resulting schema matches the incremental-migration path (v1→v70) via `PRAGMA table_info` for `automated_workflow_run_steps`, `automated_workflow_runs`, `scheduled_tasks`, `scheduled_runs`, and the new `scheduled_task_workflows` table.
- [ ] **Backfill test**: seed a v67-shaped DB (pre-nullable `project_id`), run migration 69, confirm existing `automated_workflow_runs` rows retain their original `project_id` value unchanged, and confirm a new row can now be inserted with `project_id = NULL`.
- [ ] **Regression test**: existing `automated-workflow-runs.test.ts` and `scheduler-*.test.ts` suites pass unmodified against the new schema — proves this phase is purely additive with no behavior change yet.
- [ ] **Default-value check**: confirm existing `scheduled_tasks` rows all read back with `target_type = 'chat'` after migration 70 (the `DEFAULT 'chat'` clause applies to existing rows on `ALTER TABLE ADD COLUMN` in SQLite — verify this is actually true rather than assumed).
