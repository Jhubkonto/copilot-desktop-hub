# Android Standalone and Peer Sync Roadmap

## Summary

Transform Nexy Android from a WebSocket-dependent desktop client into a local-first application that:

- Works without a reachable desktop.
- Calls supported cloud LLM providers directly when internet access is available.
- Supports cached reading and durable drafts when neither desktop nor internet is available.
- Maintains one logical dataset shared between one Android device and one paired desktop.
- Synchronizes directly over the existing authenticated peer connection when both devices are reachable.
- Clearly gates features that require desktop files, processes, tools, or build infrastructure.

This roadmap supersedes the illustrative phase breakdown in `src/plan/ANDROID_STANDALONE_BRAINSTORM.md`. That document remains useful as background research, but is not an implementation specification.

## Product and Architecture Decisions

- "Standalone" means that no desktop is required. Cloud LLM chat still requires internet access.
- Fully offline, on-device LLM inference is out of scope.
- Android and desktop expose one shared logical dataset rather than separate local and remote libraries.
- The first supported topology is one Android device paired with one desktop.
- Synchronization is peer-to-peer only. Pending changes cannot reach the counterpart until both devices are connected.
- Safe independent changes merge automatically. Ambiguous concurrent changes are preserved for user review.
- Room is the Android UI's source of truth. WebSocket events and direct LLM events update local repositories rather than becoming a second UI data source.
- Connection, capability, freshness, and synchronization are separate state dimensions. Losing a connection must not silently switch datasets or imply that cached data is current.

## Required Validation Commands

Run validation from the repository root unless stated otherwise.

### Desktop

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

### Android

- `cd android`
- Windows: `.\gradlew.bat lint testDebugUnitTest assembleDebug`
- macOS/Linux: `./gradlew lint testDebugUnitTest assembleDebug`
- With an emulator or device available: `.\gradlew.bat connectedDebugAndroidTest` or `./gradlew connectedDebugAndroidTest`

Every phase gate requires all checks relevant to the files changed in that phase. Before a phase is merged, the full desktop and Android validation sets must pass. New lint warnings, skipped tests, and unexplained baseline additions are failures.

---

## Phase 0: Capability, Data, and Protocol Discovery

**Goal:** Convert the existing brainstorm into verified feature and data contracts before changing runtime architecture.

### Implementation Steps

- [ ] Inventory every Android screen, ViewModel, `WsRepository` command, `WsEvent`, and desktop WebSocket handler.
- [ ] Produce a feature matrix that classifies each operation as:
  - Fully local.
  - Local with internet.
  - Cached read-only.
  - Queueable for later synchronization.
  - Desktop-required.
  - Excluded from standalone.
- [ ] Audit the desktop database schema, migrations, IDs, foreign keys, JSON fields, timestamps, deletion behavior, and attachment storage.
- [ ] Define which records synchronize: conversations, messages, agents, projects, prompts, skills, wiki entries, and supported attachments.
- [ ] Define which data never synchronizes: API keys, pairing secrets, device settings, transient stream state, build state, logs, and desktop filesystem paths.
- [ ] Document current identifier formats and define a collision-free identifier policy for all new records.
- [ ] Define canonical JSON fixtures for every synchronized entity and normalized chat-turn event.
- [ ] Prototype Android streaming against Anthropic and one OpenAI-compatible endpoint with cancellation and error parsing.
- [ ] Prototype Room entities and desktop-to-Android fixture round trips without replacing current behavior.
- [ ] Record measured limits for large conversations, attachments, snapshot size, and initial synchronization time.

### Phase Gate

- [ ] The feature matrix has an explicit standalone disposition for every current Android action.
- [ ] Canonical entity schemas, ownership rules, and excluded fields are reviewed.
- [ ] Streaming prototypes demonstrate text, completion, cancellation, provider error, and interrupted-network handling.
- [ ] Serialization tests prove desktop fixtures can round-trip through Android models without silent data loss.
- [ ] Run desktop lint, typecheck, tests, and build.
- [ ] Run Android lint, unit tests, and debug assembly.

---

## Phase 1: Local Persistence and Repository Boundaries

**Goal:** Make Android state durable and decouple UI logic from WebSocket transport without changing user-visible remote behavior.

### Implementation Steps

- [ ] Add Room and schema export dependencies to the Android build.
- [ ] Add Room entities and DAOs for conversations, messages, agents, projects, prompts, skills, wiki entries, attachments, and synchronization metadata.
- [ ] Store complex provider payloads only through versioned converters with malformed-data handling.
- [ ] Add append-only Room migrations and migration tests for every schema revision.
- [ ] Introduce domain repositories for conversations, messages, chat execution, agents, projects, reusable content, attachments, and synchronization.
- [ ] Refactor ViewModels to depend on repository interfaces instead of `WsRepository` or `WsClient`.
- [ ] Wrap existing WebSocket behavior in remote repository implementations during migration.
- [ ] Make Room the observable Android source of truth; apply remote snapshots and events to Room transactionally.
- [ ] Add explicit state models for:
  - Desktop and internet connectivity.
  - Feature capability and execution target.
  - Data freshness and last synchronization.
  - Pending operations and failures.
  - Conflicts.
  - Active chat turns.
- [ ] Encrypt Android API credentials and local pairing secrets with Android Keystore-backed storage.
- [ ] Add a one-time bootstrap that imports a paired desktop snapshot into an empty Android database without modifying desktop records.
- [ ] Preserve current chat re-entry, active-turn restoration, and reconnect behavior while repository boundaries are introduced.

### Phase Gate

- [ ] Repository contract tests run against fake, Room, and remote implementations where applicable.
- [ ] Room migration tests cover fresh install, each supported prior schema, rollback on failure, and malformed JSON fields.
- [ ] Process-death tests confirm committed entities and UI selection state restore correctly.
- [ ] Existing paired-desktop behavior remains functionally unchanged.
- [ ] Security tests verify secrets are absent from Room synchronization tables, logs, and serialized fixtures.
- [ ] Run desktop lint, typecheck, tests, and build.
- [ ] Run Android lint, unit tests, debug assembly, and relevant instrumentation tests.

---

## Phase 2: Offline-Safe Local Experience

**Goal:** Make cached content and local edits useful when desktop and internet connectivity are unavailable.

### Implementation Steps

- [ ] Enable local browsing and search for cached conversations, projects, agents, prompts, skills, and wiki entries.
- [ ] Enable local creation and editing of supported metadata and message drafts.
- [ ] Add a durable transactional outbox for synchronizable mutations.
- [ ] Assign each mutation an idempotency key, entity identifier, base version, device sequence number, timestamp for display only, and retry metadata.
- [ ] Coalesce safe superseded updates without reordering dependent operations.
- [ ] Preserve pending mutations across process death, restart, and application upgrades.
- [ ] Surface pending, failed, conflicted, and stale status at the affected record and in a synchronization summary.
- [ ] Add retry, discard, and inspect actions with confirmation where discarding could lose user work.
- [ ] Disable rather than queue time-sensitive operations such as tool approvals, stopping a remote generation, builds, or desktop process control.
- [ ] Keep unavailable desktop features discoverable where useful, with a concise explanation and connection action.

### Phase Gate

- [ ] Airplane-mode tests cover launch, browsing, search, draft creation, edits, deletion, restart, and later reconnection.
- [ ] Outbox tests cover ordering, coalescing, retries, permanent failure, process interruption, and duplicate dispatch.
- [ ] No offline action can accidentally execute against a stale or different dataset.
- [ ] Accessibility tests cover status labels without relying solely on color.
- [ ] Run desktop lint, typecheck, tests, and build.
- [ ] Run Android lint, unit tests, debug assembly, and offline instrumentation scenarios.

---

## Phase 3: Direct Android Chat MVP

**Goal:** Support complete cloud LLM conversations without a desktop.

### Implementation Steps

- [ ] Define a provider-neutral Android `LlmProvider` streaming contract.
- [ ] Implement Anthropic streaming with text, thinking blocks, usage, provider errors, and cancellation.
- [ ] Implement an OpenAI-compatible streaming provider for OpenAI and OpenRouter configurations.
- [ ] Normalize provider output into the existing chat-turn event model.
- [ ] Persist the user message before network dispatch.
- [ ] Checkpoint partial assistant output so interrupted generations can be recovered or explicitly retried.
- [ ] Support text and user-selected image/file attachments within provider and application limits.
- [ ] Add deterministic context construction from the agent prompt, supported local knowledge, attachments, and conversation history.
- [ ] Add conservative token budgeting and deterministic history truncation; defer automatic summarization until usage data is reliable.
- [ ] Add provider/model configuration and validation without exposing secrets to synchronization.
- [ ] Implement retry and regeneration semantics that do not duplicate committed user messages.
- [ ] Preserve provider identity, model identity, usage, and finish reason with each completed assistant response.
- [ ] Explicitly exclude desktop filesystem context, CLI adapters, local stdio MCP servers, git context, and desktop knowledge paths.

### Phase Gate

- [ ] Contract tests use recorded, redacted SSE fixtures for every supported provider event type.
- [ ] Integration tests cover first token, completion, thinking, cancellation, HTTP errors, malformed events, rate limits, timeout, and network interruption.
- [ ] Restarting during generation leaves a recoverable partial turn and never an unexplained permanent loading state.
- [ ] Attachment tests enforce type, size, encoding, and provider capability limits.
- [ ] Context-budget tests are deterministic and never exceed configured request limits.
- [ ] Manual acceptance: complete separate standalone chats through Anthropic and an OpenAI-compatible provider while the desktop is off.
- [ ] Run desktop lint, typecheck, tests, and build.
- [ ] Run Android lint, unit tests, debug assembly, and provider UI instrumentation tests.

---

## Phase 4: Peer-to-Peer Synchronization

**Goal:** Converge Android and desktop changes safely whenever the paired devices reconnect.

### Implementation Steps

- [ ] Extend pairing with stable device identity and shared dataset identity.
- [ ] Version the synchronization protocol independently from application versions.
- [ ] Add protocol negotiation for schema version, supported entity types, attachment support, and batch limits.
- [ ] Add desktop and Android durable change logs with per-device monotonically increasing sequence numbers.
- [ ] Implement snapshot bootstrap for first synchronization and incremental batches afterward.
- [ ] Add acknowledgements, resumable cursors, idempotency keys, bounded batches, retry backoff, and transactional application.
- [ ] Add per-entity version metadata sufficient to detect independent and concurrent changes without relying on wall-clock ordering.
- [ ] Implement merge rules:
  - Append messages using stable IDs and deterministic ordering.
  - Merge changes to independent fields automatically.
  - Preserve both values for concurrent changes to the same semantic field.
  - Send delete-versus-edit cases to conflict review.
  - Apply the same result regardless of which device reconnects first.
- [ ] Add tombstones for synchronized deletion and retain them until the counterpart has acknowledged them.
- [ ] Add attachment manifests, content hashes, deduplication, resumable transfer, size limits, and missing-file recovery.
- [ ] Add a conflict review queue that shows both versions, origin, affected fields, and resolution consequences.
- [ ] Add synchronization status: pending count, progress, last success, last error, conflict count, and manual retry.
- [ ] Prevent secrets and excluded device-local fields from entering snapshots or change batches.
- [ ] Add redacted protocol diagnostics without logging message contents or credentials by default.

### Phase Gate

- [ ] A shared cross-platform fixture suite produces equivalent canonical records on TypeScript and Kotlin implementations.
- [ ] Replay, duplication, reordering, partial batches, dropped acknowledgements, and process termination are idempotent.
- [ ] Concurrent independent edits merge automatically.
- [ ] Concurrent same-field and delete-versus-edit cases preserve recoverable data and appear in conflict review.
- [ ] Both databases converge after each conflict is resolved.
- [ ] Large snapshot and attachment transfers resume after disconnect without restarting completed work.
- [ ] Unsupported protocol versions fail safely and leave both databases unchanged.
- [ ] Security tests prove excluded fields and secrets never cross the wire.
- [ ] Run desktop lint, typecheck, tests, and build.
- [ ] Run Android lint, unit tests, debug assembly, and end-to-end synchronization instrumentation tests.

---

## Phase 5: Standalone Feature Expansion

**Goal:** Expand useful standalone coverage only after persistence, direct chat, and synchronization are reliable.

### Implementation Steps

- [ ] Complete local and synchronized CRUD for projects, agents, prompts, skills, and wiki entries.
- [ ] Add conversation rename, pin, archive, delete, message edit, regenerate, and branching with explicit synchronization semantics.
- [ ] Add a remotely refreshable provider/model catalog with a bundled offline fallback and signed/versioned catalog data.
- [ ] Add context summarization and compression with stored provenance.
- [ ] Add usage and cost reporting based on provider-returned usage and versioned pricing data.
- [ ] Add standalone generator workflows whose outputs can be saved locally or exported without claiming to modify a desktop workspace.
- [ ] Evaluate HTTP-based remote MCP clients as a separate threat-modeled feature; do not attempt to run stdio MCP servers on Android.
- [ ] Keep desktop-required capabilities gated:
  - Desktop filesystem and shell access.
  - Git-aware context and code changes.
  - CLI model backends.
  - Local stdio MCP servers.
  - Desktop and Android build pipelines.
  - Desktop automation.
  - Workspace-writing generators.

### Phase Gate

- [ ] Every newly enabled operation has documented offline, online, synchronization, conflict, and deletion behavior.
- [ ] Generator exports reopen correctly and do not imply that desktop files were changed.
- [ ] Model catalog fallback works without internet and rejects invalid remote catalog data.
- [ ] Usage and cost values are clearly labeled when estimated or unavailable.
- [ ] Capability-gating tests cover every desktop-required entry point.
- [ ] Run desktop lint, typecheck, tests, and build.
- [ ] Run Android lint, unit tests, debug assembly, and relevant instrumentation tests.

---

## Phase 6: Hardening, Migration, and Rollout

**Goal:** Make standalone mode safe to enable by default without risking existing user data.

### Implementation Steps

- [ ] Add encrypted local export and verified restore before general availability.
- [ ] Add database integrity checks and a read-only recovery path.
- [ ] Add synchronization diagnostics and user-exportable redacted logs.
- [ ] Add metrics for synchronization duration, pending-operation age, conflict frequency, retry count, provider failure, migration failure, and database errors.
- [ ] Define privacy-safe telemetry defaults and document every collected field.
- [ ] Support at least one desktop/Android release overlap through backward-compatible protocol negotiation.
- [ ] Add change-log and tombstone compaction only after the counterpart has acknowledged the covered sequence range.
- [ ] Test upgrades from the oldest supported paired Android and desktop releases.
- [ ] Roll out behind flags in this order:
  1. Internal local cache.
  2. Internal offline drafts.
  3. Opt-in direct chat.
  4. Opt-in synchronization.
  5. Limited external beta.
  6. Default local-first behavior.
- [ ] Define automatic rollback criteria for corruption, convergence failure, credential exposure, or unrecoverable migration failure.
- [ ] Publish user documentation describing offline limits, pending synchronization, conflicts, backups, and desktop-required features.

### Phase Gate

- [ ] Backup/restore tests verify content hashes and relational integrity.
- [ ] Upgrade and downgrade-compatibility tests cover every supported release pair.
- [ ] Soak tests run repeated edits, disconnects, reconnects, retries, and compaction without divergence.
- [ ] Fault-injection tests cover disk-full, corrupted payload, expired credentials, interrupted migration, unavailable peer, and application termination.
- [ ] No open severity-one data-loss, security, or convergence defects remain.
- [ ] Release checklist includes migration backup, staged enablement, monitoring, rollback, and user support guidance.
- [ ] Run the complete desktop and Android validation command sets on a clean checkout.
- [ ] Run `connectedDebugAndroidTest` on the supported emulator/device matrix.
- [ ] Perform manual end-to-end acceptance with a packaged desktop build and release-like Android build.

## Final Acceptance Criteria

- Android launches and exposes useful cached functionality with the paired desktop turned off.
- Direct cloud chat works without any desktop process running.
- Android remains useful for cached content and drafts with both desktop and internet unavailable.
- Local changes survive process death and remain pending until acknowledged by the desktop.
- Edits made independently on both devices converge without silent loss.
- Ambiguous conflicts preserve both values and provide an understandable review flow.
- Replaying any synchronization batch produces the same result.
- Existing remote-desktop workflows remain available and clearly identify their desktop dependency.
- Secrets never appear in synchronized entities, protocol logs, exported diagnostics, or the counterpart database.
- All required lint, typecheck, unit-test, instrumentation-test, and build gates pass.
