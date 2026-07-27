# Bug: Approving a Claude-CLI tool request on Android can silently resolve the wrong (stale) request

Drafted 2026-07-24. **Status: IN PROGRESS — fix items 1, 2, 4 implemented; item 3 (client-side
send-gate repro) still open.**

## Fix status (2026-07-24)

- ✅ **Item 1 — server-side turn guard**: `dispatchChatSend` (`src/main/chat-handlers.ts`) now
  checks `activeCliAbortControllers` before spawning a new CLI process for a conversation; if a
  prior turn is still active it calls `abortActiveStream(conversationId)` and the new
  `denyPendingApprovalsForConversation(conversationId)` (`src/main/tools.ts`) to immediately deny
  the stale turn's pending approval instead of leaving it to the 60s timeout.
- ✅ **Item 2 — Android queue, don't overwrite**: `HomeViewModel.kt` now queues
  `WsEvent.ToolApprovalRequest`s (`approvalQueue`) instead of overwriting `_pendingApproval`; the
  next queued request is shown as soon as the current one resolves/clears.
- ⬜ **Item 3 — client-side send-gate repro**: not yet reproduced live; still needs a real
  `claude-cli` conversation + in-app composer test to confirm whether `canSend`/`isAwaitingResponse`
  ever let a second send through.
- ✅ **Item 4 — regression tests**: added
  `src/main/__tests__/chat.test.ts` ("aborts a still-active CLI turn and denies its pending approval
  when a second send arrives for the same conversation") and
  `android/app/src/test/java/io/nexy/android/ui/home/HomeViewModelTest.kt`
  ("secondApprovalRequestIsQueuedNotOverwrittenAndShownAfterFirstResolves").

`Priority: P1 · Effort: M · Risk: medium`

## Symptom

Observed live: user asked (desktop, `claude-cli` backend) to bump `package.json`'s version. The
file-write approval prompt never visibly resolved. User repeated "try again" / "you have the
permission" several times from the Android companion app, approving what looked like the same
request each time. The write only actually landed after several retries, and the user could see
(via an Android screenshot) that Nexy's own approval relay was involved, not just a Claude Code UI
quirk.

## Root cause (traced, not yet reproduced under a debugger)

For the `claude-cli` backend, every tool call goes through this path:

1. `dispatchChatSend` (`src/main/chat-handlers.ts`) calls `adapter.send(...)` on the Claude CLI
   adapter, passing a fresh `requestPermission` closure
   (`chat-handlers.ts:1054-1064` → `requestClaudeCliToolPermission` at `chat-handlers.ts:318-361`).
2. That closure calls `requestApproval()` (`src/main/tools.ts:29-57`), which mints a **new
   `randomUUID()` requestId**, sends `tool:request-approval` to the desktop renderer, and
   `broadcastToMobile({ event: 'tool:approval-request', data: { requestId, ... } })` to Android.
   The promise sits in a module-level `pendingApprovals` map keyed by `requestId`
   (`tools.ts:16-19`) with a 60s auto-deny timeout (`tools.ts:50-55`).
3. On Android, `HomeViewModel` overwrites its single pending-approval slot unconditionally on every
   `WsEvent.ToolApprovalRequest`: `_pendingApproval.value = event`
   (`android/app/src/main/java/io/nexy/android/ui/home/HomeViewModel.kt:96-98`). There is no queue
   — only the *latest* request is ever showable, and `approveRequest`/`rejectRequest`
   (`HomeViewModel.kt:147-159`) only ever act on `requestId`s embedded in whatever is currently in
   that slot.
4. **`dispatchChatSend` has no guard against starting a second CLI turn for a conversation that
   already has one in flight.** Nothing in `chat-handlers.ts` checks
   `activeCliAbortControllers` (`src/main/provider-stream-state.ts`, set at
   `chat-handlers.ts:1036`, only read for `agent:stop`/`abortActiveStream` — never before starting
   a new send) or an equivalent "turn already active" flag before spawning a new `claude` CLI
   process and its own `startPermissionHookServer` (`src/main/cli-adapters/claude.ts:78-143`).

Put together: if a user sends a second message (e.g. "try again") while a prior CLI turn is still
alive and blocked on its own permission-hook `PermissionRequest` HTTP call
(`cli-adapters/claude.ts:95-124`), the app spawns a second `claude` process with its **own**
requestId. Android's single-slot `_pendingApproval` gets overwritten by whichever
`tool:approval-request` broadcast arrives last, so the user only ever sees/can-approve the *latest*
requestId. Approving it does correctly resolve *that* requestId
(`resolveApprovalFromWs` in `tools.ts:68-74`, wired to the `tool:approve` WS command in
`src/main/ws-handlers.ts:310-317`) — but the earlier turn's permission-hook HTTP request is still
parked, waiting on its own now-invisible `pendingApprovals` entry, until the 60s timeout denies it
(`tools.ts:50-55`). From the user's perspective this looks exactly like "I approved it and nothing
happened" — because the process they were actually watching/writing to may not be the one whose
approval they just granted.

Whether the client-side "assistant busy" gating (`isAwaitingResponse` /
`ChatTurnStatus.Active` in `android/app/src/main/java/io/nexy/android/ui/chat/ChatViewModel.kt:139-147`,
gating `canSend` at `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt:739-742`)
should have blocked the second send in the first place — and under what conditions it doesn't
(reconnect race, a different Nexy surface than the in-app chat composer, etc.) — needs to be
confirmed with a live repro. The server-side gap (point 4 above) is real regardless: even a UI-level
send-guard is defense in depth, not a substitute for the backend refusing/queuing a second turn for
a conversation that already has one active.

## Fix plan

1. **Server-side turn guard**: in `dispatchChatSend`, check whether `activeCliAbortControllers`
   (or a dedicated "turn active" registry) already has an entry for `conversationId` before
   spawning a new CLI process; either reject the new send with a clear error or abort/replace the
   stale turn (killing its permission-hook server via the existing `permissionHook.close()` path in
   `cli-adapters/claude.ts`) so there is only ever one live approval flow per conversation.
2. **Android: queue, don't overwrite, pending approvals.** Change `_pendingApproval` in
   `HomeViewModel.kt` to a list/queue keyed by `requestId`, and surface when more than one request
   is outstanding (or at minimum resolve/deny the previous request explicitly before replacing it,
   rather than silently orphaning it).
3. **Repro the client-side gate gap**: reproduce with the in-app Nexy chat composer to determine
   whether `canSend`/`isAwaitingResponse` truly stayed false throughout the approval wait; if a
   second send got through anyway, find the state-desync window (likely a WS reconnect mid-turn)
   and close it.
4. **Regression test**: in `src/main/__tests__/chat.test.ts` or `cli-adapters.test.ts`, assert that
   a second `dispatchChatSend`/`adapter.send` call for the same `conversationId` while a prior one
   is unresolved does not silently orphan the first `requestPermission` promise.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test` (main project).
- Manual: start a `claude-cli` conversation, trigger a tool needing approval, then send a second
  message before approving. Confirm only one live approval request exists and approving it resolves
  the tool call the user is actually watching. Use the `nexy-app-check` skill for the connected-mode
  smoke pass against a real Android device.
