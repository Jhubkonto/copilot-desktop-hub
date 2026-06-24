package io.nexy.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID

private const val STREAM_CHARS_PER_TICK = 60
private const val STREAM_TICK_MS = 16L
// Chunks larger than this skip the typewriter drip and are applied in one update
private const val LARGE_CHUNK_THRESHOLD = 500

data class PendingAttachment(
    val id: String,
    val name: String,
    val mimeType: String,
    val dataUrl: String?,
    val textContent: String?,
    val isImage: Boolean,
)

data class ChatMessage(
    val id: String = "",
    val text: String,
    val isUser: Boolean,
    val isStreaming: Boolean,
    val timestamp: Long = 0L,
    val attachments: List<AttachmentMeta> = emptyList(),
    val isToolCall: Boolean = false,
    val toolName: String? = null,
    val serverName: String? = null,
    val toolArgs: String? = null,
    val toolResult: String? = null,
    val toolSuccess: Boolean = true,
    val sendFailed: Boolean = false,
    val thinkingBlocks: List<ThinkingBlock> = emptyList(),
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val toolCalls: List<ChatMessage> = emptyList(),
)

class ChatViewModel(
    private val conversationId: String,
    private val wsClient: WsClient = WsRepository,
    private val agentId: String? = null,
    private val projectId: String? = null,
) : ViewModel() {

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _isStreaming = MutableStateFlow(false)
    val isStreaming: StateFlow<Boolean> = _isStreaming

    private val _isAwaitingResponse = MutableStateFlow(false)
    val isAwaitingResponse: StateFlow<Boolean> = _isAwaitingResponse

    private val _activityLabel = MutableStateFlow("Assistant is thinking")
    val activityLabel: StateFlow<String> = _activityLabel

    private val _liveThinkingBlocks = MutableStateFlow<List<ThinkingBlock>>(emptyList())
    val liveThinkingBlocks: StateFlow<List<ThinkingBlock>> = _liveThinkingBlocks

    private val _generationStartedAt = MutableStateFlow<Long?>(null)
    val generationStartedAt: StateFlow<Long?> = _generationStartedAt

    private val _attachments = MutableStateFlow<List<PendingAttachment>>(emptyList())
    val attachments: StateFlow<List<PendingAttachment>> = _attachments

    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft

    fun setDraft(text: String) { _draft.value = text }
    fun consumeDraft(): String = _draft.value.also { _draft.value = "" }

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing

    private val _selectedModel = MutableStateFlow<String?>(null)
    val selectedModel: StateFlow<String?> = _selectedModel

    private val _sendError = MutableStateFlow<String?>(null)
    val sendError: StateFlow<String?> = _sendError

    private var historyLoaded = false
    // Set to true when ChatStreamEnd or ChatActivity(complete/error) arrives so that
    // late-arriving in-progress ChatActivity events don't re-set isAwaitingResponse.
    private var streamCompleted = false
    // Set to true when stream ends; guards late ChatThinkingDelta/ChatThinkingEnd events.
    private var isStreamEnded = false

    // Buffer incoming stream chunks; drain coroutine emits to _messages at a fixed rate.
    // null sentinel signals end-of-stream so the drain coroutine can clear isStreaming.
    private val streamBuffer = Channel<String?>(Channel.UNLIMITED)

    init {
        refreshMessages()
        // Drain coroutine: consume buffer at ~60 chars per 16ms frame.
        // streamEndPending defers isStreaming=false until the last queued chunk finishes rendering.
        viewModelScope.launch {
            var streamEndPending = false
            WsRepository.sendLog("Drain", "drain coroutine started for conv=$conversationId")
            for (chunk in streamBuffer) {
                if (chunk == null) {
                    // Null sentinel signals end-of-stream. Defer the isStreaming clear until
                    // after the last real chunk's while-loop finishes so the cursor stays visible.
                    WsRepository.sendLog("Drain", "null sentinel received; streamEndPending=true; bufferEmpty=${streamBuffer.isEmpty}")
                    streamEndPending = true
                    continue
                }
                WsRepository.sendLog("Drain", "chunk len=${chunk.length}; msgs=${_messages.value.size}; lastIsStreaming=${_messages.value.lastOrNull()?.isStreaming}")
                // Large chunks skip the typewriter drip to avoid hundreds of rapid recompositions
                if (chunk.length >= LARGE_CHUNK_THRESHOLD) {
                    val current = _messages.value
                    val streamingIdx = current.indexOfLast { it.isStreaming }
                    if (streamingIdx >= 0) {
                        _messages.value = current.toMutableList().also { list ->
                            list[streamingIdx] = list[streamingIdx].copy(text = list[streamingIdx].text + chunk)
                        }
                    } else {
                        WsRepository.sendLog("Drain", "no streaming msg found; creating new; msgs=${current.size}; types=${current.map { if (it.isToolCall) "tool" else if (it.isUser) "user" else "asst(streaming=${it.isStreaming})" }}")
                        _messages.value = current + ChatMessage(text = chunk, isUser = false, isStreaming = true)
                    }
                } else {
                    var remaining: String = chunk
                    while (remaining.isNotEmpty()) {
                        val slice = remaining.take(STREAM_CHARS_PER_TICK)
                        remaining = remaining.drop(STREAM_CHARS_PER_TICK)
                        val current = _messages.value
                        val streamingIdx = current.indexOfLast { it.isStreaming }
                        if (streamingIdx >= 0) {
                            _messages.value = current.toMutableList().also { list ->
                                list[streamingIdx] = list[streamingIdx].copy(text = list[streamingIdx].text + slice)
                            }
                        } else {
                            WsRepository.sendLog("Drain", "no streaming msg found; creating new; msgs=${current.size}; types=${current.map { if (it.isToolCall) "tool" else if (it.isUser) "user" else "asst(streaming=${it.isStreaming})" }}")
                            _messages.value = current + ChatMessage(text = slice, isUser = false, isStreaming = true)
                        }
                        if (remaining.isNotEmpty()) delay(STREAM_TICK_MS)
                    }
                }
                // After the last chunk's characters are rendered, clear streaming state.
                // Transfer liveThinkingBlocks into the message so thinking content stays
                // visible during the 400ms gap before the history re-fetch completes.
                if (streamEndPending && streamBuffer.isEmpty) {
                    val current = _messages.value
                    val streamingIdx = current.indexOfLast { it.isStreaming }
                    val thinkingSnapshot = _liveThinkingBlocks.value
                    WsRepository.sendLog("Drain", "draining complete; streamingIdx=$streamingIdx; thinkingBlocks=${thinkingSnapshot.size}; clearing isStreaming")
                    if (streamingIdx >= 0) {
                        _messages.value = current.toMutableList().also { list ->
                            val msg = list[streamingIdx]
                            list[streamingIdx] = msg.copy(
                                isStreaming = false,
                                thinkingBlocks = if (thinkingSnapshot.isNotEmpty() && msg.thinkingBlocks.isEmpty())
                                    thinkingSnapshot else msg.thinkingBlocks,
                            )
                        }
                    }
                    _isStreaming.value = false
                    _isAwaitingResponse.value = false
                    _liveThinkingBlocks.value = emptyList()
                    _generationStartedAt.value = null
                    streamEndPending = false
                }
            }
        }
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when {
                    event is WsEvent.ConversationMessages && event.conversationId == conversationId -> {
                        WsRepository.sendLog("VM", "ConversationMessages: count=${event.messages.size} historyLoaded=$historyLoaded")
                        if (!historyLoaded) {
                            historyLoaded = true
                            _isRefreshing.value = false
                            val mapped = event.messages.map { msg -> msg.toChatMessage() }

                            // Restore in-progress state from the WsRepository snapshot if the chat
                            // is still active (user left and re-entered while the desktop was busy).
                            val snapshot = WsRepository.activeChatSnapshots.value[conversationId]
                            if (snapshot != null) {
                                _isAwaitingResponse.value = true
                                _activityLabel.value = snapshot.activityLabel
                                if (snapshot.generationStartedAt > 0L) {
                                    _generationStartedAt.value = snapshot.generationStartedAt
                                }
                                if (snapshot.liveThinkingBlocks.isNotEmpty()) {
                                    _liveThinkingBlocks.value = snapshot.liveThinkingBlocks
                                }
                                // Append tool calls from the snapshot that aren't already persisted
                                val existingToolNames = mapped.filter { it.isToolCall }.map { it.toolName }.toSet()
                                val missingToolCalls = snapshot.completedToolCalls
                                    .filter { it.toolName !in existingToolNames }
                                    .map { tc ->
                                        ChatMessage(
                                            text = "",
                                            isUser = false,
                                            isStreaming = false,
                                            isToolCall = true,
                                            toolName = tc.toolName,
                                            serverName = tc.serverName,
                                            toolArgs = tc.args,
                                            toolResult = tc.result,
                                            toolSuccess = tc.success,
                                        )
                                    }
                                _messages.value = if (missingToolCalls.isNotEmpty()) mapped + missingToolCalls else mapped
                            } else {
                                _messages.value = mapped
                                // If the last persisted message is from the user, a response is still
                                // being generated — restore the awaiting indicator so re-entry shows
                                // progress instead of an inert user bubble.
                                if (mapped.isNotEmpty() && mapped.last().isUser && !_isStreaming.value) {
                                    _isAwaitingResponse.value = true
                                }
                            }
                        }
                    }
                    event is WsEvent.ChatActivity && event.conversationId == conversationId -> {
                        if (event.state == "error") {
                            WsRepository.sendLog("VM", "ChatActivity ERROR: label=\"${event.label}\" model=${_selectedModel.value ?: "desktop-default"} streamCompleted=$streamCompleted")
                        } else {
                            WsRepository.sendLog("VM", "ChatActivity: state=${event.state} label=${event.label} streamCompleted=$streamCompleted")
                        }
                        if (event.state == "complete" || event.state == "error") {
                            streamCompleted = true
                            isStreamEnded = true
                            _isAwaitingResponse.value = false
                            _isStreaming.value = false
                            _activityLabel.value = "Assistant is thinking"
                            markAllLiveThinkingDone()
                            _liveThinkingBlocks.value = emptyList()
                            _generationStartedAt.value = null
                        } else if (!streamCompleted) {
                            _activityLabel.value = event.label.ifBlank { "Assistant is thinking" }
                            if (_generationStartedAt.value == null) {
                                _generationStartedAt.value = System.currentTimeMillis()
                            }
                            if (!_isStreaming.value) _isAwaitingResponse.value = true
                        }
                    }
                    event is WsEvent.ChatThinkingDelta && event.conversationId == conversationId -> {
                        if (isStreamEnded) return@collect
                        WsRepository.sendLog("VM", "ChatThinkingDelta: blockId=${event.blockId} len=${event.chunk.length}")
                        appendLiveThinking(event.blockId, event.chunk)
                        if (!_isStreaming.value) _isAwaitingResponse.value = true
                    }
                    event is WsEvent.ChatThinkingEnd && event.conversationId == conversationId -> {
                        if (isStreamEnded) return@collect
                        WsRepository.sendLog("VM", "ChatThinkingEnd: blockId=${event.blockId}")
                        _liveThinkingBlocks.value = _liveThinkingBlocks.value.map { block ->
                            if (block.blockId == event.blockId) block.copy(done = true) else block
                        }
                    }
                    event is WsEvent.ChatToolCallEvent && event.conversationId == conversationId -> {
                        WsRepository.sendLog("VM", "ChatToolCallEvent: tool=${event.toolName} success=${event.success} msgs_before=${_messages.value.size} isStreaming=${_isStreaming.value}")
                        // Keep isAwaitingResponse=true — the agent is still running between tool calls.
                        // Clearing it here causes the ThinkingBubble to flash off then immediately back on.
                        _liveThinkingBlocks.value = emptyList()
                        _messages.value = _messages.value + ChatMessage(
                            text = "",
                            isUser = false,
                            isStreaming = false,
                            isToolCall = true,
                            toolName = event.toolName,
                            serverName = event.serverName,
                            toolArgs = event.args,
                            toolResult = event.result,
                            toolSuccess = event.success,
                        )
                        WsRepository.sendLog("VM", "ChatToolCallEvent: msgs_after=${_messages.value.size}")
                    }
                    event is WsEvent.ChatStreamChunk && event.conversationId == conversationId -> {
                        if (_isStreaming.value.not()) {
                            WsRepository.sendLog("VM", "ChatStreamChunk: FIRST CHUNK; msgs=${_messages.value.size}; types=${_messages.value.map { if (it.isToolCall) "tool" else if (it.isUser) "user" else "asst(streaming=${it.isStreaming})" }}")
                        }
                        _isAwaitingResponse.value = false
                        _activityLabel.value = "Assistant is thinking"
                        _isStreaming.value = true
                        streamBuffer.send(event.text)
                    }
                    event is WsEvent.ChatStreamEnd && event.conversationId == conversationId -> {
                        WsRepository.sendLog("VM", "ChatStreamEnd: msgs=${_messages.value.size} bufferEmpty=${streamBuffer.isEmpty}")
                        isStreamEnded = true
                        markAllLiveThinkingDone()
                        _isAwaitingResponse.value = false
                        _activityLabel.value = "Assistant is thinking"
                        _generationStartedAt.value = null
                        // Send sentinel — drain coroutine will mark isStreaming = false once buffer is empty
                        streamBuffer.send(null)
                        // Optimistic finalization: immediately re-fetch so tool calls persisted by the
                        // desktop appear without a hardcoded delay.
                        viewModelScope.launch {
                            historyLoaded = false
                            wsClient.send("conversation:get-messages", mapOf("conversationId" to conversationId))
                        }
                    }
                    event is WsEvent.ChatCost && event.conversationId == conversationId -> {
                        WsRepository.sendLog("VM", "ChatCost: in=${event.inputTokens} out=${event.outputTokens}")
                        val current = _messages.value
                        val lastAssistantIdx = current.indexOfLast { !it.isUser && !it.isToolCall }
                        if (lastAssistantIdx >= 0) {
                            _messages.value = current.toMutableList().also { list ->
                                list[lastAssistantIdx] = list[lastAssistantIdx].copy(
                                    inputTokens = event.inputTokens,
                                    outputTokens = event.outputTokens,
                                )
                            }
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    fun addAttachment(name: String, mimeType: String, dataUrl: String?, textContent: String?) {
        _attachments.value = _attachments.value + PendingAttachment(
            id = UUID.randomUUID().toString(),
            name = name,
            mimeType = mimeType,
            dataUrl = dataUrl,
            textContent = textContent,
            isImage = mimeType.startsWith("image/"),
        )
    }

    fun removeAttachment(id: String) {
        _attachments.value = _attachments.value.filter { it.id != id }
    }

    fun refreshMessages() {
        _isRefreshing.value = true
        historyLoaded = false
        wsClient.send("conversation:get-messages", mapOf("conversationId" to conversationId))
    }

    fun loadModel(model: String?) {
        val normalized = model?.takeIf { it.isNotBlank() && it != "default" }
        WsRepository.sendLog("ChatSend", "loadModel: raw=${model ?: "null"} normalized=${normalized ?: "null(desktop default)"}")
        _selectedModel.value = normalized
    }

    fun setModel(model: String?) {
        val normalized = model?.takeIf { it.isNotBlank() && it != "default" }
        WsRepository.sendLog("ChatSend", "setModel: raw=${model ?: "null"} normalized=${normalized ?: "null(desktop default)"} conv=$conversationId")
        _selectedModel.value = normalized
        wsClient.send(
            "conversation:set-model",
            mapOf(
                "conversationId" to conversationId,
                "model" to (normalized ?: "default"),
            ),
        )
    }

    fun sendMessage(text: String) {
        val atts = _attachments.value
        if (text.isBlank() && atts.isEmpty()) return
        _attachments.value = emptyList()

        val textAtts = atts.filter { !it.isImage }
        val imageAtts = atts.filter { it.isImage }

        var augmented = text
        if (textAtts.isNotEmpty()) {
            val fileContext = textAtts.joinToString("\n") { "File: ${it.name}\n```\n${it.textContent.orEmpty()}\n```\n" }
            augmented = if (text.isBlank()) fileContext.trimEnd() else "$fileContext$text"
        }

        val optimisticMessage = ChatMessage(
            text = if (augmented.isBlank() && imageAtts.isNotEmpty()) "" else augmented,
            isUser = true,
            isStreaming = false,
            attachments = imageAtts.map { AttachmentMeta(id = it.id, name = it.name, type = "image", thumbnailDataUrl = null) },
        )
        _messages.value = _messages.value + optimisticMessage
        _isAwaitingResponse.value = true
        _activityLabel.value = "Assistant is thinking"
        _liveThinkingBlocks.value = emptyList()
        _generationStartedAt.value = System.currentTimeMillis()
        streamCompleted = false
        isStreamEnded = false

        val connState = if (wsClient === WsRepository) WsRepository.connectionState.value else null
        WsRepository.sendLog("ChatSend", "pre-send: conv=$conversationId connState=$connState selectedModel=${_selectedModel.value ?: "none(will use desktop default)"} agentId=${agentId ?: "none"} projectId=${projectId ?: "none"} hasImages=${imageAtts.isNotEmpty()} textLen=${augmented.length}")

        if (wsClient === WsRepository && connState != ConnectionState.CONNECTED) {
            val msgs = _messages.value
            _messages.value = msgs.dropLast(1) + msgs.last().copy(sendFailed = true)
            _isAwaitingResponse.value = false
            WsRepository.sendLog("ChatSend", "BLOCKED: not connected — connState=$connState")
            _sendError.value = "Message could not be delivered — not connected to desktop."
            return
        }

        val data = buildMap<String, Any> {
            put("conversationId", conversationId)
            put("content", augmented)
            if (agentId != null) put("agentId", agentId)
            if (projectId != null) put("projectId", projectId)
            _selectedModel.value?.let { put("model", it) }
            if (imageAtts.isNotEmpty()) {
                put("images", imageAtts.map { mapOf("id" to it.id, "name" to it.name, "dataUrl" to it.dataUrl.orEmpty()) })
            }
        }
        if (wsClient === WsRepository) WsRepository.markConversationPending(conversationId)
        WsRepository.sendLog("ChatSend", "chat:send-message conv=$conversationId model=${data["model"] ?: "none(desktop default)"} agentId=${data["agentId"] ?: "none"} projectId=${data["projectId"] ?: "none"} payloadKeys=${data.keys.joinToString(",")}")
        wsClient.send("chat:send-message", data)
    }

    fun stopStream() {
        wsClient.send("agent:stop", mapOf("conversationId" to conversationId))
        _isAwaitingResponse.value = false
        _activityLabel.value = "Assistant is thinking"
        _liveThinkingBlocks.value = emptyList()
        _generationStartedAt.value = null
        // Drain any buffered chunks immediately, then mark done
        val buffered = buildString {
            while (true) {
                val r = streamBuffer.tryReceive()
                val v = r.getOrNull() ?: break
                append(v)
            }
        }
        val current = _messages.value
        val streamingIdx = current.indexOfLast { it.isStreaming }
        if (streamingIdx >= 0) {
            _messages.value = current.toMutableList().also { list ->
                list[streamingIdx] = list[streamingIdx].copy(
                    text = list[streamingIdx].text + buffered,
                    isStreaming = false,
                )
            }
        }
        _isStreaming.value = false
    }

    fun clearSendError() { _sendError.value = null }

    fun deleteMessage(messageId: String) {
        _messages.value = _messages.value.filter { it.id != messageId }
        wsClient.send("message:delete", mapOf("id" to messageId))
    }

    fun deleteMessagesAfter(conversationId: String, timestamp: Long) {
        _messages.value = _messages.value.filter { it.timestamp < timestamp }
        wsClient.send("message:delete-after", mapOf("conversationId" to conversationId, "timestamp" to timestamp))
    }

    private fun markAllLiveThinkingDone() {
        val current = _liveThinkingBlocks.value
        if (current.isEmpty()) return
        _liveThinkingBlocks.value = current.map { it.copy(done = true) }
    }

    private fun appendLiveThinking(blockId: String, chunk: String) {
        if (blockId.isBlank() || chunk.isEmpty()) return
        val current = _liveThinkingBlocks.value
        val index = current.indexOfFirst { it.blockId == blockId }
        _liveThinkingBlocks.value = if (index >= 0) {
            current.toMutableList().also { list ->
                val existing = list[index]
                list[index] = existing.copy(content = existing.content + chunk, done = false)
            }
        } else {
            current + ThinkingBlock(blockId = blockId, content = chunk, done = false)
        }
    }

}
