---
document:
  title: "Nexy Android Companion and Synchronization Software Detailed Design"
  code: "SWDD-NEXY-ANDROID-COMPANION-AND-SYNC"
  controlled_document: true
template:
  source: "TEMP_SWDD_Software_Detailed_Design_v01"
project:
  number: "NEXY"
  name: "Nexy AI workspace"
release:
  date: "2026-08-19"
  baseline: "1.3.37"
  document_owner: "Nexy maintainers"
versions:
  - version: "1.0"
    change: "Initial detailed design record"
---

# 1. Purpose and scope

This detailed design describes the Android companion’s local-first data model, desktop pairing, WebSocket command path, synchronization protocol, conflict behavior, direct provider chat, attachment transfer, and capability separation.

The central rule is simple: Android can be useful without the desktop, but it must not pretend to own desktop files or execute desktop-only operations locally.

| Field | Entry |
| --- | --- |
| Software item | Android companion and desktop mobile transport |
| Parent SWAD item | `NEXY-MOBILE-SERVER`, `NEXY-ANDROID`, `NEXY-DATA` |
| Desktop files | `ws-server.ts`, `ws-handlers.ts`, `standalone-sync.ts`, `android-handlers.ts` |
| Android files | `WsClient.kt`, `WsRepository.kt`, `LocalDataRepository.kt`, `NexyDatabase.kt`, `StandaloneChatService.kt` |
| Contract | [Android standalone data and capability contract](../android-standalone-contract.md) |

# 2. Component summary

```text
Android UI (Compose)
  → ViewModels/navigation
  → WsRepository or StandaloneChatService
  → Room/local vault                  WebSocket client
  → local source of truth        ↔    desktop WS server
                                      → desktop IPC/services/database/files
```

Android-owned responsibilities:

- render local data and connection state;
- keep durable drafts and local edits;
- write the synchronization outbox before network work;
- store phone credentials in the Keystore-backed vault;
- perform direct provider chat when allowed;
- display conflicts instead of silently losing one value;
- transfer and verify attachments by content hash.

Desktop-owned responsibilities:

- execute desktop chat, CLI, MCP, shell/build, Git, automation, and workspace operations;
- remain authoritative for desktop SQLite and project files;
- validate mobile commands and scope;
- emit authoritative updates after mutations;
- filter secrets and non-portable paths at synchronization boundaries.

# 3. Pairing and transport

## 3.1 Local LAN pairing

The desktop starts a TLS WebSocket server with a locally generated certificate. The QR/manual payload contains a URL, random pairing token, and certificate fingerprint:

```text
wss://desktop-lan-address:port?token=<token>&certFP=<sha256>
```

Android pins the local certificate to the supplied fingerprint. Regenerating the pairing token invalidates existing connections. The certificate is retained separately unless explicitly regenerated.

## 3.2 External endpoint pairing

The desktop may advertise a TLS-capable reverse proxy or tunnel URL. Android uses ordinary platform TLS validation when no fingerprint is supplied, or pins a supplied fingerprint for that endpoint. The transport does not turn the desktop app into a public HTTP MCP server.

## 3.3 Session lifecycle

```text
disconnected
  → discovering/searching
  → connecting
  → TLS/token authentication
  → protocol negotiation
  → snapshot or cursor sync
  → connected
  → reconnect/backoff on loss
```

Connection status, data freshness, synchronization progress, and Standalone/Remote preference are separate state dimensions. A disconnected app still displays cached data and does not erase it.

# 4. Synchronization data model

Room is Android’s local source of truth. A mutation transaction writes the local record and an outbox entry before attempting transport.

Each outbox mutation carries:

- operation ID;
- stable device ID and device sequence;
- entity type and entity ID;
- base entity version;
- create/update/delete operation;
- canonical filtered payload;
- display timestamp.

Stable UUIDs identify projects, agents, conversations, messages, reusable content, and attachment references. Wall-clock time is display metadata, not a conflict winner.

Protocol 2 negotiates schema, entity types, attachments, batch size, and a durable desktop cursor. A valid cursor receives changed records only. Protocol 1 remains a full-snapshot fallback for older builds.

## 4.1 Synchronization ordering

```text
negotiate
  → apply metadata (projects/agents/conversations)
  → prioritize visible conversation messages
  → apply bounded message batches
  → transfer attachment manifests/chunks
  → acknowledge cursor and tombstones
```

Messages are transferred in bounded batches and may use request-correlated history pages. Attachments use SHA-256 content identity and at most 64 KB chunks. A reconnect resumes from the acknowledged byte offset; a damaged transfer restarts after verification fails.

## 4.2 Filtering rules

The canonical sync payload excludes API key values, authorization headers, passwords, pairing secrets, data URLs/base64 payloads, workspace roots and local paths, transient streams, logs, build state, and device settings. Optional unknown JSON fields are retained; malformed optional JSON falls back to a safe default rather than destroying a pending edit.

Credential metadata and binding scopes may synchronize so the UI can say “Connected” or “Desktop only.” Credential payloads never synchronize as ordinary data.

# 5. Conflict behavior

Independent field edits merge automatically. A conflict is created for:

- two edits to the same field based on the same or incompatible version;
- delete versus edit;
- any mutation that cannot be safely applied to the current parent/version.

The conflict record retains both recoverable values and explains the affected entity/field. The user resolves it from the connection/conflict UI by choosing the Android or desktop value. Tombstones are retained until a peer acknowledges a covering snapshot.

Self-healing rules prevent useless failed work from accumulating: deleting a conversation cancels unsent child-message mutations; a child operation whose parent no longer exists is discarded as obsolete; genuinely failed operations retry automatically and remain inspectable.

# 6. Standalone behavior

Standalone is a user-selected execution target, not merely a network error. When standalone:

| Available locally | Desktop required |
| --- | --- |
| Browse/search cached records | Desktop files and workspace roots |
| Create/edit/pin/delete local records | Shell, CLI models, stdio MCP |
| Durable drafts and local attachments | Desktop Git workbench |
| Direct Anthropic/OpenAI/OpenRouter chat with local key | Desktop artifacts/workspace-writing generators |
| Local backup/restore and diagnostics | Desktop workflows, scheduling, and builds |
| Conflict review | Live approval or stopping a desktop process |

The Standalone/Remote toggle is disabled during active chat, generation, or sync so the execution target cannot be pulled out from under a live operation.

# 7. Direct Android provider chat

Android’s `StandaloneChatService` uses an Android-local encrypted credential. It supports Anthropic Messages streaming and OpenAI-compatible OpenAI/OpenRouter streaming. User messages persist before dispatch; partial assistant messages are checkpointed; cancellation and interruption leave a recoverable state.

Provider readiness has two meanings: a key on this phone, or only a provider configured on the desktop. The UI must label those separately. An optional desktop-to-phone key request is a distinct, explicit desktop approval and is never put into the sync outbox or backup.

Images are limited to 10 MB each and 20 MB per request. Context trimming and summary behavior must be deterministic and usage/cost must be labeled as an estimate when pricing data is incomplete.

# 8. Remote command and event behavior

Remote commands use the authenticated WebSocket envelope and map to desktop services. The desktop validates command name, pairing/session, project/entity scope, and capability state before invoking the operation.

The desktop broadcasts authoritative change events after a successful mutation. Android replaces optimistic state with the authoritative response rather than assuming its request was accepted exactly as sent.

Active chat is request-correlated separately from ordinary record sync. On reconnect or re-entry, Android requests current conversation history and active-turn snapshot. The normalized turn reducer restores activity, thinking blocks, completed tools, and partial assistant content; the typewriter drain remains a presentation concern.

# 9. Error handling and defensive measures

| Failure | Behavior |
| --- | --- |
| Wrong token/fingerprint | Reject connection; do not modify either database |
| Unsupported protocol | Reject before mutation; ask user to upgrade/retry |
| Connection loss | Keep Room data; reconnect with backoff and durable cursor |
| Duplicate acknowledged batch | Idempotently ignore/reapply by operation/version |
| Conflicting mutation | Store conflict with both values; never silently overwrite |
| Missing parent | Cancel/discard obsolete child mutation |
| Attachment hash mismatch | Reject chunk/file and restart transfer |
| Provider key missing locally | Keep draft and show local-provider requirement |
| Desktop-only command offline | Disable or return capability-unavailable; never queue as a fake local action |
| Active stream during mode switch | Refuse switch with explanatory toast |

# 10. Verification references

| Verification area | Representative references |
| --- | --- |
| Desktop WebSocket protocol | `src/main/__tests__/ws-server.test.ts`, `ws-handlers.test.ts` |
| Sync and conflict behavior | `src/main/__tests__/standalone-sync.test.ts`, Android repository/contract tests |
| Credential filtering | Android `CredentialVault`, provider payload conversion, standalone contract tests |
| Chat restoration | Android `ChatTurnReducer`, `ChatTurnCoordinator`, active snapshot/history tests |
| Backup/restore | Android `LocalBackupManager`, diagnostics and integrity tests |
| UI capability states | Android connection, provider, code panel, workflow, and settings screens |
