# Conversation Strategy Rating & Analytics Roadmap

Status: **planning document**. No code has been changed as part of producing this document — it is a research report plus a phased implementation roadmap for future work. All file:line citations reflect the codebase at the time of writing.

## 1. Why this document exists

The user wants to rate how well a chat went, with that rating tied to which agent, model, project settings, skills, tool calls, and MCP servers were involved — so that (a) the user can browse this history as charts and a table, and (b) an LLM in a later, similar conversation can be told "a strategy like this one worked well before." None of this exists today: there is no rating/feedback mechanism anywhere in the schema, and — more fundamentally — most of the "what was used" data this feature depends on (structured tool-call history, skill-invocation history) isn't captured in queryable form at all today; it's either an unstructured JSON blob inside chat messages or not recorded anywhere.

This document:
1. Documents the current-state chat/agent/database architecture relevant to this gap, with citations (§2).
2. Lays out the target data model and UI (§3).
3. Lays out a phased roadmap — capture instrumentation has to be built before rating or retrieval can mean anything, so it comes first (§4).
4. Lists every open design decision, including product choices already confirmed with the user, for reviewer sign-off (§5).

## 2. Current-state architecture

### 2.1 What's tracked today, and how

- **`conversations`** table: `id, agent_id, model, pinned, project_id, title, created_at, updated_at, completed_at, cli_backend`. No explicit `provider` column — provider is inferred from `model`/`backend` at read time, not stored directly.
- **`messages`** table: tool-call outcomes are persisted only inside `role='tool-call'` rows as an **unstructured JSON blob** in `content`. For CLI backends specifically, `chat-handlers.ts:702-723` inserts a message with:
  ```ts
  JSON.stringify({
    __type: 'tool-call',
    toolCallId: tc.id,
    toolName: tc.name,
    serverName: effectiveBackend,
    toolArgs: tc.input,
    toolResult: tc.content,
    toolSuccess: !tc.isError,
  })
  ```
  There is no dedicated `tool_calls` table — recovering "which tools ran in this conversation" today means parsing every message's JSON content and filtering by `__type`.
- **Single choke point for every tool-call outcome, across all backends** (not just CLI): `sendToolFinished` in `src/main/tool-loop.ts:153-160`:
  ```ts
  const sendToolFinished = (event: ToolLoopToolFinishedEvent) => {
    if (onToolFinished) { onToolFinished(event); return }
    if (!webContents.isDestroyed()) webContents.send('chat:tool-call-event', event)
    broadcastToMobile({ event: 'chat:tool-call-event', data: event })
  }
  ```
  It's invoked from every branch of the tool-loop — never-allowed, not-pre-approved, unknown-tool, inline-handler (e.g. wiki tools), and the normal MCP-resolved path (`tool-loop.ts:296-325`, which also resolves `serverName` via `servers.get(mcpResolved.serverId)`). Every call carries `{toolName, serverName, args, result, success, conversationId}`. **Today this only drives an ephemeral UI push** (renderer IPC + mobile broadcast) — nothing is written to a durable, structured table. This is the natural, single hook point for new structured capture.
- **Skills are never logged as "used" in a conversation, anywhere.** The `agent_skills` join table (`agent_id, skill_id, sort_order, attached_at`) records static *attachment* of a skill to an agent — a config fact, not a per-conversation event. The actual point where an agent's attached skills take effect for a given turn is `applySkillsToAgentConfig(agentId, baseConfig)` (`src/main/skills.ts:181-216`), called unconditionally from `getAgentConfig(agentId)` (`src/main/agents.ts:122-135`, specifically line 134) every time an agent's config is resolved to run a turn. There is no side effect recording *which* skills were actually merged in for *which* conversation.
- **MCP servers**: resolved via `servers.get(mcpResolved.serverId)` in `src/main/mcp.ts`. `serverName` is already present on every `sendToolFinished` payload (§ above) — so a rating system doesn't need a separate MCP-usage table; it's derivable as `DISTINCT server_name` from whatever new tool-call table captures that payload.
- **`agent_delegations`** table (`conversation_id, leader_agent_id, specialist_agent_id, task, result, status, duration_ms, created_at`): the one place in the schema today where a structured "what happened during this conversation" event is actually persisted (multi-agent orchestration only). Useful as a shape precedent for a lightweight per-event log table.
- **`conversation_debriefs`** table (`conversation_id` unique, `project_id`, `summary`, `commands_tools` JSON, `reproduction_guide`, `mental_model`, `generated_at`), generated via `generateDebriefForWs(conversationId, projectId, model)` in `src/main/debrief-handlers.ts`. This is the closest existing sibling feature — an AI-generated, post-hoc analysis of a conversation — but it's not user-rated and not structured strategy data (agent/model/tools/skills as queryable fields); it's prose plus one loosely-shaped JSON blob.
- **Snapshot-freezing precedent already exists in this schema**: `messages.context_snapshot` (added migration v8, carried through the v12/v16 table-rebuild migrations) freezes a JSON blob of context *at write time* rather than requiring later reads to recompute it from mutable joined state. This is directly reusable as the design precedent for a rating's "what was true when this was rated" snapshot (§3).
- **No embedding or vector-store infrastructure exists anywhere in `src/main`** (confirmed by search) — there is no existing RAG/similarity infrastructure to plug into. A plain SQL match/filter query (by agent id, model, project id, keyword overlap) is the appropriate retrieval mechanism for this feature, not a vector store.

### 2.2 UI and IPC precedents

- No charting library exists in `package.json` (renderer) or `android/app/build.gradle.kts` — confirmed by search on both. Both platforms need a new charting dependency added; there's no existing chart component to extend.
- Renderer top-level navigation is `ActiveSectionPane` (`src/renderer/store/types.ts:80`), currently `'projects' | 'agents' | 'chats' | 'skills' | 'scheduled' | 'artifacts' | null`, driving `Sidebar.tsx`'s nav entries — this is where a new top-level ratings/analytics surface slots in, matching how Skills and Scheduled were each added as their own peer entry rather than nested inside something else.
- `DebriefArtifactCard.tsx` (`src/renderer/components/artifacts/`) is the closest existing "per-conversation insight card" visual precedent for a rating widget's look and feel.
- IPC pattern (per `CLAUDE.md`, reconfirmed): new channels need an entry in the `IpcChannels` union and `IpcReturnMap` in `src/shared/types.ts`, a handler registered via `safeHandle` (`src/main/safe-handle.ts`), and `typedInvoke`/`typedOn` wrappers in `src/preload/index.ts`.

### 2.3 Product decisions already confirmed with the user

- Rating scale: **1-5 stars**, not thumbs up/down.
- LLM-facing strategy retrieval: **opt-in toggle per project/agent**, not on by default, and not deferred out of scope.
- Android surface: **full parity with the desktop charts**, not a table-only cut-down view.

## 3. Target design

### 3.1 New tables (append-only migrations)

Following this codebase's established discipline of keeping `MIGRATIONS` and `initializeBaseSchema()` in sync (see `automated-workflow-hierarchy-roadmap.md` §3.1 in this same directory for why both must independently describe the same end state):

```sql
-- Structured tool-call log: replaces having to parse unstructured message JSON
-- for "what tools ran in this conversation." Additive — existing message-based
-- tool-call rendering in the transcript is untouched.
CREATE TABLE IF NOT EXISTS conversation_tool_calls (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  server_name     TEXT,              -- MCP server name; NULL for built-in tools
  success         INTEGER NOT NULL,  -- 0/1
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_tool_calls_conv ON conversation_tool_calls(conversation_id);

-- Per-conversation skill-invocation log: today skills are only ever attached
-- to an agent (agent_skills), never logged as "actually used in this chat."
CREATE TABLE IF NOT EXISTS conversation_skill_invocations (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  UNIQUE(conversation_id, skill_id)   -- one row per skill per conversation, not per turn
);

-- The rating itself. One per conversation; re-rating overwrites.
CREATE TABLE IF NOT EXISTS conversation_ratings (
  id                     TEXT PRIMARY KEY,
  conversation_id        TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  rating                 INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  note                   TEXT,
  context_snapshot_json  TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);
```

`context_snapshot_json` freezes, at rating time:
```ts
{
  agentId: string | null, agentName: string | null,   // denormalized name, not just id
  model: string, backend: string | null,
  projectId: string | null, workflowMode: 'single-agent'|'automated-delegation'|'orchestrated' | null,
  toolNames: string[], serverNames: string[],           // distinct values from conversation_tool_calls
  skillIds: string[], skillNames: string[],              // distinct values from conversation_skill_invocations
  keywords: string[],
}
```
This directly follows the `messages.context_snapshot` precedent (§2.1) — it keeps a historical rating meaningful even after the source agent is renamed/deleted, a skill is removed, or the project's `workflowMode` later changes. Denormalized name copies (not just ids) are stored for the same reason `agent_delegations` and `conversation_debriefs` already keep readable copies rather than relying on live joins that can go stale or null out.

### 3.2 Capture instrumentation

- `conversation_tool_calls` is populated by adding one insert alongside the existing `sendToolFinished` call in `tool-loop.ts:153-160` — every branch that already calls it (never-allowed, not-approved, unknown-tool, inline-handler, MCP-resolved) gets a structured row for free, with zero change to the existing push-event behavior.
- `conversation_skill_invocations` is populated with an `INSERT OR IGNORE` (respecting the `UNIQUE(conversation_id, skill_id)` constraint) at the `applySkillsToAgentConfig()` call site inside `getAgentConfig()` (`agents.ts:134`) — every turn that resolves an agent with attached skills logs those skills against the conversation, deduplicated automatically across multiple turns in the same chat.

### 3.3 Keyword capture

Local, heuristic extraction — tokenize the conversation title plus the first user message, strip stopwords, keep the top N distinct terms — stored **only** inside the frozen snapshot, not as a separate join table (this is point-in-time snapshot data, not a live relationship). Chosen over invoking an LLM at rating time (e.g. reusing the `debrief-handlers.ts` AI-summary pipeline) for reliability and cost: rating submission shouldn't require a model call to succeed. Flagged in §5 as swappable later if richer semantic keywords are wanted.

### 3.4 Retrieval for LLM context

A new query function, e.g. `findSimilarRatedStrategies({agentId?, model?, projectId?, keywords?})`, doing a plain SQL match/score over `conversation_ratings` — agent/model/project equality plus keyword overlap, ordered by rating descending then recency — returning the top few past snapshots with their rating and note. No vector store needed (§2.1 confirms none exists). This is wired into `chat-context-builder.ts` as an **additive, opt-in** context block — gated by a new per-project or per-agent setting (confirmed decision, §2.3) — surfacing something like "Similar past attempts: rated 5/5 using Agent X + tools [a, b] — note: '...'" only when explicitly enabled, so token budget and prompt behavior are unaffected for anyone who hasn't opted in.

### 3.5 UI

- **Rating capture**: a star widget (+ optional note field) in `ChatWindow` (desktop) and `ChatScreen.kt` (Android), submitted via a new `rating:submit` channel. `conversations.completed_at` (already tracked) is a natural, non-forcing trigger point to prompt for a rating, without blocking or requiring it.
- **New top-level `'ratings'` `ActiveSectionPane` entry** → `RatingsPane.tsx`, alongside Skills/Scheduled/Artifacts in `Sidebar.tsx`, containing:
  - Charts: average rating by agent, by model, by skill, by MCP server, by project; rating trend over time. Requires a new web charting dependency (open pick, §5).
  - A sortable/filterable table: date, title, project, agent, model, rating, tools used, skills used, note — each row linking back to the source conversation.
- **Android gets full parity** (confirmed decision, §2.3): an equivalent charts + table screen in Compose, requiring a new Compose-native charting dependency (open pick, §5; none exists in `build.gradle.kts` today), fed via the WS mirror of the same data channels.

## 4. Phased roadmap

### Phase 0 — Pre-work decisions
Pin down: the web charting library, the Compose charting library, and where the opt-in LLM-retrieval toggle lives (`ProjectConfig` field vs. `AgentConfig` field — a project-level toggle is simpler and matches how `workflowMode` already lives on the project, but an agent-level toggle would let a specialist "research" agent opt in while a general chat agent stays out; recommend project-level as the default unless a reviewer wants per-agent granularity). Flag both for reviewer sign-off before schema work starts.

### Phase 1 — Schema
The three tables in §3.1, plus indexes; `initializeBaseSchema()` updated in the same change so a fresh install and an incrementally-migrated install describe the same end state (this codebase's existing dual-source discipline).

**Verification**: migration-runner test asserting fresh-install schema matches incremental-migration schema for all three new tables via `PRAGMA table_info`; existing `tool-loop`/`skills`/`agents` test suites pass unmodified (proves this phase is additive-only).

### Phase 2 — Capture instrumentation (backend-only, no UI)
Wire the `sendToolFinished` call site (`tool-loop.ts:153-160`) to also insert into `conversation_tool_calls`; wire the `applySkillsToAgentConfig()` call site (`agents.ts:134`) to `INSERT OR IGNORE` into `conversation_skill_invocations`.

**Verification**: existing tool-loop and skill-resolution tests pass unmodified; new tests assert the right rows land in each table for a scripted conversation exercising multiple tools/skills; confirm no measurable latency regression on the hot tool-call path (this now does a synchronous DB insert on every tool call).

### Phase 3 — Rating CRUD + snapshot
New `rating-handlers.ts` (or `conversation-ratings.ts`) with `rating:submit` / `rating:get` / `rating:delete` IPC channels (added to `IpcChannels`/`IpcReturnMap` in `src/shared/types.ts`), snapshot-building logic (pull `agent_id`/`model`/`project_id`/`workflowMode` off the conversation + project row, aggregate distinct tool/server/skill names for that `conversation_id`, run the keyword heuristic from §3.3), and the `UNIQUE(conversation_id)` overwrite-on-re-rate behavior.

**Verification**: submit-then-fetch round trip; re-rating the same conversation overwrites rather than duplicating; snapshot content stays intact and readable after the source agent or a referenced skill is deleted (proving the denormalized-copy design in §3.1 actually holds).

### Phase 4 — LLM strategy retrieval
`findSimilarRatedStrategies()` (§3.4); the opt-in setting from Phase 0; wiring into `chat-context-builder.ts`.

**Verification**: ranking test against a seeded `conversation_ratings` table (correct ordering by match quality + rating + recency); a regression test proving the context block is entirely absent — zero token/prompt impact — when the toggle is off.

### Phase 5 — Desktop UI
Rating widget in `ChatWindow`; `RatingsPane.tsx` (new `'ratings'` `ActiveSectionPane` value, `Sidebar.tsx` entry, charts + table per §3.5); `rating:get-stats`/`rating:list` IPC channels; add the chosen web charting dependency.

**Verification**: component tests for the new sidebar entry/pane; manual E2E — rate a real conversation, confirm it appears correctly in both the chart aggregates and the table, confirm clicking a table row opens the source conversation.

### Phase 6 — WS protocol mirror + Android UI (full parity)
`rating:submit` / `rating:get-stats` / `rating:list` WS commands mirrored in `ws-handlers.ts`; rating widget in `ChatScreen.kt`; new Android ratings screen with charts (chosen Compose charting dependency) + table, `NavGraph.kt` route, `WsRepository`/`WsEventParser.kt` wiring.

**Verification**: extend WS command test coverage for the new commands; manual device smoke test — rate a conversation from Android, confirm it shows up in the desktop `RatingsPane` and vice versa.

### Phase 7 — Hardening
- Retention/pruning policy for `conversation_tool_calls` — flagged, not necessarily fixed in this pass, as an unbounded-growth risk: one row per tool call across all history, with no existing precedent for pruning this kind of high-frequency log table (the same class of gap already flagged for `automated_workflow_runs` in `automated-workflow-hierarchy-roadmap.md` §5 Phase 8 in this directory — more exercised by this feature, not introduced by it).
- Cascade-delete correctness: deleting a conversation removes its rows in all three new tables (via `ON DELETE CASCADE`); deleting an agent or skill referenced by a *frozen* `context_snapshot_json` must **not** break existing ratings (the snapshot has its own denormalized copies precisely so it doesn't need the live row to still exist) — verify this explicitly rather than assuming the schema design holds in practice.

**Verification**: cascade-delete test for all three tables; delete-an-agent-then-read-its-old-ratings test confirming the snapshot's denormalized `agentName` still renders correctly even though the live `agents` row is gone.

## 5. Consolidated open-decisions log

1. **Rating scale is 1-5 stars** — confirmed with the user, chosen over thumbs up/down for the finer-grained signal needed to rank/compare strategies against each other.
2. **LLM-facing retrieval is opt-in per project/agent, not on by default and not deferred** — confirmed with the user. Exact toggle location (project-level vs. agent-level config field) still needs Phase 0 sign-off; this document recommends project-level as the simpler default.
3. **Android gets full chart parity with desktop, not a table-only cut**, unlike the existing precedent elsewhere in this codebase of shipping desktop-first — confirmed with the user as a deliberate choice for this feature specifically.
4. **Web and Compose charting library picks are both open** — no existing dependency to reuse on either platform (confirmed by search); needs a Phase 0 decision before Phase 5/6 schema-adjacent UI work starts. (A common, low-friction default for the web side would be Recharts given the React/TypeScript stack already in use; no equivalent default is asserted for Compose without the user's input.)
5. **Keyword extraction is local/heuristic, not LLM-based, for v1** — chosen for reliability and cost (rating submission shouldn't depend on a model call succeeding); flagged as swappable later for richer semantic keywords by reusing the existing `debrief-handlers.ts` AI-summary pipeline.
6. **`conversation_tool_calls` retention/pruning policy is deferred** — flagged as a known unbounded-growth risk in Phase 7, not blocking initial ship.
7. **Rating is per-conversation, not per-turn or per-message** — matches the user's framing ("how well the chat went") and keeps the data model simple; a re-rate overwrites rather than accumulating a history of ratings for the same conversation.
