# Resumable chat timeline

Chat content is displayed immediately on desktop and Android. There is no reveal
queue, frame drain, fade, placement transition, or smooth scrolling. Static status
icons and labels communicate work in progress.

Every persisted desktop message receives a per-conversation `timeline_order` value.
Migration 81 deterministically backfills existing rows by timestamp and insertion
order; a database trigger assigns the next ordinal for new legacy insert paths. All
desktop history consumers order by this ordinal, then timestamp and ID. Android Room
schema 9 stores the same optional `timelineOrder`, with timestamp and ID fallback for
older desktop peers and standalone-local rows.

The active-turn registry retains a bounded, lossless sequence-ordered event replay.
On entry or reconnect, clients restore that replay through the same reducer used for
live events. Duplicate sequences are ignored, while original text-segment, thinking,
tool, activity, model, cost, and terminal chronology is preserved.

Desktop history and active-turn requests are scoped to a conversation load generation,
so a late response from a previous conversation cannot replace the current timeline.
Recently rendered messages and view state are cached by conversation. Re-entry restores
the previous scroll position, follow-bottom state, and unread-below state; first-time
entries follow the bottom.

The no-motion policy is enforced by source tests. Android application code rejects
Compose animation and animated-scroll APIs. Desktop CSS unconditionally disables
animations, transitions, and smooth scrolling, and chat streaming contains no frame
scheduler.
