---
document:
  title: "Nexy Artifacts, Workflows, Scheduling, Git, and Build Software Detailed Design"
  code: "SWDD-NEXY-AUTOMATION-ARTIFACTS-AND-GIT"
  controlled_document: true
template:
  source: "TEMP_SWDD_Software_Detailed_Design_v01"
project:
  number: "NEXY"
  name: "Nexy AI workspace"
release:
  date: "2026-08-19"
  baseline: "1.3.37"
  document_owner: "Nexy maintainers"
versions:
  - version: "1.0"
    change: "Initial detailed design record"
---

# 1. Purpose and scope

This detailed design explains the durable work-product and automation path: artifact versions, generated outputs, automated workflow plans and runs, managed review/publication, schedules, project Git operations, build dashboards, and local update feeds.

The design treats “generated text” and “managed deliverable” as different levels. A normal chat can produce text. A managed workflow adds lineage, exact version bindings, review decisions, previews, checksums, and safe publication.

# 2. Component summary

```text
generator chat
  → saved workflow specification/template
  → workflow run executor
       ├── dedicated step conversation
       ├── artifact/source version binding
       ├── review and attention state
       └── preview + atomic publication

scheduler engine ──→ chat run or workflow run

project Git workbench ──→ repository state/diff/stage/commit/push
build runner ──→ typecheck/test/build/package logs and update feed
```

| Component | Responsibility | Explicit boundary |
| --- | --- | --- |
| Artifact service | Store artifacts and immutable versions, export content | Does not itself decide workflow step order |
| Artifact generator | Convert generator-chat output into artifact specs/files | Does not publish directly |
| Workflow generator | Turn user goal into a reviewable plan | Does not execute until run start |
| Workflow executor | Advance step state, retries, skips, aborts, confirmation mode | Does not bypass managed publication checks |
| Managed workflow service | Bind exact versions, reviews, staleness, previews, publication | Does not keep a second document copy |
| Scheduler engine | Persist tasks, calculate triggers, create runs, retry/backoff | Does not invent tool permissions |
| Git workbench | Repository/branch/diff/staging/commit/push/stash actions | Does not replace AI coding conversations |
| Build runner | Execute controlled build commands and capture logs | Does not silently change project files outside the command |

# 3. Artifacts and version lineage

An artifact has a stable identity and one or more immutable versions. A version may contain one primary file or multiple named files, metadata, generator intent, and references to the producing conversation/run.

```text
artifact A
  ├── version 1 (original)
  ├── version 2 (edited)
  └── version 3 (regenerated/reviewed)
```

Editing never rewrites an old version. Consumers bind to `artifact_versions.id`, not “whatever the artifact currently means.” This makes reviews, quizzes, debriefs, workflow inputs, exports, and audit history reproducible.

Artifact types include documents, code, UI, data, prompts, plans, quizzes, debriefs, and teach-back material. Export supports Markdown/raw files as appropriate.

# 4. Workflow planning and execution

## 4.1 Planning

The user describes a goal in a generator chat. The generator creates a specification containing steps, dependencies, assigned agents or models, inputs/outputs, tool policy, and review/execution settings. The specification is saved as pending before execution.

Reusable templates are independent of run history. “Run again” starts a new run from the saved plan without asking the model to rediscover the goal.

## 4.2 Run state

```text
pending
  → running
      → waiting_for_confirmation
      → retrying
      → attention_required
      → completed
      → failed/aborted
```

Each step runs in a dedicated conversation. That prevents workflow instructions, intermediate tool history, and output from polluting the project’s main chat. A step can be confirmed, retried, skipped, or aborted according to its current state and dependency conditions.

Dependencies are ordered by explicit `dependsOnStepIds` where provided; otherwise the plan order is used. Dependent steps receive prior dependency outputs as context. A failed step stops downstream execution; retry restarts that step and its dependents as required.

## 4.3 Confirmation modes

- **Gated:** pause after each step for user approval.
- **Automatic:** continue immediately unless a failure or policy condition requires attention.

The schedule policy is stored with the scheduled task because timer-fired execution has no human present to answer an ordinary approval modal. Unattended tool use must be allow-listed and constrained.

# 5. Managed deliverable path

Managed steps are `collect`, `model`, `review`, and `publish`.

```text
declared project source
  → exact source version/snapshot
  → model-produced artifact version
  → human content review
  → destination/checksum preview
  → explicit publish approval
  → temporary file + atomic replacement
```

## 5.1 Staleness

Every input binding names an exact immutable version. If an upstream version is edited, dependent bindings become stale. The user can inspect affected steps and regenerate from a fresh producer instead of unknowingly publishing work based on an old input.

## 5.2 Review versus publish approval

Content approval answers “is this artifact version acceptable?” Publish approval answers “may this exact approved version be written to this destination now?” They are separate decisions.

## 5.3 Publication checks

Publication requires:

1. an approved, exact artifact version;
2. an unexpired preview;
3. a project-relative destination confined to the authoritative source;
4. rejection of symlink/link escapes and unsafe paths;
5. unchanged destination checksum since preview;
6. atomic replacement through a temporary file;
7. idempotent action handling so retries do not produce duplicate writes.

The Android app may author and review managed workflow state when paired, but source discovery, artifact storage, execution, preview, publication, and scheduling remain desktop-authoritative. Disconnected Android cannot queue a review or publish approval as an ordinary standalone mutation.

# 6. Scheduler design

The scheduler stores a task definition and separate run records. A task may target:

- a plain chat message; or
- one or more frozen workflow specs attached at task creation/update.

The engine rehydrates enabled tasks after app startup, computes one-time/recurring triggers, creates a run record, dispatches the target, and records success/failure/approval-required. Missed and failed work follows the configured catch-up/retry/backoff policy.

Notifications and tray summaries are derived from persisted task/run state. The scheduler can run without the main chat UI being open because it is a main-process service.

# 7. Git workbench design

The project Git workbench operates on repositories discovered under the selected project sources. It exposes typed operations for:

```text
discover → resolve repo → inspect status/diff
        → branches/checkout/new branch/fetch/pull/merge
        → stage/unstage → commit → push
        → stash/stash-pop or discard-file
```

Every mutating action returns a structured result and error. The project audit service records edit sessions, touched files, and file/hunk diffs so prior work can be reviewed. The workbench is a housekeeping/control surface; AI-assisted coding still happens in a normal project conversation with the configured backend/tools.

# 8. Build and update design

The desktop build dashboard can run preflight, typecheck, tests, build, package, and development launch commands. `build-runner.ts` starts the process, captures bounded stdout/stderr logs, publishes status events, supports cancellation, and writes build records.

The local update feed server can publish desktop/Android update artifacts to a user-selected location, list published entries, and support rollback actions. Electron packaging uses `electron-builder`; native modules such as `better-sqlite3` and `node-pty` require Electron-compatible rebuilding.

Android build actions use the desktop’s Gradle/ADB/signing pipeline when paired. Release metadata includes commit/build identity and signed APK handling. Android cannot run those desktop workspace operations in standalone mode.

# 9. Error handling and defensive measures

| Failure | Behavior |
| --- | --- |
| Invalid generated workflow | Keep the generator result inspectable; do not start a run |
| Step failure | Persist failed state, expose reason, stop dependents, allow retry/skip/abort as permitted |
| Stale artifact input | Block or flag dependent work until regenerated/rebound |
| Review rejection | Keep version and decision; require new review or regeneration |
| Expired publish preview | Require a new preview |
| Destination changed | Reject publish because checksum no longer matches |
| Unsafe relative path/link escape | Reject before filesystem write |
| Publish process interrupted | Atomic replacement prevents a half-written destination |
| Scheduled provider/tool unavailable | Record failed run and apply retry/backoff policy |
| Build canceled | Persist cancellation and retain log tail |
| Git conflict/failed command | Return structured error and leave repository for user resolution |
| Android disconnected | Keep cached workflow state; disable desktop-authoritative actions |

# 10. Verification references

| Verification area | Representative references |
| --- | --- |
| Artifact CRUD/export/versioning | `src/main/__tests__/artifacts*`, artifact renderer tests |
| Workflow generation/execution | `automated-workflow-generator`, executor, managed, runs, scheduler tests |
| Safe publication | managed workflow tests for confinement, staleness, previews, checksums, and atomic writes |
| Scheduling | `scheduler-engine.test.ts`, `scheduler-regression.test.ts`, `scheduler-ws.test.ts` |
| Git | `git-manager.test.ts`, project Git handler tests |
| Builds/feeds | build runner, publish feed, and Android build handler tests |
| Mobile operation | `MOBILE_WEBSOCKET.md`, Android workflow/build/project screens and ViewModels |
