# Android standalone mode

Nexy Android stores its working dataset locally and can open without a paired desktop. Pairing
adds synchronization and desktop-only tools; it is not required for local browsing, editing, or
direct cloud chat.

## Capability matrix

| Capability | No network | Internet only | Paired desktop |
| --- | --- | --- | --- |
| Browse/search conversations, projects, agents, prompts, skills, and wiki | Cached data | Local data | Local data synchronized with desktop |
| Create, edit, pin, branch, and delete local records | Queued | Queued | Synchronized |
| Compose drafts | Durable | Durable | Durable |
| Cloud chat | Draft only | Anthropic, OpenAI, or OpenRouter direct from Android | Direct Android chat or desktop chat |
| Resolve synchronization conflicts | Review cached conflicts | Review cached conflicts | Choose Android or desktop value and synchronize |
| Builds, shell, Git, CLI models, stdio MCP, workspace changes, automation | Unavailable | Unavailable | Available through desktop |
| Generators that write workspace files | Unavailable | Unavailable | Available through desktop |

An internet connection alone never grants access to desktop files or processes. API credentials
remain Android-local, use Keystore-backed encrypted preferences, and are excluded from snapshots,
outbox records, and backups.

## Local state and synchronization

Room is the Android source of truth. Local changes are committed before network work begins and
enter a durable outbox with an idempotency key, device sequence, entity version, and retry state.
The desktop and Android negotiate synchronization protocol version 1 and exchange a snapshot on
bootstrap followed by bounded incremental batches.

Independent field changes merge automatically. Concurrent changes to the same field and
delete-versus-edit changes create a conflict containing both recoverable values. Open
**Settings → Connection** to inspect pending/failed counts, retry synchronization, and choose the
Android or desktop value for each conflict. Tombstones are retained until the peer acknowledges a
covering snapshot.

Messages created on either device use stable UUIDs. Replaying an acknowledged batch is safe.
Attachments stored by standalone chat are content-addressed with SHA-256 hashes. The sync protocol
transfers attachment manifests and verified 64 KB chunks, resumes from the acknowledged byte
offset after reconnect, deduplicates by content hash, and restarts a damaged download.

## Standalone mode toggle

"Standalone" and "remote" are a user preference, separate from the connection-status indicator.
The connection chip in the top bar and Settings → Connection always reflects actual reachability
(Connected/Connecting/Searching/Disconnected). The **Standalone mode** switch — in the connection
sheet (tap the connection chip) and in Settings → Connection — is an explicit choice to use only
this device's own provider keys even when a desktop is reachable, so remote CLI models and desktop
file/git context stay hidden without implying the desktop is unreachable.

## Direct provider chat

Configure a provider under **Settings → Providers**. Anthropic uses its Messages streaming API;
OpenAI and OpenRouter use an OpenAI-compatible streaming API. User messages are persisted before
dispatch, partial assistant messages are checkpointed, and cancellation or interruption leaves a
recoverable record rather than an indefinite loading state.

A provider can be "configured" in two distinct senses: a real key stored locally on this device
(usable for standalone chat), or only configured on the paired desktop (visible, but not usable
standalone until a key exists locally too). The Providers screen labels these states separately —
"Connected" vs. "Desktop only" — instead of implying both are equally usable. For a desktop-only
provider, use **Request key from desktop** to ask the desktop to hand off its key: this requires an
explicit "Send Key" approval on the desktop side before anything is transmitted, and the key value
is never included in general sync, backups, or outbox records regardless.

Inline image limits are 10 MB per image and 20 MB per request. Context construction is
deterministic, trims old turns to the configured budget, and stores a rolling summary when
compression is needed. Usage comes from the provider response. Cost is labeled as an estimate and
is zero/unknown when the bundled pricing catalog has no matching entry.

## Backup and recovery

Open **Settings → Backup & recovery** to create or restore a passphrase-encrypted backup. Backups
use PBKDF2-HMAC-SHA256 and AES-GCM, include local attachment bytes, and exclude API keys and pairing
secrets. A restore validates the authenticated encryption envelope, required tables, attachment
hashes, and database integrity.

Keep the passphrase separately; it cannot be recovered by Nexy. Restoring replaces the current
local standalone dataset, so create a fresh backup first when the existing database is readable.

## Troubleshooting

- A **Standalone mode** banner is informational; cached data and local edits remain available.
- Check **Settings → Connection** for outbox failures, conflicts, and last successful sync.
- Provider authentication and rate-limit errors appear on the interrupted assistant turn.
- **Settings → Developer → Debug log** contains bounded runtime diagnostics. It does not include
  provider credentials or synchronization payload bodies.
- If Android and desktop cannot negotiate a supported protocol version, neither database is
  modified. Upgrade the older app and retry.
