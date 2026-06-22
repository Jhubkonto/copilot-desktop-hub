# Agentic Controls and Orchestration Generator Roadmap

## Summary

Build on the existing `agenticMode` and project orchestration features by turning them into explicit, tunable policies, then add a project-scoped orchestration generator that can create or revise a team setup. Keep desktop scope only for this roadmap.

Feasibility is good:

- Fine-grained agentic controls are high feasibility because agents/projects already store flexible JSON config.
- Provider orchestration is high feasibility because the current function-call orchestration engine already works.
- Codex/Claude CLI orchestration is feasible, but should be app-driven with a strict tagged JSON delegation protocol rather than relying on native function calling.

## Key Changes

### Phase 1: Agentic Policy Controls

- Replace the single effective meaning of `agenticMode` with a backward-compatible `agenticPolicy`.
- Keep existing `agenticMode: true` working by mapping it to an `auto-safe` preset.
- Add presets:
  - `Manual`: ask before tools.
  - `Assisted`: encourage tools but keep approvals.
  - `Auto-safe`: auto-approve trusted/unspecified safe MCP tools.
  - `Autonomous`: stronger tool-use bias with configurable limits.
- Add advanced controls:
  - max tool iterations
  - first-tool-use behavior: `auto`, `encourage`, `require`
  - MCP approval bypass rules
  - stop or continue on tool errors
- Update desktop agent/settings UI to show a preset selector plus advanced tuning.

### Phase 2: Provider Tool Loop Parity

- Feed `agenticPolicy` into the provider MCP tool loop.
- Replace hardcoded behavior such as `MCP_REQUIRED_ITERATIONS = 0` with policy-driven behavior.
- Make approval bypass depend on the selected policy instead of the coarse boolean.
- Add clear failure notifications when policy-driven tool execution is blocked.

### Phase 3: Codex and Claude CLI Support

- Add CLI agentic directives to the system prompt based on `agenticPolicy`.
- Continue using existing CLI adapter capabilities: MCP config, allowed tools, model, cwd, images, and thinking events.
- For "require tool use" policies, perform one app-level retry with a stronger instruction if tools are available but the CLI returned no tool activity.
- Preserve approval filtering before invoking CLI tools; do not bypass explicit denials.

### Phase 4: Orchestration Engine V2

- Split orchestration into a backend-neutral engine with provider and CLI runners.
- Provider runner keeps the current `delegate_to_agent` tool approach.
- CLI runner uses strict tagged JSON, for example:
  - `<delegation-plan>{...}</delegation-plan>`
  - `<final-answer>...</final-answer>`
- Add one repair attempt when CLI delegation JSON is invalid.
- Pass conversation history into orchestration; the current path should no longer use an empty history.
- Respect `showActivity` consistently for both live activity and persisted team activity.
- Let specialists run through their configured backend where possible, including provider, Codex CLI, or Claude CLI.

### Phase 5: Orchestration Generator

- Add a desktop "Orchestration Generator" from the project Team settings area.
- Scope it to existing projects rather than duplicating the project generator.
- Inputs:
  - current project
  - existing agents
  - user goal/domain
  - optional workspace/root context
- Output an `<orchestration-spec>` containing:
  - leader selection
  - member agents to create or reuse
  - role descriptions
  - delegation guidance
  - max delegation depth
  - show activity preference
  - suggested agentic policies per member
- Support generator models from BYOK providers, Codex CLI, and Claude CLI using the same tagged JSON extraction pattern already used by project/agent generation.

### Phase 6: Diagnostics and UX

- Add an orchestration preview before applying generated changes.
- Show:
  - leader
  - specialists
  - backend per agent
  - agentic policy per agent
  - missing key/tool/trust warnings
- Add graceful self-healing states:
  - no primary agent
  - fewer than two team members
  - invalid generated spec
  - unavailable CLI/provider backend
  - delegation parse failure

## Test Plan

- Unit test legacy `agenticMode` to `agenticPolicy` mapping.
- Unit test MCP approval behavior for each preset.
- Unit test provider tool-loop iteration limits and first-tool-use behavior.
- Unit test CLI delegation-plan parsing, repair, and final-answer extraction.
- Integration test project orchestration with provider leader and CLI specialist.
- Integration test CLI leader with provider specialist.
- Renderer test agentic policy controls and orchestration generator preview.
- Regression test that existing agents/projects without `agenticPolicy` still behave as before.

## Assumptions

- Existing `agenticMode` remains supported for backward compatibility.
- No database migration is required; policy can live in existing JSON config fields.
- CLI orchestration v1 should use app-owned tagged JSON parsing, not a local MCP delegation server.
- The orchestration generator is project-scoped and should not reintroduce removed feature-generator behavior.
- Android is out of scope for this roadmap unless requested separately.
