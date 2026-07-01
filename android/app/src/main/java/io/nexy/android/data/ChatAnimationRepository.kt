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
    val revealLagMs: Long = 0L,
    val droppedDuplicateEvents: Long = 0L,
    val sequenceGaps: Long = 0L,
    val snapshotRecoveries: Long = 0L,
    val oldestPendingAt: Long? = null,
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

    @Synchronized
    fun accept(event: WsEvent.ChatTurnEvent) {
        val flow = states.getOrPut(event.conversationId) { MutableStateFlow(ChatAnimationState()) }
        val current = flow.value
        if (event.type == "turn_started") {
            flow.value = ChatAnimationState(turnId = event.turnId, lastSequence = event.sequence)
            return
        }
        if (current.turnId != null && current.turnId != event.turnId) return
        if (event.sequence <= current.lastSequence) {
            flow.value = current.copy(droppedDuplicateEvents = current.droppedDuplicateEvents + 1)
            return
        }
        val sequenceGaps = current.sequenceGaps +
            if (current.lastSequence > 0L && event.sequence > current.lastSequence + 1L) 1 else 0
        when (event.type) {
            "assistant_text_delta" -> {
                val chunk = JSONObject(event.payloadJson).optString("chunk", "")
                flow.value = current.copy(
                    turnId = event.turnId,
                    authoritativeText = current.authoritativeText + chunk,
                    lastSequence = event.sequence,
                    sequenceGaps = sequenceGaps,
                    oldestPendingAt = current.oldestPendingAt ?: System.currentTimeMillis(),
                )
                ensureDrain(event.conversationId, flow)
            }
            "turn_completed", "turn_failed" -> {
                flow.value = current.copy(
                    turnId = event.turnId,
                    displayedText = current.authoritativeText,
                    lastSequence = event.sequence,
                    terminal = true,
                    sequenceGaps = sequenceGaps,
                    revealLagMs = 0L,
                    oldestPendingAt = null,
                )
                drainJobs.remove(event.conversationId)?.cancel()
            }
            else -> flow.value = current.copy(
                turnId = event.turnId,
                lastSequence = event.sequence,
                sequenceGaps = sequenceGaps,
            )
        }
    }

    @Synchronized
    fun restore(snapshot: WsEvent.ChatActiveTurnSnapshot) {
        val flow = states.getOrPut(snapshot.conversationId) { MutableStateFlow(ChatAnimationState()) }
        val current = flow.value
        if (current.turnId == snapshot.turnId && current.lastSequence >= snapshot.latestSequence) return
        // Re-entry/cold reconnect policy: accumulated desktop text is immediately visible.
        flow.value = ChatAnimationState(
            turnId = snapshot.turnId,
            authoritativeText = snapshot.assistantText,
            displayedText = snapshot.assistantText,
            lastSequence = snapshot.latestSequence,
            terminal = snapshot.status != "active",
            droppedDuplicateEvents = current.droppedDuplicateEvents,
            sequenceGaps = current.sequenceGaps,
            snapshotRecoveries = current.snapshotRecoveries + 1,
        )
    }

    @Synchronized
    fun clear(conversationId: String) {
        states.remove(conversationId)
        drainJobs.remove(conversationId)?.cancel()
    }

    fun shouldApplyPersistedHistory(conversationId: String, persistedAssistantText: String?): Boolean {
        val current = observe(conversationId).value
        if (current.turnId == null) return true
        return current.terminal &&
            persistedAssistantText != null &&
            persistedAssistantText == current.authoritativeText
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
                val nextText = current.authoritativeText.take(offset)
                val stillPending = nextText.length < current.authoritativeText.length
                flow.value = current.copy(
                    displayedText = nextText,
                    revealLagMs = if (stillPending) {
                        System.currentTimeMillis() - (current.oldestPendingAt ?: System.currentTimeMillis())
                    } else 0L,
                    oldestPendingAt = if (stillPending) current.oldestPendingAt else null,
                )
                delay(FRAME_MS)
            }
            drainJobs.remove(conversationId)
        }
    }
}
