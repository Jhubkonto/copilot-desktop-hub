package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatAnimationRepositoryTest {
    private fun event(sequence: Long, type: String, payload: String): WsEvent.ChatTurnEvent =
        WsEvent.ChatTurnEvent("conv-animation", "turn-1", sequence, type, sequence, payload)

    @Test
    fun deduplicatesDeltasAndDrainsAdaptively() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.accept(event(1, "turn_started", "{}"))
        ChatAnimationRepository.accept(event(2, "assistant_text_delta", """{"chunk":"hello"}"""))
        ChatAnimationRepository.accept(event(2, "assistant_text_delta", """{"chunk":"duplicate"}"""))
        delay(40)
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
    fun completionFlushesAuthoritativeText() = runTest {
        ChatAnimationRepository.clear("conv-animation")
        ChatAnimationRepository.accept(event(1, "turn_started", "{}"))
        ChatAnimationRepository.accept(event(2, "assistant_text_delta", """{"chunk":"final"}"""))
        ChatAnimationRepository.accept(event(3, "turn_completed", "{}"))
        val state = ChatAnimationRepository.observe("conv-animation").value
        assertEquals(state.authoritativeText, state.displayedText)
        assertTrue(state.terminal)
    }
}
