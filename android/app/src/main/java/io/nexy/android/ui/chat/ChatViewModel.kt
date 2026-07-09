package io.nexy.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ChatAnimationRepository
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.local.LocalDataRepository
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import org.json.JSONObject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.launch
import java.util.UUID

private const val ACTIVE_HISTORY_POLL_MS = 2_500L

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
    val artifactRef: ArtifactRef? = null,
    val codeChangeRef: CodeChangeRef? = null,
    val model: String? = null,
)

/** Parsed from a `__artifact-ref:{...}` sentinel message content. `kind`/`conversationId`
 * are optional metadata for generated debrief/quiz artifacts that should reopen their native
 * Android experiences instead of the generic artifact detail screen. */
data class ArtifactRef(
    val artifactId: String,
    val versionId: String?,
    val kind: String? = null,
    val conversationId: String? = null,
    val pending: Boolean = false,
)

/** Parsed from a `__code-change-ref:{...}` sentinel message content (desktop's CodeChangeCard
 * counterpart). */
data class CodeChangeRef(val reportId: String)

@OptIn(InternalCoroutinesApi::class, ExperimentalForInheritanceCoroutinesApi::class)
private class DerivedBooleanStateFlow<A, B>(
    private val first: StateFlow<A>,
    private val second: StateFlow<B>,
    private val transform: (A, B) -> Boolean,
) : StateFlow<Boolean> {
    override val value: Boolean get() = transform(first.value, second.value)
    override val replayCache: List<Boolean> get() = listOf(value)
    override suspend fun collect(collector: FlowCollector<Boolean>): Nothing {
        combine(first, second, transform).collect(collector)
        error("StateFlow collection completed unexpectedly")
    }
}

@OptIn(InternalCoroutinesApi::class, ExperimentalForInheritanceCoroutinesApi::class)
private class DerivedStateFlow<A, B>(
    private val source: StateFlow<A>,
    private val transform: (A) -> B,
) : StateFlow<B> {
    override val value: B get() = transform(source.value)
    override val replayCache: List<B> get() = listOf(value)
    override suspend fun collect(collector: FlowCollector<B>): Nothing {
        source.map(transform).collect(collector)
        error("StateFlow collection completed unexpectedly")
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModel(
    private val conversationId: String,
    private val wsClient: WsClient = WsRepository,
    private val agentId: String? = null,
    private val projectId: String? = null,
    private val localData: LocalDataRepository? =
        if (wsClient === WsRepository) WsRepository.localDataRepository() else null,
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
    val isStreaming: StateFlow<Boolean> = DerivedBooleanStateFlow(_liveTurnState, _drainActive) { state, drain ->
        drain || state.status == ChatTurnStatus.Streaming
    }

    // isAwaitingResponse: true while waiting for first token (Active) but NOT while streaming text.
    // The thinking bubble shows when Active; hides when Streaming or Idle/Completed/Failed.
    val isAwaitingResponse: StateFlow<Boolean> = DerivedBooleanStateFlow(_liveTurnState, _drainActive) { state, drain ->
        state.status == ChatTurnStatus.Active && !drain
    }

    val activityLabel: StateFlow<String> = _liveTurnState.map { state ->
        state.activity?.label?.takeIf { it.isNotBlank() } ?: "Assistant is thinking"
    }.stateIn(viewModelScope, SharingStarted.Eagerly, "Assistant is thinking")

    // Structured activity (state/toolName/serverName), not just the raw label — the live-activity
    // indicator computes its own display text from `state` (matching desktop's ChatMessages.tsx
    // live-activity branch, which ignores the raw backend label entirely for the non-tool case
    // and always shows "Thinking…Ns"), so it needs more than the flattened `activityLabel` string.
    val liveActivity: StateFlow<ChatTurnActivity?> = DerivedStateFlow(_liveTurnState) { state -> state.activity }

    val liveThinkingBlocks: StateFlow<List<ThinkingBlock>> = DerivedStateFlow(_liveTurnState) { state ->
        state.thinkingBlocks
    }

    val generationStartedAt: StateFlow<Long?> = _liveTurnState.map { state ->
        state.generationStartedAt
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _attachments = MutableStateFlow<List<PendingAttachment>>(emptyList())
    val attachments: StateFlow<List<PendingAttachment>> = _attachments

    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft

    private var draftSaveJob: Job? = null

    fun setDraft(text: String) {
        _draft.value = text
        draftSaveJob?.cancel()
        draftSaveJob = viewModelScope.launch {
            delay(250)
            localData?.saveDraft(conversationId, text)
        }
    }

    fun consumeDraft(): String = _draft.value.also {
        _draft.value = ""
        draftSaveJob?.cancel()
        viewModelScope.launch { localData?.clearDraft(conversationId) }
    }

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing

    private val _selectedModel = MutableStateFlow<String?>(null)
    val selectedModel: StateFlow<String?> = _selectedModel

    private val _sendError = MutableStateFlow<String?>(null)
    val sendError: StateFlow<String?> = _sendError

    // Ephemeral status/confirmation text for slash commands (the Android counterpart of
    // desktop's ctx.pushSystemMessage) — ChatScreen shows this as a snackbar, then clears it.
    private val _slashCommandMessage = MutableStateFlow<String?>(null)
    val slashCommandMessage: StateFlow<String?> = _slashCommandMessage
    fun consumeSlashCommandMessage() { _slashCommandMessage.value = null }

    // Quiz and code-change WS replies (quiz:ready, error-report:captured) don't carry a
    // conversationId, unlike debrief:ready — these flags scope the resulting sentinel-insert to
    // "the last /quiz or /code-change issued from this open chat", matching this codebase's
    // existing best-effort WS correlation elsewhere (no request/response ids on this protocol).
    private var awaitingQuizInsert = false
    private var awaitingCodeChangeInsert = false

    private var historyLoaded = false

    private var activeHistoryPollJob: Job? = null

    // See ChatAnimationRepository.observe collector below and freezeCurrentStreamingMessage —
    // together these let a tool call that interrupts mid-stream text push subsequent text into
    // a new message ordered after it, instead of the whole turn staying one growing blob glued
    // to its original (pre-interruption) position in the list.
    private var lastAnimationDisplayedLength = 0
    private var textSegmentStart = 0

    // The live-streaming assistant message's stable identity for its *current* segment.
    // ChatRenderItem keys AssistantMessage by id.ifBlank { "asst_$timestamp" } — a fresh
    // UUID assigned once per segment (not derived from timestamp, which used to get
    // re-stamped on every freeze and so changed the key each time) means the key never
    // changes for a segment across its whole streaming→frozen→settled lifecycle. Changing
    // it was the actual cause of tool-interrupted Codex turns visibly flickering: LazyColumn
    // treats a key change as the old item vanishing and a brand-new one mounting in its
    // place, discarding any in-flight fade/placement animation state for that item.
    private var currentLiveMessageId: String = UUID.randomUUID().toString()

    /**
     * If an assistant message is currently streaming, freezes it in place (stops it from
     * absorbing further text deltas) and records where the next segment should start reading
     * from in the turn's accumulated text. Called just before inserting a tool-call or team-
     * activity message so any text that resumes afterward renders as a new message below it,
     * matching desktop's chronological (rather than grouped-by-type) turn ordering.
     */
    private fun freezeCurrentStreamingMessage(): List<ChatMessage> {
        val current = _messages.value
        val streamingIdx = current.indexOfFirst { it.id == currentLiveMessageId }
        // The next segment (if any) gets its own fresh identity — the just-frozen message
        // keeps the id it already has, so its key is untouched by this call.
        currentLiveMessageId = UUID.randomUUID().toString()
        if (streamingIdx < 0) return current
        textSegmentStart = lastAnimationDisplayedLength
        return current.toMutableList().also {
            it[streamingIdx] = it[streamingIdx].copy(isStreaming = false)
        }
    }

    /**
     * `startActiveHistoryPolling` re-requests `conversation:get-messages` every
     * ACTIVE_HISTORY_POLL_MS while a turn is active, as a catch-up mechanism for cases where
     * this client wasn't connected to the live WS event stream (e.g. it just reconnected).
     * But when the client *was* connected the whole time, `_messages` is already being kept
     * current in real time by the ChatToolCallEvent/ChatTeamActivity/animation-observer
     * handlers — those run ahead of the backend actually persisting each tool-call/reasoning
     * row to disk. A poll response that lands mid-turn can therefore be a stale snapshot from
     * *before* the backend caught up, and applying it verbatim would make already-visible
     * content vanish, then reappear piecemeal as later polls (or the terminal sync) catch up —
     * exactly the flicker long, many-tool-call Codex turns kept reproducing. Once the turn has
     * genuinely finished (`historyHasAssistantResponse`) the fetched list is authoritative and
     * always wins; only a still-in-progress turn gets this regression guard.
     */
    private fun preferFullerActiveState(
        fetched: List<ChatMessage>,
        current: List<ChatMessage>,
        historyHasAssistantResponse: Boolean,
        turnTerminal: Boolean,
    ): List<ChatMessage> {
        if (historyHasAssistantResponse || turnTerminal) return fetched
        return if (fetched.size < current.size) current else fetched
    }

    private val isTurnTerminal: Boolean
        get() = _liveTurnState.value.status == ChatTurnStatus.Completed ||
                _liveTurnState.value.status == ChatTurnStatus.Failed

    // The conversation's own agent (once known) takes precedence over the nav-arg agentId,
    // matching ChatScreen's own chatAgentId resolution (conversation?.agent_id ?: agentId).
    private val effectiveAgentId: StateFlow<String?> = if (wsClient === WsRepository) {
        WsRepository.conversations
            .map { list -> list.find { it.id == conversationId }?.agent_id ?: agentId }
            .stateIn(viewModelScope, SharingStarted.Eagerly, agentId)
    } else {
        MutableStateFlow(agentId)
    }

    // Per-agent slash commands declared in Agent Config. WsRepository.agentFullConfig only
    // gets populated when something requests it — previously only the Agent Config editor
    // screen did, so this data existed on the wire but was never fetched near chat. Filtered
    // by id since agentFullConfig is a single slot, not keyed per agent.
    val customSlashCommands: StateFlow<List<io.nexy.android.data.model.AgentCustomCommand>> =
        if (wsClient === WsRepository) {
            combine(WsRepository.agentFullConfig, effectiveAgentId) { config, id ->
                if (config != null && id != null && config.id == id) config.customCommands else emptyList()
            }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
        } else {
            MutableStateFlow(emptyList())
        }

    init {
        if (wsClient === WsRepository) {
            viewModelScope.launch {
                effectiveAgentId.collect { id -> if (id != null) WsRepository.requestAgentFull(id) }
            }
        }
        localData?.let { repository ->
            viewModelScope.launch {
                repository.observeDraft(conversationId).collect { saved ->
                    if (_draft.value.isBlank() && !saved?.text.isNullOrBlank()) {
                        _draft.value = saved?.text.orEmpty()
                    }
                }
            }
        }
        refreshMessages()
        if (wsClient === WsRepository) {
            viewModelScope.launch {
                ChatAnimationRepository.observe(conversationId).collect { animation ->
                    if (animation.turnId == null) return@collect
                    lastAnimationDisplayedLength = animation.displayedText.length
                    val current = _messages.value
                    val streamingIdx = current.indexOfFirst { it.id == currentLiveMessageId }
                    // "Settled" requires both the backend turn to be terminal AND the reveal
                    // animation to have actually caught up (no backlog left) — using `terminal`
                    // alone would flip the message to its done/frozen appearance (spinner gone,
                    // thinking blocks attached) the instant the backend finishes, ahead of
                    // whatever text is still being animated in.
                    val settled = animation.terminal && animation.backlogLength <= 0
                    // ChatAnimationRepository accumulates one continuous string for the whole
                    // turn, but a tool call mid-turn freezes the streaming message it interrupted
                    // (see freezeCurrentStreamingMessage) and remembers the offset — so any text
                    // that streams in *after* the tool call becomes its own message, rendered
                    // below the tool call rather than invisibly merging into the frozen one above
                    // it. When no tool call has interrupted the turn, textSegmentStart stays 0 and
                    // this is exactly the prior single-message behavior.
                    val segmentText = animation.displayedText.drop(textSegmentStart)
                    val message = ChatMessage(
                        id = currentLiveMessageId,
                        text = segmentText,
                        isUser = false,
                        isStreaming = !settled,
                        thinkingBlocks = if (settled) _liveTurnState.value.thinkingBlocks else emptyList(),
                        model = _liveTurnState.value.model,
                    )
                    val lastAssistant = current.lastOrNull { !it.isUser && !it.isToolCall }
                    // A settled animation frame whose text already matches the last persisted
                    // assistant message is a stale replay racing a history sync (e.g. after
                    // Retry) — applying it would append a second copy of the same answer.
                    val isStaleReplay = settled && lastAssistant != null &&
                        !lastAssistant.isStreaming && lastAssistant.text == segmentText
                    _messages.value = if (streamingIdx >= 0) {
                        current.toMutableList().also { it[streamingIdx] = message }
                    } else if (segmentText.isNotEmpty() && !isStaleReplay) {
                        current + message
                    } else current
                    _drainActive.value = animation.backlogLength > 0
                }
            }
        }
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when {
                    event is WsEvent.ConversationMessages && event.conversationId == conversationId -> {
                        val messagesBeforeSync = _messages.value
                        val mapped = event.messages.map { msg -> msg.toChatMessage() }
                        val persistedAssistantText = mapped.lastOrNull { !it.isUser && !it.isToolCall }?.text
                        val historyHasAssistantResponse =
                            mapped.lastOrNull { !it.isToolCall }?.isUser == false &&
                            (wsClient !== WsRepository ||
                                ChatAnimationRepository.shouldApplyPersistedHistory(
                                    conversationId,
                                    persistedAssistantText,
                                ))
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
                                val reconciled = if (missingToolCalls.isNotEmpty()) mapped + missingToolCalls else mapped
                                _messages.value = preferFullerActiveState(reconciled, messagesBeforeSync, historyHasAssistantResponse, turnTerminal)
                            } else {
                                _messages.value = preferFullerActiveState(mapped, messagesBeforeSync, historyHasAssistantResponse, turnTerminal)
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
                        if (event.type == "turn_started") {
                            textSegmentStart = 0
                            lastAnimationDisplayedLength = 0
                            currentLiveMessageId = UUID.randomUUID().toString()
                        }
                        if (event.type == "turn_completed" || event.type == "turn_failed") {
                            _drainActive.value = false
                            stopActiveHistoryPolling()
                        }
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
                        _messages.value = freezeCurrentStreamingMessage() + ChatMessage(
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
                            freezeCurrentStreamingMessage() + teamMessage
                        }
                    }
                    event is WsEvent.ChatStreamChunk && event.conversationId == conversationId -> {
                        // Legacy/test transports may not emit normalized events. Production
                        // WsRepository consumes chat:turn-event as the canonical source.
                        if (wsClient !== WsRepository) {
                            stopActiveHistoryPolling()
                            _drainActive.value = true
                            _liveTurnState.value = _liveTurnState.value.copy(
                                status = ChatTurnStatus.Streaming,
                                activity = null,
                            )
                            val current = _messages.value
                            val index = current.indexOfLast { it.isStreaming && !it.isToolCall }
                            _messages.value = if (index >= 0) {
                                current.toMutableList().also {
                                    it[index] = it[index].copy(text = it[index].text + event.text)
                                }
                            } else current + ChatMessage(text = event.text, isUser = false, isStreaming = true)
                        }
                    }
                    event is WsEvent.ChatStreamEnd && event.conversationId == conversationId -> {
                        // Compatibility event; normalized completion owns terminal state.
                        if (wsClient !== WsRepository) {
                            val current = _messages.value
                            val index = current.indexOfLast { it.isStreaming && !it.isToolCall }
                            if (index >= 0) {
                                _messages.value = current.toMutableList().also {
                                    it[index] = it[index].copy(
                                        isStreaming = false,
                                        thinkingBlocks = _liveTurnState.value.thinkingBlocks,
                                    )
                                }
                            }
                            _drainActive.value = false
                            _liveTurnState.value = _liveTurnState.value.copy(
                                status = ChatTurnStatus.Completed,
                                thinkingBlocks = emptyList(),
                                pendingThinkingEnds = emptySet(),
                                generationStartedAt = null,
                            )
                        }
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
                    // /debrief, /quiz, and /code-change insert a durable, specially-rendered
                    // system message (the __artifact-ref:/__code-change-ref: sentinel convention
                    // shared with desktop) rather than streaming a normal reply — surface it here
                    // the same way a normal history refresh would, without waiting on one.
                    event is WsEvent.MessageInserted && event.conversationId == conversationId -> {
                        if (_messages.value.none { it.id == event.messageId }) {
                            val historyMessage = HistoryMessage(
                                id = event.messageId,
                                role = event.role,
                                content = event.content,
                                timestamp = event.timestamp,
                            )
                            _messages.value = _messages.value + historyMessage.toChatMessage()
                        }
                    }
                    event is WsEvent.DebriefReady && event.debrief.conversationId == conversationId -> {
                        removePendingArtifactRefMessage("debrief")
                        if (event.artifactId != null) {
                            insertArtifactRefMessage(
                                artifactId = event.artifactId,
                                versionId = event.versionId,
                                kind = "debrief",
                                sourceConversationId = event.debrief.conversationId,
                            )
                        } else {
                            _slashCommandMessage.value = "Debrief generated."
                        }
                    }
                    event is WsEvent.DebriefError -> {
                        removePendingArtifactRefMessage("debrief")
                        _slashCommandMessage.value = "Failed to generate debrief: ${event.message}"
                    }
                    event is WsEvent.QuizReady && awaitingQuizInsert -> {
                        awaitingQuizInsert = false
                        removePendingArtifactRefMessage("quiz")
                        if (event.artifactId != null) {
                            insertArtifactRefMessage(
                                artifactId = event.artifactId,
                                versionId = event.versionId,
                                kind = "quiz",
                                sourceConversationId = conversationId,
                            )
                        } else {
                            _slashCommandMessage.value = "Quiz generated."
                        }
                    }
                    event is WsEvent.QuizError && awaitingQuizInsert -> {
                        awaitingQuizInsert = false
                        removePendingArtifactRefMessage("quiz")
                        _slashCommandMessage.value = "Failed to generate quiz: ${event.message}"
                    }
                    event is WsEvent.ErrorReportCaptured && awaitingCodeChangeInsert -> {
                        awaitingCodeChangeInsert = false
                        insertCodeChangeRefMessage(event.reportId)
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
        if (wsClient === WsRepository) {
            wsClient.send("chat:get-active-turn", mapOf("conversationId" to conversationId))
        }
    }

    private fun insertArtifactRefMessage(
        artifactId: String,
        versionId: String?,
        kind: String? = null,
        sourceConversationId: String? = null,
    ) {
        val content = "__artifact-ref:" + JSONObject().apply {
            put("artifactId", artifactId)
            put("versionId", versionId)
            if (!kind.isNullOrBlank()) put("kind", kind)
            if (!sourceConversationId.isNullOrBlank()) put("conversationId", sourceConversationId)
        }.toString()
        WsRepository.insertMessage(conversationId, "system", content)
    }

    private fun insertCodeChangeRefMessage(reportId: String) {
        val content = "__code-change-ref:" + JSONObject().apply {
            put("reportId", reportId)
        }.toString()
        WsRepository.insertMessage(conversationId, "system", content)
    }

    private fun pendingArtifactMessageId(kind: String) = "pending-$kind-$conversationId"

    /** Shows an immediate, local-only placeholder card (spinner, no chevron) while a debrief/quiz
     *  generates in the background, instead of leaving the user with only a toast. Removed by
     *  [removePendingArtifactRefMessage] once the real artifact-ref message arrives or generation
     *  fails — never persisted server-side. */
    private fun insertPendingArtifactRefMessage(kind: String) {
        val id = pendingArtifactMessageId(kind)
        if (_messages.value.any { it.id == id }) return
        val pendingMessage = ChatMessage(
            id = id,
            text = "",
            isUser = false,
            isStreaming = false,
            timestamp = System.currentTimeMillis(),
            artifactRef = ArtifactRef(artifactId = "", versionId = null, kind = kind, conversationId = conversationId, pending = true),
        )
        _messages.value = _messages.value + pendingMessage
    }

    private fun removePendingArtifactRefMessage(kind: String) {
        val id = pendingArtifactMessageId(kind)
        _messages.value = _messages.value.filter { it.id != id }
    }

    /**
     * Android's counterpart of desktop's executeSlashCommand (slash-commands.ts) — a hardcoded
     * dispatch over the mobile-appropriate command subset (SlashCommands.kt). Returns true if
     * the input was a recognized command (handled here, not sent as a normal chat message).
     */
    fun trySlashCommand(rawInput: String, projectId: String?, onNewChat: () -> Unit = {}): Boolean {
        val trimmed = rawInput.trim()
        if (!trimmed.startsWith("/")) return false
        val parts = trimmed.split(Regex("\\s+"), limit = 2)
        val command = parts[0]
        val argText = parts.getOrElse(1) { "" }.trim()

        if (wsClient !== WsRepository) return false // slash commands need the real WS singleton

        when (command) {
            "/clear" -> {
                deleteMessagesAfter(conversationId, 0L)
                _slashCommandMessage.value = "Conversation cleared."
            }
            "/help" -> {
                val lines = MOBILE_SLASH_COMMANDS.joinToString("\n") { "${it.usage} — ${it.description}" }
                _slashCommandMessage.value = "Available commands:\n$lines"
            }
            "/model" -> {
                _slashCommandMessage.value = if (argText.isBlank()) {
                    "Current model: ${_selectedModel.value ?: "default"}"
                } else {
                    setModel(argText)
                    "Model set to $argText."
                }
            }
            "/new" -> {
                onNewChat()
            }
            "/complete" -> {
                WsRepository.markConversationComplete(conversationId)
                _slashCommandMessage.value = "Conversation marked complete."
            }
            "/incomplete" -> {
                WsRepository.markConversationIncomplete(conversationId)
                _slashCommandMessage.value = "Conversation marked incomplete."
            }
            "/debrief" -> {
                insertPendingArtifactRefMessage("debrief")
                WsRepository.generateDebrief(conversationId, projectId, argText.ifBlank { null })
            }
            "/quiz" -> {
                awaitingQuizInsert = true
                insertPendingArtifactRefMessage("quiz")
                WsRepository.generateQuiz(conversationId, projectId, argText.ifBlank { null })
            }
            "/code-change" -> {
                if (projectId.isNullOrBlank()) {
                    _slashCommandMessage.value = "Code changes require this conversation to be in a project."
                } else if (argText.isBlank()) {
                    _slashCommandMessage.value = "Usage: /code-change <description of the change you want>"
                } else {
                    awaitingCodeChangeInsert = true
                    WsRepository.createRemoteEditReport(
                        title = argText.take(80),
                        description = argText,
                        projectId = projectId,
                        conversationId = conversationId,
                    )
                }
            }
            else -> return false
        }
        return true
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

    // Each of these touches only its own field server-side — the other override is left as-is
    // (JSONObject.NULL is the explicit "clear to agent default" signal; a Kotlin Map<String, Any>
    // can't hold a plain null, and simply omitting the key would mean "don't touch this field").
    fun setThinkingEffortOverride(value: String?) {
        wsClient.send(
            "conversation:set-mode",
            mapOf(
                "conversationId" to conversationId,
                "thinkingEffortOverride" to (value ?: JSONObject.NULL),
            ),
        )
    }

    fun setFullAutoApproveOverride(value: Boolean?) {
        wsClient.send(
            "conversation:set-mode",
            mapOf(
                "conversationId" to conversationId,
                "fullAutoApproveOverride" to (value ?: JSONObject.NULL),
            ),
        )
    }

    fun sendMessage(text: String) {
        sendMessage(text, null)
    }

    fun retryMessage(messageId: String, text: String) {
        sendMessage(text, messageId.takeIf { it.isNotBlank() })
    }

    private fun sendMessage(text: String, retryMessageId: String?) {
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
        if (retryMessageId == null) {
            _messages.value = _messages.value + optimisticMessage
        }
        _liveTurnState.value = emptyChatTurnState(conversationId).copy(
            status = ChatTurnStatus.Active,
            generationStartedAt = System.currentTimeMillis(),
        )
        // Drop any stale animation state from a prior turn (e.g. Retry) so the observer
        // below can't replay an already-settled ChatAnimationState against the freshly
        // synced history and append a duplicate copy of the previous answer.
        if (wsClient === WsRepository) ChatAnimationRepository.clear(conversationId)
        startActiveHistoryPolling()

        val data = buildMap<String, Any> {
            put("conversationId", conversationId)
            put("content", augmented)
            retryMessageId?.let { put("retryMessageId", it) }
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
        val current = _messages.value
        val streamingIdx = current.indexOfLast { it.isStreaming }
        if (streamingIdx >= 0) {
            _messages.value = current.toMutableList().also { list ->
                list[streamingIdx] = list[streamingIdx].copy(
                    text = list[streamingIdx].text,
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

    fun editMessage(messageId: String, content: String) {
        if (messageId.isBlank() || content.isBlank()) return
        _messages.value = _messages.value.map {
            if (it.id == messageId) it.copy(text = content, sendFailed = false) else it
        }
        WsRepository.editMessage(messageId, content)
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
