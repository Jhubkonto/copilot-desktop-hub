# Nexy Memory System: Current State and Scalable Design

**Status:** Proposed  
**Date:** 2026-08-09  
**Scope:** Desktop Electron app, paired Android companion, and Android standalone mode

## Executive summary

Nexy does not currently have one unified memory system. It has four independent context mechanisms:

1. a free-form `AgentConfig.memory` string;
2. agent knowledge files;
3. project wiki entries;
4. per-conversation rolling summaries.

There is also an opt-in retrieval path for highly rated past strategies. These mechanisms solve useful
parts of the problem, but they do not form a durable, searchable memory layer. In particular, they do
not provide structured decision records, reliable cross-project access, common ranking, common token
budgets, or complete desktop/Android standalone parity.

The recommended direction is a local-first **Memory Registry** built around small, typed, provenance-
backed memory records. A record belongs to exactly one namespace (project, shared collection, user, or
agent), has an explicit lifecycle (candidate, active, superseded, retracted, archived), and is retrieved
under a strict context budget. Models should receive a few compact memory cards automatically and use
tools to expand only the records they need. Cross-project access should happen through explicitly
attached shared collections, never by silently searching every project.

This architecture permits perpetual storage growth without proportional prompt growth: storage and
indexes can grow, while every request continues to receive a fixed, observable memory budget.

## 1. What exists today

### 1.1 Current data and context paths

| Mechanism | Stored in | Scope | How models receive it | Current bounds |
| --- | --- | --- | --- | --- |
| Agent memory | `agents.config_json` as `AgentConfig.memory` | Agent | Appended under `## Agent Memory` while desktop builds chat context | No explicit length or token bound |
| Agent knowledge files | `agent_knowledge_files`; content remains on disk | Agent | Files with `inject_mode = 'always'` are read and appended | Each file over 32,000 characters is reduced to its first 100 lines; the number of files has no aggregate budget |
| Project wiki | `project_wiki_entries` | Project | Top lexical matches are auto-injected; models also get search/list/propose tools | Four entries auto-injected, normally 800 body characters each; tool search returns up to five by default |
| Conversation compression | `conversation_summaries` | Conversation | Replaces older turns with a rolling summary plus a recent tail | Desktop targets at most 12,000 estimated tokens; Android standalone triggers at 120,000 characters and retains about 80,000 characters |
| Rated strategies | `conversation_ratings` | Usually project/agent/model match | Optional short block when project strategy retrieval is enabled | Five matches by default; metadata and user rating note only |

Important implementation locations:

- `src/main/chat-context-builder.ts` assembles agent memory, knowledge files, project context, wiki
  matches, and rated strategies.
- `src/main/wiki-context.ts` performs in-process token-overlap ranking and formatting.
- `src/main/wiki-handlers.ts` owns wiki CRUD, extraction, duplicate heuristics, and supersession.
- `src/main/context-compression.ts` owns automatic desktop rolling compression.
- `src/main/conversation-compression.ts` owns the editable manual compression flow.
- `android/app/src/main/java/io/nexy/android/data/StandaloneChatService.kt` owns standalone history
  compression and provider requests.

### 1.2 Agent memory

The agent memory field is a manually edited string. On desktop it is placed after the agent system
prompt on every turn. It is closer to standing instructions than recallable memory: it has no entries,
types, timestamps, provenance, conflict handling, search, or relevance filtering.

There is also a subtle implementation constraint: the memory and knowledge-file assembly is inside
`if (agentCfg?.systemPrompt)`. An agent with a blank system prompt does not receive its memory or its
always-injected knowledge files, despite the desktop UI saying memory is always appended.

Android can edit and synchronize the field as part of `AgentFullConfig`, but standalone provider
requests currently combine only `agentConfig.systemPrompt` and the conversation summary. The
`agentConfig.memory` value is not included in those standalone requests.

### 1.3 Agent knowledge files

Knowledge files are path registrations, not indexed knowledge. `always` files are read in full on
each desktop context build unless they cross the per-file truncation threshold. `on-demand` is exposed
in the UI and stored, but there is no dedicated model retrieval tool for these registered files; it
mostly means “do not inject automatically.”

This is suitable for a small profile or a stable reference sheet. It does not scale well to a growing
corpus because there is no aggregate token budget, chunk index, relevance ranking, stale-file hash, or
source-aware citation path.

### 1.4 Project wiki

The project wiki is the closest existing feature to durable project memory:

- entries have a title, Markdown body, tags, source conversation/message IDs, timestamps, and an
  optional `superseded_by` link;
- users can create and edit entries on desktop and Android;
- an LLM can extract up to ten candidate learnings from a conversation for user review;
- tool-capable chat paths expose `search_project_wiki`, `list_recent_wiki_entries`, and
  `propose_wiki_entry`;
- proposed model writes require explicit approval;
- the current turn auto-injects up to four entries matched against the last three user messages;
- after conversation compression, up to three wiki entries are selected using summarized goals,
  files, and decisions.

Retrieval is intentionally simple. Every active entry for one project is loaded, tokenized, and ranked
with word overlap plus a title bonus. This has several limits:

- it is lexical rather than semantic (“authentication” will not naturally find “login identity”);
- it scans the full active project wiki on every search;
- there is no type or importance distinction between an architectural decision and a casual fact;
- fuzzy title/body overlap is not a reliable identity or conflict model;
- only the current project is searchable;
- 800-character body slices can remove the consequence or rationale that makes a decision useful.

### 1.5 Conversation rolling summaries

Desktop automatically compresses a long conversation into structured sections: goals, decisions,
constraints, files touched, commands, open questions, next actions, and recent notes. The extraction
is deterministic and keyword-based. It preserves recent messages and incrementally folds newly aged-
out messages into the stored summary. Users can also prepare, edit, and save a manual summary.

This is context continuity, not durable organizational memory. It is keyed to one conversation and is
not normally searched from another conversation. The fixed list limits also mean it cannot preserve
every important event indefinitely; older retained items may occupy a category while newer items fail
to enter it.

Android standalone has a separate implementation. Above a character threshold it asks the selected
provider to summarize older history, falls back to a deterministic summary, saves the text in Room,
and sends it as “Earlier conversation summary.” This schema and algorithm differ from desktop. The
local standalone summary is included in Android backup, but conversation summaries are not part of
the current desktop/Android standalone content-sync entity set.

### 1.6 Rated past strategies

When `strategyRetrievalEnabled` is enabled for a project, Nexy scans conversation ratings and ranks
them by project, agent, model, keyword overlap, rating, and recency. The prompt receives rating/tool/
note metadata, not the past conversation’s actual decisions or solution. It is useful outcome feedback,
but it is not a general memory store.

### 1.7 What is not currently automatic memory

Messages, debriefs, artifacts, code-change reports, roadmap files, and repository ADRs are durable
records, but new chats do not automatically search all of them. A user or extraction flow must promote
important content to the project wiki, or the current conversation must still carry it in history or a
rolling summary.

## 2. Problems the unified design must solve

1. **Durability:** preserve decisions and their rationale across chats, restarts, and devices.
2. **Precision:** distinguish accepted decisions from suggestions, stale facts, preferences, and
   unresolved questions.
3. **Provenance:** link a memory back to the message, ADR, file revision, artifact, or code change that
   supports it.
4. **Evolution:** supersede or retract knowledge without erasing history.
5. **Bounded context:** prompt size must depend on request budget, not corpus size.
6. **Cross-project reuse:** share intentionally useful knowledge while preventing accidental data
   leakage between unrelated projects.
7. **Provider independence:** useful retrieval must work locally without requiring a hosted vector or
   embedding service.
8. **Cross-platform parity:** paired desktop and standalone Android must use the same logical records,
   access rules, and observable retrieval contract.
9. **Trust:** models may propose memories, but Nexy—not the model—enforces scope, permissions,
   lifecycle, and write policy.

## 3. Recommended conceptual model

### 3.1 Keep instructions, documents, conversation state, and memories distinct

These concepts should not be merged into one large prompt field:

| Concept | Purpose | Examples | Context behavior |
| --- | --- | --- | --- |
| Instructions | Tell a model how to behave | System prompt, project scope, coding rules | Small and predictably injected |
| Source documents | Authoritative, potentially large material | ADR file, specification, knowledge file | Indexed; retrieve chunks on demand |
| Conversation state | Continue one thread | Rolling summary, open actions, recent turns | Conversation-only, bounded |
| Durable memories | Recall atomic facts and decisions | “Use Room as Android source of truth” | Ranked, filtered, compact cards; expand on demand |

The existing agent `memory` field should initially remain compatible, but the UI should eventually
call it **Standing context**. It should have a small token limit and be described as always-on agent
guidance. Durable learned facts should move into the Memory Registry.

### 3.2 Atomic typed records

A memory should capture one durable claim. Recommended kinds:

- `decision` — an accepted choice, including rationale and consequences;
- `constraint` — a rule or invariant that remains in force;
- `fact` — stable project or domain knowledge;
- `procedure` — repeatable steps that produced a useful outcome;
- `preference` — a user or team preference;
- `outcome` — a result tied to an approach, including failure lessons;
- `open_question` — unresolved work that should be discoverable but not treated as truth.

Every record should contain a short title, a one-sentence abstract, optional detailed Markdown,
normalized tags/entities, importance, confidence, lifecycle status, and provenance. Decision records
should additionally support context, chosen option, alternatives, rationale, consequences, and review
conditions. These can live in a typed JSON payload while common searchable fields remain relational.

### 3.3 Namespaces and scope

Every memory has exactly one home namespace:

- `project:<id>` — default location for project facts and decisions;
- `collection:<id>` — intentionally shared domain or product knowledge;
- `user:<id>` — preferences that should follow the user everywhere;
- `agent:<id>` — rare agent-specific operational knowledge.

Avoid an implicit “all projects” namespace. User preferences may be global, but architectural and
business knowledge should not leak globally merely because it was useful once.

## 4. Proposed storage model

The following is a logical schema, not a migration to copy verbatim:

```text
memory_items
  id, namespace_type, namespace_id, kind
  title, abstract, body_markdown, payload_json
  status                         # candidate|active|superseded|retracted|archived
  importance, confidence, sensitivity
  canonical_key, content_hash
  valid_from, valid_until, superseded_by
  created_by_type, created_by_id
  created_at, updated_at, last_confirmed_at
  deleted, local_version, remote_version

memory_sources
  id, memory_id, source_type     # message|conversation|adr|file|artifact|code_change|manual
  source_id, source_uri, source_revision
  excerpt, excerpt_hash, created_at

memory_relations
  from_memory_id, relation       # supports|conflicts_with|depends_on|applies_to|derived_from
  to_memory_id, created_at

memory_candidates
  id, proposed_item_json, source_type, source_id
  proposed_scope_type, proposed_scope_id
  state                          # pending|accepted|rejected|expired
  created_at, reviewed_at

memory_collections
  id, name, description, sensitivity, created_at, updated_at

memory_collection_projects
  collection_id, project_id, access  # read|contribute|manage

memory_embeddings
  memory_id, model_id, dimensions, vector_blob, content_hash, created_at

memory_feedback
  id, memory_id, conversation_id, event  # injected|opened|used|dismissed|corrected
  value_json, created_at
```

Add a local full-text index over title, abstract, body, tags, entities, and source URI. Embeddings are
an optional derived index and can always be rebuilt; they are not the source of truth.

The current `project_wiki_entries` should remain during migration. A compatibility layer can expose
active project memory records in the existing Wiki UI and translate wiki CRUD into registry records
until both clients have moved to the new protocol.

## 5. Cross-project access

### 5.1 Shared memory collections

Use named collections such as “Nexy platform architecture,” “Android conventions,” or “Company API
rules.” A project explicitly attaches a collection with `read`, `contribute`, or `manage` access.
Memories created in a project remain private to that project unless the user deliberately promotes or
copies them to an attached collection.

This produces a clear rule:

```text
eligible namespaces for a turn =
  current project
  + collections explicitly attached to that project
  + eligible user preferences
  + selected agent namespace
  + any temporary scopes explicitly selected by the user for this turn
```

Scope filtering must occur before lexical or semantic retrieval. A model must never receive a title,
embedding match, count, or existence signal from a namespace it cannot read.

### 5.2 Explicit temporary cross-project search

For occasional research, let the user select projects/collections in the context picker for a single
conversation or turn. Show the selected scopes in Context Inspector. Do not let a model broaden its
own project access by passing arbitrary project IDs to a tool.

### 5.3 Conflicts across scopes

Project-local decisions override shared defaults for that project, but they should not mutate the
shared record. Retrieval should surface the local override and, when useful, the shared record it
supersedes or conflicts with. The prompt should clearly label both scope and status.

## 6. Capture and maintenance lifecycle

### 6.1 Capture sources

Candidate memories can come from:

- explicit user actions (“Remember this” or “Save decision”);
- the existing model tool, generalized from `propose_wiki_entry` to `propose_memory`;
- conversation completion/extraction;
- project conversations and CLI coding outcomes;
- ADR or documentation indexing;
- debriefs and artifacts selected by the user;
- corrections to a previously retrieved memory.

Prefer deterministic capture when the source is already structured. For example, an accepted code-
implementation summary or an ADR has stronger evidence than an LLM inference from casual conversation.

### 6.2 Approval policy

Default policy:

- manual entries save immediately;
- model-extracted decisions, constraints, and cross-project records require review;
- low-risk project facts may be auto-saved only under an explicit project setting;
- promotion to a shared collection always requires confirmation;
- a model can propose supersession or retraction but cannot silently perform it.

Candidates should display the proposed type, scope, concise content, source, and whether an existing
record will be updated, superseded, or left in conflict.

### 6.3 Consolidation without information loss

A background maintenance job should find likely duplicates using canonical keys, full-text similarity,
and optional embeddings. It may suggest merges, but accepted memories should not be destructively
rewritten without keeping sources and revision history.

Perpetual growth is managed through lifecycle and indexes:

- superseded/retracted items are excluded from normal recall but remain auditable;
- low-value stale items can be archived;
- repeated observations update confirmation/utility metadata instead of creating endless duplicates;
- large source text stays in documents; the memory stores a compact claim and pointer;
- embeddings and FTS indexes are derived and rebuildable;
- retention policies may delete rejected candidates and old feedback events without deleting accepted
  memories or their provenance.

## 7. Retrieval and context budgeting

### 7.1 Retrieval pipeline

For each turn:

1. Build a retrieval query from the current user request, up to three recent user turns, active files/
   entities, and compact goals/decisions from the conversation summary.
2. Resolve eligible namespaces and sensitivity policy.
3. Retrieve a bounded lexical shortlist from the full-text index. This is the mandatory offline path.
4. Optionally union a semantic shortlist when a configured local or BYOK embedding model is available.
5. Filter inactive, expired, inaccessible, and source-stale records.
6. Rerank using relevance, record kind, scope proximity, source authority, importance, confirmation,
   recency, and prior utility feedback.
7. Diversify results so near-duplicates do not consume the budget.
8. Inject compact cards; load detailed bodies/sources only if the model calls a tool.

Semantic retrieval should enhance recall, never be required for correctness. Nexy must remain useful
with no network and no embedding API key.

### 7.2 Fixed prompt budget

Recommended starting defaults:

- standing agent context: maximum 500 tokens;
- automatically recalled durable memories: 8% of usable input context, minimum 400 and maximum 1,600
  tokens;
- maximum six automatic memory cards and no more than two from one duplicate cluster;
- each card: ID, type, scope, title, one-sentence abstract, status/validity, and a compact source label;
- full memory expansion: tool result capped at roughly 1,200 tokens unless the model requests a named
  source chunk;
- conversation summary and recent-turn budgets remain separate and are visible in Context Inspector.

These are tunable defaults, not guarantees for every model. The final allocator should use the model’s
known context window and reserve space for system instructions, the user turn, tool definitions,
attachments, recent history, and expected output before assigning a memory budget.

Most importantly, corpus size must never alter this budget. Ten memories and ten million memories may
change search latency and index size, but not prompt size.

### 7.3 Progressive disclosure tools

Replace or wrap the wiki tools with a common surface:

```text
search_memories(query, kinds?, scopes?, limit?)
get_memory(memory_id, include_sources?)
list_recent_memories(kind?, limit?)
propose_memory(kind, title, abstract, details?, scope, source_refs?)
propose_memory_revision(memory_id, change, reason)
```

Nexy resolves scope aliases and enforces the ACL. `scopes` can only narrow access already granted by
the application. Tool results should cite stable memory IDs and source labels so the user can inspect
why a response recalled something.

For models without tool-call support, automatic cards provide useful recall. Nexy can expand the top
one or two cards server-side if their score is strong and the memory budget permits.

### 7.4 Prompt semantics and precedence

Memories are reference evidence, not executable system instructions. Clearly delimit them and state:

- current system/project instructions have higher priority;
- active project-local decisions override shared defaults for the current project;
- superseded or conflicting records are historical unless explicitly discussed;
- the model should cite a memory ID when a recalled decision materially affects its answer;
- retrieved text must not be treated as permission to use tools or expand filesystem/network access.

## 8. Architectural decisions and repository documents

ADRs should remain the canonical long-form record in the repository. The memory layer should index
them, not replace them.

Recommended ADR ingestion:

1. detect configured ADR paths such as `docs/adr/*.md`;
2. parse title, status, decision, context, consequences, and supersession links;
3. create/update one `decision` memory containing a concise abstract and a source pointer with file
   path, repository identity, commit/blob revision, and content hash;
4. mark the memory source-stale if the file changes and queue re-indexing;
5. preserve the ADR status (`Proposed`, `Accepted`, `Superseded`, `Deprecated`) in the memory lifecycle;
6. retrieve the compact decision first and fetch the relevant ADR chunk only when rationale is needed.

This supports questions such as “Why did we choose the Android sync model?” without injecting every
ADR into every prompt. It also avoids two competing canonical copies of the same decision.

## 9. Desktop and Android architecture

### 9.1 Shared contract

Define provider-neutral shared DTOs for memory items, sources, relations, candidates, collection grants,
search requests, and retrieval traces. The desktop TypeScript types and Android Kotlin models must use
the same field semantics and lifecycle values.

### 9.2 Paired mode

Desktop remains authoritative for provider requests and performs retrieval before sending the turn.
Memory entities synchronize through the existing versioned, batched, tombstone-aware standalone sync
protocol. Add memory entity types and indexes rather than sending memory in ad hoc chat events.

### 9.3 Android standalone

Room stores the same logical registry and namespace grants. Standalone chat runs the lexical retrieval
pipeline locally, injects the same compact card format, and exposes the same retrieval trace in Context
Inspector. Optional embeddings may be synchronized as derived data or rebuilt locally, but standalone
correctness cannot depend on them.

As an early parity fix, standalone request construction should include bounded standing agent context
and eligible project wiki/memory cards. It should not wait for the full semantic retrieval phase.

### 9.4 Sync and conflict behavior

- UUIDs make create replay idempotent.
- Ordinary editable fields use the existing per-entity version/conflict approach.
- Sources and relations are append-oriented where possible.
- Concurrent revisions that change the claim produce a visible conflict or two linked records; they
  must not be resolved by last-writer-wins.
- Supersession/retraction is an explicit state transition with provenance.
- Collection membership and sensitivity changes are security-relevant and must invalidate cached
  retrieval results immediately.

## 10. User experience

### 10.1 Memory Library

Evolve the Project Wiki into a Memory Library with consistent desktop and Android views:

- filters for type, status, scope, tag, source, and date;
- separate Pending Review and Conflicts views;
- a decision-focused editor with rationale, consequences, and supersession;
- source links back to conversation/message, ADR, artifact, or code change;
- promote/move to shared collection with a clear access warning;
- archive, retract, merge, and supersede actions that preserve history.

“Wiki” can remain a friendly project navigation label during migration, backed by project-scoped
memory records.

### 10.2 Context Inspector

For each sent turn, record and display:

- eligible scopes and why they were eligible;
- retrieval query terms/entities;
- candidate count, selected records, scores, and rejection reasons;
- tokens allocated and actually injected;
- whether lexical, semantic, or both retrieval paths ran;
- expanded memory/source tool calls;
- any stale, conflicting, or superseded record warning.

This makes “What did the model know?” answerable and helps diagnose both missing recall and context
flooding.

## 11. Migration plan

### Phase 0 — Correctness and measurements

- Fix desktop memory/knowledge injection so it does not depend on a non-empty system prompt.
- Add an aggregate token cap to standing agent memory and always-injected knowledge.
- Include bounded agent memory in Android standalone prompts.
- Record current wiki retrieval latency, entry counts, injected tokens, and extraction acceptance rate.
- Add retrieval details to Context Inspector before changing ranking.

### Phase 1 — Unified project memory registry

- Add registry/source/candidate/relation tables and local FTS search.
- Backfill each wiki entry as a project-scoped `fact`, `decision`, `constraint`, or `procedure`; use
  `fact` when classification is uncertain.
- Keep wiki APIs working through a compatibility adapter.
- Replace scan-and-tokenize search with indexed search and a fixed token allocator.
- Introduce common search/get/propose tools and stable memory citations.

### Phase 2 — Decision and source workflows

- Add the structured decision editor and lifecycle UI.
- Index repository ADRs and selected documents with revision hashes.
- Capture candidates from conversation completion, accepted code changes, and debriefs.
- Add deduplication, conflict, and supersession review flows.

### Phase 3 — Shared collections and Android parity

- Add collection membership and explicit project grants.
- Extend standalone sync and Room schema for the complete memory contract.
- Run local lexical retrieval in Android standalone and unify Context Inspector traces.
- Add temporary user-selected cross-project scopes.

### Phase 4 — Optional semantic and adaptive ranking

- Add pluggable local/BYOK embeddings as a derived index.
- Hybrid reranking and duplicate clustering.
- Learn from explicit corrections and usefulness feedback, with an option to disable it.
- Add maintenance dashboards for stale sources, conflicts, archived records, and index health.

Each phase should be independently useful. Cross-project access should not ship before access filtering,
retrieval traces, and Android sync semantics are tested.

## 12. Verification strategy

### Unit and integration tests

- namespace filtering occurs before ranking and never leaks inaccessible metadata;
- local project overrides rank ahead of conflicting shared defaults;
- superseded, retracted, expired, and stale records follow policy;
- prompt memory tokens never exceed the allocator’s budget;
- results are deterministic when embeddings are unavailable;
- source revisions invalidate and re-index correctly;
- candidate approval, rejection, merge, and supersession preserve provenance;
- desktop and Android serialize the same lifecycle/status values;
- offline Android standalone recalls project decisions without desktop connectivity;
- sync replay is idempotent and concurrent claim revisions do not silently overwrite one another.

### Scale tests

Seed at least 10, 1,000, 100,000, and 1,000,000 records across many namespaces and verify:

- prompt size is constant;
- query latency remains within a defined percentile target;
- memory usage is bounded during search;
- index rebuild is resumable;
- revoked collection access disappears from search and caches immediately.

### Quality evaluation

Build a small grounded recall set containing paraphrases, renamed components, superseded decisions,
conflicting shared/project rules, and irrelevant distractors. Measure recall, precision, stale-memory
rate, citation correctness, and tokens per useful memory—not only whether some result was returned.

## 13. Recommended decisions

1. Treat the project wiki as the seed of the durable memory layer, not as a separate competing system.
2. Keep conversation compression conversation-local; promote selected items through candidates rather
   than making all summaries globally searchable.
3. Treat the current agent memory field as bounded standing context and migrate learned knowledge into
   typed records.
4. Make lexical indexed retrieval the offline baseline and embeddings optional.
5. Use explicit shared collections for cross-project access; never search all projects by default.
6. Keep ADR files canonical and store concise indexed decision records with revisioned source links.
7. Require review for decisions, supersession, retraction, and cross-project promotion by default.
8. Enforce a fixed per-turn memory budget with progressive disclosure and observable retrieval traces.
9. Ship desktop/Android logical parity as part of each data-contract phase, not as a later UI-only task.

## 14. Open product choices

The architecture does not require these choices immediately, but they should be decided before their
respective phases:

- whether low-risk project facts may be auto-accepted and what qualifies as low risk;
- whether user-global preferences exist as a first-class namespace or remain standing agent context;
- which local embedding model, if any, Nexy should bundle versus letting users configure one;
- whether shared collections are device-local only initially or exportable/importable as packages;
- default archive thresholds and whether archival is automatic or suggestion-only;
- whether users can opt into searching completed conversation summaries directly as a fallback corpus.

The safest initial product stance is manual/approved capture, project-only scope, FTS retrieval, and a
strict memory budget. Shared collections and semantic retrieval can then be added without changing the
core record or provenance model.
