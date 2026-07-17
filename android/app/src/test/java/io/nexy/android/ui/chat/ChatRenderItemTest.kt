package io.nexy.android.ui.chat

import io.nexy.android.data.model.ThinkingBlock
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatRenderItemTest {
    @Test
    fun positionsAPersistedTextSegmentBeforeTheToolCallThatFollowedIt() {
        val messages = listOf(
            ChatMessage(
                id = "tool-1",
                text = "contents",
                isUser = false,
                isStreaming = false,
                timestamp = 200,
                isToolCall = true,
                toolName = "Read",
                toolResult = "contents",
            ),
            ChatMessage(
                id = "assistant-1",
                text = "I'll look at the key config files.Here's the fuller picture.",
                isUser = false,
                isStreaming = false,
                timestamp = 300,
                textSegments = listOf(
                    ThinkingBlock(blockId = "text-0", content = "I'll look at the key config files.", done = true, firstSeenAt = 100),
                    ThinkingBlock(blockId = "text-1", content = "Here's the fuller picture.", done = true, firstSeenAt = 250),
                ),
            ),
        )

        val items = buildChatRenderItems(
            messages = messages,
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = false,
            activity = null,
            generationStartedAt = null,
        )

        // The lead-in segment (said before the tool call) renders inline, ahead of the tool
        // call, not bunched together with the tail segment after every tool call.
        assertEquals(
            listOf(
                ChatRenderItem.TextSegmentItem::class,
                ChatRenderItem.ToolCall::class,
                ChatRenderItem.AssistantMessage::class,
            ),
            items.map { it::class },
        )
        val textItem = items[0] as ChatRenderItem.TextSegmentItem
        assertEquals("I'll look at the key config files.", textItem.block.content)
        val assistantItem = items[2] as ChatRenderItem.AssistantMessage
        // The tail segment (said after the tool call) is the only text shown in the bubble —
        // not repeated a second time via a TextSegmentItem.
        assertEquals("Here's the fuller picture.", assistantItem.displayText)
    }

    @Test
    fun fallsBackToFullTextWithNoOverrideWhenThereAreNoTextSegments() {
        val messages = listOf(
            ChatMessage(
                id = "assistant-1",
                text = "A simple, uninterrupted answer.",
                isUser = false,
                isStreaming = false,
                timestamp = 100,
            ),
        )

        val items = buildChatRenderItems(
            messages = messages,
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = false,
            activity = null,
            generationStartedAt = null,
        )

        assertEquals(1, items.size)
        val assistantItem = items[0] as ChatRenderItem.AssistantMessage
        assertEquals(null, assistantItem.displayText)
    }
}
