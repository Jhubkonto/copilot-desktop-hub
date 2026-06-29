# Project Workflow and Diff Audit Roadmap

## Summary

Implement this in four phases, in the same order as the product value/risk tradeoff:

1. Add a general project-level diff/activity audit surface for desktop and Android.
2. Replace the current project orchestration boolean with an explicit workflow mode model.
3. Add a manual workflow/delegation generator that outputs a reusable execution plan and copyable agent prompts.
4. Improve coding-project setup with repo auto-detection and deferred git-auth guidance, without collecting raw credentials.

This roadmap is project-scoped first, with desktop as the source of truth and Android consuming the same project/report data over the existing WebSocket channel.

## Progress Checklist

- [x] Phase 1: add shared project audit session/file types and SQLite persistence.
- [x] Phase 1: reuse the existing Remote Edit diff hunk schema for audit payloads.
- [x] Phase 1: add desktop IPC handlers for listing audit sessions, files, and diffs.
- [x] Phase 1: add desktop `Changes` UI in project settings with inline diff viewing.
- [x] Phase 1: record remote-edit workspace applies into the shared project audit log.
- [x] Phase 1: expose project audit listing and diff retrieval over WebSocket for Android/mobile consumers.
- [x] Phase 1: record project-scoped artifact-generated file creation into the shared project audit log.
- [x] Phase 1: instrument additional project-scoped non-remote-edit file mutation paths beyond remote edit and artifact generation.
- [x] Phase 1: add Android UI for browsing project audit sessions and diffs.
- [x] Phase 1: have Remote Edit read shared audit payloads where that reduces duplicated state.
- [x] Phase 2: add `workflowMode` with backward-compatible `orchestrationEnabled` mapping.
- [x] Phase 2: replace the desktop orchestration toggle with a 3-mode workflow selector.
- [x] Phase 2: gate orchestration behavior off `workflowMode`.
- [x] Phase 2: surface manual-delegation-specific controls in project UI.
- [x] Phase 2: add Android project config support for workflow mode.
- [x] Phase 2: add explicit backend-availability warnings for unsupported workflow modes.
- [x] Phase 3: define `ManualWorkflowSpec` and generator channels.
- [x] Phase 3: add desktop workflow generation, preview, copy, and start-step actions.
- [x] Phase 3: add Android read/generate parity for manual workflows.
- [x] Phase 4: add coding-project detection and repo metadata capture in project setup.
- [x] Phase 4: add deferred git-auth guidance UX for repo operations that require auth.

## Key Changes

---

### Phase 1: General Diff and File-Activity Audit

**Goal:** Let users see which files an agent touched, is touching, or proposed changing, without limiting this to Remote Edit/self-heal flows.

**Implementation changes**

- Add a new project-scoped audit model in `src/shared/types.ts` for:
  - `ProjectEditSession`
  - `ProjectTouchedFile`
  - `ProjectFileDiffSummary`
  - `ProjectEditSource` (`chat-tool`, `remote-edit`, `self-heal`, `manual-apply`)
- Persist edit-session metadata in SQLite using new tables for:
  - sessions
  - touched files
  - optional cached diff/hunk payloads
- Instrument existing file-edit paths in `src/main/tools.ts`, `src/main/remote-edit-handlers.ts`, and any built-in file mutation entrypoint so every write/create/delete/diff operation records:
  - conversation id
  - project id
  - agent id
  - relative path
  - operation type
  - timestamp
  - before/after diff if available
- Reuse the existing hunk/diff JSON shape from the Remote Edit flow instead of inventing a second diff schema.
- Add desktop IPC handlers to:
  - list edit sessions for a project
  - list touched files for a session
  - fetch full diff for a file
- Add WebSocket commands/events with the same payloads for Android parity.
- Desktop UI:
  - add a `Changes` or `Audit` entry in project settings or project view
  - show active/recent sessions with file counts, agent name, conversation title, timestamp
  - show touched files with badges for `modified`, `created`, `deleted`
  - open inline diff viewer using the existing Remote Edit visual style
- Android UI:
  - add a project-level audit screen, not hidden inside self-heal
  - keep the Android diff experience simpler: file list, expandable diffs, session metadata
- Keep Remote Edit’s existing report viewer, but have it read from the shared diff payload where possible so the product does not fork into two diff systems.

**Public/interface additions**

- New shared types for edit sessions and touched-file diffs.
- New IPC and WS commands for project audit listing and diff retrieval.

---

### Phase 2: Project Workflow Mode Settings

**Goal:** Replace the current `orchestration enabled` toggle with a project-level workflow mode that reflects how users want multi-agent work to happen.

**Implementation changes**

- Add a new project config field in shared/store types:
  - `workflowMode: 'single-agent' | 'manual-delegation' | 'orchestrated'`
- Keep `orchestrationEnabled` readable for backward compatibility; map it on load:
  - `true` -> `orchestrated`
  - `false` -> `single-agent`
- Extend project config parsing and persistence in main/store layers to support `workflowMode`.
- Update desktop project settings UI in `ProjectSettingsPanel.tsx` / `TeamTab.tsx`:
  - replace the orchestration toggle with a 3-state selector
  - only show orchestration depth/activity controls when mode is `orchestrated`
  - show manual workflow generator controls when mode is `manual-delegation`
- Update Android project config screen to expose the same workflow mode model.
- Update chat dispatch behavior:
  - `single-agent`: current normal agent flow
  - `manual-delegation`: no automatic orchestration; expose generated workflow/prompts to the user
  - `orchestrated`: current orchestration path
- Add guard rails:
  - disable `orchestrated` unless at least 2 project agents exist and one is primary
  - allow `manual-delegation` with 1+ agents
  - show explicit warnings when a selected mode requires unavailable backends

**Public/interface additions**

- `ProjectConfig.workflowMode`
- Backward-compatible load/save mapping for legacy `orchestrationEnabled`

---

### Phase 3: Manual Workflow / Delegation Generator

**Goal:** Generate a structured work plan for a project that users can run manually, either instead of orchestration or alongside it.

**Implementation changes**

- Define a generator output type in shared types:
  - `ManualWorkflowSpec`
  - includes title, goal summary, ordered steps, assigned agent per step, expected outputs, and copyable prompt text per step
- Add a new main-process generator handler:
  - input: project id, user goal, optional constraints
  - context: project config, team agents, primary agent, workflow mode, root directory, optional scope/milestones
  - output: tagged JSON block parsed into `ManualWorkflowSpec`
- Reuse the existing generator architecture/pattern from project and agent generators:
  - streaming tokens
  - tagged spec extraction
  - preview before apply/save
- Desktop UI:
  - add a `Generate Workflow` entry in the project team/workflow area
  - preview plan with:
    - ordered steps
    - assigned agent/backend
    - prompt text
    - copy button
    - `Start step in chat` action where feasible
  - optionally store approved workflows under project artifacts/history
- Android UI:
  - add read/generate/apply parity through WS
  - Android does not need advanced drag/reorder in v1; view, copy, and start step is enough
- Scope the generator tightly:
  - it does not execute work
  - it does not create agents automatically
  - it does not mutate project config except optionally saving the workflow artifact
- If project workflow mode is `manual-delegation`, surface the generator as the primary recommended action in the project UI.

**Public/interface additions**

- `ManualWorkflowSpec` shared type
- Generator IPC/WS channels and payloads

---

### Phase 4: Coding-Project Setup and Repo Detection

**Goal:** Make project setup smarter for coding work, but avoid insecure credential collection.

**Implementation changes**

- Add coding-project setup logic to project creation/edit flow, not first-run onboarding.
- When a project root directory is chosen:
  - auto-detect whether it is a git repo
  - capture branch and dirty-state metadata
  - store lightweight repo metadata in project config or derived workspace info
- Add a small project-setup prompt only when relevant:
  - detect likely coding project from root contents (`package.json`, `pom.xml`, `.git`, `src/`, etc.)
  - if coding-related, ask whether Nexy should treat this as a software workspace and enable coding-focused affordances
- Do not ask for git credentials during project setup.
- Add a deferred git-auth UX only on operations that require it, such as push/fetch/clone:
  - if auth fails, show guidance to use system git auth / CLI login / credential manager
  - if a future credential integration is added, store tokens via secure OS mechanisms only, never raw project-scoped plaintext settings
- Expose repo state in project UI:
  - repo detected / not detected
  - current branch
  - dirty/clean
  - optional warning when workflow/diff features are reduced outside git repos
- Feed repo status into Phase 1 audit UI so users understand when full diffs are available versus best-effort file change logs.

**Public/interface additions**

- Project workspace metadata for repo detection and branch/dirty state
- Optional project flag such as `codingWorkspace: boolean` if needed for UX branching

---

## Test Plan

- Unit tests for project config migration:
  - legacy `orchestrationEnabled` maps correctly to `workflowMode`
  - new `workflowMode` persists and reloads correctly
- Unit tests for audit recording:
  - file edit creates session/file rows
  - multiple edits in one conversation append to the same active session where intended
  - create/delete/modify operations produce correct status badges
  - diff payload retrieval returns the expected hunk shape
- Unit tests for repo detection:
  - git repo returns branch and dirty state
  - non-git directory returns safe fallback metadata
  - coding-project heuristic detects common codebase markers
- Generator tests:
  - manual workflow tagged spec parses correctly
  - invalid or missing tagged JSON returns recoverable error
  - generator context includes team and project data
- Renderer tests, desktop:
  - workflow mode selector shows correct controls per mode
  - audit panel lists sessions and opens diffs
  - manual workflow preview renders steps and copy/start actions
  - project setup shows coding/repo hints only when applicable
- Android tests:
  - audit screen renders sessions and diffs from WS payloads
  - project config workflow mode round-trips correctly
  - manual workflow screen renders generated steps and prompt text
- Integration/regression:
  - existing Remote Edit diff review still works
  - existing orchestration still works when `workflowMode = 'orchestrated'`
  - single-agent chat behavior is unchanged for projects not using the new features

## Assumptions

- Target roadmap file: `roadmap/roadmap-new/PROJECT_WORKFLOW_AND_DIFF_AUDIT_ROADMAP.md`
- Desktop remains the source of truth for filesystem and git operations; Android consumes results remotely.
- Existing Remote Edit diff schema should be reused rather than replaced.
- `manual-delegation` is a project behavior mode, not a new chat backend.
- Git credentials are explicitly out of scope for this roadmap; only repo detection and auth guidance are included.
- If a project has no root directory, Phase 1 audit can still show file-touch logs, but git-aware diffs/metadata may be limited.
