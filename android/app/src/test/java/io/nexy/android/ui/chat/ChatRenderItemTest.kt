package io.nexy.android.ui.chat

import io.nexy.android.data.model.ThinkingBlock
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatRenderItemTest {
    @Test
    fun projectsTheActiveTurnInCanonicalEventOrder() {
        var turn = emptyChatTurnState("conv-1")
        fun apply(type: String, sequence: Long, payload: String = "") {
            val json = """{"type":"$type","conversationId":"conv-1","turnId":"turn-1","sequence":$sequence,"timestamp":${1000 + sequence}${if (payload.isBlank()) "" else ",$payload"}}"""
            turn = reduceChatTurn(turn, io.nexy.android.data.model.WsEvent.ChatTurnEvent(
                "conv-1", "turn-1", sequence, type, 1000 + sequence, json,
            ))
        }
        apply("turn_started", 1)
        apply("assistant_text_delta", 2, """"blockId":"before","chunk":"Before"""")
        apply("text_segment_done", 3, """"blockId":"before"""")
        apply("tool_started", 4, """"id":"tool-1","name":"read_file"""")
        apply("assistant_text_delta", 5, """"blockId":"after","chunk":"After"""")

        val items = buildActiveTurnRenderItems(turn)

        assertEquals(
            listOf(
                ChatRenderItem.AssistantMessage::class,
                ChatRenderItem.ToolCall::class,
                ChatRenderItem.AssistantMessage::class,
            ),
            items.map { it::class },
        )
        assertEquals("Before", (items[0] as ChatRenderItem.AssistantMessage).message.text)
        assertEquals("After", (items[2] as ChatRenderItem.AssistantMessage).message.text)
    }

    @Test
    fun activeTurnTextItemKeysStayUniqueAcrossSegments() {
        var turn = emptyChatTurnState("conv-1")
        fun apply(type: String, sequence: Long, payload: String = "") {
            val json = """{"type":"$type","conversationId":"conv-1","turnId":"turn-1","sequence":$sequence,"timestamp":${1000 + sequence}${if (payload.isBlank()) "" else ",$payload"}}"""
            turn = reduceChatTurn(turn, io.nexy.android.data.model.WsEvent.ChatTurnEvent(
                "conv-1", "turn-1", sequence, type, 1000 + sequence, json,
            ))
        }
        apply("turn_started", 1)
        apply("assistant_text_delta", 2, """"blockId":"before","chunk":"Before"""")
        apply("text_segment_done", 3, """"blockId":"before"""")
        apply("tool_started", 4, """"id":"tool-1","name":"read_file"""")
        apply("assistant_text_delta", 5, """"blockId":"after","chunk":"After"""")

        val keys = buildActiveTurnRenderItems(turn).map { it.key }

        assertEquals(keys, keys.distinct())
    }

    @Test
    fun reusesSettledHistoryWhileTheStreamingTailChanges() {
        val user = ChatMessage(id = "user-1", text = "Hello", isUser = true, isStreaming = false)
        val cache = ChatRenderTimelineCache()

        val first = cache.build(
            messages = listOf(user, ChatMessage(id = "assistant-live", text = "One", isUser = false, isStreaming = true)),
            activeTurn = emptyChatTurnState(),
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = true,
            activity = null,
            generationStartedAt = null,
        )
        val second = cache.build(
            messages = listOf(user, ChatMessage(id = "assistant-live", text = "One two", isUser = false, isStreaming = true)),
            activeTurn = emptyChatTurnState(),
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = true,
            activity = null,
            generationStartedAt = null,
        )

        assertEquals("One two", (second.last() as ChatRenderItem.AssistantMessage).message.text)
        assertEquals(true, first.first() === second.first())
    }

    @Test
    fun notificationReentryDoesNotDuplicatePersistedAndActiveToolKeys() {
        var turn = emptyChatTurnState("conv-1")
        fun apply(type: String, sequence: Long, payload: String = "") {
            val json = """{"type":"$type","conversationId":"conv-1","turnId":"turn-1","sequence":$sequence,"timestamp":${1000 + sequence}${if (payload.isBlank()) "" else ",$payload"}}"""
            turn = reduceChatTurn(
                turn,
                io.nexy.android.data.model.WsEvent.ChatTurnEvent(
                    "conv-1", "turn-1", sequence, type, 1000 + sequence, json,
                ),
            )
        }
        apply("turn_started", 1)
        apply("assistant_text_delta", 2, "\"blockId\":\"before\",\"chunk\":\"Let me check.\"")
        apply("text_segment_done", 3, """"blockId":"before"""")
        apply("tool_started", 4, """"id":"tool-1","name":"read_file"""")
        apply("tool_finished", 5, """"id":"tool-1","toolName":"read_file","result":"done","success":true""")
        apply("assistant_text_delta", 6, "\"blockId\":\"after\",\"chunk\":\"Still working.\"")

        // This is the state seen after opening an in-progress response from its notification:
        // the completed call is already persisted, but the active-turn snapshot replays it too.
        val items = ChatRenderTimelineCache().build(
            messages = listOf(
                ChatMessage(id = "user-1", text = "Question", isUser = true, isStreaming = false),
                ChatMessage(
                    id = "tool-1",
                    text = "",
                    isUser = false,
                    isStreaming = false,
                    isToolCall = true,
                    toolName = "read_file",
                    toolResult = "done",
                ),
            ),
            activeTurn = turn,
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = true,
            activity = null,
            generationStartedAt = 1000,
        )

        val keys = items.map { it.key }
        assertEquals(keys.distinct(), keys)
        assertEquals(1, items.count { it is ChatRenderItem.ToolCall && it.key == "tool-1" })
    }

    @Test
    fun usesTypeAwareDeletedArtifactLabelsWithAGenericFallback() {
        assertEquals("Quiz deleted", deletedArtifactLabel("quiz"))
        assertEquals("Teach-back deleted", deletedArtifactLabel("teachback"))
        assertEquals("Artifact deleted", deletedArtifactLabel(null))
        assertEquals("Artifact deleted", deletedArtifactLabel("future-kind"))
    }

    @Test
    fun hidesAPendingArtifactReferenceOnceItsFinalReferenceExists() {
        val messages = listOf(
            ChatMessage(
                id = "pending-ref",
                text = "",
                isUser = false,
                isStreaming = false,
                timestamp = 100,
                artifactRef = ArtifactRef("artifact-1", null, "quiz", pending = true),
            ),
            ChatMessage(
                id = "final-ref",
                text = "",
                isUser = false,
                isStreaming = false,
                timestamp = 200,
                artifactRef = ArtifactRef("artifact-1", "version-1", "quiz"),
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

        assertEquals(listOf("final-ref"), items.filterIsInstance<ChatRenderItem.ArtifactCard>().map { it.messageId })
    }

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
        assertEquals(
            emptyList<ChatRenderItem.ThinkingBlockItem>(),
            items.filterIsInstance<ChatRenderItem.ThinkingBlockItem>(),
        )
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

    @Test
    fun resolvesTheRetrySourceWhileBuildingTheTimeline() {
        val user = ChatMessage(id = "user-1", text = "Question", isUser = true, isStreaming = false)
        val assistant = ChatMessage(id = "assistant-1", text = "Answer", isUser = false, isStreaming = false)

        val items = buildChatRenderItems(
            messages = listOf(user, assistant),
            liveThinkingBlocks = emptyList(),
            isAwaitingResponse = false,
            isStreaming = false,
            activity = null,
            generationStartedAt = null,
        )

        assertEquals(user, (items.last() as ChatRenderItem.AssistantMessage).precedingUserMessage)
    }
}
