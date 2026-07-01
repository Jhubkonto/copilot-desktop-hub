package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatAnimationRepositoryTest {
    private fun event(sequence: Long, type: String, payload: String): WsEvent.ChatTurnEvent =
        WsEvent.ChatTurnEvent("conv-animation", "turn-1", sequence, type, sequence, payload)

    // The drain loop runs on a real background dispatcher outside runTest's virtual
    // clock. Polling must happen on a real dispatcher too — polling from runTest's own
    // TestDispatcher would advance virtual time instantly without ever yielding real
    // wall-clock time for the background drain job to make progress.
    private suspend fun awaitDisplayedText(conversationId: String, expected: String) {
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                while (ChatAnimationRepository.observe(conversationId).value.displayedText != expected) {
                    delay(10)
                }
            }
        }
    }

    @Test
    fun deduplicatesDeltasAndDrainsAdaptively() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.accept(event(1, "turn_started", "{}"))
        ChatAnimationRepository.accept(event(2, "assistant_text_delta", """{"chunk":"hello"}"""))
        ChatAnimationRepository.accept(event(2, "assistant_text_delta", """{"chunk":"duplicate"}"""))
        awaitDisplayedText("conv-animation", "hello")
        val state = ChatAnimationRepository.observe("conv-animation").value
        assertEquals("hello", state.authoritativeText)
        assertEquals("hello", state.displayedText)
    }

    @Test
    fun snapshotSnapsOldContentAndNewDeltasAnimateFromItsCursor() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.restore(
            WsEvent.ChatActiveTurnSnapshot("conv-animation", "turn-1", 5, "restored", "active"),
        )
        var state = ChatAnimationRepository.observe("conv-animation").value
        assertEquals("restored", state.displayedText)
        ChatAnimationRepository.accept(event(6, "assistant_text_delta", """{"chunk":" tail"}"""))
        state = ChatAnimationRepository.observe("conv-animation").value
        assertEquals("restored tail", state.authoritativeText)
        assertTrue(state.displayedText.length >= "restored".length)
    }

    @Test
    fun completionEventuallyDrainsToAuthoritativeText() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.accept(event(1, "turn_started", "{}"))
        ChatAnimationRepository.accept(event(2, "assistant_text_delta", """{"chunk":"final"}"""))
        ChatAnimationRepository.accept(event(3, "turn_completed", "{}"))
        // turn_completed marks the state terminal immediately, but must not cut the reveal
        // animation short — displayedText should keep draining until it catches up rather
        // than snapping to the full authoritativeText the instant the turn completes.
        assertTrue(ChatAnimationRepository.observe("conv-animation").value.terminal)
        awaitDisplayedText("conv-animation", "final")
        val state = ChatAnimationRepository.observe("conv-animation").value
        assertEquals(state.authoritativeText, state.displayedText)
        assertTrue(state.terminal)
    }

    @Test
    fun tracksDuplicatesGapsAndSnapshotRecovery() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.accept(event(1, "turn_started", "{}"))
        ChatAnimationRepository.accept(event(3, "assistant_text_delta", """{"chunk":"gap"}"""))
        ChatAnimationRepository.accept(event(3, "assistant_text_delta", """{"chunk":"duplicate"}"""))
        ChatAnimationRepository.restore(
            WsEvent.ChatActiveTurnSnapshot("conv-animation", "turn-2", 8, "restored", "active"),
        )
        val state = ChatAnimationRepository.observe("conv-animation").value
        assertEquals(1L, state.sequenceGaps)
        assertEquals(1L, state.droppedDuplicateEvents)
        assertEquals(1L, state.snapshotRecoveries)
        assertEquals("restored", state.displayedText)
    }

    @Test
    fun olderHistoryCannotReplaceANewerActiveTurn() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.restore(
            WsEvent.ChatActiveTurnSnapshot("conv-animation", "turn-new", 5, "live answer", "active"),
        )
        assertFalse(ChatAnimationRepository.shouldApplyPersistedHistory("conv-animation", "old answer"))
        ChatAnimationRepository.accept(
            WsEvent.ChatTurnEvent("conv-animation", "turn-new", 6, "turn_completed", 6, "{}"),
        )
        assertTrue(ChatAnimationRepository.shouldApplyPersistedHistory("conv-animation", "live answer"))
    }
}
