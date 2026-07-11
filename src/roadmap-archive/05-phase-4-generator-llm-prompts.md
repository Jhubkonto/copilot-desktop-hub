# Phase 4 — Generator / LLM Prompt Exposure

Status: **DONE**. Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases.

## Implementation notes

`automated-workflow-generator.ts`: `ProjectWorkflowContext.projectId`/`.config` widened to `string | null`/`ProjectConfig | null`; `loadProjectWorkflowContext(null)` returns `{ projectId: null, projectName: '(no project)', config: null, agents: [] }` without touching the DB. `buildProjectContextBlock` short-circuits to a plain "no project, no agents, assign every step a model" message when `config` is null. `buildProviderMessages`/`runAutomatedWorkflowGeneratorChat`/`runAutomatedWorkflowGeneratorChatForAndroid`/the `automated-workflow-generator:chat` IPC handler all take `projectId: string | null`. The system prompt now documents the per-step agent-or-model either/or directly (no separate skills section — skills were never mentioned and still aren't). `normalizeAutomatedWorkflowSpec` parses a step's `model` field the same way `agentId` already was.

`scheduler-generator.ts`: `ScheduleGeneratorSpec` gained `targetType`/`sourceRunId`. The system prompt asks the user to pick standalone-task vs. attach-an-existing-workflow explicitly, rather than authoring a new multi-step spec inline (the scoped-down default from the original design). `normalizeSpec` validates `targetType === 'automated_workflow'` requires `sourceRunId`, and only requires `prompt` for the `'chat'` target. `createScheduleFromSpec` builds a frozen `workflowSpecJson` by reading the referenced `AutomatedWorkflowRunSummary`/`Detail` via `getAutomatedWorkflowRun` and re-shaping it into a plain `AutomatedWorkflowSpec` (stripping run-only fields), defaulting the attached spec's `confirmationMode` to `'auto'` per Phase 1's schema default.

**Verification result**: `automated-workflow-generator.test.ts` — added a test confirming a step's `model` field round-trips through `normalizeAutomatedWorkflowSpec`. `scheduler-generator.test.ts` — updated the one exact-shape assertion that needed the new `targetType: 'chat'` default, added 3 new tests (default targetType, valid automated_workflow+sourceRunId spec, rejection of automated_workflow with no sourceRunId). Full `main` suite: 783/783 passed. TypeScript compiles cleanly project-wide.

## Goal

Teach the two AI-authoring wizards — the Automated Workflow plan generator and the schedule generator — about the new fields from Phase 2, without exposing skills to either planner LLM at all.

## Depends on / Blocks

- **Depends on**: Phase 2 (needs `AutomatedWorkflowStep.model` and `ScheduledTask.targetType`/`workflowSpecs` to exist as types before the generators can populate them). Not strictly blocked by Phase 3, though full end-to-end testing (generate a plan, then actually run it) needs Phase 3's executor to exist.
- **Blocks**: Phase 5 needs this phase's IPC surface (the generator's output shape) finalized before mirroring it over WS.

## Architectural design choices & reasoning

1. **No skills list is exposed to the plan-authoring LLM, at all.** This is the direct consequence of Phase 3's central invariant: skill access is a structural side effect of the agent/model choice, invisible to the planner. Earlier drafts of this roadmap had the generator's prompt-context builder include a global skills list (to let the LLM "assign relevant skills per step") — that's retracted. The planner only ever needs to know about available agents and available models, not skills.
2. **The per-step choice is presented to the LLM as a simple either/or, not a preference ranking.** Each step gets either an `agentId` (chosen from the project's attached agents, when any exist) or a `model` (chosen from the available model list) — never both, never neither (falling back to a sensible default if the LLM's output is ambiguous is the generator's job via `normalizeAutomatedWorkflowSpec`, not the executor's).
3. **`loadProjectWorkflowContext(projectId: string | null)` returning `agents: []` for a `null` project is a deliberate nudge, not just a null-safety shim.** A project-less plan has no agents to offer the LLM in the first place (there's no `project_agents` join to query without a project), so the natural, honest context to hand the LLM is "no agents available here" — which in turn biases the generated plan toward model-mode steps, which is exactly the execution path Phase 3 built for this case. No special-casing needed in the prompt itself beyond just reporting reality.
4. **Schedule generator defaults to "attach an existing saved workflow," not full recursive spec generation.** When a user wants a schedule to target `'automated_workflow'`, the simpler and recommended default is referencing an already-generated, already-reviewed `AutomatedWorkflowRunSummary` via `sourceRunId` (freezing its spec at attach time, per Phase 1's `workflow_spec_json` design) rather than asking the schedule-generator LLM to author a brand-new multi-step workflow spec inline, recursively, inside a different generator's conversation. Full recursive generation is flagged as a possible future enhancement, not required scope for this phase — it adds real complexity (nesting one generator's output format inside another's) for a case a user can already accomplish in two steps (generate/save a workflow first, then point a schedule at it).

## Itemized todo checklist

### `src/main/automated-workflow-generator.ts`
- [ ] `loadProjectWorkflowContext(projectId: string | null)`: widen the signature; when `projectId` is `null`, skip the project/agents SQL query entirely and return a context with an empty `agents: []` and a clear "(no project)" project-name placeholder.
- [ ] Update `buildProjectContextBlock` (or wherever the prompt-context text is assembled) to read naturally for the project-less case — don't just print an empty "Agents:" section; state plainly that this plan has no project and no agents available, so every step should specify a model directly.
- [ ] Update the system prompt (`AUTOMATED_WORKFLOW_GENERATOR_SYSTEM_PROMPT` or equivalent) to document the per-step binary choice: assign `agentId` (from the listed project agents, when any) or `model` (from the available model list) — never a skill list, and the prompt should not mention skills at all.
- [ ] `normalizeAutomatedWorkflowSpec`: parse/validate the new `model` field on each step the same way `agentId` is already validated (e.g. trim/validate as a plain string, no special normalization needed beyond what other string fields already get).
- [ ] Confirm nothing in this file still references skills (grep for "skill" in this file after the change — should be zero matches, matching the pre-Phase-1 baseline).

### `src/main/scheduler-generator.ts`
- [ ] `ScheduleGeneratorSpec` (shared type) gains `targetType: 'chat' | 'automated_workflow'`.
- [ ] When `targetType === 'automated_workflow'`, the spec gains a `sourceRunId: string` referencing an existing saved `automated_workflow_runs` row (the recommended, in-scope default) — the generator conversation asks the user to identify/confirm which saved workflow to attach, rather than authoring a new one inline.
- [ ] Update the schedule-generator system prompt to document the `targetType`/`sourceRunId` fields and the "attach an existing workflow" flow in plain language.
- [ ] `createScheduleFromSpec()`: when `targetType === 'automated_workflow'`, after persisting the `scheduled_tasks` row, also call `dbSetScheduledTaskWorkflows` (Phase 2) to attach the referenced spec (fetched and frozen from the `sourceRunId`'s current `workflow_spec_json`, per Phase 1's design).
- [ ] Reject/handle the invalid case explicitly: a spec with `targetType: 'automated_workflow'` but no `sourceRunId` (or an unresolvable one) should fail validation with a clear error rather than silently falling back to `'chat'` behavior.

## Verification

- [ ] Generate a project-less plan end-to-end (no project selected) and confirm every step in the resulting spec has a `model`, no `agentId`, and the prompt context genuinely contained no agents section with real entries.
- [ ] Generate a project-scoped plan and confirm the LLM still assigns real `agentId`s from that project's agents where sensible (no regression in the existing, already-working case).
- [ ] `normalizeAutomatedWorkflowSpec` round-trips a step's `model` field through parse/validate without alteration.
- [ ] Grep confirms zero "skill" references remain in `automated-workflow-generator.ts` after this phase.
- [ ] Schedule spec parser: a spec with `targetType: 'automated_workflow'` and a valid `sourceRunId` parses successfully and results in `dbSetScheduledTaskWorkflows` being called with the correct frozen spec.
- [ ] Schedule spec parser: a spec with `targetType: 'automated_workflow'` and no/invalid `sourceRunId` is rejected with a clear validation error, not silently treated as a `'chat'` schedule.
