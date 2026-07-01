package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

data class ChatAnimationState(
    val turnId: String? = null,
    val authoritativeText: String = "",
    val displayedText: String = "",
    val lastSequence: Long = 0L,
    val terminal: Boolean = false,
) {
    val backlogLength: Int get() = authoritativeText.length - displayedText.length
}

/**
 * Process-memory animation state. It deliberately persists no chat content to disk:
 * navigation keeps the controller alive, while process restart restores from desktop.
 */
object ChatAnimationRepository {
    private const val FRAME_MS = 16L
    private const val TARGET_CATCH_UP_MS = 750L
    private const val MIN_CHARS_PER_FRAME = 12
    private const val MAX_CHARS_PER_FRAME = 320

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val states = mutableMapOf<String, MutableStateFlow<ChatAnimationState>>()
    private val drainJobs = mutableMapOf<String, Job>()

    @Synchronized
    fun observe(conversationId: String): StateFlow<ChatAnimationState> =
        states.getOrPut(conversationId) { MutableStateFlow(ChatAnimationState()) }.asStateFlow()

    fun accept(event: WsEvent.ChatTurnEvent) {
        val flow = synchronized(this) {
            states.getOrPut(event.conversationId) { MutableStateFlow(ChatAnimationState()) }
        }
        val current = flow.value
        if (event.type == "turn_started") {
            flow.value = ChatAnimationState(turnId = event.turnId, lastSequence = event.sequence)
            return
        }
        if (current.turnId != null && current.turnId != event.turnId) return
        if (event.sequence <= current.lastSequence) return
        when (event.type) {
            "assistant_text_delta" -> {
                val chunk = JSONObject(event.payloadJson).optString("chunk", "")
                flow.value = current.copy(
                    turnId = event.turnId,
                    authoritativeText = current.authoritativeText + chunk,
                    lastSequence = event.sequence,
                )
                ensureDrain(event.conversationId, flow)
            }
            "turn_completed", "turn_failed" -> {
                flow.value = current.copy(
                    turnId = event.turnId,
                    displayedText = current.authoritativeText,
                    lastSequence = event.sequence,
                    terminal = true,
                )
                drainJobs.remove(event.conversationId)?.cancel()
            }
            else -> flow.value = current.copy(turnId = event.turnId, lastSequence = event.sequence)
        }
    }

    fun restore(snapshot: WsEvent.ChatActiveTurnSnapshot) {
        val flow = synchronized(this) {
            states.getOrPut(snapshot.conversationId) { MutableStateFlow(ChatAnimationState()) }
        }
        val current = flow.value
        if (current.turnId == snapshot.turnId && current.lastSequence >= snapshot.latestSequence) return
        // Re-entry/cold reconnect policy: accumulated desktop text is immediately visible.
        flow.value = ChatAnimationState(
            turnId = snapshot.turnId,
            authoritativeText = snapshot.assistantText,
            displayedText = snapshot.assistantText,
            lastSequence = snapshot.latestSequence,
            terminal = snapshot.status != "active",
        )
    }

    fun clear(conversationId: String) {
        synchronized(this) { states.remove(conversationId) }
        drainJobs.remove(conversationId)?.cancel()
    }

    private fun ensureDrain(conversationId: String, flow: MutableStateFlow<ChatAnimationState>) {
        if (drainJobs[conversationId]?.isActive == true) return
        drainJobs[conversationId] = scope.launch {
            while (true) {
                val current = flow.value
                val backlog = current.backlogLength
                if (backlog <= 0 || current.terminal) break
                val frames = max(1.0, TARGET_CATCH_UP_MS.toDouble() / FRAME_MS)
                val frameSize = min(
                    backlog,
                    min(MAX_CHARS_PER_FRAME, max(MIN_CHARS_PER_FRAME, ceil(backlog / frames).toInt())),
                )
                val offset = current.displayedText.length + frameSize
                flow.value = current.copy(displayedText = current.authoritativeText.take(offset))
                delay(FRAME_MS)
            }
            drainJobs.remove(conversationId)
        }
    }
}
