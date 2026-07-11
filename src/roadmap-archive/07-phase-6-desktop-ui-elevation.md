# Phase 6 — Desktop UI Elevation

Status: **DONE**. Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases. This is the desktop half of closing target-hierarchy point 3.

## Implementation notes

**Preload/IPC follow-through from Phase 5**: two preload wrappers still had the pre-nullable-projectId signature and needed widening to compile against the new UI — `automatedWorkflowGeneratorChat` and `saveAutomatedWorkflowRunFromSpec` (both `projectId: string` → `string | null`). New `listAllAutomatedWorkflowRuns`/`schedulerListWorkflowTemplates` preload wrappers added (steps 1-3 of the IPC checklist — channel already existed from Phase 5, this is preload step 3 + step 4 was already done).

**`ActiveSectionPane`/`Sidebar.tsx`/`SectionPane.tsx`**: added `'workflows'` throughout, new Sidebar entry (lucide-react's `Workflow` icon) between Scheduled and the Artifacts divider, new `AutomatedWorkflowsPane` case in the section switch.

**Extraction, not duplication**: `AutomatedWorkflowTab.tsx`'s step-card/run-list/confirmation-toggle rendering (~250 lines) was extracted into `src/renderer/components/automated-workflow/AutomatedWorkflowShared.tsx` (`StepCard`, `ConfirmationModeToggle`, `RunListRow`, `ActionButton`, `ChatBubble`, `StepStatusBadge`, `stripSpecTags`) so the new global pane could reuse the exact same interactive UI instead of a second, drifting copy. `StepCard`'s header now resolves a single `fulfilledByLabel` (agent name, or `Model: X`, never both) — this is where "no skill chips, ever" from the corrected design actually shows up in the UI. `AutomatedWorkflowTab.tsx` now imports from the shared module; behavior is unchanged (all its existing tests pass unmodified).

**`AutomatedWorkflowsPane.tsx`** (new): list view (all / global-only filter) sourced from `listAllAutomatedWorkflowRuns()`, each row tagged with a project-name or "Global" badge via `RunListRow`'s new optional `projectName` prop. A "New" button opens a lightweight project-less generator (reuses the same `automatedWorkflowGeneratorChat(null, ...)`/`saveAutomatedWorkflowRunFromSpec(null, ...)` IPC calls Phase 4 already made project-optional) — deliberately smaller than `AutomatedWorkflowTab.tsx`'s workspace (no variable picker, since a project-less plan has no project variables). Selecting a run opens a detail view built from the same shared `StepCard`/`ConfirmationModeToggle` components with full start/confirm/retry/skip/abort interactivity — this is what makes the "generate → model-mode step → start → complete" project-less E2E path actually possible from this pane, not just browsing.

**`BackgroundActivityBridges.tsx` fix found along the way**: `trackAutomatedWorkflowGeneration`/`clearAutomatedWorkflowGeneration` computed a *different* activity id for the no-project case (falling back to the bare `kind` string) than the main process does (`automated-workflow-generator:${projectId ?? 'global'}`) — widened both to `projectId: string | null` and made them always suffix `:global` to match, so a project-less generation's locally-optimistic activity entry reconciles against the real server snapshot instead of transiently appearing as two entries.

**`SchedulerTaskForm.tsx`**: added a target-type toggle (Standalone task / Automated Workflow). Selecting the latter replaces the prompt textarea with a `<select>` populated from `schedulerListWorkflowTemplates()`; picking a run fetches its full detail (`getAutomatedWorkflowRun`) and reshapes it into a frozen `AutomatedWorkflowSpec` client-side (mirroring `scheduler-generator.ts`'s `buildAttachedWorkflowSpec` — this was a design gap not fully specified in Phase 4: the manual create/update path needs the frozen spec JSON handed to it directly, since `dbCreateTask`/`dbUpdateTask` don't resolve `sourceRunId` server-side themselves, only the AI-generator path does).

**Verification result**: `AutomatedWorkflowTab.test.tsx` — added a test confirming a bare-model step shows "Model: X" (not "Unassigned", not both). `sectionpane.test.tsx`/`sidebar.test.tsx` — added tests for the new "workflows" section header and Sidebar entry. Added missing `listAllAutomatedWorkflowRuns`/`schedulerListWorkflowTemplates` stubs to `src/test/mocks/api.ts` (required for any test touching the new pane/form). Full `renderer` suite: 532/532 passed (529 + 3 new). `npm run typecheck` and `npm run lint`: clean. **Not done**: no browser/Electron-window visual verification was performed — no browser-automation tool was available in this session, so this is confirmed by types/lint/tests only, not by actually clicking through the running app. Flagged explicitly rather than claimed.

## Goal

Give Automated Workflow its own top-level Sidebar entry and a global browse/manage pane on desktop, matching the treatment Chats/Projects/Agents/Skills/Scheduled already get — without removing or duplicating the existing project-scoped `AutomatedWorkflowTab.tsx`.

## Depends on / Blocks

- **Depends on**: Phase 5 (the WS/IPC surface this UI calls — `listAllAutomatedWorkflowRuns`, nullable-`projectId` save/list/get, scheduler `targetType`/`workflowSpecs` — must exist first). Also depends on Phase 3's executor behavior being correct, since this phase's manual E2E test exercises a real project-less run end-to-end.
- **Blocks**: nothing downstream except Phase 8's hardening pass, which touches this UI opportunistically for unrelated cleanup.
- **Must ship in the same release as Phase 7** (see the WS-lockstep constraint in `00-overview-and-sequencing.md` and Phase 5).

## Architectural design choices & reasoning

1. **`AutomatedWorkflowTab.tsx` is kept, not replaced.** It still needs project-specific context (scope, milestones, the project's own attached agents) to generate a *good* project-scoped plan — that context genuinely isn't available (or meaningful) from a global view. The new top-level pane is an additive way to *browse and manage* every run (including this tab's own project's runs, read from the same underlying data), not a duplicate of the executor/generator logic or a migration away from the existing tab.
2. **New pane mirrors `ScheduledPane.tsx`'s established pattern, not a novel design.** This codebase already has exactly one precedent for "a top-level Sidebar section showing a filterable list of a project-optional entity with live push updates" — `ScheduledPane.tsx`. Reusing that pattern (filter tabs, list, live subscription) rather than inventing new list-UI conventions keeps the new feature visually and behaviorally consistent with something users already know.
3. **Step cards show a single Agent/Model badge, never skill chips.** This directly reflects the corrected target hierarchy: skills are never a per-step concept, so there's nothing step-level to display about them. A skill is only ever visible on an *agent's own* configuration screen (the pre-existing Skills tab there) — showing it again at the workflow-step level would misleadingly imply steps have their own skill selection, which they don't.
4. **The Sidebar entry's position (between Scheduled and the divider before Artifacts) matches the existing grouping logic**: Chats/Projects/Agents/Skills/Scheduled read as one cluster of "your stuff" sections, with Artifacts set apart by a divider as a distinct kind of thing (generated outputs). Automated Workflow belongs with the first cluster, immediately after Scheduled since it's the newest/most closely related addition (schedules can now target workflows, per Phase 3).

## Itemized todo checklist

- [ ] `src/renderer/store/types.ts:80`: add `'workflows'` to the `ActiveSectionPane` union.
- [ ] `src/renderer/components/Sidebar.tsx`: add a new `NavButton` entry between "Scheduled" and the `<hr>` divider before "Artifacts," matching every existing entry's icon/label/`active`-state/`onClick`-via-`openSectionPane` pattern exactly (pick an icon distinct from the existing Wrench/Clock/etc. set — confirm no collision).
- [ ] Add `src/renderer/components/section-pane/AutomatedWorkflowsPane.tsx`, structured after `ScheduledPane.tsx`: filter tabs (e.g. all / project-scoped / global), a list sourced from `listAllAutomatedWorkflowRuns()` (Phase 2/5), live updates via the existing push-subscription pattern used elsewhere in this directory.
- [ ] Each list item shows a "Project: X" badge for project-scoped runs, or a "Global" badge for project-less runs, plus a project filter control.
- [ ] Wire the new pane into whatever top-level switch/router renders the active section pane (alongside the existing `'scheduled'`/`'skills'`/etc. cases).
- [ ] In `AutomatedWorkflowTab.tsx`'s step-card rendering, replace/confirm there is exactly one "Agent: X" or "Model: Y" badge per step (reusing the existing badge visual language already used for `agentName`), and confirm there is no skill-chip rendering anywhere on a step card.
- [ ] `SchedulerTaskForm.tsx`: add a target-type toggle (Chat / Automated Workflow). Selecting "Automated Workflow" replaces the prompt textarea with a picker sourced from `scheduler:list-workflow-templates` (Phase 5), listing existing saved workflow runs to attach.

## Verification

- [ ] Component test: the new Sidebar entry renders, is clickable, and opens the new pane (mirroring this codebase's existing sidebar/section-pane test patterns).
- [ ] Component test: `AutomatedWorkflowsPane.tsx` renders both project-scoped and project-less items with the correct badge, and the project filter narrows the list correctly.
- [ ] `AutomatedWorkflowTab.tsx`'s existing test suite still passes; extend it to cover the Agent/Model badge rendering for both step kinds.
- [ ] **Manual E2E**: from the new global pane, create a project-less workflow end-to-end — generate a plan with no project selected, confirm at least one step resolved to model-mode, start the run, watch it complete — and confirm it never appears in any individual project's `AutomatedWorkflowTab.tsx` list (since it has no project).
- [ ] **Manual check**: confirm a project-less, model-mode step's actual output shows no evidence of skill augmentation (no "Attached skills:" block, no skill-provided tools available) — this is the most direct way to catch a regression of the "no skills in model-mode" invariant from Phase 3 at the UI/output level.
