package io.nexy.android.data

import io.nexy.android.data.local.OutboxEntity

/**
 * Why the sync outbox is (or is not) being pushed right now.
 *
 * Every value other than [PUSH] is a *settled* reason to wait, and each one is reachable from the
 * sync-status sheet — a queue that is not draining must be able to say why.
 */
enum class OutboxDrainDecision {
    /** There is drainable work and the link can carry it: push now. */
    PUSH,

    /** Empty queue — nothing to do. */
    NOTHING_QUEUED,

    /** Queued work is real but the desktop link is down; it drains on reconnect. */
    NOT_CONNECTED,

    /** A `sync:push` is already awaiting its `sync:ack`; this batch rides along with it. */
    PUSH_IN_FLIGHT,

    /** Everything queued is a failed operation still inside its exponential-backoff window. */
    WAITING_FOR_BACKOFF,
}

/**
 * The pure drain decision applied to *every* outbox change.
 *
 * Draining used to depend on a hand-picked set of call sites remembering to flush. The
 * message-write paths were not among them, so an operation enqueued while the link was already up
 * could sit queued indefinitely in a long-lived connected session. Deciding from the queue itself
 * makes "queued while connected" self-draining by construction.
 */
fun resolveOutboxDrain(
    connected: Boolean,
    pushInFlight: Boolean,
    outbox: List<OutboxEntity>,
    now: Long,
): OutboxDrainDecision = when {
    outbox.isEmpty() -> OutboxDrainDecision.NOTHING_QUEUED
    !connected -> OutboxDrainDecision.NOT_CONNECTED
    pushInFlight -> OutboxDrainDecision.PUSH_IN_FLIGHT
    outbox.any { it.nextAttemptAt <= now } -> OutboxDrainDecision.PUSH
    else -> OutboxDrainDecision.WAITING_FOR_BACKOFF
}

/**
 * Millis until the earliest backed-off operation becomes drainable, or `null` when nothing is
 * waiting on a backoff. A backed-off operation is the one case no other signal will wake: the
 * desktop sends nothing and the user does nothing, so the retry has to be armed on a timer.
 */
fun nextOutboxRetryDelayMs(outbox: List<OutboxEntity>, now: Long): Long? =
    outbox.filter { it.nextAttemptAt > now }
        .minOfOrNull { it.nextAttemptAt - now }

/**
 * User-facing explanation for a queued change that has not left the device yet. A queue that is
 * not draining has to be able to say why — "Waiting to sync" alone is exactly what made a stuck
 * outbox impossible to diagnose from the device.
 */
fun outboxDrainExplanation(decision: OutboxDrainDecision): String = when (decision) {
    OutboxDrainDecision.PUSH -> "Sending to the desktop…"
    OutboxDrainDecision.PUSH_IN_FLIGHT -> "Sending to the desktop…"
    OutboxDrainDecision.NOT_CONNECTED -> "Waiting for the desktop connection"
    OutboxDrainDecision.WAITING_FOR_BACKOFF -> "Retrying shortly after an earlier failure"
    OutboxDrainDecision.NOTHING_QUEUED -> "Waiting to sync"
}
