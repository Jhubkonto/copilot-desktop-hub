# Auto-Approve All Actions Roadmap

## Summary

Add a first-class "full auto-approve" mode that lets any agent — BYOK provider or CLI backend — execute every possible action without pausing for user approval. This is a power-user escape hatch for trust-maxed agents, scripted pipelines, and agentic runs where interrupting for consent defeats the point.

Feasibility is good:

- Every approval surface in the codebase accepts a boolean bypass parameter; wiring a single agent-level flag through each layer is straightforward.
- The existing `AgenticPolicy` roadmap (`AGENTIC_ORCHESTRATION_ROADMAP.md`) already introduces an `'autonomous'` preset that bypasses MCP approvals — this roadmap extends that idea to **all** surfaces: built-in tools, MCP tools, CLI tools, mobile push approvals, and the 60-second timeout guard.
- CLI adapters (Claude CLI, Codex CLI) handle tool execution internally; we can influence them only through the spawned system prompt and the post-event `neverAllow` filter — both are already in place.

**Relationship to `AGENTIC_ORCHESTRATION_ROADMAP.md`:** Phase 1 of that roadmap replaces `agenticMode: boolean` with a structured `AgenticPolicy`. This roadmap adds a separate, explicit `fullAutoApprove: boolean` flag that sits *above* the policy layer — it is not a preset inside `AgenticPolicy` because it intentionally skips surfaces that even `'autonomous'` still checks (explicit `neverAllow` overrides, built-in tool `approval` fields, push notification hooks). When both are present, `fullAutoApprove` wins.

## Key Changes

---

### Phase 1: `fullAutoApprove` Flag on AgentConfig

**Goal:** Establish a single boolean source of truth on `AgentConfig` that downstream layers will read. Zero behaviour change in this phase — just the type, the DB persistence, and the IPC plumbing.

**Current state:** `AgentConfig` in `src/shared/types.ts` has `agenticMode: boolean` and (after orchestration roadmap Phase 1) `agenticPolicy?: AgenticPolicy`. No "skip everything" flag exists. Agent config is stored as JSON in the `settings` table — no DB migration needed for a new optional field.

#### Checklist

- [x] **Add `fullAutoApprove?: boolean` to `AgentConfig`** in `src/shared/types.ts`
  - Optional field; `undefined` / `false` = approval behaves as today
  - Place after `agenticMode` to signal its relationship to the existing toggle
  - Add a JSDoc comment: `/** When true, all tool executions are approved automatically. No approval prompts are shown. Use only for fully trusted agents. */`

- [x] **Update the `resolveAgenticPolicy` mapper** in `src/main/agentic-policy.ts`
  - If `fullAutoApprove === true`, force the resolved policy's preset to `'autonomous'` and clear all `neverAllow` entries (the flag means "trust everything")
  - Export a helper `isFullAutoApprove(agent: AgentConfig): boolean` = `agent.fullAutoApprove === true`

- [x] **No DB migration needed** — agent config is stored as a JSON blob; the new field serialises automatically when the agent is next saved

- [x] **Update IPC types** in `src/shared/types.ts`
  - No new channels needed; `'agent:create'` and `'agent:update'` already pass the full `AgentConfig`; the new field round-trips automatically

- [x] **Update default agent factory** in `src/renderer/components/AgentGeneratorModal.tsx` (line 474)
  - Do not set `fullAutoApprove` in the default; leave it `undefined`

#### Phase 1 Gate

- [x] Write unit tests in `src/main/__tests__/agentic-policy.test.ts` covering:
  - `isFullAutoApprove` returns `false` for `undefined`, `false`, and absent field
  - `isFullAutoApprove` returns `true` only when `fullAutoApprove === true`
  - `resolveAgenticPolicy` with `fullAutoApprove: true` returns `'autonomous'` preset with empty `neverAllow`
  - An agent with `fullAutoApprove: true` AND an explicit `neverAllow` entry: the entry is cleared by the mapper
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero warnings

---

### Phase 2: Built-in Tool Bypass

**Goal:** When `fullAutoApprove` is set, skip approval prompts for the three built-in tools (`fileEdit`, `terminal`, `webFetch`) regardless of their individual `ToolConfig.approval` setting.

**Current state:** `chat-handlers.ts` calls `getClaudeCliAllowedBuiltInTools()` which reads `agent.tools.{fileEdit,terminal,webFetch}.approval`. The `requestApproval()` function in `src/main/tools.ts` sends a `'tool:request-approval'` IPC event and waits up to 60 seconds. There is no bypass path for built-in tools in interactive chat (only scheduled tasks use `toolPolicy`).

#### Checklist

- [x] **Add a bypass check at the top of `requestApproval()`** in `src/main/tools.ts`
  - Accept a new optional parameter `autoApprove?: boolean`
  - If `autoApprove === true`, resolve the promise with `true` immediately (no IPC event, no push, no timeout)

- [x] **Thread `autoApprove` into every `requestApproval()` call site** in `src/main/chat-handlers.ts`
  - Resolve `isFullAutoApprove(agentCfg)` once at the top of the handler
  - Pass it as `autoApprove` to every `requestApproval()` invocation in the file

- [x] **Skip the 60-second timeout guard** when `autoApprove` is true
  - The `setTimeout(..., 60000)` in `requestApproval()` should not be registered when resolving immediately

- [x] **Preserve audit logging** — even when auto-approved, emit a `'tool:auto-approved'` IPC event to `webContents` with `{ toolName, args }` so the renderer can show a subtle inline indicator rather than a prompt

- [x] **Add `'tool:auto-approved'` to `IpcChannels` and `IpcReturnMap`** in `src/shared/types.ts`; add a `typedOn` wrapper in `src/preload/index.ts`

#### Phase 2 Gate

- [x] Write unit tests in `src/main/__tests__/tools.test.ts` covering:
  - `requestApproval({ autoApprove: true })` resolves `true` without emitting `'tool:request-approval'`
  - `requestApproval({ autoApprove: true })` does not register a timeout
  - `requestApproval({ autoApprove: true })` emits `'tool:auto-approved'`
  - `requestApproval({ autoApprove: false })` still emits `'tool:request-approval'` as before
- [x] Write renderer tests covering the inline auto-approved indicator
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero warnings
- [x] `npm run build` — compiles cleanly
- [x] `npm test` — full Vitest suite green

---

### Phase 3: MCP Tool Bypass

**Goal:** When `fullAutoApprove` is set, skip all MCP tool approval prompts — including per-tool overrides set to `'always-ask'` and server-level trust set to `'block'`. This goes beyond what `agenticMode` does (which still respects explicit per-tool overrides).

**Current state:** `callMcpTool()` in `src/main/mcp.ts` computes `bypassApproval = autoApprove || (agenticMode && !hasExplicitOverride)`. Explicit per-tool overrides (stored in `agent_mcp_tool_overrides` table) survive agentic mode. The `autoApprove` parameter is currently always `false` in the chat path.

#### Checklist

- [x] **Add `fullAutoApprove?: boolean` to `callMcpTool()` options** in `src/main/mcp.ts`
  - Update the bypass computation: `bypassApproval = fullAutoApprove || autoApprove || (agenticMode && !hasExplicitOverride)`
  - `fullAutoApprove` overrides explicit per-tool `'always-ask'` and `'block'` server trust — document this clearly in a comment
  - `fullAutoApprove` also bypasses `'disabled'` tool-level overrides (tool is enabled and auto-approved when flag is set)

- [x] **Pass `isFullAutoApprove(agent)` into `callMcpTool()`** from every call site in `src/main/tool-loop.ts` and `src/main/mcp.ts`
  - `runProviderMcpToolLoop()` already accepts `autoApproveTools?: boolean`; wire `fullAutoApprove` into it rather than adding a duplicate parameter

- [x] **Emit `'tool:auto-approved'`** from `callMcpTool()` when bypassing via `fullAutoApprove` (reuse the event from Phase 2)

- [x] **Preserve `neverAllow` from `toolPolicy`** — scheduled task policy blocks still apply even in `fullAutoApprove` mode (interactive agent trust and scheduled task policy are separate concerns)

#### Phase 3 Gate

- [x] Write unit tests in `src/main/__tests__/mcp.test.ts` covering:
  - `fullAutoApprove: true` bypasses a tool with explicit `'always-ask'` per-tool override
  - `fullAutoApprove: true` bypasses a tool with `'block'` server trust
  - `fullAutoApprove: true` bypasses a `'disabled'` tool override
  - `fullAutoApprove: false` still respects explicit `'always-ask'` override (unchanged behaviour)
  - Scheduled task `neverAllow` list still blocks when `fullAutoApprove: true`
  - `'tool:auto-approved'` is emitted for each bypassed MCP tool call
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero warnings
- [x] `npm run build` — compiles cleanly
- [x] `npm test` — full Vitest suite green

---

### Phase 4: CLI Tool Bypass

**Goal:** When `fullAutoApprove` is set and the agent uses a CLI backend (`'claude-cli'` or `'codex-cli'`), inject a maximum-permissiveness directive into the system prompt so the spawned CLI runs without interactive approval stops.

**Current state:** CLI adapters (`src/main/cli-adapters/claude.ts`, `codex.ts`) receive a `systemPrompt` string. The Claude CLI exposes a `--dangerously-skip-permissions` flag. The Codex CLI is controlled by its config. The app currently has no way to intercept in-flight tool approvals inside the CLI process — it can only influence behaviour through flags and the system prompt.

#### Checklist

- [x] **Add `skipPermissions?: boolean` to `CliAdapterRequest`** in `src/main/cli-adapters/types.ts`

- [x] **Pass `--dangerously-skip-permissions` to Claude CLI** in `src/main/cli-adapters/claude.ts`
  - When `req.skipPermissions === true`, append the flag to the `args` array
  - This flag is only appended when `fullAutoApprove` is set on the agent — never by default

- [x] **Inject auto-approve system prompt directive for Codex CLI** in `src/main/cli-adapters/codex.ts`
  - Codex has no equivalent skip-permissions flag; instead, prepend to the system prompt:
    `"[AUTO-APPROVE] You have full permission to use any tool without asking for confirmation. Execute all actions immediately."`
  - This is in addition to the `buildCliPolicyDirective('autonomous')` from the orchestration roadmap

- [x] **Wire `fullAutoApprove` → `skipPermissions`** in `src/main/chat-handlers.ts`
  - When building `CliAdapterRequest`, set `skipPermissions: isFullAutoApprove(agentCfg)`

- [x] **Suppress post-event `neverAllow` checks for CLI tools** when `fullAutoApprove` is set
  - In `src/main/chat-handlers.ts` where CLI stream events are processed, the `neverAllow` filter (from Phase 3 of the orchestration roadmap) should be skipped when `fullAutoApprove` is true

- [x] **Safety gate for `--dangerously-skip-permissions`** — log a warning to the Electron main-process console when this flag is used: `[WARN] Agent "${agentName}" is running with --dangerously-skip-permissions. All file and shell operations will execute without confirmation.`

#### Phase 4 Gate

- [x] Write unit tests in `src/main/__tests__/cli-adapters.test.ts` covering:
  - Claude CLI adapter includes `--dangerously-skip-permissions` when `skipPermissions: true`
  - Claude CLI adapter omits the flag when `skipPermissions: false` or absent
  - Codex CLI adapter prepends the auto-approve directive when `skipPermissions: true`
  - Codex CLI adapter does NOT prepend the directive when `skipPermissions: false`
- [x] Write unit tests in `src/main/__tests__/chat-handlers.test.ts` covering:
  - `skipPermissions: true` is set on the CLI request when agent has `fullAutoApprove: true`
  - Post-event `neverAllow` check is skipped when `fullAutoApprove: true`
  - The main-process warning is logged when the flag is applied
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero warnings
- [x] `npm run build` — compiles cleanly
- [x] `npm test` — full Vitest suite green

---

### Phase 5: UI Surface and Safety UX

**Goal:** Expose `fullAutoApprove` in the agent settings UI with a clear danger indication and a one-time confirmation modal so users understand what they are enabling.

**Current state:** `src/renderer/components/agent-panel/SettingsTab.tsx` shows the `agenticMode` checkbox (and, after the orchestration roadmap, the `AgenticPolicy` preset selector). No danger-tier controls exist yet.

#### Checklist

- [x] **Add a "Full Auto-Approve" toggle** to `SettingsTab.tsx`
  - Position it in a visually distinct "Danger Zone" section at the bottom of the settings tab, separated by a horizontal rule
  - Use a red-tinted toggle or checkbox to signal risk level
  - Label: "Auto-approve all actions"
  - Subtitle: "All tool calls execute immediately without confirmation. Use only for fully trusted agents."

- [x] **Require a one-time confirmation dialog** before enabling
  - On toggle-on, open a confirmation modal (reuse the existing modal pattern in the renderer):
    - Title: "Enable auto-approve?"
    - Body: "This agent will execute all tool calls — including file edits, shell commands, and web requests — without asking for confirmation. Are you sure?"
    - Buttons: "Cancel" / "Enable auto-approve" (destructive style)
  - On confirm, write `fullAutoApprove: true` to the store and persist via `agent:update`
  - Turning the toggle off does not require a confirmation

- [x] **Show a persistent banner in the chat header** when `fullAutoApprove` is enabled
  - Banner text: "Auto-approve is ON — all actions execute immediately"
  - Include a "Disable" link that turns off the flag without a confirmation modal
  - Banner uses a warning colour (amber or red) to remain visible during active sessions

- [x] **Show an inline indicator in the message thread** for each auto-approved tool call
  - Render the `'tool:auto-approved'` event (from Phase 2) as a subtle grey chip: "⚡ [tool name] auto-approved"
  - Keep it visually lighter than the full approval card to reduce noise

- [x] **Disable `fullAutoApprove` toggle when agent has scheduled tasks**
  - Scheduled tasks have their own `toolPolicy`; enabling `fullAutoApprove` for a scheduled-task agent could bypass the policy in interactive sessions
  - Show tooltip: "Auto-approve is not available for agents used in scheduled tasks"
  - This is a soft guard — the flag is still settable via IPC; the UI just discourages it

- [x] **Add the auto-approve toggle to the Android agent config screen**
  - Parse and save `fullAutoApprove` in Android agent config round-trips
  - Require confirmation before enabling from Android
  - Show the same high-risk copy used by desktop

#### Phase 5 Gate

- [x] Write renderer tests in `src/renderer/__tests__/SettingsTab.test.tsx` covering:
  - Toggle is rendered in a "Danger Zone" section
  - Clicking the toggle opens the confirmation modal
  - Cancelling the modal does not set `fullAutoApprove`
  - Confirming the modal dispatches `fullAutoApprove: true` on the agent
  - Toggling off directly sets `fullAutoApprove: false` without a modal
  - Toggle is disabled and tooltip shown for agents linked to scheduled tasks
- [x] Write renderer tests for the chat header banner and the auto-approved inline chip
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero warnings
- [x] `npm run build` — compiles cleanly
- [x] `npm test` — full Vitest suite green

---

### Phase 6: Mobile and Push Approval Suppression

**Goal:** When `fullAutoApprove` is set, prevent approval requests from routing to the Android companion or triggering push notifications, and auto-resolve any in-flight mobile approvals.

**Current state:** `requestApproval()` in `src/main/tools.ts` calls `broadcastToMobile(...)` and (when mobile is not in foreground) `sendApprovalPush(...)`. The WebSocket handler in `src/main/ws-handlers.ts` can resolve approvals via `tool:approve` / `tool:reject` commands. Mobile-originated approvals resolve the same `pendingApprovals` map as desktop ones.

#### Checklist

- [x] **Skip `broadcastToMobile` and `sendApprovalPush`** in `requestApproval()` when `autoApprove === true` (already resolved immediately in Phase 2; the broadcast/push calls sit after the early-return, so they are already skipped — verify this and add an explicit guard comment)

- [x] **Add a `'tool:auto-approve-all'` broadcast** to the mobile companion when `fullAutoApprove` is toggled on for an agent
  - Send via `broadcastToMobile({ event: 'agent:full-auto-approve-on', data: { agentId } })` from `ws-server.ts`
  - The Android companion can use this to suppress its own approval UI for that agent session
  - Send the inverse event `'agent:full-auto-approve-off'` when toggled off

- [x] **Drain `pendingApprovals`** on toggle-on
  - When `fullAutoApprove` is set to `true` via `agent:update`, check `pendingApprovals` in `tools.ts` for any outstanding request tied to that agent
  - Resolve them all with `true` (approved) immediately
  - This handles the race where the flag is enabled mid-session with an open approval dialog

- [x] **Add `agentId` tracking to `pendingApprovals`** in `src/main/tools.ts` to enable the drain above
  - Extend the map value to include `agentId?: string`
  - Pass `agentId` from `callMcpTool()` and built-in tool call sites into `requestApproval()`

- [x] **Handle drain in the `agent:update` IPC handler** in `src/main/agents.ts`
  - After saving the updated agent config, if `fullAutoApprove` changed from `false` to `true`, call a new `drainPendingApprovals(agentId)` export from `tools.ts`

#### Phase 6 Gate

- [x] Write unit tests in `src/main/__tests__/tools.test.ts` covering:
  - `requestApproval({ autoApprove: true })` does not call `broadcastToMobile`
  - `requestApproval({ autoApprove: true })` does not call `sendApprovalPush`
  - `drainPendingApprovals(agentId)` resolves all pending approvals for that agent with `true`
  - `drainPendingApprovals(agentId)` leaves approvals for other agents untouched
- [x] Write unit tests for the `'agent:full-auto-approve-on'` broadcast being sent on `agent:update`
- [x] `npm run typecheck` — zero errors
- [x] `npm run lint` — zero warnings
- [x] `npm run build` — compiles cleanly
- [x] `npm test` — full Vitest suite green

---

## Test Plan

- Unit test `isFullAutoApprove` helper and `resolveAgenticPolicy` override (`src/main/__tests__/agentic-policy.test.ts`).
- Unit test built-in tool bypass in `requestApproval()` — no IPC event, no timeout, no push (`src/main/__tests__/tools.test.ts`).
- Unit test MCP bypass overriding explicit `'always-ask'` and `'block'` overrides (`src/main/__tests__/mcp.test.ts`).
- Unit test Claude CLI `--dangerously-skip-permissions` flag injection (`src/main/__tests__/cli-adapters.test.ts`).
- Unit test Codex CLI system prompt directive (`src/main/__tests__/cli-adapters.test.ts`).
- Unit test `drainPendingApprovals` selectivity (`src/main/__tests__/tools.test.ts`).
- Renderer test confirmation modal flow for toggling on/off (`src/renderer/__tests__/SettingsTab.test.tsx`).
- Renderer test chat header banner and inline auto-approved chip.
- Regression test that agents without `fullAutoApprove` see no behaviour change.
- Regression test that scheduled task `toolPolicy.neverAllow` still blocks in `fullAutoApprove` interactive mode.

## Assumptions

- `fullAutoApprove` is agent-scoped, not project-scoped. A project with mixed-trust agents should be able to have one fully trusted specialist and others with normal approval flows.
- `fullAutoApprove` supersedes `AgenticPolicy` at every approval surface — it is not a preset within `AgenticPolicy` but a separate flag layered above it.
- Scheduled task `toolPolicy` is independent of `fullAutoApprove`; scheduled tasks always go through their declared policy regardless.
- The `--dangerously-skip-permissions` flag is only appended when `fullAutoApprove` is explicitly `true` — not when `agenticMode` is true or when the `'autonomous'` policy preset is set.
- Android support for the `'agent:full-auto-approve-on/off'` broadcast is out of scope for the broadcast handler itself (the app sends it; the companion app decides what to do with it).
- No new DB migration is required; `fullAutoApprove` serialises into the existing agent JSON config blob.
