package io.nexy.android.ui.chat

import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun requestsHistoryOnInit() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)

        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.single(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun loadsHistoryOnceForCurrentConversation() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage("m1", "user", "Hello", 1),
                    HistoryMessage("m2", "assistant", "Hi", 2),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            listOf(
                ChatMessage(id = "m1", text = "Hello", isUser = true, isStreaming = false, timestamp = 1),
                ChatMessage(id = "m2", text = "Hi", isUser = false, isStreaming = false, timestamp = 2),
            ),
            vm.messages.value,
        )

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m3", "user", "Ignored reload", 3)),
            ),
        )
        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "other-conv",
                messages = listOf(HistoryMessage("m4", "user", "Ignored other", 4)),
            ),
        )
        advanceUntilIdle()

        assertEquals(2, vm.messages.value.size)
        assertEquals("Hello", vm.messages.value.first().text)

        vm.viewModelScope.cancel()
    }

    @Test
    fun restoresAttachmentNamesFromHistory() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage(
                        id = "m1",
                        role = "user",
                        content = "",
                        timestamp = 1,
                        attachments = listOf(AttachmentMeta(id = "m1", name = "photo.png", type = "image", thumbnailDataUrl = null)),
                    ),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            ChatMessage(
                id = "m1",
                text = "",
                isUser = true,
                isStreaming = false,
                timestamp = 1,
                attachments = listOf(AttachmentMeta(id = "m1", name = "photo.png", type = "image", thumbnailDataUrl = null)),
            ),
            vm.messages.value.single(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun restoresPersistedThinkingBlocksFromHistoryReload() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage(
                        id = "m1",
                        role = "assistant",
                        content = "Done",
                        timestamp = 1,
                        thinkingBlocks = listOf(ThinkingBlock("codex-activity", "Ran tests", done = true)),
                    ),
                ),
            ),
        )
        advanceUntilIdle()

        assertEquals(
            listOf(ThinkingBlock("codex-activity", "Ran tests", done = true)),
            vm.messages.value.single().thinkingBlocks,
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun appendsStreamChunksAndFinalizesAssistantMessage() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")
        assertTrue(vm.isAwaitingResponse.value)

        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", "Hello"))
        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", " world"))
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertTrue(vm.isStreaming.value)
        assertEquals(
            ChatMessage(text = "Hello world", isUser = false, isStreaming = true),
            vm.messages.value.last(),
        )

        fakeWs.emit(WsEvent.ChatStreamEnd("conv-1"))
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            ChatMessage(text = "Hello world", isUser = false, isStreaming = false),
            vm.messages.value.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun accumulatesLiveThinkingBlocksAndClearsThemOnStreamEnd() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ChatThinkingDelta("conv-1", "codex-activity", "Planning"))
        fakeWs.emit(WsEvent.ChatThinkingDelta("conv-1", "codex-activity", " steps"))
        fakeWs.emit(WsEvent.ChatThinkingEnd("conv-1", "codex-activity"))
        advanceUntilIdle()

        assertTrue(vm.isAwaitingResponse.value)
        assertEquals(
            listOf(ThinkingBlock("codex-activity", "Planning steps", done = true)),
            vm.liveThinkingBlocks.value,
        )

        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", "Done"))
        fakeWs.emit(WsEvent.ChatStreamEnd("conv-1"))
        advanceUntilIdle()

        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        vm.viewModelScope.cancel()
    }

    @Test
    fun ignoresLiveThinkingEventsForOtherConversations() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ChatThinkingDelta("other-conv", "codex-activity", "Ignored"))
        fakeWs.emit(WsEvent.ChatThinkingEnd("other-conv", "codex-activity"))
        advanceUntilIdle()

        assertTrue(vm.liveThinkingBlocks.value.isEmpty())
        assertFalse(vm.isAwaitingResponse.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun clearsLiveThinkingBlocksOnStopRefreshAndErrorActivity() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ChatThinkingDelta("conv-1", "codex-activity", "Working"))
        advanceUntilIdle()
        assertTrue(vm.liveThinkingBlocks.value.isNotEmpty())

        vm.stopStream()
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        fakeWs.emit(WsEvent.ChatThinkingDelta("conv-1", "codex-activity", "Working"))
        advanceUntilIdle()
        vm.refreshMessages()
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        fakeWs.emit(WsEvent.ChatThinkingDelta("conv-1", "codex-activity", "Working"))
        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "error",
                label = "Failed",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()
        assertTrue(vm.liveThinkingBlocks.value.isEmpty())

        vm.viewModelScope.cancel()
    }

    @Test
    fun ignoresStreamEventsForOtherConversations() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(WsEvent.ChatStreamChunk("other-conv", "Nope"))
        fakeWs.emit(WsEvent.ChatStreamEnd("other-conv"))
        advanceUntilIdle()

        assertFalse(vm.isStreaming.value)
        assertFalse(vm.isAwaitingResponse.value)
        assertTrue(vm.messages.value.isEmpty())

        vm.viewModelScope.cancel()
    }

    @Test
    fun activityEventsUpdateAndClearAwaitingStatus() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "tool",
                label = "Running browser_snapshot",
                toolName = "browser_snapshot",
                serverName = "Browser",
            ),
        )
        advanceUntilIdle()

        assertTrue(vm.isAwaitingResponse.value)
        assertEquals("Running browser_snapshot", vm.activityLabel.value)

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "other-conv",
                state = "tool",
                label = "Ignored",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()

        assertEquals("Running browser_snapshot", vm.activityLabel.value)

        fakeWs.emit(
            WsEvent.ChatActivity(
                conversationId = "conv-1",
                state = "complete",
                label = "Complete",
                toolName = null,
                serverName = null,
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isAwaitingResponse.value)
        assertEquals("Assistant is thinking", vm.activityLabel.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageAddsOptimisticUserMessageAndSendsCommand() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")

        assertEquals(
            ChatMessage(text = "Hello", isUser = true, isStreaming = false),
            vm.messages.value.single(),
        )
        assertTrue(vm.isAwaitingResponse.value)
        assertEquals(
            SentCommand("chat:send-message", mapOf("conversationId" to "conv-1", "content" to "Hello")),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageIncludesImageAttachments() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.addAttachment("photo.png", "image/png", "data:image/png;base64,abc123", null)
        vm.sendMessage("")

        assertTrue(vm.attachments.value.isEmpty())
        val actualMsg = vm.messages.value.single()
        val attId = actualMsg.attachments.firstOrNull()?.id.orEmpty()
        assertEquals(
            ChatMessage(
                text = "",
                isUser = true,
                isStreaming = false,
                attachments = listOf(AttachmentMeta(id = attId, name = "photo.png", type = "image", thumbnailDataUrl = null)),
            ),
            actualMsg,
        )

        val sent = fakeWs.sentCommands.last()
        assertEquals("chat:send-message", sent.command)
        assertEquals("conv-1", sent.data["conversationId"])
        assertEquals("", sent.data["content"])
        @Suppress("UNCHECKED_CAST")
        val images = sent.data["images"] as List<Map<String, String>>
        assertEquals(1, images.size)
        assertEquals("photo.png", images[0]["name"])
        assertEquals("data:image/png;base64,abc123", images[0]["dataUrl"])

        vm.viewModelScope.cancel()
    }

    @Test
    fun sendMessageIncludesDraftAgentAndProjectIds() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("draft-conv", fakeWs, agentId = "agent-1", projectId = "project-1")
        advanceUntilIdle()

        vm.sendMessage("Use the browser")

        assertEquals(
            SentCommand(
                "chat:send-message",
                mapOf(
                    "conversationId" to "draft-conv",
                    "content" to "Use the browser",
                    "agentId" to "agent-1",
                    "projectId" to "project-1",
                ),
            ),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun setModelPersistsSelectionAndSendMessageIncludesModel() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.setModel("gpt-5.5")
        vm.sendMessage("Hello")

        assertEquals("gpt-5.5", vm.selectedModel.value)
        assertEquals(
            SentCommand(
                "conversation:set-model",
                mapOf("conversationId" to "conv-1", "model" to "gpt-5.5"),
            ),
            fakeWs.sentCommands[fakeWs.sentCommands.size - 2],
        )
        assertEquals(
            SentCommand(
                "chat:send-message",
                mapOf("conversationId" to "conv-1", "content" to "Hello", "model" to "gpt-5.5"),
            ),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    @Test
    fun refreshMessagesRequestsHistoryAgain() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.refreshMessages()

        assertTrue(vm.isRefreshing.value)
        assertEquals(
            SentCommand("conversation:get-messages", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )
        assertEquals(2, fakeWs.sentCommands.count { it.command == "conversation:get-messages" })

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(HistoryMessage("m1", "assistant", "Hi", 1)),
            ),
        )
        advanceUntilIdle()

        assertFalse(vm.isRefreshing.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun mapsPersistedToolCallHistoryMessages() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.ConversationMessages(
                conversationId = "conv-1",
                messages = listOf(
                    HistoryMessage(
                        "tool-1",
                        "tool-call",
                        """{"__type":"tool-call","toolName":"browser_type","serverName":"claude-cli","toolArgs":{"target":"search-box","text":"poodle"},"toolResult":"Search submitted","toolSuccess":true}""",
                        1,
                    ),
                ),
            ),
        )
        advanceUntilIdle()

        val msg = vm.messages.value.single()
        assertTrue(msg.isToolCall)
        assertEquals("browser_type", msg.toolName)
        assertEquals("claude-cli", msg.serverName)
        assertEquals("Search submitted", msg.toolResult)
        assertTrue(msg.toolSuccess)

        vm.viewModelScope.cancel()
    }

    @Test
    fun stopStreamSendsStopCommandAndClearsStreamingState() = runTest {
        val fakeWs = FakeWsClient()
        val vm = ChatViewModel("conv-1", fakeWs)
        advanceUntilIdle()

        vm.sendMessage("Hello")
        assertTrue(vm.isAwaitingResponse.value)

        vm.stopStream()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            SentCommand("agent:stop", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )

        fakeWs.emit(WsEvent.ChatStreamChunk("conv-1", "Working"))
        advanceUntilIdle()
        assertTrue(vm.isStreaming.value)

        vm.stopStream()

        assertFalse(vm.isAwaitingResponse.value)
        assertFalse(vm.isStreaming.value)
        assertEquals(
            SentCommand("agent:stop", mapOf("conversationId" to "conv-1")),
            fakeWs.sentCommands.last(),
        )

        vm.viewModelScope.cancel()
    }

    private data class SentCommand(val command: String, val data: Map<String, Any>)

    private class FakeWsClient : WsClient {
        private val mutableEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
        override val events: SharedFlow<WsEvent> = mutableEvents
        val sentCommands = mutableListOf<SentCommand>()

        override fun send(command: String, data: Map<String, Any>) {
            sentCommands += SentCommand(command, data)
        }

        suspend fun emit(event: WsEvent) {
            mutableEvents.emit(event)
        }
    }
}
