# 0001 — Android content synchronisation strategy

- **Status:** Accepted
- **Date:** 2026-08-07
- **Scope:** The Nexy Android companion app's local persistence and its synchronisation with the
  desktop peer.
- **Primary source files:**
  - `android/app/src/main/java/io/nexy/android/data/local/LocalDataRepository.kt` — the local
    source of truth, outbox enqueue, snapshot apply, conflict recording, sanitisation.
  - `android/app/src/main/java/io/nexy/android/data/local/LocalEntities.kt` — Room entities,
    including `OutboxEntity`, `ChangeLogEntity`, `SyncCursorEntity`, `ConflictEntity`, `SyncStatus`.
  - `android/app/src/main/java/io/nexy/android/data/WsRepository.kt` — the WebSocket transport and
    the connect → hydrate → push → acknowledge handshake.
  - `android/app/src/main/java/io/nexy/android/data/repository/RepositoryContracts.kt` — the
    `CapabilityState` / `DataFreshness` model.
  - `android/app/src/main/java/io/nexy/android/ui/connection/ContentSyncState.kt` — the UI-facing
    sync-health projection.
  - `src/main/standalone-sync.ts` — the desktop side of the same protocol (snapshot/delta builder,
    push handler, conflict detection, attachment transfer).

---

## Context

Nexy's desktop app is the historical home of a user's data (conversations, projects, agents, wiki,
prompts, skills, attachments). The Android companion has to be a **first-class client of that data
that also works with no desktop present at all** — browsing, editing, and direct-to-provider chat
must function offline, on cellular with no desktop reachable, and while paired over the LAN.

That framing rules out the obvious "thin remote client" design. Several forces shaped the decision:

1. **The desktop is an optional peer, not a required backend.** There is no hosted Nexy service; a
   phone may never see a desktop, or may see one only intermittently over a local network. The app
   cannot treat "disconnected" as "no data".
2. **Both sides mutate the same records concurrently.** A conversation can be renamed on the phone
   while the desktop auto-titles it from the first message; an agent can be edited on both. The
   strategy has to reconcile independent edits without constant user intervention.
3. **Mobile memory and a single WebSocket frame are hard limits.** A naive "send everything on
   connect" snapshot grows without bound with history size — a single long chat can be ~12k message
   blocks — and can exhaust the mobile heap while the home screen still says "Syncing".
4. **The link is lossy and re-established often.** Backgrounding, network changes, and half-open
   sockets mean reconnects are routine, and delivery must be **at-least-once with replay safety**.
5. **Secrets and local paths must never leave the device that owns them.** API keys are Android-
   local; desktop workspace paths are desktop-local. Neither may appear in a snapshot, an outbox
   record, or a backup.

## Decision

Adopt an **offline-first, local-source-of-truth architecture with a durable outbox, per-entity
versioning, field-level conflict detection, and a versioned WebSocket sync protocol that prefers
cursor-based deltas and falls back to bounded snapshots.** Concretely:

### 1. Room is the single source of truth; the network is a projection into it

`LocalDataRepository` (a process singleton) owns a Room database and exposes every list as a
reactive `StateFlow` derived from a Room `Flow`. The UI reads only from Room. Remote events and
snapshots are *merged into* Room and never bypass it, so **disconnecting never clears a list or
reinterprets cached data as stale** (`CapabilityState.freshness` tracks that separately). This is
stated directly in the repository's own class doc: "Android's durable source of truth. Remote
events are projections into this store; UI consumers never need to discard cached data merely
because the desktop connection disappeared."

### 2. Every local mutation is optimistic and transactional, and enqueues an outbox operation

Each write (`createConversation`, `renameConversation`, `updateMessageContent`, …) does three things
inside one `database.withTransaction { … }`:

- upserts the entity locally with `syncStatus = PENDING` and an incremented `localVersion`;
- enqueues an `OutboxEntity` (the mutation to push);
- appends a `ChangeLogEntity` (a durable, compactable log of what changed).

The UI updates immediately from the local write; the push happens later and asynchronously.

### 3. Ordering and idempotency are explicit, not derived from wall-clock time

- Outbox ordering is `(deviceId, deviceSequence)` where `deviceSequence` is a monotonic per-device
  counter. **Timestamps are display metadata only and never decide a conflict winner.**
- Each operation carries a UUID `operationId` used as an idempotency key, so replaying an
  acknowledged batch after a dropped connection is safe.
- All records use stable RFC 4122 UUIDs generated on whichever device created them, so an entity
  created on the phone keeps its identity when it reaches the desktop.

### 4. Per-entity version vectors drive field-level, automatic-where-possible merges

Each entity carries `localVersion`, `remoteVersion`, and a `SyncStatus`
(`SYNCED` / `PENDING` / `FAILED` / `CONFLICT`). When a snapshot or remote event arrives
(`applySyncSnapshot`, `applyRemoteEvent`):

- If the local row is **not** `PENDING`, the remote value wins and is written.
- If the local row **is** `PENDING`, the merge compares the *specific fields*. If the fields that
  actually diverge are unrelated to the queued edit, it is adopted silently; if the queued field
  and the remote field genuinely disagree, a `ConflictEntity` is recorded carrying *both*
  recoverable values and the entity is flagged `CONFLICT`.
- Delete-versus-edit is treated as a conflict (`applyTombstones`), not a silent data loss.
- A deliberate exception: a brand-new chat's placeholder title (`"New Chat"`) being replaced by the
  desktop's auto-generated title is **never** surfaced as a conflict (`isPlaceholderTitle`) — that
  divergence is expected, not a user decision.

The user resolves real conflicts in **Settings → Connection**, choosing the Android or desktop
value; `applyConflictResolution` then either re-queues the local value or adopts the remote one.

### 5. The transport is a versioned WebSocket protocol: negotiate, hydrate, push, acknowledge

`WsRepository` drives, over an authenticated (shared-token) OkHttp WebSocket:

1. `sync:hello` negotiates **protocol version** (v2 preferred, v1 fallback), **schema version**,
   entity types, a max batch size, and — critically — sends the device's durable **desktop change
   cursor** (`SyncCursorEntity.lastReceivedSequence`) and a requested **hydration mode**.
2. The desktop replies with `sync:welcome`:
   - With a valid cursor it returns a **delta** — only entities changed since that sequence
     (`buildSyncSnapshot` in `standalone-sync.ts`).
   - Otherwise it returns a **bounded full snapshot** (protocol v1 behaviour, or first pairing).
3. Android applies the snapshot/delta into Room in **bounded transactions with `yield()`** between
   chunks, prioritising the conversation the user is currently viewing, so a large apply never
   freezes interactive chat.
4. Android then flushes its outbox (`sync:push`); the desktop replies `sync:ack` with acknowledged
   operation IDs and any conflicts. Acknowledged operations mark their entities `SYNCED` and
   **compact** the change log.

### 6. The connect frame is kept small deliberately (shell hydration + lazy pagination)

Two hydration modes exist: `full` (legacy: inlines message bodies for the most-recent conversations)
and `shell` (metadata only — conversation rows with a `last_message` preview, projects, agents; no
bulk message bodies and no wiki/prompt/skill bodies). Message bodies hydrate on demand through a
**separate, request-correlated, paginated history flow** (newest-first, content-hash
`not-modified` short-circuit, bounded page sizes). After a shell connect, a **bounded prefetch** of
the top-N conversations with no cached bodies warms the most-likely taps without recreating the
monolithic-snapshot cost.

### 7. Attachments are content-addressed and transferred out-of-band, resumably

Attachment identity is the lowercase SHA-256 of the bytes. Bytes never travel inline in entity
payloads; they move as **verified ≤64 KB chunks** that resume from the receiver's acknowledged byte
offset, deduplicate by hash, verify the digest on completion, and restart a damaged download.

### 8. Security is enforced at both sync boundaries, plus dataset binding

`sanitizeSyncJson` recursively strips a denylist of keys (`apikey`, `token`, `secret`, `password`,
`rootdirectory`, `path`, `dataurl`, `thumbnaildataurl`, …) from every payload before it is enqueued
or applied, so secrets and local/workspace paths cannot leak in either direction. The device holds
one stable UUID identity (never synced as content), and `bindDataset` locks the local database to
the first paired dataset (first 24 hex of SHA-256 over the pairing token), refusing to sync a
second desktop profile into the same store.

### 9. Failure handling is self-healing and avoids retry storms

- Failed operations get **exponential backoff** (`1s << attempts`, capped at 60s) via `markFailed`.
- Deleting a conversation **cancels** any not-yet-synced operations for its messages
  (`cancelOutboxForConversationMessages`) — they can never apply once the parent is gone.
- After a batch failure, `discardOrphanedOperations` silently discards operations whose parent
  record no longer exists, while **explicitly not touching** genuinely-failed-but-valid operations
  — a large comment in the code records that resetting their backoff there previously caused an
  infinite push/error/retry loop.
- Recognised error causes are translated into plain language for the Connection screen
  (`SyncErrorMessages`); unrecognised ones show raw text.

### 10. UI separates connectivity from content freshness

`CapabilityState` keeps desktop connectivity, internet connectivity, execution target, data
freshness (`CURRENT` / `STALE` / `LOCAL_ONLY`), and pending/failed/conflict counts as independent
dimensions. The app bar splits this into two glyphs: `ConnectionDotState` answers "am I linked to
the desktop?" and `ContentSyncState` (`SYNCED` / `SYNCING` / `ERROR`) answers "is my content up to
date?". They are intentionally not collapsed into one indicator.

---

## How this compares to Android / Kotlin best practice

**It closely follows the canonical Android offline-first architecture** that Google documents in the
"Build an offline-first app" guide and demonstrates in the *Now in Android* sample:

- **Room as the single source of truth**, repository pattern in front of it, and **reactive `Flow` →
  `StateFlow`** streams to the UI — exactly the recommended shape. Reads never touch the network.
- **Optimistic local writes with a durable outbox / pending-operations queue** is the recommended
  pattern for "user made a change while offline". The idempotency key + monotonic sequence +
  at-least-once-with-dedupe is standard distributed-sync hygiene.
- **Content-addressed blobs with resumable chunked transfer** is the git/rsync-style best practice
  for large binaries over an unreliable link, and avoids re-sending bytes already present.
- **Protocol and schema version negotiation with a compatibility fallback** is the correct way to
  evolve a two-app contract where the two halves update independently.
- **Version-vector, field-level merge** is a pragmatic, well-understood middle ground between
  last-write-wins (lossy) and full CRDTs (complex) — appropriate because there is a single
  authoritative desktop reconciler and effectively one writer per device.

**Deliberate, defensible deviations from the "textbook" Kotlin stack:**

- **The outbox is flushed by an in-process coroutine on connect, not by `WorkManager`.** The
  textbook answer for deferred sync is `WorkManager` with a network constraint. Here, sync is only
  meaningful while a foreground WebSocket to a specific LAN peer is live, and the desktop is not a
  cloud endpoint that can accept a background job at an arbitrary later time. Coupling the flush to
  the live connection is simpler and matches the actual availability window. The cost: no OS-managed
  retry when the app is fully backgrounded — accepted because the outbox is durable and flushes on
  the next connect.
- **Hand-rolled `org.json` mapping rather than kotlinx.serialization/Moshi** in the sync layer. This
  trades compile-time type-safety for tolerance of unknown/malformed optional fields (unknown fields
  are *retained* in the canonical payload; malformed optional JSON degrades to a default rather than
  crashing or clobbering a pending edit) and for exact cross-language shape parity with the desktop's
  TypeScript `org`-shaped JSON. It is the most error-prone part of the design and the most heavily
  unit-tested (`StandaloneSyncParserTest`, `StandaloneCanonicalFixtureTest`, the `Sync*Test` suite).
- **A manual process-singleton repository rather than Hilt/DI-provided scoping.** Pragmatic for a
  single app-wide store; it does make the class large and harder to unit-test in isolation, which is
  why the merge/conflict *decisions* are extracted into pure, testable functions (e.g.
  `resolveContentSyncState`, `isOrphanedConversationReference`).

**Where it exceeds the baseline:** the explicit split of connectivity vs. content-freshness in the
UI, the placeholder-title conflict suppression, the orphaned-operation self-heal, and the
backoff-preservation guard against retry storms are all beyond what a reference sample provides and
reflect real production failure modes.

---

## Why it was structured this way — rationale for each major choice

- **Local-source-of-truth (not thin client):** because the desktop is optional. A design where the
  UI reads from the network would show an empty app whenever the phone is offline or the desktop is
  asleep — unacceptable for a companion whose whole point is "works anywhere". Making Room
  authoritative is what lets disconnect be a non-event.
- **Outbox + change log (not fire-and-forget writes):** the link drops constantly, so a mutation
  must survive being made while disconnected and must be replayable without duplicating its effect.
  Durability + idempotency keys give at-least-once delivery with replay safety; the separate change
  log allows compaction after acknowledgement without losing the pending-push queue.
- **`(deviceId, deviceSequence)` ordering, not timestamps:** phone and desktop clocks disagree, and
  a user editing on two devices must not have a winner chosen by clock skew. A per-device monotonic
  sequence is a deterministic, skew-proof ordering.
- **Cursor delta + shell hydration + pagination (not a monolithic snapshot):** driven directly by a
  mobile-memory constraint. The code comments quantify it: a single long chat is ~12k message
  blocks; hundreds of conversations multiply that into one WebSocket frame that spikes Android's
  allocation on every reconnect. Sending only what changed since a durable cursor, hydrating a
  metadata "shell" first, and paging bodies on demand keeps the connect frame tiny and the home
  screen responsive.
- **Field-level conflicts with automatic merge (not last-write-wins, not always-ask):** most
  concurrent edits touch different fields and should just merge; forcing the user to adjudicate every
  reconnect would be intolerable, while last-write-wins would silently destroy edits. Only genuine
  same-field divergence is surfaced, and even then both values are preserved for recovery. The
  placeholder-title exception exists because the single most common "divergence" (new chat gets
  auto-titled) is not a decision a human should be asked to make.
- **Self-healing failure paths (orphan discard, delete-cancels-outbox, backoff preservation):** a
  companion app cannot rely on the user to babysit a failed-operations queue. Operations that can
  never succeed are removed automatically; the rest retry on their own schedule. The
  backoff-preservation guard exists specifically because an earlier version created an infinite
  push/error/retry loop — the comment is a regression fence.
- **Sanitisation at both boundaries + dataset binding (not trust-the-payload):** privacy and
  correctness. API keys stay usable only on the device that holds them; desktop paths never reach
  the phone; and a phone bound to one desktop profile cannot be corrupted by accidentally syncing a
  different profile's dataset into the same Room store.
- **Connectivity/freshness split in the UI:** users repeatedly conflated "not connected to desktop"
  with "my data is out of date / lost". Separating the two indicators makes standalone mode read as
  a normal state rather than an error, which is the intended product posture.

---

## Consequences

**Positive**

- Fully usable offline; disconnect is a non-event for cached data.
- Reconnect cost is bounded and roughly proportional to what changed, not to total history size.
- At-least-once delivery with replay safety; no duplicate effects from re-sent batches.
- Secrets and local paths are structurally prevented from crossing the sync boundary.
- Most conflicts resolve silently; the few surfaced ones preserve both values.

**Negative / accepted costs**

- No OS-scheduled background sync — the outbox only flushes while a foreground connection is live.
- The hand-rolled JSON mapping layer is verbose and must be kept in lock-step with the desktop's
  TypeScript shapes; it is the highest-risk area and leans on an extensive fixture/parser test suite.
- `LocalDataRepository` is a large, multi-interface class; testability is preserved by extracting
  pure decision functions rather than by decomposing the store.
- Version-vector field-level merge is weaker than a CRDT for true multi-writer scenarios; it is
  sufficient only because a single authoritative desktop reconciles and each device is effectively a
  single writer.

## Alternatives considered

- **Thin remote client (UI reads the desktop directly).** Rejected: breaks the core requirement that
  the app works with no desktop present.
- **Last-write-wins on a single timestamp.** Rejected: silently loses concurrent edits and is
  vulnerable to clock skew between phone and desktop.
- **Full CRDT (e.g. per-field RGA/LWW-register set).** Rejected as over-engineered: there is a single
  authoritative desktop and one writer per device, so the version-vector + field-merge approach
  reconciles the real cases at a fraction of the complexity.
- **Monolithic full snapshot on every connect.** Rejected: unbounded WebSocket frame and mobile-heap
  exhaustion for large histories (retained only as the protocol-v1 compatibility fallback and for
  first pairing).
- **`WorkManager`-scheduled background sync.** Rejected as the primary mechanism: the desktop is a
  live LAN peer, not a cloud endpoint that can accept a deferred background job; sync is only
  meaningful while the connection is up.

## References

- `docs/android-standalone.md` — user-facing behaviour and troubleshooting.
- `docs/android-standalone-contract.md` (contract v2) — the canonical record/field table, capability
  matrix, and protocol envelope this ADR implements.
- `docs/MOBILE_WEBSOCKET.md` — the underlying WebSocket transport and auth.
- Android developer guide, "Build an offline-first app"; the *Now in Android* architecture sample —
  the best-practice baseline compared against above.
