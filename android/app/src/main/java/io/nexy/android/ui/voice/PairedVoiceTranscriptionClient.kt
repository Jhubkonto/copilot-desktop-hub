package io.nexy.android.ui.voice

import io.nexy.android.data.WsClient
import io.nexy.android.data.model.WsEvent
import java.io.Closeable
import java.util.Base64
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

sealed interface VoiceTranscriptionState {
    data object Idle : VoiceTranscriptionState
    data object Starting : VoiceTranscriptionState
    data class Uploading(val sessionId: String, val sentBytes: Long) : VoiceTranscriptionState
    data class Transcribing(val sessionId: String) : VoiceTranscriptionState
    data class Complete(val text: String) : VoiceTranscriptionState
    data class Cancelled(val sessionId: String?) : VoiceTranscriptionState
    data class Error(val code: String, val message: String) : VoiceTranscriptionState
}

/**
 * Streams recorder-owned PCM to the already authenticated Nexy WebSocket.
 *
 * A recording may begin before the desktop acknowledges the upload session, so
 * early chunks are held briefly and flushed in order after `voice:upload-started`.
 */
class PairedVoiceTranscriptionClient(
    private val wsClient: WsClient,
    scope: CoroutineScope,
) : Closeable {
    private val pendingChunks = ArrayDeque<ByteArray>()
    private val _state = MutableStateFlow<VoiceTranscriptionState>(VoiceTranscriptionState.Idle)
    val state: StateFlow<VoiceTranscriptionState> = _state
    private val eventJob: Job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
        wsClient.events.collect(::onEvent)
    }
    private var sessionId: String? = null
    private var nextSequence = 0
    private var sentBytes = 0L
    private var maxBytes = DEFAULT_MAX_BYTES
    private var finishRequested = false

    @Synchronized
    fun begin() {
        sessionId?.let { wsClient.send("voice:upload-cancel", mapOf("sessionId" to it)) }
        reset()
        _state.value = VoiceTranscriptionState.Starting
        wsClient.send("voice:upload-start")
    }

    @Synchronized
    fun appendPcm(chunk: ByteArray) {
        if (chunk.isEmpty() || chunk.size > CHUNK_BYTES) {
            sessionId?.let { wsClient.send("voice:upload-cancel", mapOf("sessionId" to it)) }
            fail("invalid-chunk", "Voice recorder produced an invalid audio chunk.")
            return
        }
        when (_state.value) {
            VoiceTranscriptionState.Starting -> {
                if (pendingChunks.sumOf { it.size.toLong() } + chunk.size > MAX_PENDING_BYTES) {
                    fail("desktop-timeout", "Desktop did not start voice upload in time.")
                } else {
                    pendingChunks.addLast(chunk.copyOf())
                }
            }
            is VoiceTranscriptionState.Uploading -> sendChunk(chunk)
            else -> Unit
        }
    }

    @Synchronized
    fun finish() {
        when (_state.value) {
            VoiceTranscriptionState.Starting -> finishRequested = true
            is VoiceTranscriptionState.Uploading -> sendFinish()
            else -> Unit
        }
    }

    @Synchronized
    fun cancel() {
        val activeId = sessionId
        if (activeId != null) {
            wsClient.send("voice:upload-cancel", mapOf("sessionId" to activeId))
        }
        pendingChunks.clear()
        _state.value = VoiceTranscriptionState.Cancelled(activeId)
        sessionId = null
    }

    override fun close() {
        cancel()
        eventJob.cancel()
    }

    @Synchronized
    private fun onEvent(event: WsEvent) {
        when (event) {
            is WsEvent.VoiceUploadStarted -> {
                if (_state.value != VoiceTranscriptionState.Starting) return
                sessionId = event.sessionId
                maxBytes = event.maxBytes
                _state.value = VoiceTranscriptionState.Uploading(event.sessionId, 0)
                while (pendingChunks.isNotEmpty()) sendChunk(pendingChunks.removeFirst())
                if (finishRequested) sendFinish()
            }
            is WsEvent.VoiceUploadAck -> {
                if (event.sessionId != sessionId || _state.value !is VoiceTranscriptionState.Uploading) return
                _state.value = VoiceTranscriptionState.Uploading(event.sessionId, event.receivedBytes)
            }
            is WsEvent.VoiceTranscription -> {
                if (event.sessionId != sessionId) return
                _state.value = VoiceTranscriptionState.Complete(event.text)
                sessionId = null
            }
            is WsEvent.VoiceUploadCancelled -> {
                if (event.sessionId != sessionId) return
                _state.value = VoiceTranscriptionState.Cancelled(event.sessionId)
                sessionId = null
            }
            is WsEvent.VoiceUploadError -> {
                if (event.sessionId != null && event.sessionId != sessionId) return
                fail(event.code, event.message)
            }
            else -> Unit
        }
    }

    private fun sendChunk(chunk: ByteArray) {
        val activeId = sessionId ?: return
        if (sentBytes + chunk.size > maxBytes) {
            wsClient.send("voice:upload-cancel", mapOf("sessionId" to activeId))
            fail("duration-limit", "Voice recording reached its ten-minute safety limit.")
            return
        }
        wsClient.send(
            "voice:upload-chunk",
            mapOf(
                "sessionId" to activeId,
                "sequence" to nextSequence,
                "dataBase64" to Base64.getEncoder().encodeToString(chunk),
            ),
        )
        nextSequence += 1
        sentBytes += chunk.size
        _state.value = VoiceTranscriptionState.Uploading(activeId, sentBytes)
    }

    private fun sendFinish() {
        val activeId = sessionId ?: return
        finishRequested = false
        _state.value = VoiceTranscriptionState.Transcribing(activeId)
        wsClient.send("voice:upload-finish", mapOf("sessionId" to activeId))
    }

    private fun fail(code: String, message: String) {
        pendingChunks.clear()
        sessionId = null
        _state.value = VoiceTranscriptionState.Error(code, message)
    }

    private fun reset() {
        pendingChunks.clear()
        sessionId = null
        nextSequence = 0
        sentBytes = 0
        maxBytes = DEFAULT_MAX_BYTES
        finishRequested = false
    }

    companion object {
        const val CHUNK_BYTES = 32 * 1024
        const val DEFAULT_MAX_BYTES = 16_000L * 2 * 10 * 60
        private const val MAX_PENDING_BYTES = CHUNK_BYTES * 8L
    }
}
