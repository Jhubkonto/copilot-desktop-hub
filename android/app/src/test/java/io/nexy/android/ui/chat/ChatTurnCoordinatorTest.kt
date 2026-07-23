package io.nexy.android.ui.chat

import io.nexy.android.data.model.WsEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatTurnCoordinatorTest {
    @Test
    fun buffersAGapUntilSnapshotSuppliesTheMissingPrefix() {
        val coordinator = ChatTurnCoordinator("conv-1")
        coordinator.accept(event("turn_started", 1))
        val gap = coordinator.accept(event("assistant_text_delta", 3, """"blockId":"b","chunk":"B""""))

        assertTrue(gap.needsSnapshot)
        assertEquals("", gap.state.text)

        val restored = coordinator.restore(
            listOf(
                event("turn_started", 1),
                event("assistant_text_delta", 2, """"blockId":"a","chunk":"A""""),
            ),
        )

        assertFalse(restored.needsSnapshot)
        assertEquals("AB", restored.state.text)
        assertEquals(3L, restored.state.lastSequence)
    }

    @Test
    fun snapshotReplayAndUninterruptedDeliveryProduceTheSameTimeline() {
        val events = listOf(
            event("turn_started", 1),
            event("assistant_text_delta", 2, """"blockId":"before","chunk":"Before""""),
            event("text_segment_done", 3, """"blockId":"before""""),
            event("tool_started", 4, """"id":"tool-1","name":"read_file""""),
            event("tool_finished", 5, """"id":"tool-1","toolName":"read_file","result":"ok","success":true"""),
            event("assistant_text_delta", 6, """"blockId":"after","chunk":"After""""),
        )
        val live = ChatTurnCoordinator("conv-1")
        events.forEach(live::accept)
        val restored = ChatTurnCoordinator("conv-1").restore(events)

        assertEquals(live.currentState().timeline, restored.state.timeline)
        assertEquals(
            listOf(
                ChatTurnItem.TextSegment::class,
                ChatTurnItem.ToolCall::class,
                ChatTurnItem.TextSegment::class,
            ),
            restored.state.timeline.map { it::class },
        )
    }

    @Test
    fun ignoresDuplicateSequences() {
        val coordinator = ChatTurnCoordinator("conv-1")
        coordinator.accept(event("turn_started", 1))
        coordinator.accept(event("assistant_text_delta", 2, """"blockId":"a","chunk":"one""""))
        coordinator.accept(event("assistant_text_delta", 2, """"blockId":"a","chunk":"duplicate""""))

        assertEquals("one", coordinator.currentState().text)
    }

    private fun event(type: String, sequence: Long, payload: String = ""): WsEvent.ChatTurnEvent {
        val json = buildString {
            append("""{"type":"$type","conversationId":"conv-1","turnId":"turn-1","sequence":$sequence,"timestamp":${1000 + sequence}""")
            if (payload.isNotBlank()) append(",").append(payload)
            append("}")
        }
        return WsEvent.ChatTurnEvent("conv-1", "turn-1", sequence, type, 1000 + sequence, json)
    }
}
