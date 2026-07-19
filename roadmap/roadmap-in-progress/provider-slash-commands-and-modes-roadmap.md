# Roadmap: Provider-Aware Slash Commands & Per-Backend Modes

Drafted 2026-07-18. **Status: IMPLEMENTED 2026-07-19 (stretch items open — see below).**

## Implementation status (2026-07-19)

Both phases shipped:

**Phase 1 — provider-aware slash commands**
- `SlashCommandDef.source` field + new `src/renderer/provider-slash-commands.ts` (per-backend command sets, `MODE_COMMAND_TO_OVERRIDE` map, `slashCommandSourceLabel`).
- Backend commands injected as a third source in `visibleSlashCommands` (`useChatWindowActions.ts`), keyed off the new machine-readable `backendChip.backend` in `ChatWindow.tsx`; cap raised 8 → 12.
- `SlashCommandMenu.tsx` renders grouped section headers (Nexy / Agent / Claude CLI / …) only when sources are mixed.
- Execution: mode commands set the conversation override; backend-mismatched commands get a clear notice; `/init` passes through as prompt text to Claude CLI.

**Phase 2 — per-backend modes**
- Migration 80: `conversations.cli_mode_override TEXT`; `CliModeOverride` union in `src/shared/types.ts`.
- Fourth `ChatModePicker` section, shown only for CLI-backed chats (Claude permission modes / Codex sandbox levels), following the existing override plumbing (`conversation:set-mode`, pending refs for not-yet-created conversations).
- Threaded through `chat-handlers.ts` as `CliAdapterRequest.permissionMode`; Claude adapter maps to `--permission-mode` (explicit mode wins over `skipPermissions`), Codex maps to `--sandbox` and drops the `[AUTO-APPROVE]` prompt hack whenever a real sandbox flag governs.
- Slash commands (`/plan`, `/accept-edits`, `/bypass-permissions`, `/sandbox-*`, `/mode-default`) and the picker are two front-ends to the same column.
- Tests: adapter arg-mapping (`cli-adapters.test.ts`), override threading (`chat.test.ts`), mode-command behavior (`slash-commands.test.ts`); schema version expectations bumped.

**Still open (stretch):** dynamic discovery of user-defined `~/.claude` commands; `--resume` session support for cross-turn plan → execute flows; `[AUTO-APPROVE]` retained as fallback when `skipPermissions` is set without an explicit sandbox mode (kept deliberately — removing it entirely would change existing auto-approve behavior); Android `conversation:set-mode` does not yet accept `cliModeOverride` (column is preserved, just not settable from the companion).

## Summary

Two connected features, phased into one roadmap because they share the same plumbing (active-backend detection in the composer, per-conversation overrides, `CliAdapterRequest` threading):

1. **Provider-aware slash commands** — surface the slash commands of whichever backend answers the current chat (Claude CLI, Codex CLI, Hermes CLI, OpenRouter/BYOK) as a dynamic list in the composer, alongside Nexy's built-ins. Recommendation: **one combined menu, visually grouped by source** ("Nexy" / "Claude CLI" / …) rather than separate lists — one keystroke surface, no mode confusion, and the grouping communicates provenance.
2. **Per-backend mode switching** — expose Claude Code's plan/permission modes and Codex's sandbox/approval modes as a per-conversation setting, settable both from the existing `ChatModePicker` gear and via the corresponding slash commands.

## Key findings (current state)

**Slash command system (renderer)**
- Command defs: static `SLASH_COMMANDS` array of `SlashCommandDef {name, usage, description}` — `src/renderer/slash-commands.ts:42-102` (~55 built-ins). No backend/provider field.
- Execution: giant switch in `executeSlashCommand` (`slash-commands.ts:284-975`); unmatched commands fall through to agent `customCommands` prompt-expansion (`:966-973`), else the raw text is sent as a normal message.
- Menu merge point: `visibleSlashCommands` in `src/renderer/hooks/useChatWindowActions.ts:656-659` — `[...filteredSlashCommands, ...customSlashCommands].slice(0, 8)` — rendered by `SlashCommandMenu.tsx` via `ChatComposer.tsx:210-217`. **This is the single natural injection point.**
- Precedent for backend-aware behavior: `/models` already branches on `ctx.activeAgent?.backend` and calls `window.api.getCliModels(backend)` (`slash-commands.ts:424-448`).

**Backend detection**
- Renderer: `backendChip` useMemo (`src/renderer/components/ChatWindow.tsx:1045-1083`) is the authoritative "what answers this chat" determination — `sourceType: 'provider' | 'cli'` + `sourceKey`. The dynamic command list should key off this.
- Main: `resolveEffectiveBackend` (`src/main/backend-routing.ts:47-83`) is the canonical resolver (request → agent backend → conversation `cli_backend` column → auth fallback → BYOK).

**CLI adapters (`src/main/cli-adapters/`)**
- Interface: `CliAgentAdapter` (`types.ts:45-59`); request shape `CliAdapterRequest` (`types.ts:4-26`) — no slash-command or mode field today.
- Claude (`claude.ts:102-142`): `--output-format stream-json --print`, `--model`, `--effort`, `--dangerously-skip-permissions` when `skipPermissions`. **No `--permission-mode`, no `--resume`** — each turn is a fresh spawn with history as a text prefix (`chat-handlers.ts:770-773`).
- Codex (`codex.ts:434-458`): `codex exec --json --ephemeral`; auto-approve is faked by prepending an `[AUTO-APPROVE]` directive to the system prompt — no real sandbox/approval flags used.
- Hermes (`hermes.ts:42`): synchronous `spawnSync`, minimal flags, no modes.

**Existing mode plumbing (the template for Phase 2)**
- `src/renderer/components/chat/ChatModePicker.tsx` — gear in the composer with three per-conversation overrides (thinking effort, auto-approve, terminal sandbox bypass).
- Flow: picker → `handleSetConversationMode` (`useChatWindowActions.ts:1085-1093`) → `window.api.setConversationMode` → `conversations` columns `thinking_effort_override` / `full_auto_approve_override` / `terminal_sandbox_override` (`chat-handlers.ts:406-418` write, `:454-514` read/effective) → adapter request (`chat-handlers.ts:989-995`).

## Phase 1 — Provider-aware slash command list

`Priority: P1 · Effort: M · Risk: low`

1. **Extend the command model.** Add optional fields to `SlashCommandDef`: `source?: 'nexy' | 'agent' | CliBackend | ProviderName` and `backends?: string[]` (which backends the command applies to). Built-ins default to `'nexy'`.
2. **Define per-backend command sets.** New module (e.g. `src/renderer/provider-slash-commands.ts`) with curated command lists per backend: Claude CLI (`/plan`, `/compact`, `/review`, `/init`, …), Codex CLI, Hermes CLI, plus any OpenRouter/BYOK-relevant entries. Keep them data, not switch cases.
3. **Inject at the merge point.** In `visibleSlashCommands` (`useChatWindowActions.ts:656-659`), add a third source selected by the active backend (reuse the `backendChip` computation / `activeAgent.backend`). Raise the `.slice(0, 8)` cap or make the menu scrollable, and pass grouping info so `SlashCommandMenu.tsx` renders section headers per source.
4. **Pass-through execution.** In `executeSlashCommand`, commands whose `source` is a CLI backend are not expanded locally: send them to the adapter via a new optional `CliAdapterRequest` field (e.g. `rawSlashCommand?: string`), threaded through `chat-handlers.ts`. Claude CLI accepts slash commands inside the `--print` prompt; Codex/Hermes commands that have no CLI equivalent either map to an adapter-specific arg or show a graceful "not supported by this backend" notice in the composer.
5. **Stretch:** dynamic discovery — scan the user's `~/.claude` (skills/commands) via a main-process handler so user-defined Claude commands appear automatically.

## Phase 2 — Per-backend mode switching

`Priority: P1 · Effort: M · Risk: medium`

1. **Conversation override.** New column via append-only migration in `database-migrations.ts` (e.g. `cli_mode_override TEXT` holding a backend-scoped value like `plan`, `acceptEdits`, `sandbox-workspace-write`). Follow the exact template of the three existing override columns (`chat-handlers.ts:406-418`, `:454-514`).
2. **UI.** Fourth section in `ChatModePicker.tsx`, shown conditionally on the active CLI backend, listing that backend's modes (Claude: default / plan / accept-edits / bypass; Codex: approval + sandbox levels; Hermes: hidden/disabled). Persist via the existing `setConversationMode` path.
3. **Adapter mapping.** New `CliAdapterRequest.permissionMode?` field:
   - Claude: map to `--permission-mode <mode>`; fold the existing `skipPermissions` boolean into this enum where possible rather than keeping two overlapping mechanisms.
   - Codex: map to real `--sandbox` / approval flags, replacing the `[AUTO-APPROVE]` system-prompt hack (`codex.ts:434-442`).
   - Hermes: ignore (documented no-op).
4. **Slash-command front-end.** Phase 1's backend command sets include the mode commands (`/plan`, etc.) — executing one sets the same conversation override, so the picker and slash commands are two front-ends to one mechanism.
5. **Known constraint / stretch.** Without session resume, "plan mode" applies per turn only; a true plan → approve → execute flow across turns requires adding `--resume <session-id>` support to the Claude adapter (persist the CLI session id per conversation). Capture as a separate stretch item — it also unlocks cheaper multi-turn CLI chats generally.

## Acceptance criteria

- [ ] Slash menu shows a grouped list: Nexy built-ins + agent custom commands + the active backend's commands; switching the chat's backend/model updates the list without reload.
- [ ] Backend commands that the CLI supports are passed through and visibly take effect; unsupported ones surface a clear notice instead of being sent as chat text.
- [ ] `ChatModePicker` shows a mode section only for CLI-backed chats, persists per conversation, and survives app restart.
- [ ] Claude adapter emits `--permission-mode`, Codex uses real sandbox/approval flags, and the `[AUTO-APPROVE]` prompt hack is removed.
- [ ] Renderer tests for the merged/grouped `visibleSlashCommands`; main tests for override threading into `CliAdapterRequest` (use the `vi.hoisted` spawn-mock pattern from `.claude/CLAUDE.md`).

## Common verification gates

- `npm run typecheck`, `npm run lint`, `npm test` (both Vitest projects).
- `nexy-app-check` smoke: composer menu against a Claude CLI agent, a Codex agent, and a BYOK/OpenRouter chat; mode toggle round-trip.
- Manual visual pass on the grouped slash menu and the extended `ChatModePicker` (dark/light, keyboard navigation).
