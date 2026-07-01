# Resumable chat animation

Chat streaming separates three kinds of state:

- The desktop `active-chat-turns` registry is the authoritative, bounded in-memory
  source for an active response. It records normalized turn events and accumulated
  assistant text by conversation, turn, and sequence.
- Desktop and Android reveal controllers track displayed text separately from the
  authoritative text. Their frame budget grows with backlog, targeting catch-up in
  roughly 750 ms with a per-frame cap.
- The rendered message is derived from the reveal controller. Thinking, tool,
  activity, and terminal events are not progressively animated.

On chat entry or reconnect, clients request an active-turn snapshot. Existing text
is rendered immediately and only later deltas animate. Android keeps its reveal
controller in process memory and never persists response content locally; after a
cold process restart it snaps to the desktop snapshot.

Normalized `chat:turn-event` sequence numbers provide turn isolation and duplicate
suppression. Android ignores compatibility chunk/end events in production. Terminal
events flush authoritative text, and reduced-motion mode flushes desktop text
without animation.

Both clients expose in-memory diagnostics for backlog length, reveal lag, duplicate
events, sequence gaps, and snapshot recovery. Desktop diagnostics are available from
the active-turn registry and streaming queue modules; Android diagnostics are part
of each conversation's `ChatAnimationState`. These counters contain no message
content and are reset with their in-memory animation state.
