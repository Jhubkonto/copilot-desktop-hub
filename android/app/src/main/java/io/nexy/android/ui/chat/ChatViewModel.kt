package io.nexy.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
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
    val attachmentNames: List<String> = emptyList(),
)

class ChatViewModel(private val conversationId: String) : ViewModel() {

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages

    private val _isStreaming = MutableStateFlow(false)
    val isStreaming: StateFlow<Boolean> = _isStreaming

    private val _attachments = MutableStateFlow<List<PendingAttachment>>(emptyList())
    val attachments: StateFlow<List<PendingAttachment>> = _attachments

    private var historyLoaded = false

    init {
        WsRepository.send("conversation:get-messages", mapOf("conversationId" to conversationId))
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when {
                    event is WsEvent.ConversationMessages && event.conversationId == conversationId -> {
                        if (!historyLoaded) {
                            historyLoaded = true
                            _messages.value = event.messages.map { msg ->
                                ChatMessage(text = msg.content, isUser = msg.role == "user", isStreaming = false)
                            }
                        }
                    }
                    event is WsEvent.ChatStreamChunk && event.conversationId == conversationId -> {
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
            attachmentNames = imageAtts.map { it.name },
        )

        val data = buildMap<String, Any> {
            put("conversationId", conversationId)
            put("content", augmented)
            if (imageAtts.isNotEmpty()) {
                put("images", imageAtts.map { mapOf("id" to it.id, "name" to it.name, "dataUrl" to it.dataUrl.orEmpty()) })
            }
        }
        WsRepository.send("chat:send-message", data)
    }

    fun stopStream() {
        WsRepository.send("agent:stop", mapOf("conversationId" to conversationId))
        _isStreaming.value = false
    }
}
