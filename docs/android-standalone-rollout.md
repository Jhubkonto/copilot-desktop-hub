# Android standalone rollout and recovery policy

Updated 2026-07-05.

## Privacy and telemetry defaults

External telemetry is disabled by default and the standalone implementation sends no analytics
events to Nexy or another telemetry service. Provider requests go only to the endpoint explicitly
configured for that provider. Peer synchronization goes only to the authenticated paired desktop.

Locally retained operational fields are:

| Field | Purpose | Retention/export |
| --- | --- | --- |
| Pending operation count, type, attempts, next retry, last error | Synchronization recovery | Until acknowledged/discarded; error visible in Connection |
| Conflict count, entity/type/field, both canonical values | Lossless conflict resolution | Until resolved; included in encrypted backup |
| Last successful synchronization time | Freshness display | Replaced by next success |
| Attachment transfer state, size, hash, local path | Resumable verified transfer | Until local record deletion; path never synchronized |
| Bounded diagnostic tag/message/time | User troubleshooting | Last 500 in memory; user-exported only |
| Provider/model/token usage/finish reason | Per-message usage and recovery | Stored with the local message |

Diagnostic messages are recursively redacted for authorization headers, API-key/token/secret-shaped
values, data URLs, and base64 payloads, and are truncated to 2,000 characters. Message bodies,
provider credentials, pairing secrets, attachment bytes, and desktop filesystem paths are not
analytics fields. Enabling any future external telemetry requires a separate opt-in UI, published
schema, retention period, deletion mechanism, and security review.

## Staged enablement

Release flags must advance independently in this order:

1. `standalone_local_cache` — internal cohort only.
2. `standalone_offline_drafts` — internal cohort only.
3. `standalone_direct_chat` — explicit user opt-in.
4. `standalone_peer_sync` — explicit user opt-in after an encrypted backup.
5. Limited external beta with protocol/schema compatibility checks.
6. Default local-first behavior after all exit criteria pass.

Moving forward never bypasses database migration, backup/restore, convergence, or credential
exclusion gates. Disabling direct chat or peer sync must leave local records readable and exportable.

## Automatic rollback criteria

Stop expansion and disable the affected flag when any of these occur:

- Confirmed silent record loss, cross-dataset synchronization, or non-converging replay.
- A credential, pairing secret, raw authorization header, or excluded local path crosses sync or
  appears in exported diagnostics.
- Migration failure prevents read-only access or verified backup export.
- Backup restore passes authentication but fails attachment hashes or relational integrity.
- Conflict resolution discards either version before acknowledgement.
- More than 1% of beta devices experience an unrecoverable migration/database error, or more than
  5% fail three consecutive synchronization attempts for a release-caused reason.

Rollback preserves the database, outbox, conflicts, and encrypted backups. It may disable execution
and synchronization, but must not downgrade the schema destructively or delete pending operations.

## Release checklist

- Create and restore an encrypted pre-migration backup; verify attachment hashes and relationships.
- Test the oldest supported Android/desktop pair, current/current, and one-version overlap.
- Run desktop lint, typecheck, complete tests, production build, and package smoke test.
- Run Android lint, unit tests, debug/release assembly, migration tests, and connected instrumentation
  on the supported emulator/device matrix.
- Run airplane-mode, interrupted-stream, dropped-ack, duplicate/reordered batch, attachment resume,
  conflict resolution, disk-full, corrupted payload, and process-termination scenarios.
- Confirm protocol/schema negotiation rejects incompatible peers without database mutation.
- Confirm API keys, pairing secrets, data URLs, paths, and message bodies are absent from protocol
  diagnostics and telemetry.
- Verify pending age, retry/error, conflict, last-sync, and attachment progress surfaces.
- Stage flags in order; record cohort, release version, monitoring window, and rollback owner.
- Publish offline limits, desktop-required features, backup instructions, conflict behavior, known
  issues, and support/recovery steps.
