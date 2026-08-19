# Roadmap: Managed-Artifact Automated Workflows

Drafted 2026-08-15. **Status: IN PROGRESS.**

## Executive summary

Nexy's Automated Workflow feature should become a managed deliverable-production system rather
than a generic automation builder. A workflow should turn explicitly selected source material into
reviewable, versioned deliverables and publish only the exact version a user approved.

The first proving workflow is intentionally narrow:

```text
Selected project files
        |
        v
Immutable source snapshot
        |
        v
One or more model transformations
        |
        v
Markdown artifact version
        |
        v
Human review and editing
        |
        v
Exact-version content approval
        |
        v
Project-file diff preview
        |
        v
Publish-action approval
        |
        v
Atomic project-file write
```

This preserves the feature's original purpose: Nexy provides the planning, state, dependency,
review, and side-effect machinery, while less capable or cheaper models perform bounded content
transformations. The model does not need to explore a workspace, remember prior outputs, manage
files, or decide when a side effect is safe.

Desktop remains authoritative for project files, SQLite, artifact storage, model execution, and
scheduling. Paired Android receives full authoring and execution-control parity through the
existing authenticated WebSocket connection. Android standalone execution is explicitly outside
this roadmap.

## Decision in one sentence

**Make workflows produce immutable, traceable deliverables inside Nexy's existing Artifact system,
then let users review and deliberately publish an approved version.**

## Product contract

### The problem this solves

The feature should solve a specific recurring problem:

> Produce the same kind of important deliverable from changing source material, with a visible
> process, reviewable intermediate results, and a safe handoff into the user's project.

Examples include weekly reports, design drafts, release notes, meeting summaries, audit reports,
and documentation updates. The differentiator from chat is not that a workflow can generate text.
It is that Nexy can repeatedly gather declared inputs, preserve what was used, coordinate multiple
bounded transformations, return later with a ready draft, and publish only an approved version.

### User language versus engine language

The engine may need artifact IDs, version IDs, dependency bindings, checksums, approval records,
and snapshots. The interface should expose deliverables and stages:

```text
User sees                         Engine manages
-------------------------------  ------------------------------------------
Weekly report                    artifact + immutable artifact versions
Project notes                    source snapshot artifact versions
Prepare a draft                  model step + declared version bindings
Needs review                     review state + content approval record
Out of date                      dependency lineage + stale state
Write to reports/weekly.md       publish preview + action approval + result
```

The governing principle is:

> The engine manages artifacts. The user manages deliverables.

### Non-goals for the first release

- A general-purpose visual programming environment.
- Arbitrary shell commands or unrestricted filesystem actions.
- Loops, dynamic branching, or model-created steps during a run.
- Autonomous project exploration.
- Email, ticket, cloud-upload, or Git publishing.
- Android-local workflow execution or a second mobile artifact store.
- Treating a mutable working file as the authoritative workflow state.

## Current implementation baseline

This roadmap extends shipped systems rather than replacing them.

### Automated workflows today

- `src/shared/types.ts` defines generated workflow specs, dependency IDs, persisted run steps,
  confirmation modes, and run/template summaries.
- `src/main/automated-workflow-generator.ts` creates workflow plans conversationally.
- `src/main/automated-workflow-runs.ts` persists reusable templates, runs, and steps.
- `src/main/automated-workflow-executor.ts` topologically orders steps, runs each step through an
  agent or bare model, streams output, and pauses in gated mode.
- Dependency output is currently woven into the next prompt as text and truncated per dependency
  to 6,000 characters. The step output itself is stored as one mutable string.
- Editing during confirmation overwrites that string before marking the step done. The edited
  version has no independent identity or provenance.
- Templates can be run again, and scheduled tasks can spawn workflow runs.
- Desktop IPC and Android WebSocket handlers already support generation, save/list/detail,
  start, confirmation with edited output, retry, skip, abort, confirmation mode, scheduling, and
  run-again.

### Artifact system today

- Migration 33 created `artifacts`, `artifact_versions`, and `artifact_files`.
- `src/main/artifacts.ts` provides version lookup, file access, conversation promotion, deletion,
  export, and version writing.
- Each `ArtifactVersion` already has a stable ID, increasing version number, manifest, file list,
  source conversation/message fields, creator agent IDs, and creation timestamp.
- Desktop and Android already have artifact browsing and version-history surfaces.

The missing layer is not another file store. It is workflow-specific lineage and control: exact
input/output version bindings, source snapshots, review state, staleness, and safe publication.

### Android boundary today

`AutomatedWorkflowScreen.kt`, `AutomatedWorkflowListScreen.kt`, `WsRepository.kt`,
`WsEventParser.kt`, and `WsEvent.kt` already implement a paired Android workflow experience. The
Android standalone contract correctly classifies artifact creation, workspace writes, scheduled
execution, and live process control as desktop-required capabilities.

This roadmap preserves that boundary:

```text
Android UI
    |
authenticated WebSocket commands/events
    |
Desktop workflow service
    +-- SQLite workflow and artifact records
    +-- project source snapshots
    +-- model execution
    +-- scheduler
    +-- publish transaction
```

Android may fully create, configure, inspect, edit, approve, schedule, and control a managed
workflow while paired. It does not silently queue approvals or publishes while disconnected.

## Target domain model

### Step kinds

Add an explicit `kind` to new workflow steps:

```ts
type AutomatedWorkflowStepKind = 'collect' | 'model' | 'review' | 'publish'
```

| Kind | Responsibility | Model call | Can create a side effect |
| --- | --- | --- | --- |
| `collect` | Snapshot declared project sources into an artifact version | No | Only inside managed storage |
| `model` | Transform declared artifact-version inputs into a new artifact version | Yes | No |
| `review` | Let a human edit and approve an exact artifact version | No | No |
| `publish` | Preview and publish an approved version to a declared destination | No | Yes, after action approval |

Steps without `kind` remain valid and are interpreted as legacy model steps. They continue to use
the current output-string behavior until their template is explicitly upgraded. Do not silently
change the meaning of a saved legacy template.

### Proposed shared contracts

The exact TypeScript names may change during implementation, but the shared contract should encode
these concepts explicitly:

```ts
interface WorkflowArtifactBinding {
  bindingId: string
  source:
    | { type: 'project-files'; projectSourceId: string; include: string[] }
    | { type: 'step-output'; stepId: string; outputName: string }
  required: boolean
}

interface WorkflowDeliverableDefinition {
  name: string
  title: string
  kind: ArtifactKind
  primaryPath: string
  mediaType: string
}

interface WorkflowPublishDestination {
  type: 'project-file'
  projectSourceId: string
  relativePath: string
  conflictPolicy: 'require-new-preview'
}
```

A `collect` step owns project-source bindings. A `model` step owns declared input bindings and one
or more output definitions. A `review` step references one upstream output. A `publish` step
references a reviewed output and one declared destination.

Keep the generated spec understandable and serializable. Runtime-resolved artifact/version IDs do
not belong in templates; they belong in run records.

### Persistence additions

Add append-only migrations in `src/main/database-migrations.ts`. Do not edit migration 33 or the
existing workflow migrations. Prefer normalized linkage tables over embedding evolving runtime
state inside the template JSON.

Recommended tables:

#### `automated_workflow_step_artifacts`

Records every exact version consumed or produced by a run step.

```text
id
run_id
step_id                 automated_workflow_run_steps.id
binding_name
direction               input | output
artifact_id
artifact_version_id
source_step_id           nullable
created_at
```

Required constraints/indexes:

- unique output binding per step attempt;
- index by `run_id` and `step_id`;
- index by `artifact_version_id` for provenance lookup;
- no mutation of an existing binding after a step reaches a terminal state.

#### `automated_workflow_reviews`

Stores content-review decisions separately from run-step execution.

```text
id
run_id
step_id
artifact_version_id
decision                approved | rejected
reviewed_by_client       desktop | android
reviewed_at
superseded_at            nullable
```

Editing produces a new `artifact_versions` row. It never changes the approved version in place.
Any approval for a previous version remains auditable but becomes superseded.

#### `automated_workflow_publish_previews`

```text
id
run_id
step_id
artifact_version_id
project_source_id
relative_path
destination_checksum    nullable for a new file
before_content_ref       nullable
diff_text
created_at
expires_at               nullable
invalidated_at           nullable
```

The destination checksum binds a preview to the file state the user saw.

#### `automated_workflow_publish_actions`

```text
id
preview_id
idempotency_key
status                   pending | publishing | published | failed | conflicted
approved_by_client
approved_at
started_at
completed_at
before_recovery_ref      nullable
result_checksum          nullable
error                    nullable
```

The implementation may consolidate preview/action data if the same invariants and history remain
queryable. The important design requirement is that content approval and action approval are
separate durable facts.

### Artifact storage rules

- Reuse `artifacts`, `artifact_versions`, and `artifact_files` as the canonical managed store.
- Every model completion creates a new immutable artifact version before the step can be reviewed.
- Every human edit creates another immutable version and changes the review step's current target.
- Source snapshots are artifacts too, with a manifest containing original project source ID,
  relative path, size, checksum, and snapshot timestamp.
- Never use a live project path as a model input after the collect stage has completed.
- Preserve the current step `output` string as a compatibility/display projection for legacy
  clients during migration; it must not remain authoritative for managed steps.
- Artifact deletion must be blocked or converted to archival while a workflow lineage, approval,
  or publish record references the version.

### Provenance graph

```text
Project notes at 09:00
        |
        v
Source snapshot version S1
        |
        +--------------------+
        |                    |
        v                    v
Draft version D1        Findings version F1
        |                    |
        +----------+---------+
                   v
           Revised draft D2
                   |
             user edits
                   v
           Revised draft D3
                   |
          content approval
                   v
            publish preview P1
                   |
           action approval
                   v
          reports/weekly.md
```

Every arrow is represented by a persisted version binding. A downstream step never depends on
"whatever the previous step currently says."

## Execution semantics

### Run creation and collection

When a manual or scheduled run is created:

1. Freeze the template/spec used for the run.
2. Validate that all project source IDs and relative paths remain within declared project roots.
3. Execute each ready `collect` step by reading the selected sources once.
4. Write the snapshot files and manifest into managed artifact storage.
5. Bind the resulting exact version IDs to the run and downstream steps.
6. Continue only if all required sources were captured successfully.

If a selected file is missing or unreadable, fail the collect step with a specific error. Do not
substitute a newer or similarly named file.

### Model-step context

Replace implicit predecessor-output weaving for managed steps with explicit binding resolution.
The prompt builder should receive:

- the step's authored instruction;
- a manifest of named inputs;
- complete content for each declared artifact file, within validated model/context limits;
- project/agent instructions only when the workflow explicitly enables them.

Do not silently truncate a managed input. Estimate the complete request before execution and
either:

- accept it;
- apply a user-visible, deterministic reduction configured by the workflow; or
- fail before the model call with a message explaining which binding exceeds the limit.

Legacy steps retain `weaveStepPrompt()` until migrated.

### Review and editing

A review step pauses on an exact `artifactVersionId` and offers:

- rendered Markdown;
- raw Markdown editing;
- version history and version comparison;
- provenance summary;
- approve, reject, or request regeneration;
- clear stale-state warnings.

Saving an edit creates a new artifact version. Approval targets the saved version ID. Desktop and
Android use the same compare-and-set operation so a stale client cannot approve a version that was
superseded elsewhere.

### Staleness and invalidation

Changing, editing, or regenerating an upstream output marks all transitive downstream managed
outputs stale.

```text
Source S1 -> Draft D1 -> Summary M1 -> Publish preview P1
    |
source recollected as S2
    |
    +------ Draft D1, Summary M1, and preview P1 become stale
```

Rules:

- stale artifact versions remain readable as history;
- stale outputs cannot receive a new content approval;
- a stale approved version cannot be published;
- existing content and action approvals are superseded, not deleted;
- `Regenerate affected steps` resets only the transitive downstream managed steps;
- concurrent invalidation and approval use a transaction and version check.

Add `stale` as an explicit step/output state or persist a separate staleness record. Do not infer
staleness only in the renderer.

### Content approval versus publish approval

These are distinct decisions:

```text
Content approval: "This exact report version is correct."
Action approval:  "Write it to this destination, replacing the state shown in this diff."
```

A compact UI may present both sequentially in one flow, but persistence and validation must remain
separate.

### Publish transaction

The first publish destination is one project-relative file.

Preview:

1. Resolve `projectSourceId` to its authoritative desktop root.
2. normalize and validate `relativePath`;
3. reject absolute paths, traversal, links that escape the root, or an undeclared destination;
4. read the current destination, if present;
5. compute its checksum and a unified diff against the approved artifact file;
6. persist the preview and return it to both clients.

Confirmation:

1. atomically claim the action by idempotency key;
2. re-read and checksum the destination;
3. if it differs from the preview checksum, mark the action `conflicted` and require a new preview;
4. write a temporary file in the destination directory;
5. flush and atomically replace/rename where the platform permits;
6. retain recoverable before-state metadata;
7. record the result checksum and broadcast the final state.

Never publish from streaming buffers, a mutable editor value, or a stale step output. The bytes
written must come from the approved artifact version referenced by the preview.

### Retry, cancellation, and crash recovery

- Retry creates a new step attempt and new output version; it does not overwrite an earlier
  version or binding.
- Cancelling during a model call must not persist or publish its eventual result.
- A crash during collection leaves an incomplete version unbound and eligible for cleanup.
- A crash after an artifact version is committed but before the step transition is recovered by
  finding the attempt's unique output binding.
- A crash during publish is reconciled from the action status, destination checksum, temp-file
  state, and recovery reference before any retry.
- A retry of an already published idempotency key returns the existing result.

## API and event surface

### Desktop IPC

Follow the repository IPC pattern: add channels and return types in `src/shared/types.ts`, expose
typed wrappers in `src/preload/index.ts`, register handlers through `safeHandle`, and include mocks
in `src/test/mocks/api.ts`.

The implementation should expose operations equivalent to:

- validate/list workflow sources;
- get a step's artifact bindings and provenance;
- get artifact/version content for review;
- create a new edited artifact version with expected-current-version protection;
- approve or reject an exact version;
- regenerate affected steps;
- create/get/refresh a publish preview;
- confirm a publish action idempotently;
- query publish/recovery status.

Prefer resource-oriented payloads over UI-specific commands. Every mutation includes `runId`,
`stepDbId`, the expected current version or preview ID, and an idempotency key where applicable.

### WebSocket and Android models

Mirror each required operation in `src/main/ws-handlers.ts`, `WsRepository.kt`, `WsEventParser.kt`,
and `WsEvent.kt`. Continue to use the existing authenticated connection and desktop broadcasts.

Required event families include:

- run detail changed;
- artifact version created or current review target changed;
- downstream steps invalidated;
- review decision recorded or rejected as stale;
- publish preview ready/invalidated;
- publish action started/completed/conflicted/failed;
- review or publish attention required.

Events should carry stable IDs and state, not only display strings. Android must be able to
re-fetch authoritative detail after reconnect instead of relying on having observed every event.

### Cross-client concurrency

Desktop and Android may act on the same run. All mutations must therefore be compare-and-set and
idempotent:

- editing requires the expected current version ID;
- approval requires the current review target version ID;
- preview confirmation requires the current valid preview ID and destination checksum;
- duplicate confirmations return the already committed state;
- a losing client receives the authoritative current state, not a generic failure.

## Desktop experience

Extend the existing workflow surfaces rather than adding a parallel feature:

- `AutomatedWorkflowGeneratorModal.tsx` proposes step kinds, named deliverables, source bindings,
  and destination configuration in plain language.
- `AutomatedWorkflowShared.tsx`, `AutomatedWorkflowTab.tsx`, and
  `AutomatedWorkflowsPane.tsx` display the same managed-run state.
- Source selection uses project sources and validated project-relative paths.
- The plan preview displays `Collect`, `Create`, `Review`, and `Publish` stages with understandable
  inputs and outputs.
- Run detail provides artifact rendering/editing, provenance, version history, stale indicators,
  regeneration controls, and publish diff/confirmation.
- Auto confirmation must never auto-approve a publish action. It may advance safe internal model
  steps, but review and publish policies remain explicit in the workflow definition.

The default authoring path remains conversational:

> Every Friday, snapshot these project notes, prepare a weekly report, let me review it, then write
> the approved version to `reports/weekly.md`.

Nexy converts that request into a visible proposal that the user can edit without seeing artifact
IDs or database concepts.

## Paired Android experience

Paired Android is a full client for this workflow type, not merely an approval notification.

### Authoring parity

`AutomatedWorkflowScreen.kt` should support:

- conversational workflow generation and refinement;
- project-source browsing and multi-file selection;
- readable step-kind editing;
- input/output binding configuration;
- publish destination selection and validation;
- schedule creation and editing;
- final proposal review before saving.

All path selection is performed against desktop-provided project/source listings. Android must not
pretend a phone-local path is a desktop project path.

### Run and review parity

Android should provide:

- run status and per-step progress;
- Markdown rendering and raw editing;
- version history and comparisons;
- provenance and exact-version identity in an advanced detail area;
- stale warnings and regeneration controls;
- content approval/rejection;
- project-file diff preview;
- publish confirmation and conflict recovery;
- retry, skip where semantically allowed, abort, run-again, and history.

Compose layouts must remain usable on narrow screens. Large diffs and documents should be lazy,
scrollable, selectable, and fetched on demand rather than embedded in every run-detail event.

### Disconnected and standalone behavior

- Viewing cached metadata may remain possible if already available locally.
- Editing, approval, regeneration, scheduling changes, and publish are disabled while the desktop
  is unavailable; they are not queued because they require live authoritative validation.
- The UI explains: `Connect to your paired desktop to manage this workflow.`
- Standalone mode must not expose a control that appears to have succeeded locally.
- Reconnect triggers an authoritative run/version/preview refresh before enabling mutations.

## Scheduling and attention model

### Scheduled inputs

Every scheduled occurrence creates a new run and fresh source snapshot. A paused older run keeps
its original snapshot even if project files have changed.

### Overlap policy

Use one active run per workflow template by default. If another occurrence fires while a prior run
is running or awaiting human action:

```text
no queued replacement -> remember one replacement occurrence
replacement already queued -> coalesce the new occurrence into it
active run finishes -> start one fresh replacement run and snapshot current sources
```

Do not accumulate an unlimited backlog. Record coalesced/missed occurrences so the user can see
what happened.

### Notifications

Notify desktop and Android when:

- a review is ready;
- a workflow became stale and requires regeneration;
- a publish preview is ready for confirmation;
- a publish conflicted or failed;
- a scheduled occurrence was coalesced.

Notifications deep-link to the relevant run and step. They must not include confidential document
content on a lock screen by default.

## Delivery plan

Implementation begins only after this roadmap is promoted to `roadmap-in-progress/` and approved
against the repository's active milestone.

### Phase 0: Contract fixtures and migration design

**Goal:** Lock compatibility and state invariants before changing execution.

- [x] Add the new shared step/binding/deliverable/publish types with legacy-compatible defaults.
- [x] Create JSON fixtures for one legacy workflow, one managed Markdown workflow, run detail,
  artifact lineage, review, stale state, publish preview, and publish result.
- [x] Define TypeScript and Kotlin parsing tests from the same semantic fixtures.
- [x] Design append-only migrations and indexes for bindings, reviews, previews, and actions.
- [x] Define artifact retention behavior for workflow-referenced versions.
- [x] Document the state machine and allowed transitions for all four step kinds.
- [x] Decide explicit document/context size limits and errors; no silent truncation.

#### Phase 0 gate

- Existing stored template JSON parses unchanged.
- Existing workflow IPC and WebSocket payloads remain accepted.
- New payload fixtures round-trip through desktop normalization and Android parsing.
- Migration tests cover a pre-workflow database, current database, and repeated startup.
- Security review approves the path and publish invariants.

### Phase 1: Managed-artifact foundation

**Goal:** Make collect/model steps consume and produce exact immutable versions without publishing.

- [x] Add migrations and row mappers.
- [x] Add workflow artifact service functions around the existing Artifact subsystem.
- [x] Implement project-source resolution, path confinement, snapshot manifests, checksums, and
  cleanup of incomplete versions.
- [x] Persist per-attempt input and output bindings.
- [x] Add a managed prompt builder that resolves named version content and validates complete size.
- [x] Keep legacy `weaveStepPrompt()` behavior for legacy steps.
- [x] Make model completion commit an artifact version before transitioning to review/done.
- [x] Extend run detail with deliverable and binding summaries without embedding large contents.
- [x] Add provenance and binding query IPC/WS operations.

#### Phase 1 gate

- A run snapshots selected files and never re-reads them during downstream model steps.
- Two runs of one template bind different source versions when the project changes.
- Downstream steps consume exactly the declared version IDs.
- Model/context overflow fails before provider invocation and names the offending binding.
- Retry and crash-recovery tests do not create ambiguous duplicate output bindings.
- Legacy executor tests remain green.

### Phase 2: Markdown review and staleness

**Goal:** Deliver a complete safe workspace lifecycle before adding side effects.

- [x] Implement review-step state and exact-version current-target selection.
- [x] Add artifact-version editing with compare-and-set semantics.
- [x] Add content approve/reject operations and audit records.
- [x] Implement transitive staleness calculation and transactional invalidation.
- [x] Implement `Regenerate affected steps` with new step attempts.
- [x] Add Desktop Markdown review/edit/version/provenance UI.
- [x] Add paired Android review/edit/version/provenance UI and parser/repository support.
- [x] Add cross-client refresh and conflict messages.

#### Phase 2 gate

- Editing an approved document creates a new version and supersedes the approval.
- Upstream edits mark every transitive downstream output stale.
- Stale outputs cannot be approved or selected for publication.
- Simultaneous desktop/Android edits produce one winner and a recoverable conflict for the loser.
- A document can be authored on Android, executed on desktop, edited on either client, and approved
  from the other with identical final state.

### Phase 3: Safe Markdown publication

**Goal:** Publish one approved Markdown file into a project with an exact preview and explicit
action approval.

- [x] Implement destination validation and symlink/junction escape protection.
- [x] Reuse or extend `src/main/diff-utils.ts` for a bounded unified diff.
- [x] Persist preview checksum, diff, artifact version, and before-state recovery reference.
- [x] Implement action approval and idempotent publish claim.
- [x] Implement destination-drift detection and preview invalidation.
- [x] Implement temporary-write and atomic replacement with recovery behavior.
- [x] Add Desktop publish preview, confirmation, conflict, success, and recovery UI.
- [x] Add equivalent paired Android diff and action-approval UI.
- [x] Prevent `auto` confirmation mode from bypassing publish approval.

#### Phase 3 gate

- The published bytes match the approved artifact-version checksum.
- Absolute paths, traversal, and root-escaping links are rejected.
- Destination changes after preview always require a new preview.
- Duplicate confirmation from desktop and Android publishes once.
- Failed, cancelled, or interrupted steps never publish partial content.
- A simulated crash at each publish boundary is reconciled safely on restart.

### Phase 4: Authoring parity and product polish

**Goal:** Make managed workflows understandable to ordinary users on Desktop and paired Android.

- [x] Teach the workflow generator the four kinds, explicit bindings, and supported MVP limits.
- [x] Validate generated specs and perform one constrained repair attempt for invalid output.
- [x] Add readable plan cards and configuration forms on Desktop.
- [x] Add full source/binding/destination authoring on paired Android.
- [x] Add standalone/disconnected capability messaging and control gating.
- [x] Add reusable starter templates for weekly report, release notes, and design draft.
- [x] Add concise provenance and stale-state explanations.
- [ ] Run accessibility checks for keyboard, screen reader, focus order, touch target, and diff
  readability.

#### Phase 4 gate

- A user can create the weekly-report workflow without manipulating artifact IDs or JSON.
- The generated proposal states every source, deliverable, review gate, and destination.
- Desktop and Android can each create a workflow the other can edit and run.
- No Android control implies standalone execution.
- Usability testing shows users can explain what will be read, reviewed, and written before saving.

### Phase 5: Scheduling, notifications, and release evaluation

**Goal:** Prove the recurring unattended-preparation experience and decide whether to expand.

- [x] Implement one-active-run enforcement and one-replacement coalescing per template.
- [x] Snapshot fresh sources for each scheduled run.
- [x] Add durable attention states and desktop/FCM notifications.
- [x] Add deep links and authoritative refresh after notification/reconnect.
- [x] Surface missed/coalesced occurrences in run history.
- [ ] Instrument opt-in product metrics without capturing source or deliverable content.
- [ ] Conduct a go/no-go evaluation against chat-based document creation.

#### Phase 5 gate

- Scheduled runs preserve independent source snapshots.
- A review pause cannot create an unlimited backlog.
- Desktop and Android notifications open the correct current step.
- Users can understand why an occurrence was coalesced.
- Pilot users complete recurring deliverables with fewer repeated instructions and less manual
  reconstruction than in chat.

## Implementation record — 2026-08-16

The implementation now includes the managed-artifact engine, schema migration 92, exact-version
lineage, review/edit/staleness behavior, guarded project-file publication, Desktop IPC/UI,
authenticated WebSocket operations, paired-Android authoring and controls, starter prompts,
scheduled-run coalescing, durable attention records, and approval-required notifications.

Automated evidence added with the implementation covers:

- legacy workflow normalization and executor compatibility;
- shared managed contract fixtures and Android parsing of versions, provenance, stale state,
  previews, and actions;
- source snapshots, immutable model output, compare-and-set editing, rejection-driven
  regeneration, exact-version approval, destination drift, traversal rejection, publication, and
  checksum equality;
- scheduler overlap/coalescing and prevention of scheduler auto-approval for review/publish gates;
- Desktop managed workflow rendering and existing workflow controls;
- migration 92 on fresh, incremental, and repeated-startup database paths.

Verification completed on 2026-08-16:

- `npm run typecheck` passed.
- `npm run lint` passed with zero errors and three pre-existing warnings outside this feature.
- `npm test -- --run` passed all 200 files and 1,726 tests.
- `npm run build` passed.
- The targeted Android managed-workflow parser tests passed.
- Android `:app:assembleDebug` passed in offline mode after Gradle used its in-process Kotlin
  compiler fallback.
- The full Android JVM run reached 313 tests; its 29 failures are existing `ChatViewModelTest`
  failures caused by unmocked `android.os.SystemClock.elapsedRealtime`, while the managed-workflow
  tests passed.
- Android `lintDebug` remains blocked in the offline sandbox because uncached Android-test
  dependencies cannot be resolved. This is an environment gate, not a clean lint result.
- `git diff --check` passed for the working tree.

The roadmap remains **IN PROGRESS** rather than being moved to `roadmap-complete/`. These release
activities require human/device/product work and are intentionally not represented as completed by
unit tests:

- keyboard, screen-reader, touch-target, narrow-screen, and physical-device accessibility passes;
- connected Compose instrumentation and the five cross-platform acceptance scenarios;
- simulated process termination at every atomic publish boundary and recovery inspection;
- an explicit privacy/consent decision before any product telemetry;
- the pilot comparison against chat and its go/no-go decision.

## Test plan

### Desktop main-process tests

Add or extend tests under `src/main/__tests__/` for:

- migrations and legacy-template normalization;
- collect snapshots, manifests, file checksums, and missing-source errors;
- exact binding resolution and no live-file rereads;
- context validation without truncation;
- immutable output creation and per-attempt uniqueness;
- provenance traversal and retention protection;
- review compare-and-set, superseded approvals, and rejection;
- transitive invalidation and regeneration;
- path confinement, traversal, symlink/junction escape, and undeclared destinations;
- new-file and replacement diffs;
- destination drift, atomic writes, recovery, and idempotency;
- cancellation and application-restart recovery;
- schedule overlap/coalescing and fresh snapshot behavior;
- WebSocket validation and cross-client race behavior.

### Desktop renderer tests

Add tests under `src/renderer/` for:

- generated plan preview for all four step kinds;
- source, binding, deliverable, and destination editors;
- Markdown editing and save-conflict handling;
- version history, comparison, provenance, and stale indicators;
- regeneration confirmation;
- bounded/large diff rendering;
- content approval and publish approval as distinct actions;
- destination-conflict refresh;
- reconnect and authoritative-state replacement;
- keyboard and focus behavior.

### Android tests

Add JVM tests for `WsEventParser`, `WsRepository`, and models covering every new command/event,
missing optional fields, unknown forward-compatible fields, stale responses, and reconnect refresh.

Add Compose/instrumentation tests for:

- narrow-screen authoring and source selection;
- Markdown editing and unsaved-change protection;
- version history and comparisons;
- stale-state recovery;
- long diff scrolling and selection;
- approval and publication conflicts;
- disconnected/standalone gating;
- cross-platform deep links and resumed state.

### Cross-platform acceptance scenarios

1. Author on Android, execute on desktop, edit on Android, approve on desktop, preview and publish
   on Android.
2. Author on desktop, execute on schedule, receive an Android notification, edit and approve on
   Android, publish on desktop.
3. Open the same review on both clients, edit on one, and verify the other cannot approve the stale
   version.
4. Preview a destination on Android, modify the destination externally, and verify confirmation on
   desktop requires a new preview.
5. Pause a scheduled run for several occurrences and verify there is only one coalesced
   replacement with fresh inputs.

### Validation commands

Run the relevant targeted tests during each phase, then the full gates:

```text
npm run typecheck
npm run lint
npm test
npm run build

cd android
./gradlew testDebugUnitTest
./gradlew lintDebug
./gradlew assembleDebug
```

Run targeted connected Compose tests on a supported emulator/device before moving a phase that
changes Android UI into complete status.

## Security and privacy requirements

- Source and destination paths are resolved only through authoritative project/source records.
- All relative paths are normalized and confined after resolving links.
- Managed artifact contents and diffs are never written to routine logs.
- Notifications contain names/status only unless the user opts into content previews.
- Android commands require the existing authenticated/pinned WebSocket connection.
- Approvals are scoped to a run, step, artifact version, preview, destination state, and client
  request ID.
- A disconnected client cannot queue a publish approval.
- Artifact retention and cleanup never remove the only recovery copy for an incomplete publish.
- External publish destinations require a separate threat model and are not unlocked by the local
  project-file implementation.

## Observability and product evaluation

Operational metrics should count states and durations without collecting document contents:

- collect/model/review/publish success and failure counts;
- time waiting for review and publish approval;
- edit/version count per deliverable;
- stale/regeneration frequency;
- destination-conflict rate;
- scheduled-run coalescing rate;
- cross-client operation and reconnect-conflict rates;
- workflow completion and abandonment.

The product evaluation should compare the MVP with asking Nexy in chat to create the same document.
Continue expansion only if users value the ready-made recurring draft, understandable provenance,
editing/version history, and safe publication enough to justify the additional workflow setup.

## Later expansion, conditional on the MVP

After the Markdown workflow passes the Phase 5 review, consider:

- deterministic artifact transforms such as Markdown-to-PDF;
- multiple files in one deliverable;
- reusable source collections;
- destination-specific publishing to email, tickets, uploads, or Git commits;
- policy-based approval compaction for demonstrably safe actions;
- limited conditional branches based on deterministic validation results.

Every external destination needs its own preview, conflict, idempotency, audit, and approval design.
Arbitrary scripts, unrestricted mutation, loops, and general-purpose branching remain deferred
until a concrete user problem requires them.

## Documentation updates required during implementation

- Promote this file to `roadmap/roadmap-in-progress/` before implementation starts.
- Update `src/docs/ARCHITECTURE.md` when the workflow/artifact execution boundary changes.
- Update `docs/MOBILE_WEBSOCKET.md` with the new paired protocol operations and events.
- Update `docs/android-standalone-contract.md` only to clarify capabilities; do not imply mobile
  standalone execution.
- Add an ADR if the desktop-authoritative execution/storage boundary changes.
- Record per-phase verification evidence in this roadmap before moving it to
  `roadmap-complete/`.

## Assumptions and open decisions

### Locked assumptions

- Markdown-to-project-file is the first proof workflow.
- Existing artifact storage is reused.
- Existing workflow templates and runs remain readable and executable.
- Desktop is authoritative for execution, storage, project files, and scheduling.
- Android parity means full functionality while paired, not a second local executor.
- Content approval and publish approval remain separate durable decisions.
- Project-file publication always requires explicit action approval in the MVP.

### Decisions locked during implementation

- A collect or model step produces exactly one named deliverable in the Markdown MVP. A source
  snapshot may contain multiple files within that one artifact version.
- Individual source files are limited to 1 MB, a source snapshot to 4 MB, and a fully assembled
  managed prompt to 180,000 characters. Overflow fails before provider invocation; there is no
  silent truncation or automatic preprocessing.
- Workflow-referenced artifact versions cannot be deleted. Untracked filesystem output from a
  failed version commit is removed immediately.
- Publish recovery copies are retained under managed artifact storage. Automated expiry remains a
  future storage-policy decision rather than risking premature deletion.
- Regenerating or retrying a rejected review starts from that review's declared producer and
  invalidates the full transitive chain through review and publication.
- Required collect, review, and publish steps cannot be skipped. A model step may retain legacy
  skip behavior after failure.
- Scheduled approval notifications are durable in workflow attention state and use existing
  desktop/FCM task notifications. Reconnect always replaces Android state from desktop.
- External product telemetry remains disabled. Pilot metrics and consent require a separate
  privacy decision and remain an explicit release-evaluation item.

## Final release criterion

The managed-artifact workflow is ready for its first release only when a user can perform the full
Markdown lifecycle on either Desktop or paired Android, observe the same authoritative state on
both, and Nexy can prove that the file it published is the exact approved artifact version against
the exact destination state shown in the preview.
