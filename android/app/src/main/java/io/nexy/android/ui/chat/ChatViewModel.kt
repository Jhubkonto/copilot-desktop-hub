package io.nexy.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID

data class PendingAttachment(
    val id: String,
    val name: String,
    val mimeType: String,
    val dataUrl: String?,
    val textContent: String?,
    val isImage: Boolean,
)

data class ChatMessage(
    val text: String,
    val isUser: Boolean,
    val isStreaming: Boolean,
    val attachments: List<AttachmentMeta> = emptyList(),
    val isToolCall: Boolean = false,
    val toolName: String? = null,
    val serverName: String? = null,
    val toolArgs: String? = null,
    val toolResult: String? = null,
    val toolSuccess: Boolean = true,
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

    private val _attachments = MutableStateFlow<List<PendingAttachment>>(emptyList())
    val attachments: StateFlow<List<PendingAttachment>> = _attachments

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing

    private val _selectedModel = MutableStateFlow<String?>(null)
    val selectedModel: StateFlow<String?> = _selectedModel

    private var historyLoaded = false

    init {
        refreshMessages()
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when {
                    event is WsEvent.ConversationMessages && event.conversationId == conversationId -> {
                        if (!historyLoaded) {
                            historyLoaded = true
                            _isRefreshing.value = false
                            _messages.value = event.messages.map { msg -> msg.toChatMessage() }
                        }
                    }
                    event is WsEvent.ChatActivity && event.conversationId == conversationId -> {
                        if (event.state == "complete" || event.state == "error") {
                            _isAwaitingResponse.value = false
                            _activityLabel.value = "Assistant is thinking"
                        } else {
                            _activityLabel.value = event.label.ifBlank { "Assistant is thinking" }
                            if (!_isStreaming.value) _isAwaitingResponse.value = true
                        }
                    }
                    event is WsEvent.ChatStreamChunk && event.conversationId == conversationId -> {
                        _isAwaitingResponse.value = false
                        _activityLabel.value = "Assistant is thinking"
                        _isStreaming.value = true
                        val current = _messages.value
                        if (current.lastOrNull()?.isStreaming == true) {
                            _messages.value = current.dropLast(1) + current.last().copy(
                                text = current.last().text + event.text
                            )
                        } else {
                            _messages.value = current + ChatMessage(text = event.text, isUser = false, isStreaming = true)
                        }
                    }
                    event is WsEvent.ChatStreamEnd && event.conversationId == conversationId -> {
                        _isAwaitingResponse.value = false
                        _activityLabel.value = "Assistant is thinking"
                        _isStreaming.value = false
                        val current = _messages.value
                        if (current.lastOrNull()?.isStreaming == true) {
                            _messages.value = current.dropLast(1) + current.last().copy(isStreaming = false)
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

        _messages.value = _messages.value + ChatMessage(
            text = if (augmented.isBlank() && imageAtts.isNotEmpty()) "" else augmented,
            isUser = true,
            isStreaming = false,
            attachments = imageAtts.map { AttachmentMeta(id = it.id, name = it.name, type = "image", thumbnailDataUrl = null) },
        )
        _isAwaitingResponse.value = true
        _activityLabel.value = "Assistant is thinking"

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
        wsClient.send("chat:send-message", data)
    }

    fun stopStream() {
        wsClient.send("agent:stop", mapOf("conversationId" to conversationId))
        _isAwaitingResponse.value = false
        _activityLabel.value = "Assistant is thinking"
        _isStreaming.value = false
    }

    private fun io.nexy.android.data.model.HistoryMessage.toChatMessage(): ChatMessage {
        if (role != "tool-call") {
            return ChatMessage(
                text = content,
                isUser = role == "user",
                isStreaming = false,
                attachments = attachments,
            )
        }

        return runCatching {
            ChatMessage(
                text = jsonString(content, "toolResult").orEmpty(),
                isUser = false,
                isStreaming = false,
                isToolCall = true,
                toolName = jsonString(content, "toolName"),
                serverName = jsonString(content, "serverName"),
                toolArgs = jsonObject(content, "toolArgs"),
                toolResult = jsonString(content, "toolResult").orEmpty(),
                toolSuccess = jsonBoolean(content, "toolSuccess") ?: true,
            )
        }.getOrElse {
            ChatMessage(
                text = content,
                isUser = false,
                isStreaming = false,
                isToolCall = true,
                toolName = "Tool call",
                toolResult = content,
            )
        }
    }

    private fun jsonString(json: String, key: String): String? {
        val pattern = """"$key"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
        return pattern.find(json)?.groupValues?.getOrNull(1)
            ?.replace("\\\"", "\"")
            ?.replace("\\n", "\n")
            ?.replace("\\\\", "\\")
            ?.takeIf { it.isNotBlank() }
    }

    private fun jsonBoolean(json: String, key: String): Boolean? {
        val pattern = """"$key"\s*:\s*(true|false)""".toRegex()
        return pattern.find(json)?.groupValues?.getOrNull(1)?.toBooleanStrictOrNull()
    }

    private fun jsonObject(json: String, key: String): String? {
        val keyMatch = """"$key"\s*:\s*\{""".toRegex().find(json) ?: return null
        val start = keyMatch.range.last
        var depth = 0
        var inString = false
        var escaped = false
        for (i in start until json.length) {
            val ch = json[i]
            if (escaped) {
                escaped = false
                continue
            }
            if (ch == '\\' && inString) {
                escaped = true
                continue
            }
            if (ch == '"') inString = !inString
            if (inString) continue
            if (ch == '{') depth++
            if (ch == '}') {
                depth--
                if (depth == 0) return json.substring(start, i + 1)
            }
        }
        return null
    }
}
