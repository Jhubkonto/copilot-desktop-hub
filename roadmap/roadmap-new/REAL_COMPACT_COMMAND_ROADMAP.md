# Roadmap: Make `/compact` a real context-compaction command

Drafted 2026-08-17. **Status: PROPOSED.**

## Finding

Nexy has a real automatic rolling-compression implementation, but the `/compact` slash command is not connected to it.

The current `/compact` handler in `src/renderer/slash-commands.ts` only filters the React message list to the last eight non-system messages and adds a local system message. `pushSystemMessage` in `src/renderer/hooks/useChat.ts` does not persist that message. The next chat request is rebuilt from the database in both the CLI and BYOK branches of `src/main/chat-handlers.ts`, so the provider still sees the full persisted transcript and `/compact` has no durable effect.

The existing `applyRollingContextCompression` path is useful and covered by tests: it persists a deterministic summary in `conversation_summaries` and injects a summary plus recent turns when the estimated history exceeds its threshold. The Context Inspector also has a separate persisted manual-summary flow. Neither flow is invoked by `/compact`, and a manually saved summary can be ignored when the raw history is below the automatic threshold because the rolling compressor returns early before checking the saved summary.

Focused verification on 2026-08-17: the context-compression, slash-command, and conversation-export suites passed (3 files, 47 tests). There is currently no `/compact` test.

## Desired contract

`/compact` should:

1. Require an active conversation and produce a durable structured summary without deleting the raw transcript.
2. Make the summary plus a recent retained tail the effective context for the next BYOK and CLI request, even when compaction was explicitly forced below the automatic threshold.
3. Keep transcript export, search, undo, and conversation history based on the original messages.
4. Refresh the visible conversation with an explicit status/result and expose counts for summarized and retained messages.
5. Be safe to repeat: repeated compaction should preserve an existing edited summary and should not duplicate summary content on later sends.

## Implementation plan

### 1. Define and expose a compact operation

- Add a typed `conversation:compact` IPC channel, preload wrapper, shared request/result types, and a main-process handler.
- Reuse the existing deterministic summary builder and normalized structured-summary format rather than creating a second summary format.
- Centralize the message-selection rules so `/compact`, Context Inspector manual compression, and automatic compression agree about which operational/system rows are excluded and which recent messages are retained.
- Return a result containing `hasSummary`, summarized count, retained count, estimated before/after tokens, strategy, and the effective context snapshot needed by the renderer.

### 2. Make persisted summaries authoritative for effective context

- Refactor `applyRollingContextCompression` to accept an explicit `force`/manual-compaction option, or introduce a shared lower-level function that separates “should compression start automatically?” from “apply an already requested summary.”
- Ensure a saved manual or `/compact` summary is honored on the next request even when the raw history is below the automatic threshold.
- Define stale-summary behavior when messages are deleted, edited, or regenerated: invalidate or recompute the summary when its covered prefix no longer matches the current transcript, and preserve an edited summary when only newer messages have aged into the compressed prefix.
- Keep the current automatic threshold behavior for conversations that have never been compacted.

### 3. Wire the slash command to the durable operation

- Extend `SlashCommandContext` with a `compactConversation` callback supplied by `useChatWindowActions`.
- Change `/compact` from local `slice(-8)` behavior to awaiting the IPC operation, then refresh the message/context state from the returned result.
- Show a useful no-op message for an empty/short conversation and an error message when compaction fails.
- Keep `/compact` handled locally; it must not become a model prompt or create a normal user turn.

### 4. Make the UI state honest

- Replace “Compacted to recent context” with counts and token estimates returned by the main process.
- Show that compaction changes model context, not the stored transcript, and provide a clear way to inspect or restore the full visible history if the UI hides older rows.
- Align the Context Inspector’s “Compress now” path with the same effective-context semantics and remove the current below-threshold inconsistency.

### 5. Add end-to-end regression coverage

- Renderer slash-command test: `/compact` calls the callback, reports success, handles no active conversation, and surfaces IPC errors.
- Main compression tests: forced compaction works below the automatic threshold; a subsequent provider-context build uses the persisted summary plus retained tail; repeated compaction does not duplicate or overwrite an edited summary; deletion/edit/regeneration invalidates stale coverage.
- Chat-handler integration tests for both BYOK and CLI dispatch: capture the request payload after `/compact` and assert older turns are replaced by the summary while the recent tail remains.
- IPC/preload contract test covering the new channel.
- Run the existing focused suites plus the full `npm test` and `npm run typecheck` gates.

## Acceptance criteria

- After a long chat, `/compact` creates/updates exactly one `conversation_summaries` row and reports non-zero summarized messages.
- The next BYOK and CLI requests contain the compacted summary and retained recent turns, not the entire old transcript.
- A short chat can be explicitly compacted and the next request still uses the saved summary.
- The original message rows remain available to export, search, undo, and inspect.
- `/compact` has automated coverage proving the user-visible command and both provider routes work.

