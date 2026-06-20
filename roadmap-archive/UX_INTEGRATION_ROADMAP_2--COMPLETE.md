# Roadmap: UX Integration Pass 2

`UX_INTEGRATION_ROADMAP.md` (Milestones M–P) is fully complete — see git history. That pass promoted Self-Heal, Feature Generator, and Artifacts to top-level sidebar destinations, gave Self-Heal a phase bar and retry affordance, unified Artifacts into one scope-filterable surface, and added a proactive bug-report entry point. This document picks up the workflows that pass didn't touch: chat, agent management, project settings, sidebar conversation operations, and the rest of the Settings panel (Providers/BYOK, MCP, Mobile pairing, Developer's remaining build tabs), plus onboarding now that the sidebar has changed shape.

The findings below come from a direct code audit (not new feature work) and split into two kinds of problem: the same inconsistency repeated across several files (cross-cutting), and friction specific to one workflow.

---

## Implementation checklist

### Milestone R — Shared UI primitives

- [x] **R1.1 Shared toggle/switch component** — added `ToggleSwitch` to `src/renderer/components/ui/primitives.tsx` (with a `size: 'sm' | 'md'` variant) and migrated all three hand-rolled toggles: General tab's "Start on login" and "Auto-read clipboard" toggles, Mobile tab's "Enable mobile server" toggle, and `TeamTab.tsx`'s multi-agent orchestration toggle (previously a plain styled checkbox).
- [x] **R1.2 Unified save-state convention** — added a `SaveStatus` indicator primitive (idle / saving / saved / error) to `ui/primitives.tsx`. `ProjectSettingsPanel.tsx` now tracks a single `saveState` across both its debounced (`debounceSave`) and immediate (`immediateSave`, added for the General tab's mode/enabled/variable/root-dir handlers that previously called `updateProjectConfig` directly with no feedback) save paths, and renders the indicator in the tab bar whenever General/Scope/Milestones is active.
- [x] **R1.3 Undo affordance for reversible sidebar actions** — on inspection, conversation pin/unpin and move-to-project are non-destructive and trivially reversible, unlike delete (which rightly keeps its confirmation modal) — so a blocking confirmation dialog would add friction without preventing real harm. Implemented instead as a toast-based undo: extended `Toast` (`store/types.ts` and `components/Toast.tsx`) with an optional `action: { label; onClick }`, and `Sidebar.tsx`'s pin/unpin and move-to-project handlers now show an "Undo" toast that reverts the action.

### Milestone S — Onboarding refresh

- [x] **S2.1 Surface relocated top-level features** — added three entries to `OnboardingModal.tsx`'s "Done" step capability list (Self-Heal, Feature Generator, Artifacts), each noting it's reachable from the sidebar, using the same icon+text row pattern as the existing list items and the same icons the sidebar uses for Feature Generator (`Sparkles`) and Artifacts (`Package`).

### Milestone T — Project creation flow

- [x] **T3.1 Allow team setup during creation** — the Team tab is no longer hidden during draft mode. Since `TeamTab.tsx` is built entirely around a persisted project (drag-reorder, orchestration settings, `ProjectAgent` records with resolved name/icon), drafts get a new lightweight `DraftTeamPicker.tsx` instead — a simple checkbox list of available agents with a "set primary" star, no reorder/orchestration (those remain in the full Team tab after creation). Selections are held in local draft state and applied via `addAgentToProject`/`setProjectPrimaryAgent` immediately after `createProject` succeeds in `ProjectPanel.tsx`'s `handleConfirm`.

### Milestone U — Agent management clarity

- [x] **U4.1 Explain tool-trust tiers** — added a one-line explanation under the Trust selector in `SkillsTab.tsx` for each of the four tiers ("Ask before running" / "Run automatically" / "Block all tools" / "Custom per-tool…"), including a direct pointer from "Custom" to the per-tool override list that appears below it.

### Milestone V — MCP server status responsiveness

- [x] **V5.1 Event-driven restart status** — added a `mcp:server-status-changed` push channel: `mcp.ts`'s `broadcastServerStatus()` sends the updated `McpServerWithStatus` to all windows whenever a server's status actually changes (connect success/error, transport close, intentional disconnect), following the same `BrowserWindow.getAllWindows()[...].webContents.send(...)` pattern used elsewhere in `src/main/`. `McpServerPanel.tsx` now listens via `window.api.onMcpServerStatusChanged` and patches the changed server in place; the `setTimeout`-based 5-retry polling loop in `handleRestart` is gone.

### Milestone W — Conversation & model-selection consistency

- [x] **W6.1 Conversation rename discoverability + validation** — added an always-visible (on row hover) rename button with a pencil icon next to pin/move/delete in `Sidebar.tsx`, so renaming no longer depends on knowing about the double-click + tooltip. `handleRename` now explicitly rejects an empty/whitespace-only name with a toast instead of silently discarding the edit.
- [x] **W6.2 Reconcile model-selection UI** — on inspection, the composer footer's model dropdown (live conversation model, searchable, grouped by source) and the "Continue with" picker (`ChatWindow.tsx`, one parameter of a fork-into-new-conversation dialog alongside an agent picker) are not duplicate UIs for the same action — forcing them into one shape wouldn't reduce real confusion. Applied the smaller real fix instead: the "Continue with" model `<select>` already used `getModelLabel` for provider models (consistent labeling) but had a mismatched focus-ring color; unified it to the same blue accent used by the composer's model search input.

### Cross-cutting acceptance gates

- [x] Every relocated/new UI surface keeps its existing IPC channels — no channel renames; `mcp:server-status-changed` (Milestone V) is net-new, not a redesign of an existing channel.
- [x] New shared primitives (`ToggleSwitch`, `SaveStatus`) follow the same component conventions already established in `ui/primitives.tsx` (Tailwind class patterns matching `Button`/`TextField`; forwardRef wasn't needed since neither primitive forwards a ref to a focusable input).
- [x] No DB schema changes were required for this roadmap.
- [x] Desktop typecheck and relevant tests passed for each milestone before marking it complete (751/751 throughout; pre-existing Windows filesystem test flakes were verified unrelated by isolated re-runs).
- [x] Roadmap checkboxes were updated in the same session that completed each item.

---

## Detail — Milestone R: Shared UI primitives

**Why:** Three different parts of the app independently implement a toggle switch with their own markup and animation (General tab's theme/debug toggles, Mobile tab's server-enable toggle, `TeamTab.tsx`'s orchestration toggle) — same control, three slightly different implementations to maintain. Separately, the app has no consistent way to tell a user whether a setting change was saved: Providers tab requires an explicit Test-then-Save click per provider card, General/Scope/Milestones auto-save on blur with zero visual confirmation, Developer tab uses per-section Save buttons, and Prompts uses a Save/Delete pair at the editor's bottom — four different conventions for the same underlying need. Finally, delete actions for conversations, agents, and projects all use a confirmation modal (agent delete even shows an impact preview), but pinning/unpinning a conversation or moving it to a project are instant, no-confirmation actions in the same sidebar. On closer inspection during implementation, both of those are non-destructive and trivially reversible, so the fix that matched the actual risk was a toast-based undo rather than a blocking modal.

**Affected files:**
- `src/renderer/components/ui/primitives.tsx` — added `ToggleSwitch` and `SaveStatus`.
- `src/renderer/components/settings/GeneralTab.tsx`, `src/renderer/components/settings/MobileTab.tsx`, `src/renderer/components/project-settings/TeamTab.tsx` — migrated to `ToggleSwitch`.
- `src/renderer/components/ProjectSettingsPanel.tsx` — added `saveState` tracking (`debounceSave` + new `immediateSave`) and renders `SaveStatus` in the tab bar for General/Scope/Milestones.
- `src/renderer/components/Toast.tsx`, `src/renderer/store/types.ts`, `src/renderer/store/slices/uiSlice.ts` — added optional `action` to `Toast`/`addToast`.
- `src/renderer/components/Sidebar.tsx` — pin/unpin and move-to-project now show an undo toast.
- `src/test/mocks/store.ts` — `updateProjectConfig` mock updated to resolve a promise, matching the real (async) store action now that callers chain `.finally()` on it.

**Verification:**
- Toggle anywhere it now appears (General, Mobile, Team) renders and behaves identically (checked state, onChange) to before migration.
- Editing a field in General/Scope/Milestones shows a visible saved/saving indicator in the tab bar.
- Pinning/unpinning and moving a conversation to a project show an "Undo" toast that reverts the action when clicked.
- `npm run typecheck && npm test` clean (751/751).

---

## Detail — Milestone S: Onboarding refresh

**Why:** `OnboardingModal.tsx` walks a new user through providers, CLI detection, and a capability checklist, but that checklist predates the first roadmap's sidebar promotion of Self-Heal, Feature Generator, and Artifacts — a brand-new user finishing onboarding today has no signal that those three top-level destinations exist.

**Affected files:**
- `src/renderer/components/OnboardingModal.tsx`.

**Verification:**
- Walk through onboarding end to end; confirm Self-Heal, Feature Generator, and Artifacts are mentioned as available, discoverable features.
- `npm run typecheck && npm test` clean (751/751).

---

## Detail — Milestone T: Project creation flow

**Why:** `ProjectSettingsPanel.tsx` hides the Team (and Wiki/Artifacts) tabs while a project is in draft (`isDraft`) state, so a user creating a new project cannot assign agents to it until after clicking Create and reopening it in edit mode — an unnecessary round trip for a step that logically belongs with naming the project and setting its scope.

**Affected files:**
- `src/renderer/components/ProjectSettingsPanel.tsx` — Team tab shown for drafts, draft agent/primary selection state, `onConfirm` signature extended with a `DraftTeamSelection` param.
- `src/renderer/components/project-settings/DraftTeamPicker.tsx` — new, simple agent multi-select for draft mode.
- `src/renderer/components/ProjectPanel.tsx` — `handleConfirm` applies the draft team selection via `addAgentToProject`/`setProjectPrimaryAgent` right after `createProject` resolves.
- `src/renderer/__tests__/project-settings-panel.test.tsx` — updated the draft-confirm assertion to account for the new 4th `onConfirm` argument.

**Verification:**
- Create a new project, select agents (and a primary) in the Team tab while still in draft mode, then click Create; confirm the agents are attached to the new project without needing to reopen it.
- `npm run typecheck && npm test` clean (751/751).

---

## Detail — Milestone U: Agent management clarity

**Why:** The Skills tab's tool-trust tier system (auto / always-ask / custom / block) is derived from per-tool override state in `SkillsTab.tsx`, but the UI presents only the tier labels — a user has to infer what "custom" actually changes about tool behavior without any inline explanation.

**Affected files:**
- `src/renderer/components/agent-panel/SkillsTab.tsx`.

**Verification:**
- Open the Skills tab for an agent with MCP tools assigned; confirm each tier (always-ask/auto/block/custom) shows visible explanatory text describing its effect, and that "Custom" explains its relationship to the per-tool list shown beneath it.
- `npm run typecheck && npm test` clean (751/751).

---

## Detail — Milestone V: MCP server status responsiveness

**Why:** `McpServerPanel.tsx` polls on a `setTimeout` loop to reflect a server's status after a restart, rather than reacting to a pushed status-change event — every other live-status surface in the app (build logs, preflight checks) already streams updates from the main process instead of polling.

**Affected files:**
- `src/main/mcp.ts` — new `broadcastServerStatus()` helper, called from `connectServer` (success and error paths), `transport.onclose`, and `disconnectServer`.
- `src/shared/types.ts` — added `'mcp:server-status-changed': void` to `IpcChannels`/`IpcReturnMap`.
- `src/preload/index.ts` — added `onMcpServerStatusChanged`.
- `src/renderer/components/McpServerPanel.tsx` — subscribes to the event, removed the polling loop from `handleRestart`.
- `src/main/__tests__/mcp.test.ts` — added `BrowserWindow.getAllWindows` to the `electron` mock (now exercised by the broadcast call).
- `src/main/__tests__/ipc-channels.test.ts`, `src/test/mocks/api.ts` — updated to include the new channel/mock.

**Verification:**
- Restart an MCP server from the panel; confirm the status indicator updates immediately on the pushed event rather than after the polling interval elapses.
- `npm run typecheck && npm test` clean (751/751).

---

## Detail — Milestone W: Conversation & model-selection consistency

**Why:** Two small but real frictions in everyday chat use: renaming a conversation in the sidebar is only discoverable via a double-click plus a tooltip (easy to miss, and empty/whitespace names are currently accepted), and model selection has two different UI shapes depending on whether you're picking a model from the composer footer or from the post-generation "Continue with" picker — same action, two different affordances to learn.

**Affected files:**
- `src/renderer/components/Sidebar.tsx` — added rename button, empty-name validation in `handleRename`.
- `src/renderer/components/ChatWindow.tsx` — focus-ring color fix on the "Continue with" model select.

**Verification:**
- Rename a conversation via the new pencil button; confirm an empty/whitespace-only name is rejected with a toast and the original title is kept.
- Open "Continue with" and confirm the model select's focus ring matches the composer's accent color.
- `npm run typecheck && npm test` clean (751/751).
