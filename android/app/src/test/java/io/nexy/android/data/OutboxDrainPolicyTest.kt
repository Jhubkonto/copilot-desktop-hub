package io.nexy.android.data

import io.nexy.android.data.local.OutboxEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for the "1 change stuck pending forever while connected" bug.
 *
 * Draining the outbox used to depend on a hand-picked set of call sites remembering to call
 * flushStandaloneOutbox(). The message-write paths (standalone chat turns, assistant
 * finalisation) are not among them, so an operation enqueued while the desktop link was already
 * up sat in the outbox until some *unrelated* event happened to trigger a flush — which, in a
 * long-lived connected session, never came. [resolveOutboxDrain] is the pure decision the
 * repository now applies to every outbox change, so queued work pushes itself.
 */
class OutboxDrainPolicyTest {

    private fun op(
        id: String = "op-1",
        state: String = "pending",
        nextAttemptAt: Long = 0,
    ) = OutboxEntity(
        operationId = id,
        deviceId = "device-1",
        deviceSequence = 1,
        entityType = "message",
        entityId = "msg-1",
        operation = "upsert",
        payloadJson = "{}",
        baseRemoteVersion = 0,
        createdAt = 0,
        nextAttemptAt = nextAttemptAt,
        state = state,
    )

    @Test
    fun queuedOperationOnAConnectedLinkPushesItself() {
        assertEquals(
            OutboxDrainDecision.PUSH,
            resolveOutboxDrain(connected = true, pushInFlight = false, outbox = listOf(op()), now = 1_000),
        )
    }

    @Test
    fun emptyOutboxNeedsNoPush() {
        assertEquals(
            OutboxDrainDecision.NOTHING_QUEUED,
            resolveOutboxDrain(connected = true, pushInFlight = false, outbox = emptyList(), now = 1_000),
        )
    }

    @Test
    fun offlineQueueWaitsForTheLink() {
        assertEquals(
            OutboxDrainDecision.NOT_CONNECTED,
            resolveOutboxDrain(connected = false, pushInFlight = false, outbox = listOf(op()), now = 1_000),
        )
    }

    @Test
    fun aPushAlreadyInFlightIsNotDuplicated() {
        assertEquals(
            OutboxDrainDecision.PUSH_IN_FLIGHT,
            resolveOutboxDrain(connected = true, pushInFlight = true, outbox = listOf(op()), now = 1_000),
        )
    }

    @Test
    fun failedOperationRespectsItsBackoffWindow() {
        assertEquals(
            OutboxDrainDecision.WAITING_FOR_BACKOFF,
            resolveOutboxDrain(
                connected = true,
                pushInFlight = false,
                outbox = listOf(op(state = "failed", nextAttemptAt = 5_000)),
                now = 1_000,
            ),
        )
    }

    @Test
    fun failedOperationPushesOnceItsBackoffElapsed() {
        assertEquals(
            OutboxDrainDecision.PUSH,
            resolveOutboxDrain(
                connected = true,
                pushInFlight = false,
                outbox = listOf(op(state = "failed", nextAttemptAt = 5_000)),
                now = 5_000,
            ),
        )
    }

    @Test
    fun oneDrainableOperationIsEnoughToPushTheBatch() {
        assertEquals(
            OutboxDrainDecision.PUSH,
            resolveOutboxDrain(
                connected = true,
                pushInFlight = false,
                outbox = listOf(op(id = "op-1", state = "failed", nextAttemptAt = 9_000), op(id = "op-2")),
                now = 1_000,
            ),
        )
    }

    /**
     * A backed-off operation is the one case nothing else will wake: no user action, no desktop
     * event. The repository arms a timer for it, so the delay has to be computed from the queue.
     */
    @Test
    fun backoffDelayIsTheEarliestPendingRetry() {
        assertEquals(
            2_000L,
            nextOutboxRetryDelayMs(
                outbox = listOf(
                    op(id = "op-1", state = "failed", nextAttemptAt = 9_000),
                    op(id = "op-2", state = "failed", nextAttemptAt = 3_000),
                ),
                now = 1_000,
            ),
        )
    }

    @Test
    fun nothingToRetryArmsNoTimer() {
        assertNull(nextOutboxRetryDelayMs(outbox = listOf(op()), now = 1_000))
        assertNull(nextOutboxRetryDelayMs(outbox = emptyList(), now = 1_000))
    }
}

/** The sheet has to name the reason a queue is waiting; a bare "Waiting to sync" is undiagnosable. */
class OutboxDrainExplanationTest {

    @Test
    fun everyWaitingReasonHasItsOwnExplanation() {
        val explanations = OutboxDrainDecision.entries.associateWith(::outboxDrainExplanation)
        assertEquals("Waiting for the desktop connection", explanations[OutboxDrainDecision.NOT_CONNECTED])
        assertEquals("Retrying shortly after an earlier failure", explanations[OutboxDrainDecision.WAITING_FOR_BACKOFF])
        assertEquals("Sending to the desktop…", explanations[OutboxDrainDecision.PUSH])
        assertEquals(true, explanations.values.all { it.isNotBlank() })
    }
}
