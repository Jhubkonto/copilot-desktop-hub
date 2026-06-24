# Agentic Controls and Orchestration Generator Roadmap

## Summary

Build on the existing `agenticMode` and project orchestration features by turning them into explicit, tunable policies, then add a project-scoped orchestration generator that can create or revise a team setup. Keep desktop scope only for this roadmap.

Feasibility is good:

- Fine-grained agentic controls are high feasibility because agents/projects already store flexible JSON config.
- Provider orchestration is high feasibility because the current function-call orchestration engine already works.
- Codex/Claude CLI orchestration is feasible, but should be app-driven with a strict tagged JSON delegation protocol rather than relying on native function calling.

## Key Changes

---

### Phase 1: Agentic Policy Controls

**Goal:** Replace the coarse `agenticMode: boolean` flag with a structured `agenticPolicy` that supports presets and advanced per-agent tuning, while remaining fully backward-compatible.

**Current state:** `AgentConfig.agenticMode: boolean` in `src/shared/types.ts`. The checkbox in `src/renderer/components/agent-panel/SettingsTab.tsx` sets it. `callMcpTool()` in `src/main/mcp.ts` reads it at approval time.

#### Checklist

- [ ] **Define `AgenticPolicy` type** in `src/shared/types.ts`
  - Add `AgenticPolicyPreset` union: `'manual' | 'assisted' | 'auto-safe' | 'autonomous'`
  - Add `AgenticPolicy` interface with fields:
    - `preset: AgenticPolicyPreset`
    - `maxToolIterations?: number` (overrides `MCP_MAX_ITERATIONS` in `tool-loop.ts`)
    - `firstToolUse?: 'auto' | 'encourage' | 'require'`
    - `mcpApprovalBypass?: { preApproved: string[]; alwaysAsk: string[]; neverAllow: string[] }`
    - `onToolError?: 'stop' | 'continue'`
  - Add optional `agenticPolicy?: AgenticPolicy` field to `AgentConfig` alongside the existing `agenticMode: boolean` (keep both during migration)

- [ ] **Write a backward-compat mapper** `resolveAgenticPolicy(agent: AgentConfig): AgenticPolicy` in a new `src/main/agentic-policy.ts`
  - If `agenticPolicy` is set, return it directly
  - If only `agenticMode === true`, return the `auto-safe` preset with default values
  - If neither, return the `manual` preset
  - Export a `PRESET_DEFAULTS` map for each of the four presets

- [ ] **Update `AgentConfig` defaults** in `src/renderer/components/AgentGeneratorModal.tsx` line 474
  - Keep `agenticMode: false` for compatibility
  - Do not set `agenticPolicy` by default (let the mapper derive it)

- [ ] **Replace the agentic mode checkbox** in `src/renderer/components/agent-panel/SettingsTab.tsx` lines 207–218
  - Add a `<select>` (or segmented control) for the four presets
  - Add a collapsible "Advanced" section for `maxToolIterations`, `firstToolUse`, `onToolError`
  - Add the MCP approval bypass lists (pre-approved, always-ask, never-allow) as editable tag inputs
  - Keep the old checkbox rendering for any agent that has only `agenticMode` set (display as read-only "legacy")

- [ ] **Persist the new fields** — no DB migration needed; agent config is stored as JSON in the `settings` table; the new optional fields serialise automatically

- [ ] **Update IPC layer** if any typed channel surfaces `agenticMode` directly — check `src/shared/types.ts` `IpcReturnMap` and `src/preload/index.ts`

#### Phase 1 Gate

- [ ] Write unit tests in `src/main/__tests__/agentic-policy.test.ts` covering:
  - `resolveAgenticPolicy` returns `auto-safe` for `agenticMode: true`
  - `resolveAgenticPolicy` returns `manual` for `agenticMode: false` and no policy set
  - `resolveAgenticPolicy` returns the explicit policy when set
  - All four preset defaults are valid (no missing required fields)
- [ ] Write renderer tests in `src/renderer/__tests__/SettingsTab.test.tsx` covering:
  - Preset selector renders and dispatches correct config updates
  - Legacy `agenticMode`-only agents show the read-only legacy badge
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — Electron main + preload + renderer compile cleanly
- [ ] `npm test` — full Vitest suite green

---

### Phase 2: Provider Tool Loop Parity

**Goal:** Feed `agenticPolicy` into the existing MCP tool loop so that iteration limits, first-tool-use forcing, approval bypass, and error handling are all policy-driven rather than hardcoded.

**Current state:** `MCP_MAX_ITERATIONS = 20` and `MCP_REQUIRED_ITERATIONS = 0` are constants in `src/main/tool-loop.ts`. `callMcpTool()` in `src/main/mcp.ts` accepts a bare `agenticMode?: boolean` and derives bypass logic with `bypassApproval = autoApprove || (agenticMode && !hasExplicitOverride)`. `dispatchToProvider()` in `src/main/chat-provider-dispatch.ts` passes `agenticMode` through.

#### Checklist

- [ ] **Extend `runProviderMcpToolLoop()` signature** in `src/main/tool-loop.ts`
  - Replace the `agenticMode?: boolean` parameter with `policy?: AgenticPolicy`
  - Derive `effectiveMaxIterations` from `policy?.maxToolIterations ?? MCP_MAX_ITERATIONS`
  - Derive `forcedIterations` from `policy?.firstToolUse === 'require' ? 1 : 0` (replaces `MCP_REQUIRED_ITERATIONS`)
  - When `policy?.firstToolUse === 'encourage'`, set tool_choice to `'auto'` but inject a system hint (e.g. append a one-line instruction to the system prompt segment) for the first iteration only
  - When `onToolError === 'stop'`, break the loop on the first tool error instead of continuing

- [ ] **Update `callMcpTool()` in `src/main/mcp.ts`**
  - Replace `agenticMode?: boolean` parameter with `policy?: AgenticPolicy`
  - Compute bypass from policy: `bypassApproval = autoApprove || (policy?.preset === 'auto-safe' || policy?.preset === 'autonomous') && !hasExplicitOverride`
  - Pre-approved / always-ask / never-allow lists from `policy?.mcpApprovalBypass` take precedence over server-level trust if set

- [ ] **Update `dispatchToProvider()` in `src/main/chat-provider-dispatch.ts`**
  - Replace `agenticMode: boolean` in `ProviderDispatchOptions` with `policy?: AgenticPolicy`
  - Pass the resolved policy down to `runProviderMcpToolLoop()`

- [ ] **Update call site in `src/main/chat-handlers.ts`** line 215
  - Call `resolveAgenticPolicy(agentCfg2)` and pass the result as `policy`

- [ ] **Add failure notifications** — when a tool call is blocked due to `neverAllow` policy, emit a `chat:tool-blocked` event to `webContents` with tool name and reason; handle it in the renderer to show an inline notice

- [ ] **Update `src/shared/types.ts`** `IpcChannels` with `'chat:tool-blocked'` and its payload type in `IpcReturnMap`

#### Phase 2 Gate

- [ ] Write unit tests in `src/main/__tests__/tool-loop.test.ts` covering:
  - `maxToolIterations` from policy caps the loop at the specified number
  - `firstToolUse: 'require'` forces tool_choice on iteration 0
  - `firstToolUse: 'encourage'` injects the hint only on iteration 0 and uses `'auto'` tool_choice
  - `onToolError: 'stop'` exits the loop on first error
  - `onToolError: 'continue'` (default) continues after a tool error
- [ ] Write unit tests in `src/main/__tests__/mcp.test.ts` covering:
  - `auto-safe` preset bypasses approval when no explicit override
  - `autonomous` preset bypasses approval when no explicit override
  - `manual` preset does not bypass approval
  - `neverAllow` list blocks tool and emits `chat:tool-blocked`
  - `preApproved` list skips approval prompt
  - Explicit per-tool override always wins over preset
- [ ] Write renderer tests for the `chat:tool-blocked` inline notice rendering
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — Electron main + preload + renderer compile cleanly
- [ ] `npm test` — full Vitest suite green

---

### Phase 3: Codex and Claude CLI Support

**Goal:** Make `agenticPolicy` meaningful for CLI-backed agents by injecting policy directives into the CLI system prompt and adding an app-level retry when a "require tool use" policy is set but the CLI returned no tool activity.

**Current state:** CLI adapters (`src/main/cli-adapters/claude.ts`, `codex.ts`) receive a `systemPrompt` string and `allowedTools` list via `CliAdapterRequest`. There is no concept of agentic policy at the CLI layer. Approval filtering happens before `callMcpTool()`, which CLI adapters do not invoke — they handle tools internally.

#### Checklist

- [ ] **Write `buildCliPolicyDirective(policy: AgenticPolicy): string`** in `src/main/agentic-policy.ts`
  - Returns a short paragraph appended to the system prompt
  - `manual`: "Ask before using any tool."
  - `assisted`: "Use tools where helpful, but describe your intent first."
  - `auto-safe`: "Use tools freely for safe read/lookup operations."
  - `autonomous`: "Use all available tools without asking. Optimise for task completion."
  - `require` first-tool-use variant: also appends "You MUST invoke at least one tool in your first response."

- [ ] **Inject the directive in `src/main/chat-handlers.ts`**
  - When the agent's `backend` is `'claude-cli'` or `'codex-cli'`, append `buildCliPolicyDirective(policy)` to `systemPrompt` before passing to the adapter

- [ ] **Add app-level CLI retry** in `src/main/chat-handlers.ts`
  - After the CLI adapter returns, if `policy.firstToolUse === 'require'` and the response contains no tool activity events (`CliStreamEvent` of type `tool_start`)
  - Append a stronger instruction to the messages and re-invoke the adapter once
  - Emit a `chat:activity` event of type `'retry'` so the UI can show "Retrying with tool instruction…"
  - Do not retry more than once (one repair attempt)

- [ ] **Preserve approval filtering for CLI tools**
  - CLI adapters surface tool calls via `CliStreamEvent { type: 'tool_start' }`; before passing the result back, check the tool name against `policy.mcpApprovalBypass.neverAllow`
  - If blocked, replace the tool result with an error string and emit `chat:tool-blocked`
  - Do not silently bypass explicit `alwaysAsk` overrides for CLI tools

- [ ] **Update `CliAdapterRequest` in `src/main/cli-adapters/types.ts`**
  - No new fields needed — the directive is injected into the existing `systemPrompt`; document this in a comment

#### Phase 3 Gate

- [ ] Write unit tests in `src/main/__tests__/agentic-policy.test.ts` covering:
  - `buildCliPolicyDirective` returns the correct string for each preset
  - `require` variant appends the mandatory tool sentence
- [ ] Write unit tests in `src/main/__tests__/chat-handlers.test.ts` (or a new CLI-specific file) covering:
  - Directive is appended to `systemPrompt` when backend is `claude-cli` or `codex-cli`
  - Retry fires exactly once when `firstToolUse === 'require'` and no `tool_start` events were emitted
  - No retry when tools were used
  - `neverAllow` list blocks tool result and emits `chat:tool-blocked`
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — Electron main + preload + renderer compile cleanly
- [ ] `npm test` — full Vitest suite green

---

### Phase 4: Orchestration Engine V2

**Goal:** Split the monolithic `runOrchestration()` in `src/main/orchestrator.ts` into a backend-neutral engine with separate provider and CLI runners. Fix known gaps: pass conversation history, use consistent `showActivity`, and let specialists run through their configured backend.

**Current state:** `runOrchestration()` (orchestrator.ts line 223) hard-codes a provider call for the leader and calls `callSpecialist()` (line 154) which resolves the specialist's provider but does not use CLI backends. Conversation history is not passed to the leader on first call. `showActivity` is read from `OrchestratorOptions` but not forwarded to CLI specialists.

#### Checklist

- [ ] **Extract `OrchestratorRunner` interface** in a new `src/main/orchestrator-runner.ts`
  ```ts
  interface OrchestratorRunner {
    runLeader(opts, messages, tools): Promise<LeaderResult>
    runSpecialist(agentId, task, context, stepId, opts): Promise<string>
  }
  ```

- [ ] **Implement `ProviderOrchestratorRunner`** in `src/main/orchestrator-runner.ts`
  - Extracted from current `runOrchestration()` / `callSpecialist()` — minimal diff
  - Keeps the `delegate_to_agent` function-call tool approach
  - Passes `agenticPolicy` resolved for the leader agent

- [ ] **Implement `CliOrchestratorRunner`** in `src/main/orchestrator-runner.ts`
  - Leader prompt includes the team manifest and instructions to emit `<delegation-plan>{...}</delegation-plan>` JSON
  - Parse delegation plan with a `parseDelegationPlan(raw: string): DelegationPlan | null` helper
  - On parse failure, perform one repair attempt: re-prompt with the raw output and "Your previous response was not valid JSON inside `<delegation-plan>`. Try again."
  - After all delegations complete, expect the leader to emit `<final-answer>...</final-answer>` — extract with a `parseFinalAnswer(raw: string): string | null` helper
  - Specialists run through their own configured backend (resolve via `agent.backend`)

- [ ] **Pass conversation history into orchestration** in `src/main/orchestrator.ts`
  - `runOrchestration()` currently receives `historyMessages` — ensure they are forwarded to `runLeader()` as the initial messages array rather than starting with an empty array
  - Truncate to last N messages (e.g. 20) if history is long to avoid context blowout

- [ ] **Enforce `showActivity` consistently**
  - When `showActivity` is false, suppress all `chat:team-step-stream` and `teamActivityStep` IPC events for both provider and CLI runners
  - When `showActivity` is true, ensure CLI specialist output streams via `chat:team-step-stream` the same way provider specialists do

- [ ] **Add one repair attempt for invalid CLI delegation JSON** — already described above in `CliOrchestratorRunner`

- [ ] **Update `runOrchestration()` to select the runner** based on leader `agent.backend`
  - `undefined` / BYOK provider → `ProviderOrchestratorRunner`
  - `'claude-cli'` or `'codex-cli'` → `CliOrchestratorRunner`

- [ ] **Write `parseDelegationPlan()` and `parseFinalAnswer()`** as pure functions in `src/main/orchestrator-runner.ts` (easy to unit test in isolation)

#### Phase 4 Gate

- [ ] Write unit tests in `src/main/__tests__/orchestrator-runner.test.ts` covering:
  - `parseDelegationPlan` returns `null` for malformed XML/JSON
  - `parseDelegationPlan` correctly parses a valid `<delegation-plan>` block
  - `parseFinalAnswer` extracts text from `<final-answer>` block
  - Repair attempt fires exactly once on the first parse failure
  - No repair attempt on the second failure (return error)
- [ ] Write integration-style tests in `src/main/__tests__/orchestrator.test.ts` covering:
  - Provider leader + provider specialist round-trip with mocked `callProvider`
  - CLI leader produces delegation plan; specialists are dispatched with correct backend
  - Conversation history is forwarded (not empty) on the first leader call
  - `showActivity: false` suppresses all team step events
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — Electron main + preload + renderer compile cleanly
- [ ] `npm test` — full Vitest suite green

---

### Phase 5: Orchestration Generator

**Goal:** Add a desktop "Orchestration Generator" surface in the project Team settings area that generates a full team setup (leader, specialists, roles, policies, depth) from a user goal using the project's existing agents and BYOK or CLI models.

**Current state:** `src/renderer/components/project-settings/TeamTab.tsx` shows the orchestration toggle and agent list. Project and agent generation already use a tagged XML extraction pattern (look for `<orchestration-spec>` in the generator response). No orchestration-specific generator exists.

#### Checklist

- [ ] **Define `OrchestrationSpec` type** in `src/shared/types.ts`
  ```ts
  interface OrchestrationSpec {
    leaderAgentId: string
    members: {
      agentId: string          // existing agent to reuse, or null to create
      name?: string            // if new
      roleDescription: string
      agenticPolicy: AgenticPolicyPreset
      backend?: AgentConfig['backend']
    }[]
    delegationGuidance: string
    maxDelegationDepth: number
    showActivity: boolean
  }
  ```

- [ ] **Add `generateOrchestration` IPC handler** in `src/main/` (new file `orchestration-generator-handlers.ts` or alongside `build-handlers.ts`)
  - Input: `{ projectId, goal, workspaceContext?: string }`
  - Resolve current project config and its agents from DB
  - Build a generator prompt that includes: project name, goal, agent list (id, name, system prompt excerpt, backend), and instructions to output `<orchestration-spec>...</orchestration-spec>` containing valid JSON
  - Support BYOK providers, Codex CLI, and Claude CLI as the generation backend (use the project's primary agent backend as default, fall back to first available BYOK key)
  - Extract the spec with `parseTaggedJson<OrchestrationSpec>('<orchestration-spec>', raw)` — reuse or generalise the same helper used by project/agent generation
  - Return `{ spec: OrchestrationSpec } | { error: string }`

- [ ] **Register the handler** in `src/main/ipc-handlers.ts` and wire up `IpcChannels` / `IpcReturnMap` / `src/preload/index.ts` following the standard IPC pattern from CLAUDE.md

- [ ] **Add "Generate Team" button to `TeamTab.tsx`**
  - Opens a modal (new `OrchestrationGeneratorModal.tsx`) with:
    - A textarea for "Goal / domain"
    - An optional "Workspace context" textarea
    - A model/backend selector (defaults to project primary agent)
    - A "Generate" button that calls `window.api.generateOrchestration()`
  - Show a spinner while generating

- [ ] **Add `OrchestrationPreviewPanel` component** (used by the modal before applying)
  - Shows: leader name + icon, member list with role + backend + policy badge, delegation guidance text, depth + showActivity values
  - "Apply" button writes the spec to the project config (updates `orchestrationEnabled`, `maxDelegationDepth`, `showTeamActivity`, and sets each agent's `agenticPolicy`)
  - "Cancel" closes without changes

- [ ] **Scope to existing projects only** — the "Generate Team" button is hidden when no project is selected; do not add a "create project" shortcut here

#### Phase 5 Gate

- [ ] Write unit tests in `src/main/__tests__/orchestration-generator.test.ts` covering:
  - `parseTaggedJson` extracts a valid spec from a well-formed response
  - `parseTaggedJson` returns `null` for a response with no `<orchestration-spec>` tag
  - Handler returns `{ error }` when spec JSON is invalid
  - Handler returns `{ error }` when project is not found
- [ ] Write renderer tests in `src/renderer/__tests__/OrchestrationGeneratorModal.test.tsx` covering:
  - "Generate" button is disabled when goal is empty
  - Spinner shows while `generateOrchestration` is pending
  - Preview panel renders leader, members, and guidance from a mock spec
  - "Apply" button dispatches the correct store update
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — Electron main + preload + renderer compile cleanly
- [ ] `npm test` — full Vitest suite green

---

### Phase 6: Diagnostics and UX

**Goal:** Surface clear warnings and graceful self-healing states across the orchestration flow — before generation is applied, during runtime, and when the system is misconfigured.

**Current state:** No pre-apply preview exists. Runtime errors from the orchestrator surface as generic error strings. The `TeamTab.tsx` orchestration toggle can be enabled even when prerequisites (≥2 agents, a primary leader) are not met.

#### Checklist

- [ ] **Add pre-apply validation** in `OrchestrationPreviewPanel` (Phase 5)
  - Before showing "Apply", compute a `ValidationResult` from the spec:
    - `noLeader`: spec's `leaderAgentId` does not exist in the project
    - `tooFewMembers`: fewer than 2 member agents
    - `missingKey`: a member uses a BYOK backend but no API key is configured for that provider
    - `missingTool`: a member's `agenticPolicy` has `preApproved` tools that are not in any configured MCP server
    - `unavailableBackend`: a member uses `claude-cli` or `codex-cli` but `isAvailable()` returns false
  - Show inline warning chips for each issue; `noLeader` and `tooFewMembers` block "Apply"; the rest are non-blocking warnings

- [ ] **Add runtime self-healing states** in `src/main/orchestrator.ts`
  - `no primary agent`: if `leaderAgentId` resolves to null, emit `chat:error` with message "Orchestration failed: no leader agent is configured."
  - `fewer than two team members`: skip delegation and run the leader directly as a single agent
  - `invalid generated spec` (Phase 4 repair failure): after the second parse failure, fall back to returning the raw leader text as the final answer
  - `unavailable CLI/provider backend` for a specialist: emit a `chat:team-step-stream` error event for that step and continue with remaining specialists
  - `delegation parse failure` for a single specialist: same — error the step, do not abort the whole orchestration

- [ ] **Improve `TeamTab.tsx` guard rails**
  - Disable the orchestration toggle if fewer than 2 agents are in the team — show tooltip: "Add at least one more agent to enable orchestration"
  - Highlight the primary agent star if none is designated when orchestration is on
  - Show a warning banner if orchestration is enabled but the leader's backend is unavailable

- [ ] **Show backend + policy badges per agent** in `TeamTab.tsx` agent list
  - Each agent row shows: icon, name, backend tag (`BYOK` / `claude-cli` / `codex-cli`), policy preset tag (`manual` / `assisted` / `auto-safe` / `autonomous`)
  - Clicking the policy tag opens the agent settings panel directly to the policy selector

- [ ] **Add `showActivity` toggle to `TeamTab.tsx`** (already in `ProjectOrchestrationConfig`; expose it in the UI if not already visible)

#### Phase 6 Gate

- [ ] Write unit tests in `src/main/__tests__/orchestrator.test.ts` covering:
  - No-leader case emits `chat:error` and does not crash
  - One-member case runs leader without delegation
  - Unavailable specialist backend errors that step and continues
  - Delegation parse failure errors that step and continues
- [ ] Write renderer tests in `src/renderer/__tests__/TeamTab.test.tsx` covering:
  - Orchestration toggle is disabled when fewer than 2 agents are present
  - Warning banner renders when leader backend is unavailable
  - Backend and policy badges render correctly per agent
- [ ] Write renderer tests in `src/renderer/__tests__/OrchestrationPreviewPanel.test.tsx` covering:
  - `noLeader` shows blocking error and disables Apply
  - `tooFewMembers` shows blocking error and disables Apply
  - `missingKey` shows non-blocking warning chip but Apply is enabled
  - `unavailableBackend` shows non-blocking warning chip
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build` — Electron main + preload + renderer compile cleanly
- [ ] `npm test` — full Vitest suite green

---

## Test Plan

- Unit test legacy `agenticMode` to `agenticPolicy` mapping (`src/main/__tests__/agentic-policy.test.ts`).
- Unit test MCP approval behavior for each preset (`src/main/__tests__/mcp.test.ts`).
- Unit test provider tool-loop iteration limits and first-tool-use behavior (`src/main/__tests__/tool-loop.test.ts`).
- Unit test CLI delegation-plan parsing, repair, and final-answer extraction (`src/main/__tests__/orchestrator-runner.test.ts`).
- Integration test project orchestration with provider leader and CLI specialist (`src/main/__tests__/orchestrator.test.ts`).
- Integration test CLI leader with provider specialist.
- Renderer test agentic policy controls and orchestration generator preview (`src/renderer/__tests__/`).
- Regression test that existing agents/projects without `agenticPolicy` still behave as before.

## Assumptions

- Existing `agenticMode` remains supported for backward compatibility.
- No database migration is required; policy can live in existing JSON config fields.
- CLI orchestration v1 should use app-owned tagged JSON parsing, not a local MCP delegation server.
- The orchestration generator is project-scoped and should not reintroduce removed feature-generator behavior.
- Android is out of scope for this roadmap unless requested separately.
