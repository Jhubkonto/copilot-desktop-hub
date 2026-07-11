# Overview & Sequencing — Automated Workflow Restructure

Status: **implemented — all 9 phases (0-8) complete**. Index for the 9 phase files in this directory. Each phase file's own "Implementation notes" section has the specifics; see those for exact file/line changes, test results, and any explicitly-flagged verification gaps (e.g. no browser/emulator UI smoke tests were performed in the implementing session).

## Read this first, then read in order

1. **Prerequisite reading**: `../roadmap-new/automated-workflow-hierarchy-roadmap.md` — the target hierarchy, the full current-state entity model with citations, the gap analysis, and the consolidated open-decisions log. Everything below assumes that document's findings as given. (This phase set is now archived here since all 9 phases are complete; the hierarchy doc itself remains in `roadmap-new/` as it's the source research doc, not a phase.)
2. Then the 9 phase files below, in numeric order. Each is self-contained (goal, dependencies, design reasoning, itemized todos, verification) so a developer can pick up any one phase without holding the whole hierarchy doc in their head — but the *order* matters, per the dependency graph in this file.

## The 9 phases

| File | Phase | One-line goal |
|---|---|---|
| `01-phase-0-code-changes-workspace-verification.md` | Phase 0 | Confirm/enforce that Code Changes requires a configured workspace path, not just a project id |
| `02-phase-1-schema-foundations.md` | Phase 1 | Additive schema changes: step `model` column, project-optional workflow runs, schedule target-type |
| `03-phase-2-data-layer-shared-types.md` | Phase 2 | Thread the new schema through `src/shared/types.ts` and the CRUD layer |
| `04-phase-3-executor-scheduler-behavior.md` | Phase 3 | The real logic: agent-or-model step resolution, scheduler → workflow branching |
| `05-phase-4-generator-llm-prompts.md` | Phase 4 | Teach the plan-authoring and schedule-authoring LLMs about the new fields |
| `06-phase-5-ws-protocol-mirror.md` | Phase 5 | Mirror every new/changed IPC channel to the WS protocol + Android Kotlin models |
| `07-phase-6-desktop-ui-elevation.md` | Phase 6 | New top-level Sidebar entry + global pane on desktop |
| `08-phase-7-android-ui-elevation.md` | Phase 7 | New dashboard 3-dot-menu entry + top-level nav route on Android |
| `09-phase-8-hardening-cleanup.md` | Phase 8 | Regression tests, retention-policy flag, opportunistic defect cleanup |

## Dependency graph

```
Phase 0 ─────────────────────────────────────────────────────────────────── (independent, do anytime, ideally first)

Phase 1 (schema) ──▶ Phase 2 (types/CRUD) ──▶ Phase 3 (executor/scheduler logic) ──▶ Phase 4 (LLM prompts)
                                                        │                                    │
                                                        └──────────────▶ Phase 5 (WS mirror) ◀┘
                                                                              │
                                                             ┌────────────────┴────────────────┐
                                                             ▼                                  ▼
                                                     Phase 6 (desktop UI)              Phase 7 (Android UI)
                                                             │                                  │
                                                             └────────────────┬─────────────────┘
                                                                              ▼
                                                                       Phase 8 (hardening)
```

Read strictly: Phase 2 cannot start meaningfully before Phase 1's schema exists (it types and CRUDs columns that don't exist yet). Phase 3 needs Phase 2's types. Phase 4 needs Phase 2's `model` field on a step but is not strictly blocked by Phase 3 — it can be scaffolded in parallel with Phase 3, though end-to-end testing of a generated plan needs Phase 3's executor to actually run it. Phase 5 needs Phases 2-4's IPC surface finalized. Phases 6 and 7 both depend on Phase 5 and nothing else new — they can be built in parallel by different people, but see the lockstep constraint below.

## Cross-cutting constraints (apply across multiple phases — don't re-derive per phase)

1. **WS protocol has no versioning.** `src/main/ws-server.ts` does raw string-matching on command names. A desktop build that changes a WS command's shape (Phase 5) will silently break an Android build still speaking the old shape, and vice versa. **Phases 5, 6, and 7 must ship in the same release.** Phase 1-4 (schema/backend-only) can ship alone as an internal change with no user-visible effect, same as this codebase's prior Manual→Automated Workflow rebuild did.
2. **Two schema sources must stay in sync.** `src/main/database-migrations.ts` has both the incremental `MIGRATIONS` array and a separate `initializeBaseSchema()` fresh-install baseline. Every Phase 1 migration must be reflected in both, or a fresh install and an upgraded install will end up with different schemas. This has already bitten this codebase once (the `automated_workflow_*` tables appear twice today, once per path, and Phase 1 touches both).
3. **Migration version numbering**: this roadmap reserves versions 68, 69, 70 (see Phase 1) — confirm the actual next free version against `database-migrations.ts` at implementation time in case other work has landed migrations in between planning and implementation.
4. **No skill involvement in model-mode, anywhere.** This is the single most important invariant from the corrected hierarchy: a workflow step resolved via a bare model (no agent) must never call `getAgentConfig`/`applySkillsToAgentConfig` or otherwise touch `src/main/skills.ts`. This invariant is introduced in Phase 3 and must be preserved through Phases 4, 6, and 7's UI/prompt work — no phase should reintroduce a "give the model some skills anyway" shortcut.
5. **Existing project-scoped behavior must not change.** Every phase's design keeps today's agent-resolution path (`agentId ?? resolvePrimaryAgentId(projectId)`) working exactly as before for any step that doesn't opt into project-less/model-mode. Model-mode and project-optional runs are additive branches, not replacements.

## Migration-number ledger (keep updated as phases land)

| Version | Change | Phase |
|---|---|---|
| 68 | `automated_workflow_run_steps` gains nullable `model` column | Phase 1 |
| 69 | `automated_workflow_runs.project_id` becomes nullable (table-swap) + adds `scheduled_run_id`/`spec_sort_order` | Phase 1 |
| 70 | `scheduled_tasks.target_type`, `scheduled_task_workflows` table, `scheduled_runs.workflow_run_ids_json` | Phase 1 |
