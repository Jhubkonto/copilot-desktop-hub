# Nexy Android - Desktop Parity Roadmap

Last updated: 2026-06-20

This document tracks the work needed to bring the Android companion app to practical parity with the current Electron desktop app. Parity means matching current desktop behavior through the paired desktop bridge; removed desktop features are not Android targets.

Status legend:

- `Done` - implemented on Android and wired through the desktop bridge.
- `Partial` - present, but missing important desktop behavior or polish.
- `Missing` - desktop has the feature and Android does not.
- `Mobile-adjusted` - Android should provide a practical equivalent for desktop-local OS behavior.

---

## Current Android Baseline

- Chat send/receive/stream/stop, attachments, latest screenshot attach, prompt insertion, per-conversation model picker, and context inspector.
- Conversation list/create/rename/delete/search/export/fork/import and message delete.
- Project and agent list/create/rename/delete.
- Basic project config and team-agent management.
- Basic agent config editing.
- Provider key management, CLI status plumbing, settings screens, model diagnostics.
- MCP server list read-only.
- Project Generator exists and should be reachable from project creation, not Settings.
- Agent Generator exists and is routed from the Agents area.
- Artifacts list/detail/export exists and should be reachable as a content/tool area, not Settings.
- Prompt CRUD and insert into chat.
- Wiki CRUD code exists and is routed from Project Config.
- Self-heal reports/detail/investigation/fix/verification/git/reload flows.
- Updates, pairing, multi-profile, notifications, diagnostics.

---

## Parity Gap Matrix

| Area | Android status | Remaining work |
|------|----------------|----------------|
| Navigation / IA | Partial | Ensure every desktop top-level pane has an Android destination or documented mobile-adjusted equivalent. |
| Models | Partial | Add visible Android errors when global default model resolution fails. |
| Providers | Partial | Add Azure endpoint and provider test/has-key flows. |
| Chat UI | Partial | Add advanced conversation controls and richer stream metadata rendering. |
| Skills | Done | Core CRUD, import/export, usage, editor parity, and agent-skill links are covered. |
| Skill Generator | Done | Desktop WS bridge, Android parser/repository/UI, and generator flow tests are covered. |
| Agent Generator | Done | Android parser/repository/UI parity and generator flow tests are covered. |
| Agent Config | Done | Full desktop field parity achieved: skills, knowledge files, MCP assignment/trust/tool overrides, tool instructions, thinking effort, context files/rules, root directory, custom commands. |
| Project Settings | Done | General, Scope, Milestones, Team, Wiki, Artifacts, default model, root directory, and orchestration controls are covered. |
| Artifacts | Done | Version history, export/share, delete, revision generation, and storage-root visibility are covered. |
| Prompts | Partial | Prompt version history and rollback are covered; complete any remaining project-context polish found during QA. |
| Wiki | Partial | Add extraction from conversation and source conversation/message display. |
| MCP | Partial | Add server add/update/remove/restart/status/tools/trust/agent overrides. |
| Developer tooling | Mobile-adjusted | Add read-only build/update dashboards and guarded desktop-triggered actions where useful. |

Feature Generator is intentionally excluded because it has been removed from the desktop app.

---

## Manager Phases

### Phase 0 - Roadmap Hygiene And Protocol Audit

- [x] Replace stale "complete parity" status with the current gap matrix.
- [x] Remove Feature Generator from the Android parity roadmap.
- [x] Add status legend and mobile-adjusted policy.
- [x] Add a WS coverage table for each remaining area: desktop IPC, desktop WS, Android parser, Android repository, Android UI.
- [x] Keep this roadmap updated as phases land through Phase 8.

### WebSocket Coverage Table

| Area | Desktop IPC | Desktop WS | Android parser | Android repository | Android UI |
|------|-------------|------------|----------------|--------------------|------------|
| Skills CRUD | Done | Done | Done | Done | Done |
| Skill import/export | Done | Partial | Partial | Done | Done |
| Agent-skill links | Done | Done | Done | Done | Done |
| Skill Generator | Done | Done | Done | Done | Done |
| Artifact Generator | Done | Done | Done | Done | Done |
| Full Agent Config | Done | Done | Done | Done | Done |
| Full Project Settings | Done | Done | Done | Done | Done |
| Artifact lifecycle | Done | Done | Done | Done | Done |
| Prompt versions | Done | Done | Done | Done | Done |
| Wiki extraction/source markers | Done | Missing | Missing | Missing | Partial |
| MCP management/tools/trust | Done | Partial | Partial | Partial | Partial |
| Provider Azure/test-key | Done | Done | Done | Done | Done |
| Advanced conversation controls | Done | Partial | Partial | Partial | Partial |

### Phase 1 - Navigation And IA Parity

- [x] Move Project Generator out of Settings into the Projects creation flow.
- [x] Move Artifacts out of Settings into a desktop-parity content/tool entry point.
- [x] Add Android route for Skills.
- [x] Add missing Android route for Skill Generator.
- [x] Add missing Android route for Artifact Generator.
- [x] Add missing Android routes for full Project Settings sections.
- [x] Ensure every desktop top-level pane has an Android destination or documented mobile-adjusted equivalent.
- [x] Add consistent empty/error/retry states for each parity screen.

### Phase 2 - Models, Providers, And CLI Model Parity

- [x] Verify Android new-chat model dropdown includes all desktop-available provider models when no agent/project is selected.
- [x] Fix missing OpenRouter models in the new-chat model dropdown if the desktop bridge is not returning them.
- [x] Fix Android Settings model list so it shows the full grouped model list, including OpenRouter.
- [x] Add a dedicated CLI Models entry/section in Android Settings.
- [x] Ensure global default model resolution produces visible Android errors when it fails.
- [x] Fix OpenRouter provider row layout so "Configured" never wraps awkwardly.
- [x] Add provider parity for Azure endpoint and provider test-key flows.

### Phase 3 - Chat UI Polish And Conversation Parity

- [x] Equalize Android chat history row heights.
- [x] Move the send button inside the Android chat input field.
- [x] Add compression preview, prepare summary, and save summary.
- [x] Add pin/unpin conversation controls.
- [x] Add delete-after-message flow.
- [x] Improve chat rendering parity for thinking blocks, costs, tool events, artifacts, wiki markers, and in-reply-to navigation where metadata exists.
- [x] Add richer export/fork/import option parity.
- [x] Add visible error notifications for every failed WS action.

### Phase 4 - Skills Parity

- [x] Add desktop WS handlers for `skill:list/get/create/update/delete/duplicate/export/import`.
- [x] Add WS handlers for `skill:get-agent-links`, `skill:attach-to-agent`, `skill:reorder-for-agent`, `skill:get-agent-usage`.
- [x] Add Android `Skill` models, events, parser branches, repository state, and ViewModels.
- [x] Build Skills list/detail/editor screens for core CRUD and duplicate.
- [x] Add Android import/export UI for skill JSON.
- [x] Add skill usage display in Android Skills list/detail.
- [x] Add Android editor parity for built-in tool permissions/instructions, MCP server assignment, and knowledge entries.
- [x] Add Android editor parity for MCP trust/tool overrides.
- [x] Add attach/detach/reorder skills inside Android Agent Config.
- [x] Add tests for skill CRUD and agent-skill round trip.

### Phase 5 - Generator Parity

- [x] Verify existing Android `agent-generator:*` support against the desktop generator.
- [x] Add `skill-generator:*` WS bridge and Android screen.
- [x] Add `artifact-generator:*` WS bridge and Android screen.
- [x] Add parser and ViewModel tests for token/spec/done/error/cancel flows.

### Phase 6 - Full Agent Configuration Parity

- [x] Extend Android `AgentFullConfig` to preserve all desktop agent fields.
- [x] Add UI for thinking effort, root directory, context directories/files, context rules, and custom commands.
- [x] Add knowledge file list/add/remove/read/update support.
- [x] Add built-in tool instructions and approval parity.
- [x] Add MCP server assignment, server trust, and tool override UI.
- [x] Fix tool approval value normalization to match desktop/shared config.
- [x] Add round-trip tests proving Android does not drop advanced fields.

### Phase 7 - Project Settings Parity

- [x] Add Android Project Settings sections for General, Scope, Milestones, Team, Wiki, and Artifacts.
- [x] Add or expose WS commands for complete project config read/update.
- [x] Add team management: add/remove/reorder agents and set primary agent.
- [x] Add orchestration settings: enabled, delegation depth, team activity visibility.
- [x] Add default model and root directory controls.
- [x] Add tests for project config and team round trips.

### Phase 8 - Artifact Lifecycle Parity

- [x] Extend Android artifact detail to include version history.
- [x] Add artifact export/share support as Android equivalent of desktop export/open-folder.
- [x] Add artifact delete.
- [x] Add generated artifact revision flow.
- [x] Add storage-root visibility; make editing mobile-adjusted or desktop-triggered with confirmation.
- [x] Add tests for list/detail/version/export/delete events.

### Phase 9 - Prompts, Wiki, MCP, And Developer Tooling

- [x] Add prompt version list and rollback.
- [x] Add project-scoped prompt filtering where desktop supports it.
- [x] Add wiki extraction from conversation.
- [x] Add source conversation/message display for wiki entries.
- [x] Add MCP add/update/remove/restart/status flows.
- [x] Add MCP list-tools and list-tools-for-agent flows.
- [x] Add read-only build/developer dashboards for desktop and Android build records.
- [x] Add guarded trigger actions for preflight/build/install/publish/restore where mobile-safe.

---

## Protocol Work Pattern

Every new WebSocket command should update these layers together:

1. Desktop WS handler in `src/main/ws-handlers.ts`.
2. Typed event in `android/.../data/model/WsEvent.kt`.
3. Parser branch in `android/.../data/WsEventParser.kt`.
4. Repository state/send helper in `android/.../data/WsRepository.kt`.
5. ViewModel and Compose UI.
6. Focused desktop and Android tests.

---

## Acceptance Criteria

- Every current desktop pane or modal is represented as `Done`, `Partial`, `Missing`, or `Mobile-adjusted`.
- Removed desktop features, especially Feature Generator, are not included as Android targets.
- Android model lists match desktop model availability, including OpenRouter and CLI model sections.
- Settings contains settings, not creation/content tools like Project Generator or Artifacts.
- Each phase has a checklist small enough to assign independently.
- The roadmap distinguishes missing Android UI from missing WS bridge support.
