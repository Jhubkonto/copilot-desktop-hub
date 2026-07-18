package io.nexy.android.ui.generator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Shared engine for the AI generator flows (agent / skill / project / schedule).
 * Each feature ViewModel supplies only its WsEvent mapping, spec payload encoding,
 * greeting, command prefix and spec tag — the chat/spec-review/done state machine,
 * session guarding, streaming accumulation and error handling live here once.
 */

data class GenMessage(val role: String, val content: String)

enum class GenPhase { CHAT, SPEC_REVIEW, DONE }

data class GenState<Spec>(
    val phase: GenPhase = GenPhase.CHAT,
    val messages: List<GenMessage>,
    val streamingText: String = "",
    val pendingSpec: Spec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdName: String? = null,
    val createdId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
    val promptInsert: Pair<Int, String>? = null,
    val selectedModel: String? = null,
    val resolvedModel: String? = null,
)

/** Normalized generator events; feature adapters map their WsEvent variants into these. */
sealed interface GenEvent<out Spec> {
    val sessionId: String?

    data class Model(override val sessionId: String?, val modelId: String) : GenEvent<Nothing>
    data class Token(override val sessionId: String?, val chunk: String) : GenEvent<Nothing>
    data class TurnComplete(override val sessionId: String?, val content: String, val hasSpec: Boolean) : GenEvent<Nothing>
    data class SpecReady<Spec>(override val sessionId: String?, val spec: Spec) : GenEvent<Spec>
    data class Created(override val sessionId: String?, val id: String, val name: String) : GenEvent<Nothing>
    data class Error(override val sessionId: String?, val message: String) : GenEvent<Nothing>
    data class Cancelled(override val sessionId: String?) : GenEvent<Nothing>
}

/**
 * Synchronously-mapped read-only view of a StateFlow. Unlike Flow.map + stateIn,
 * `value` reflects the source immediately — the feature ViewModels expose their
 * legacy per-feature UiState shape through this without adding dispatch latency.
 */
fun <T, R> StateFlow<T>.mapState(transform: (T) -> R): StateFlow<R> = object : StateFlow<R> {
    override val value: R get() = transform(this@mapState.value)
    override val replayCache: List<R> get() = listOf(value)
    override suspend fun collect(collector: FlowCollector<R>): Nothing {
        var last: Any? = Unmapped
        this@mapState.collect { upstream ->
            val mapped = transform(upstream)
            if (last == Unmapped || last != mapped) {
                last = mapped
                collector.emit(mapped)
            }
        }
    }
}

private object Unmapped

abstract class GeneratorViewModel<Spec>(
    private val wsClient: WsClient,
    private val commandPrefix: String,
    specTag: String,
    private val greeting: String,
) : ViewModel() {

    private val specTagRegex = Regex("<$specTag>[\\s\\S]*?</$specTag>")

    private fun freshState() = GenState<Spec>(messages = listOf(GenMessage("assistant", greeting)))

    protected val state = MutableStateFlow(freshState())

    init {
        viewModelScope.launch {
            wsClient.events.collect { event ->
                val gen = mapEvent(event) ?: return@collect
                if (!isActiveSession(gen.sessionId)) return@collect
                handle(gen)
            }
        }
    }

    /** Maps this feature's WsEvent variants to normalized GenEvents; null for unrelated events. */
    protected abstract fun mapEvent(event: WsEvent): GenEvent<Spec>?

    /** Encodes the spec into the command payload the desktop generator expects. */
    protected abstract fun specPayload(spec: Spec): Map<String, Any>

    private fun handle(event: GenEvent<Spec>) {
        when (event) {
            is GenEvent.Model -> {
                state.value = state.value.copy(resolvedModel = event.modelId.ifBlank { null })
            }
            is GenEvent.Token -> {
                state.value = state.value.copy(streamingText = state.value.streamingText + event.chunk)
            }
            is GenEvent.TurnComplete -> commitAssistantTurn(event.content, event.hasSpec)
            is GenEvent.SpecReady -> {
                state.value = state.value.copy(
                    streamingText = "",
                    pendingSpec = event.spec,
                    phase = GenPhase.SPEC_REVIEW,
                    isLoading = false,
                )
            }
            is GenEvent.Created -> {
                state.value = state.value.copy(
                    phase = GenPhase.DONE,
                    createdName = event.name,
                    createdId = event.id,
                    isLoading = false,
                )
            }
            is GenEvent.Error -> {
                state.value = state.value.copy(error = event.message, isLoading = false)
            }
            is GenEvent.Cancelled -> {
                state.value = freshState()
            }
        }
    }

    fun sendMessage(content: String) {
        val current = state.value
        val userMsg = GenMessage("user", content)
        val next = current.messages + userMsg
        state.value = current.copy(messages = next, isLoading = true, streamingText = "", missedSpec = false, error = null)
        val payload = next.map { mapOf("role" to it.role, "content" to it.content) }
        val baseData = buildMap<String, Any> {
            put("sessionId", current.activeSessionId)
            put("messages", payload)
            current.selectedModel?.let { put("model", it) }
        }
        if (current.messages.size <= 1) {
            wsClient.send("$commandPrefix:start", baseData)
        } else {
            wsClient.send("$commandPrefix:message", baseData)
        }
    }

    fun setModel(modelId: String?) {
        state.value = state.value.copy(selectedModel = modelId)
    }

    private var promptInsertCounter = 0

    fun insertPromptText(body: String) {
        state.value = state.value.copy(promptInsert = Pair(++promptInsertCounter, body))
    }

    fun confirmSpec() {
        val spec = state.value.pendingSpec ?: return
        state.value = state.value.copy(isLoading = true, error = null)
        wsClient.send(
            "$commandPrefix:confirm",
            mapOf("sessionId" to state.value.activeSessionId, "spec" to specPayload(spec)),
        )
    }

    fun reset() {
        wsClient.send("$commandPrefix:cancel", mapOf("sessionId" to state.value.activeSessionId))
        state.value = freshState()
    }

    fun updateSpec(spec: Spec) {
        state.value = state.value.copy(pendingSpec = spec)
    }

    fun backToChat() {
        state.value = state.value.copy(phase = GenPhase.CHAT, error = null)
    }

    /** Jumps straight to spec review with the feature's blank starter spec. */
    protected fun enterSpecReview(spec: Spec) {
        state.value = state.value.copy(phase = GenPhase.SPEC_REVIEW, pendingSpec = spec)
    }

    fun retryLastMessage() {
        val lastUserMsg = state.value.messages.lastOrNull { it.role == "user" }?.content ?: return
        state.value = state.value.copy(error = null)
        sendMessage(lastUserMsg)
    }

    fun dismissError() {
        state.value = state.value.copy(error = null)
    }

    private fun isActiveSession(sessionId: String?): Boolean =
        sessionId == null || sessionId == state.value.activeSessionId

    private fun commitAssistantTurn(content: String, hasSpec: Boolean) {
        val current = state.value
        val clean = content.ifBlank { current.streamingText }
            .replace(specTagRegex, "")
            .trim()
        state.value = current.copy(
            streamingText = "",
            messages = if (clean.isBlank()) current.messages else current.messages + GenMessage("assistant", clean),
            isLoading = false,
            missedSpec = !hasSpec && clean.isBlank(),
        )
    }
}
