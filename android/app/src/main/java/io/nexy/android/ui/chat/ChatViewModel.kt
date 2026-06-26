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
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.launch
import java.util.UUID

private const val STREAM_CHARS_PER_TICK = 60
private const val STREAM_TICK_MS = 16L
private const val ACTIVE_HISTORY_POLL_MS = 2_500L
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

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModel(
    private val conversationId: String,
    private val wsClient: WsClient = WsRepository,
    private val agentId: String? = null,
    private val projectId: String? = null,
) : ViewModel() {

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _liveTurnState = MutableStateFlow(emptyChatTurnState(conversationId))
    val liveTurnState: StateFlow<ChatTurnState> = _liveTurnState

    // True while the drain coroutine has not yet finished rendering buffered chunks.
    // Set to true on first chunk, cleared by drain finalizer.
    private val _drainActive = MutableStateFlow(false)

    // isStreaming: true while the typewriter drain is active (cursor shown in message bubble).
    // Combining drainActive with Streaming status handles the gap between status update and drain start.
    val isStreaming: StateFlow<Boolean> = combine(_liveTurnState, _drainActive) { state, drain ->
        drain || state.status == ChatTurnStatus.Streaming
    }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    // isAwaitingResponse: true while waiting for first token (Active) but NOT while streaming text.
    // The thinking bubble shows when Active; hides when Streaming or Idle/Completed/Failed.
    val isAwaitingResponse: StateFlow<Boolean> = combine(_liveTurnState, _drainActive) { state, drain ->
        state.status == ChatTurnStatus.Active && !drain
    }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val activityLabel: StateFlow<String> = _liveTurnState.map { state ->
        state.activity?.label?.takeIf { it.isNotBlank() } ?: "Assistant is thinking"
    }.stateIn(viewModelScope, SharingStarted.Eagerly, "Assistant is thinking")

    val liveThinkingBlocks: StateFlow<List<ThinkingBlock>> = _liveTurnState.map { state ->
        state.thinkingBlocks
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val generationStartedAt: StateFlow<Long?> = _liveTurnState.map { state ->
        state.generationStartedAt
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

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

    // Buffer incoming stream chunks; drain coroutine emits to _messages at a fixed rate.
    // null sentinel signals end-of-stream so the drain coroutine can clear isStreaming.
    private val streamBuffer = Channel<String?>(Channel.UNLIMITED)
    private var activeHistoryPollJob: Job? = null

    private val isTurnTerminal: Boolean
        get() = _liveTurnState.value.status == ChatTurnStatus.Completed ||
                _liveTurnState.value.status == ChatTurnStatus.Failed

    init {
        refreshMessages()
        // Drain coroutine: consume buffer at ~60 chars per 16ms frame.
        // streamEndPending defers _drainActive=false until the last queued chunk finishes rendering.
        viewModelScope.launch {
            var streamEndPending = false
            fun finalizeRenderedStream() {
                val current = _messages.value
                val streamingIdx = current.indexOfLast { it.isStreaming }
                val thinkingSnapshot = _liveTurnState.value.thinkingBlocks
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
                // Clear live thinking blocks after committing them to the message
                _liveTurnState.value = _liveTurnState.value.copy(thinkingBlocks = emptyList())
                _drainActive.value = false
                streamEndPending = false
            }
            for (chunk in streamBuffer) {
                if (chunk == null) {
                    // Null sentinel signals end-of-stream. Defer the drain-active clear until
                    // after the last real chunk's while-loop finishes so the cursor stays visible.
                    streamEndPending = true
                    if (streamBuffer.isEmpty) {
                        finalizeRenderedStream()
                    }
                    continue
                }
                // Large chunks skip the typewriter drip to avoid hundreds of rapid recompositions
                if (chunk.length >= LARGE_CHUNK_THRESHOLD) {
                    val current = _messages.value
                    val streamingIdx = current.indexOfLast { it.isStreaming }
                    if (streamingIdx >= 0) {
                        _messages.value = current.toMutableList().also { list ->
                            list[streamingIdx] = list[streamingIdx].copy(text = list[streamingIdx].text + chunk)
                        }
                    } else {
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
                            _messages.value = current + ChatMessage(text = slice, isUser = false, isStreaming = true)
                        }
                        if (remaining.isNotEmpty()) delay(STREAM_TICK_MS)
                    }
                }
                // After the last chunk's characters are rendered, clear streaming state.
                // Transfer thinkingBlocks from liveTurnState into the message so thinking content
                // stays visible during the 400ms gap before the history re-fetch completes.
                if (streamEndPending && streamBuffer.isEmpty) {
                    finalizeRenderedStream()
                }
            }
        }
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when {
                    event is WsEvent.ConversationMessages && event.conversationId == conversationId -> {
                        val mapped = event.messages.map { msg -> msg.toChatMessage() }
                        val historyHasAssistantResponse = mapped.lastOrNull { !it.isToolCall }?.isUser == false
                        val turnTerminal = isTurnTerminal
                        val shouldApplyHistory =
                            !historyLoaded ||
                            _isRefreshing.value ||
                            isAwaitingResponse.value ||
                            _drainActive.value ||
                            historyHasAssistantResponse

                        if (shouldApplyHistory) {
                            historyLoaded = true
                            _isRefreshing.value = false
                            if (historyHasAssistantResponse) {
                                _liveTurnState.value = emptyChatTurnState(conversationId)
                                _drainActive.value = false
                                stopActiveHistoryPolling()
                                WsRepository.clearConversationActiveState(conversationId)
                            }

                            // Restore in-progress state from the WsRepository snapshot if the chat
                            // is still active (user left and re-entered while the desktop was busy).
                            val snapshot = WsRepository.activeChatSnapshots.value[conversationId]
                            val isDesktopActive = conversationId in WsRepository.activeConversationIds.value
                            if (!historyHasAssistantResponse && snapshot != null && isDesktopActive && !turnTerminal) {
                                // Replay snapshot into liveTurnState so derived flows pick up activity/thinking
                                _liveTurnState.value = _liveTurnState.value.copy(
                                    status = ChatTurnStatus.Active,
                                    activity = ChatTurnActivity(
                                        state = "thinking",
                                        label = snapshot.activityLabel,
                                    ),
                                    thinkingBlocks = snapshot.liveThinkingBlocks,
                                    generationStartedAt = snapshot.generationStartedAt.takeIf { it > 0L },
                                    toolCalls = snapshot.completedToolCalls.map { tc ->
                                        ChatTurnToolCall(
                                            toolName = tc.toolName,
                                            serverName = tc.serverName,
                                            argsJson = tc.args,
                                            result = tc.result ?: "",
                                            success = tc.success,
                                        )
                                    },
                                )
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
                                // Only restore the awaiting indicator when the desktop is confirmed active
                                // for this conversation. Checking activeConversationIds prevents a glitched
                                // chat (where no activity ever arrived) from showing a perpetual spinner.
                                if (mapped.isNotEmpty() && mapped.last().isUser && !_drainActive.value && isDesktopActive && !turnTerminal) {
                                    _liveTurnState.value = _liveTurnState.value.copy(status = ChatTurnStatus.Active)
                                }
                                // Clean up any stale snapshot so re-entry doesn't restore false busy-state
                                if (!isDesktopActive || turnTerminal || historyHasAssistantResponse) {
                                    WsRepository.clearConversationActiveState(conversationId)
                                }
                            }
                            if (!historyHasAssistantResponse && (isAwaitingResponse.value || _drainActive.value) && !turnTerminal) {
                                startActiveHistoryPolling()
                            }
                        }
                    }
                    event is WsEvent.ChatTurnEvent && event.conversationId == conversationId -> {
                        _liveTurnState.value = reduceChatTurn(_liveTurnState.value, event)
                    }
                    event is WsEvent.ChatActivity && event.conversationId == conversationId -> {
                        if (event.state == "complete" || event.state == "error") {
                            if (!isTurnTerminal) {
                                _liveTurnState.value = _liveTurnState.value.copy(
                                    status = if (event.state == "complete") ChatTurnStatus.Completed else ChatTurnStatus.Failed,
                                    thinkingBlocks = emptyList(),
                                    pendingThinkingEnds = emptySet(),
                                    activity = null,
                                    generationStartedAt = null,
                                )
                            }
                            stopActiveHistoryPolling()
                            viewModelScope.launch {
                                historyLoaded = false
                                wsClient.send("conversation:get-messages", mapOf("conversationId" to conversationId))
                            }
                        } else if (!isTurnTerminal) {
                            _liveTurnState.value = _liveTurnState.value.copy(
                                status = if (_liveTurnState.value.status == ChatTurnStatus.Streaming)
                                    ChatTurnStatus.Streaming else ChatTurnStatus.Active,
                                activity = ChatTurnActivity(
                                    state = event.state,
                                    label = event.label.ifBlank { "Assistant is thinking" },
                                ),
                                generationStartedAt = _liveTurnState.value.generationStartedAt
                                    ?: System.currentTimeMillis(),
                            )
                            startActiveHistoryPolling()
                        }
                    }
                    event is WsEvent.ChatToolCallEvent && event.conversationId == conversationId -> {
                        // Clear thinking from live state — tool call starts a new thinking cycle.
                        _liveTurnState.value = _liveTurnState.value.copy(
                            thinkingBlocks = emptyList(),
                            pendingThinkingEnds = emptySet(),
                        )
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
                    }
                    event is WsEvent.ChatTeamActivity && event.conversationId == conversationId -> {
                        val title = listOf(event.agentIcon, event.agentName).filter { it.isNotBlank() }.joinToString(" ")
                        val result = event.result?.takeIf { it.isNotBlank() }
                            ?: when (event.status) {
                                "delegating" -> "Working on: ${event.task}"
                                "error" -> "Team activity failed."
                                else -> event.task
                            }
                        val teamMessage = ChatMessage(
                            id = event.stepId.ifBlank { UUID.randomUUID().toString() },
                            text = "",
                            isUser = false,
                            isStreaming = event.status == "delegating",
                            isToolCall = true,
                            toolName = title.ifBlank { "Team activity" },
                            serverName = "Team activity",
                            toolArgs = event.task.takeIf { it.isNotBlank() },
                            toolResult = result,
                            toolSuccess = event.status != "error",
                        )
                        val current = _messages.value
                        val idx = current.indexOfFirst { it.id == teamMessage.id }
                        _messages.value = if (idx >= 0) {
                            current.toMutableList().also { it[idx] = teamMessage }
                        } else {
                            current + teamMessage
                        }
                    }
                    event is WsEvent.ChatStreamChunk && event.conversationId == conversationId -> {
                        stopActiveHistoryPolling()
                        if (!_drainActive.value) {
                            _drainActive.value = true
                        }
                        _liveTurnState.value = _liveTurnState.value.copy(
                            status = ChatTurnStatus.Streaming,
                            activity = null,
                        )
                        streamBuffer.send(event.text)
                    }
                    event is WsEvent.ChatStreamEnd && event.conversationId == conversationId -> {
                        _liveTurnState.value = _liveTurnState.value.copy(
                            status = ChatTurnStatus.Completed,
                            thinkingBlocks = _liveTurnState.value.thinkingBlocks.map { it.copy(done = true) },
                            pendingThinkingEnds = emptySet(),
                            generationStartedAt = null,
                        )
                        stopActiveHistoryPolling()
                        // Null sentinel triggers drain finalization
                        streamBuffer.send(null)
                        // Optimistic finalization: immediately re-fetch so tool calls persisted by the
                        // desktop appear without a hardcoded delay.
                        viewModelScope.launch {
                            historyLoaded = false
                            wsClient.send("conversation:get-messages", mapOf("conversationId" to conversationId))
                        }
                    }
                    event is WsEvent.ChatCost && event.conversationId == conversationId -> {
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
        _liveTurnState.value = _liveTurnState.value.copy(thinkingBlocks = emptyList(), generationStartedAt = null)
        wsClient.send("conversation:get-messages", mapOf("conversationId" to conversationId))
    }

    fun loadModel(model: String?) {
        _selectedModel.value = model?.takeIf { it.isNotBlank() && it != "default" }
    }

    fun setModel(model: String?) {
        val normalized = model?.takeIf { it.isNotBlank() && it != "default" }
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
        _liveTurnState.value = emptyChatTurnState(conversationId).copy(
            status = ChatTurnStatus.Active,
            generationStartedAt = System.currentTimeMillis(),
        )
        startActiveHistoryPolling()

        val connState = if (wsClient === WsRepository) WsRepository.connectionState.value else null
        if (wsClient === WsRepository && connState != ConnectionState.CONNECTED) {
            val msgs = _messages.value
            _messages.value = msgs.dropLast(1) + msgs.last().copy(sendFailed = true)
            _liveTurnState.value = emptyChatTurnState(conversationId)
            stopActiveHistoryPolling()
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
        wsClient.send("chat:send-message", data)
    }

    fun stopStream() {
        wsClient.send("agent:stop", mapOf("conversationId" to conversationId))
        _liveTurnState.value = _liveTurnState.value.copy(
            status = ChatTurnStatus.Completed,
            thinkingBlocks = emptyList(),
            generationStartedAt = null,
            activity = null,
        )
        stopActiveHistoryPolling()
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
        _drainActive.value = false
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

    private fun startActiveHistoryPolling() {
        if (activeHistoryPollJob?.isActive == true) return
        activeHistoryPollJob = viewModelScope.launch {
            delay(ACTIVE_HISTORY_POLL_MS)
            activeHistoryPollJob = null
            if (isTurnTerminal || (!isAwaitingResponse.value && !_drainActive.value)) return@launch
            historyLoaded = false
            wsClient.send("conversation:get-messages", mapOf("conversationId" to conversationId))
        }
    }

    private fun stopActiveHistoryPolling() {
        activeHistoryPollJob?.cancel()
        activeHistoryPollJob = null
    }

}

