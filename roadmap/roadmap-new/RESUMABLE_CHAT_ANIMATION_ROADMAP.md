# Resumable Adaptive Chat Animation Roadmap

## Summary

Separate authoritative streamed content from visible animated content. Desktop owns the persisted conversation and active-turn event log. Each UI maintains a lightweight reveal cursor and drains pending assistant text at an adaptive rate.

Re-entry policy:

- Render accumulated content immediately.
- Animate only content received after re-entry.
- Android retains active reveal state in memory only.
- After Android process death, render the desktop snapshot immediately.
- Only assistant response text is progressively animated; thinking, tools, activity, and history remain atomic and ordered.

## Phase 0 — Contracts and Regression Baseline

- [x] Define platform-neutral animation concepts: authoritative text, displayed offset, pending backlog, turn ID, and last sequence.
- [x] Extend active-turn snapshots with `turnId`, latest sequence, and accumulated assistant text.
- [x] Define a WebSocket snapshot request/response used on chat entry and reconnect.
- [x] Ensure normalized `chat:turn-event` deltas are the canonical animation input; compatibility events must not cause duplicate text.
- [x] Add baseline tests for burst traffic, stream completion before drain completion, navigation during streaming, reconnect, duplicate sequences, and stale-turn events.

### Phase 0 validation

- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] From `android/`: `./gradlew test`
- [x] From `android/`: `./gradlew lintDebug`
- [x] From `android/`: `./gradlew assembleDebug`
- [x] Record and resolve pre-existing validation findings before proceeding.

## Phase 1 — Shared Animation Model and Desktop Drain

- [x] Replace the fixed-rate desktop queue with a resumable controller whose authoritative text and displayed offset are separate.
- [x] Calculate reveal speed from backlog size, targeting catch-up within approximately 750 ms while capping work per frame.
- [x] Batch visible updates through `requestAnimationFrame`; avoid one render per token or character.
- [x] Make reset behavior turn-aware so late events from an old `turnId` cannot alter the current response.
- [x] Flush safely on completion, cancellation, error, conversation deletion, and reduced-motion preference.
- [x] Keep accumulated active-turn text outside the mounted chat view so navigating away does not discard true state.
- [x] On desktop re-entry, display the accumulated text immediately and establish that point as the new reveal cursor.
- [x] Add unit tests for adaptive speed, cursor invariants, backlog bounds, flushing, reset, stale events, and unmount/remount.

### Phase 1 validation

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] From `android/`: `./gradlew test`
- [x] From `android/`: `./gradlew lintDebug`
- [ ] From `android/`: `./gradlew assembleDebug`
- [ ] Manually verify smooth desktop streaming under slow, normal, and burst delivery.

## Phase 2 — Desktop Active-Turn Replay Source

- [x] Maintain a bounded in-memory active-turn log keyed by conversation and turn.
- [x] Store ordered assistant deltas with sequence metadata until the turn is persisted or terminated.
- [x] Produce an authoritative active snapshot containing accumulated text and the latest sequence.
- [x] Serve snapshots to Android on chat entry and WebSocket reconnect.
- [x] Remove active logs after successful persistence; expire abandoned terminal logs defensively.
- [x] Ensure reconnect snapshot creation never writes chat content to Android storage.
- [ ] Add tests for ordered replay, duplicate suppression, sequence gaps, cleanup, reconnect, and simultaneous desktop/Android consumers.

### Phase 2 validation

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] From `android/`: `./gradlew test`
- [x] From `android/`: `./gradlew lintDebug`
- [ ] From `android/`: `./gradlew assembleDebug`
- [ ] Manually disconnect and reconnect Android during an active desktop response.

## Phase 3 — Android Memory-Resident Animation State

- [x] Move authoritative active text and reveal metadata into a conversation-keyed, in-memory repository that survives screen navigation.
- [x] Replace the fixed-rate `Channel<String?>` drain with an adaptive, turn-aware animation controller.
- [x] On chat entry, request the desktop snapshot and render its accumulated text immediately.
- [x] Set the cursor to the snapshot’s latest sequence, then animate only newer deltas.
- [x] Preserve pending live animation across navigation while the Android process remains alive.
- [x] After process death or missing cursor state, snap to the desktop snapshot and continue with new live deltas.
- [x] Deduplicate normalized and compatibility events by `turnId` and sequence.
- [ ] Reconcile history without replacing a newer active turn or replaying already visible text.
- [x] Keep thinking blocks, tool calls, activity, and completion events atomically ordered around animated text.
- [x] Add coroutine tests for navigation, reconnect, process-cold behavior, burst adaptation, completion, cancellation, and sequence gaps.

### Phase 3 validation

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] From `android/`: `./gradlew test`
- [x] From `android/`: `./gradlew lintDebug`
- [ ] From `android/`: `./gradlew assembleDebug`
- [ ] Manually verify Android navigation away/back, reconnect, background/foreground, and cold restart.

## Phase 4 — Integration, Performance, and Cleanup

- [x] Remove obsolete fixed-rate buffers and duplicate compatibility consumption paths.
- [ ] Add diagnostics for backlog length, reveal lag, dropped duplicate events, sequence gaps, and snapshot recovery.
- [x] Confirm queue growth remains bounded during large responses and log floods.
- [ ] Confirm auto-scroll follows animated growth only when the user remains near the bottom.
- [x] Confirm cancellation and errors expose the complete authoritative text without leaving a cursor active.
- [x] Document the source-state/cursor/render-state architecture and WebSocket lifecycle.
- [x] Run the complete desktop and Android regression suites.

### Phase 4 validation

- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] From `android/`: `./gradlew test`
- [x] From `android/`: `./gradlew lintDebug`
- [x] From `android/`: `./gradlew assembleDebug`
- [ ] Complete manual testing with slow streams, rapid streams, large responses, tool calls, reconnects, navigation, cancellation, and reduced motion.

## Acceptance Criteria

- Incoming assistant text remains smooth without accumulating unbounded visual delay.
- Navigating away and returning never replays content already accumulated.
- Android reconnects from an authoritative desktop snapshot without storing message content on the phone.
- Every delta is rendered at most once despite overlapping normalized and compatibility events.
- Completion, cancellation, and errors leave the full response visible.
- Thinking and tool events retain their correct order relative to assistant text.
- All validation gates pass at the end of every phase, or documented pre-existing failures remain unchanged.
