package io.nexy.android.ui.chat

import io.nexy.android.data.model.WsEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatTurnReducerTest {
    @Test
    fun startsTurnAndAccumulatesTextInSequenceOrder() {
        var state = emptyChatTurnState("conv-1")
        state = reduceChatTurn(state, turnEvent("turn_started", 1))
        state = reduceChatTurn(state, turnEvent("assistant_text_delta", 2, """"chunk":"Hello""""))
        state = reduceChatTurn(state, turnEvent("assistant_text_delta", 3, """"chunk":" world""""))

        assertEquals(ChatTurnStatus.Streaming, state.status)
        assertEquals("Hello world", state.text)
        assertEquals(3L, state.lastSequence)
    }

    @Test
    fun ignoresStaleEventsAndEventsForOtherConversations() {
        var state = emptyChatTurnState("conv-1")
        state = reduceChatTurn(state, turnEvent("turn_started", 1))
        state = reduceChatTurn(state, turnEvent("assistant_text_delta", 3, """"chunk":"new""""))
        state = reduceChatTurn(state, turnEvent("assistant_text_delta", 2, """"chunk":" stale""""))
        state = reduceChatTurn(state, turnEvent("assistant_text_delta", 4, """"chunk":" other"""", conversationId = "conv-2"))

        assertEquals("new", state.text)
        assertEquals(3L, state.lastSequence)
    }

    @Test
    fun queuesThinkingDoneBeforeMatchingDeltaAndReplaysIt() {
        var state = emptyChatTurnState("conv-1")
        state = reduceChatTurn(state, turnEvent("turn_started", 1))
        state = reduceChatTurn(state, turnEvent("thinking_done", 2, """"blockId":"reasoning-1""""))

        assertTrue("reasoning-1" in state.pendingThinkingEnds)
        assertTrue(state.thinkingBlocks.isEmpty())

        state = reduceChatTurn(
            state,
            turnEvent("thinking_delta", 3, """"blockId":"reasoning-1","chunk":"Planned steps""""),
        )

        assertEquals(1, state.thinkingBlocks.size)
        assertEquals("Planned steps", state.thinkingBlocks.single().content)
        assertTrue(state.thinkingBlocks.single().done)
        assertTrue(state.pendingThinkingEnds.isEmpty())
    }

    @Test
    fun marksThinkingDoneOnCompletionAndFailure() {
        var completed = emptyChatTurnState("conv-1")
        completed = reduceChatTurn(completed, turnEvent("turn_started", 1))
        completed = reduceChatTurn(completed, turnEvent("thinking_delta", 2, """"blockId":"reasoning-1","chunk":"Still thinking""""))
        completed = reduceChatTurn(completed, turnEvent("turn_completed", 3))

        assertEquals(ChatTurnStatus.Completed, completed.status)
        assertTrue(completed.thinkingBlocks.single().done)

        var failed = emptyChatTurnState("conv-1")
        failed = reduceChatTurn(failed, turnEvent("turn_started", 1))
        failed = reduceChatTurn(failed, turnEvent("thinking_delta", 2, """"blockId":"reasoning-1","chunk":"Still thinking""""))
        failed = reduceChatTurn(
            failed,
            turnEvent("turn_failed", 3, """"errorType":"api","message":"Provider failed","retryable":true"""),
        )

        assertEquals(ChatTurnStatus.Failed, failed.status)
        assertEquals("Provider failed", failed.error?.message)
        assertTrue(failed.thinkingBlocks.single().done)
    }

    @Test
    fun recordsToolModelActivityAndCost() {
        var state = emptyChatTurnState("conv-1")
        state = reduceChatTurn(state, turnEvent("turn_started", 1))
        state = reduceChatTurn(state, turnEvent("model_changed", 2, """"model":"gpt-5-mini""""))
        state = reduceChatTurn(
            state,
            turnEvent("activity_changed", 3, """"state":"tool","label":"Running browser_snapshot","toolName":"browser_snapshot","serverName":"Browser""""),
        )
        state = reduceChatTurn(
            state,
            turnEvent("tool_finished", 4, """"toolName":"browser_snapshot","serverName":"Browser","args":{"tab":"active"},"result":"Snapshot captured","success":true"""),
        )
        state = reduceChatTurn(
            state,
            turnEvent("cost_updated", 5, """"inputTokens":100,"outputTokens":25,"totalCostUsd":0.01"""),
        )

        assertEquals("gpt-5-mini", state.model)
        assertEquals("Running browser_snapshot", state.activity?.label)
        assertEquals("browser_snapshot", state.toolCalls.single().toolName)
        assertEquals("""{"tab":"active"}""", state.toolCalls.single().argsJson)
        assertEquals(100, state.cost?.inputTokens)
        assertEquals(25, state.cost?.outputTokens)
        assertEquals(0.01, state.cost?.totalCostUsd ?: 0.0, 0.0001)
        assertNull(state.error)
    }

    @Test
    fun updatesDuplicateToolFinishedEventsWithTheSameId() {
        var state = emptyChatTurnState("conv-1")
        state = reduceChatTurn(state, turnEvent("turn_started", 1))
        state = reduceChatTurn(
            state,
            turnEvent("tool_finished", 2, """"id":"tool-1","toolName":"read_file","result":"old","success":true"""),
        )
        state = reduceChatTurn(
            state,
            turnEvent("tool_finished", 3, """"id":"tool-1","toolName":"read_file","result":"new","success":false"""),
        )

        assertEquals(1, state.toolCalls.size)
        assertEquals("tool-1", state.toolCalls.single().id)
        assertEquals("new", state.toolCalls.single().result)
        assertEquals(false, state.toolCalls.single().success)
    }

    private fun turnEvent(
        type: String,
        sequence: Long,
        payload: String = "",
        conversationId: String = "conv-1",
        turnId: String = "turn-1",
    ): WsEvent.ChatTurnEvent {
        val payloadJson = buildString {
            append("""{"type":"$type","conversationId":"$conversationId","turnId":"$turnId","sequence":$sequence,"timestamp":${1000 + sequence}""")
            if (payload.isNotBlank()) append(",").append(payload)
            append("}")
        }
        return WsEvent.ChatTurnEvent(
            conversationId = conversationId,
            turnId = turnId,
            sequence = sequence,
            type = type,
            timestamp = 1000 + sequence,
            payloadJson = payloadJson,
        )
    }
}
