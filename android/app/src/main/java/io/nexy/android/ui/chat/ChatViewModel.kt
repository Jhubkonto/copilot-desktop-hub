package io.nexy.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.local.LocalDataRepository
import io.nexy.android.data.model.AttachmentMeta
import io.nexy.android.data.model.HistoryMessage
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import io.nexy.android.data.nullableString
import org.json.JSONObject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

private const val ACTIVE_HISTORY_POLL_MS = 2_500L
private const val HISTORY_PAGE_SIZE = 60

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
    // True for a text segment that finished streaming because a tool call interrupted it
    // (see freezeCurrentStreamingMessage) — the turn itself isn't done yet, more text or
    // tool calls may still follow. Distinct from isStreaming=false, which MessageBubble
    // otherwise treats as "this is the final settled answer" and decorates with a model
    // label, timestamp, and copy/share/etc action row — none of which make sense on an
    // intermediate fragment the model was still mid-turn on.
    val isFrozenMidTurn: Boolean = false,
    val timestamp: Long = 0L,
    val timelineOrder: Long? = null,
    val attachments: List<AttachmentMeta> = emptyList(),
    val isToolCall: Boolean = false,
    val toolName: String? = null,
    val serverName: String? = null,
    val toolArgs: String? = null,
    val toolResult: String? = null,
    val toolSuccess: Boolean = true,
    val sendFailed: Boolean = false,
    val thinkingBlocks: List<ThinkingBlock> = emptyList(),
    // Ordered response-text bursts when the reply was interrupted by a tool call — used
    // to interleave earlier narration with the tool calls it surrounded, the same way
    // thinkingBlocks are. `text` remains the full concatenated content regardless.
    val textSegments: List<ThinkingBlock> = emptyList(),
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val toolCalls: List<ChatMessage> = emptyList(),
    val artifactRef: ArtifactRef? = null,
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
    private val turnCoordinator = ChatTurnCoordinator(conversationId)
    private var snapshotRequestedForGap = false

    // True while the drain coroutine has not yet finished rendering buffered chunks.
    // Set to true on first chunk, cleared by drain finalizer.
    private val _drainActive = MutableStateFlow(false)

    // isStreaming: true while the typewriter drain is active (cursor shown in message bubble).
    // Combining drainActive with Streaming status handles the gap between status update and drain start.
    val isStreaming: StateFlow<Boolean> = DerivedStateFlow(_liveTurnState) { state ->
        state.status == ChatTurnStatus.Streaming
    }

    // isAwaitingResponse: true while waiting for first token (Active) but NOT while streaming text.
    // The thinking bubble shows when Active; hides when Streaming or Idle/Completed/Failed.
    val isAwaitingResponse: StateFlow<Boolean> = DerivedStateFlow(_liveTurnState) { state ->
        state.status == ChatTurnStatus.Active
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

    // Local, optimistic mirror of the conversation's mode overrides. Needed because a
    // brand-new/unsent chat only has a client-generated draft id (see NavGraph.kt) — there's no
    // server-side conversation row yet, so `conversation:set-mode` would target an id the desktop
    // has never heard of and silently no-op. Reading straight from WsRepository.conversations (as
    // ChatScreen used to) meant taps on the mode sheet before the first message never appeared to
    // do anything. Keyed by wire field name so setModeOverride/the flush collector can share one map.
    private val pendingModeOverrides = mutableMapOf<String, Any?>()
    private val _thinkingEffortOverride = MutableStateFlow<String?>(null)
    val thinkingEffortOverride: StateFlow<String?> = _thinkingEffortOverride
    private val _fullAutoApproveOverride = MutableStateFlow<Boolean?>(null)
    val fullAutoApproveOverride: StateFlow<Boolean?> = _fullAutoApproveOverride
    private val _terminalSandboxOverride = MutableStateFlow<Boolean?>(null)
    val terminalSandboxOverride: StateFlow<Boolean?> = _terminalSandboxOverride
    private val _cliModeOverride = MutableStateFlow<String?>(null)
    val cliModeOverride: StateFlow<String?> = _cliModeOverride
    private val _codexExecutionModeOverride = MutableStateFlow<String?>(null)
    val codexExecutionModeOverride: StateFlow<String?> = _codexExecutionModeOverride

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
    private var awaitingTeachbackInsert = false

    // /code-change, /code-plan, /code-execute, /code-push, /code-undo, /code-status: independent
    // slash commands (no wizard/step gating) following the same "awaiting flag + ephemeral status,
    // real result via a normal event" pattern as /debrief and /quiz above. codeChangeReportId caches
    // the report resolved for this conversation so /code-execute etc. don't need a round trip to
    // look it up every time; pendingCodeChangeAction remembers which action to run once that
    // lookup round trip (for the cache-miss case) comes back.
    private var codeChangeReportId: String? = null
    private var pendingCodeChangeAction: String? = null
    private var awaitingCodeChangeSubmit = false
    private var awaitingCodeChangePlan = false
    private var awaitingCodeChangeAccept = false
    private var awaitingCodeChangePush = false
    private var awaitingCodeChangeUndo = false
    private var awaitingCodeChangeStatus = false

    // True until we have an authoritative answer about whether this conversation already has
    // content: the in-memory cache restore, the Room cache read, or the first server
    // conversation:get-messages reply — whichever settles first. Lets the screen show a loading
    // skeleton instead of misreporting an existing chat as "Start a new conversation" while its
    // history is still being fetched off the main thread.
    private val _isInitialHistoryLoading = MutableStateFlow(true)
    val isInitialHistoryLoading: StateFlow<Boolean> = _isInitialHistoryLoading

    private var historyLoaded = false
    private var oldestLoadedTimestamp: Long? = null
    private var oldestLoadedId: String? = null
    private var hasOlderMessages = false
    private val _isLoadingOlder = MutableStateFlow(false)
    val isLoadingOlder: StateFlow<Boolean> = _isLoadingOlder

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
     * Folds one sequence-ordered `ChatTurnEvent` into `_liveTurnState` and `_messages`.
     * Shared by the live `wsClient.events` collector below and by the
     * `ChatActiveTurnSnapshot` restore branches, which replay a whole turn's worth of these
     * in order — so a re-entering client ends up in exactly the state it would be in had it
     * stayed connected the entire time, rather than a separately-derived approximation.
     */
    private fun applyChatTurnEvent(event: WsEvent.ChatTurnEvent) {
        val coordinated = turnCoordinator.accept(event)
        _liveTurnState.value = coordinated.state
        if (coordinated.needsSnapshot && !snapshotRequestedForGap && wsClient === WsRepository) {
            snapshotRequestedForGap = true
            wsClient.send("chat:get-active-turn", mapOf("conversationId" to conversationId))
        } else if (!coordinated.needsSnapshot) {
            snapshotRequestedForGap = false
        }
        if (event.type == "turn_completed" || event.type == "turn_failed") {
            stopActiveHistoryPolling()
        }
    }

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
            it[streamingIdx] = it[streamingIdx].copy(isStreaming = false, isFrozenMidTurn = true)
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
        // An in-flight history page is never authoritative for the active turn: persistence
        // legitimately trails its event stream, and comparing list sizes allows a page with
        // duplicated/partially-persisted tool rows to replace the canonical projection. Keep the
        // visible session intact; only use history as the initial base when there is no local
        // state yet. The active turn itself is rendered from ChatTurnState.timeline.
        return if (current.isEmpty()) fetched else current
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
        // Navigation creates a new ViewModel for this destination. Restore the last rendered
        // page synchronously so returning to an already opened conversation never waits for a
        // database dispatcher just to show the same content again.
        if (wsClient === WsRepository) {
            restoreInMemoryHistory()
            viewModelScope.launch {
                messages.collect { current ->
                    ChatHistoryMemoryCache.put(conversationId, current)
                }
            }
        }
        if (wsClient === WsRepository) {
            viewModelScope.launch {
                // refreshMessages() only requests chat:get-active-turn once, on ViewModel
                // creation (chat screen opened). If the socket drops and reconnects while the
                // screen stays open mid-turn — background/foreground, brief network blip — this
                // wasn't re-requested, so re-entry ordering only ever caught up on the next
                // ACTIVE_HISTORY_POLL_MS tick via the flattened `conversation:get-messages`
                // path instead of the events-replay path above (applyChatTurnEvent), which is
                // the one that actually gets chronological ordering right. Re-request the
                // snapshot on every reconnect so that path — not the poll — is what resyncs a
                // still-open chat after a drop.
                var wasConnected = WsRepository.connectionState.value == io.nexy.android.data.ConnectionState.CONNECTED
                WsRepository.connectionState.collect { state ->
                    val isConnected = state == io.nexy.android.data.ConnectionState.CONNECTED
                    if (isConnected && !wasConnected && !isTurnTerminal) {
                        wsClient.send("chat:get-active-turn", mapOf("conversationId" to conversationId))
                    }
                    wasConnected = isConnected
                }
            }
            viewModelScope.launch {
                effectiveAgentId.collect { id -> if (id != null) WsRepository.requestAgentFull(id) }
            }
            viewModelScope.launch {
                WsRepository.conversations.collect { list ->
                    val conv = list.find { it.id == conversationId } ?: return@collect
                    // Flush any overrides the user set while this was still a draft conversation
                    // (no server row yet). The keys we just flushed are skipped in the resync below
                    // since `conv`'s override columns here are still whatever they were before this
                    // conversation existed (default null) — syncing them now would flash the
                    // checkmark back off until the conversation:mode-updated echo lands.
                    val flushedKeys = pendingModeOverrides.keys.toSet()
                    if (flushedKeys.isNotEmpty()) {
                        val toSend = pendingModeOverrides.toMap()
                        pendingModeOverrides.clear()
                        wsClient.send(
                            "conversation:set-mode",
                            buildMap {
                                put("conversationId", conversationId)
                                toSend.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
                            },
                        )
                    }
                    if ("thinkingEffortOverride" !in flushedKeys) _thinkingEffortOverride.value = conv.thinking_effort_override
                    if ("fullAutoApproveOverride" !in flushedKeys) _fullAutoApproveOverride.value = conv.full_auto_approve_override
                    if ("terminalSandboxOverride" !in flushedKeys) _terminalSandboxOverride.value = conv.terminal_sandbox_override
                    if ("cliModeOverride" !in flushedKeys) _cliModeOverride.value = conv.cli_mode_override
                    if ("codexExecutionModeOverride" !in flushedKeys) _codexExecutionModeOverride.value = conv.codex_execution_mode_override
                }
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
        // Re-opening a chat creates a fresh ViewModel, but the latest page is already in Room
        // from the previous visit. Hydrate that page first, then reconcile it with the desktop in
        // the background. Keeping the refresh indicator hidden here avoids making a cached chat
        // look as though it is loading from scratch every time the user returns to it.
        if (localData != null) {
            hydrateCachedHistoryThenRefresh()
        } else {
            refreshMessages()
        }
        viewModelScope.launch {
            wsClient.events.collect { event ->
                when {
                    event is WsEvent.ConversationMessages && event.conversationId == conversationId -> {
                        _isInitialHistoryLoading.value = false
                        val messagesBeforeSync = _messages.value
                        // History payloads can contain hundreds of messages. Converting them
                        // also parses attachment and rich-message metadata, so keep that CPU
                        // work off Compose's main thread and only publish the finished list.
                        var mapped = if (wsClient === WsRepository) {
                            withContext(Dispatchers.Default) { event.messages.map { msg -> msg.toChatMessage() } }
                        } else {
                            // Deterministic for lightweight test/offline WsClient implementations;
                            // production mapping remains off Compose's main thread above.
                            event.messages.map { msg -> msg.toChatMessage() }
                        }
                        if (event.paged && _isLoadingOlder.value && oldestLoadedTimestamp != null) {
                            // Cursor pages are strictly older than the visible history, so do
                            // not replace the latest page while the user scrolls upward.
                            val existingIds = messagesBeforeSync.asSequence().map { it.id }.toHashSet()
                            val older = mapped.filter { it.id !in existingIds }
                            if (older.isNotEmpty()) _messages.value = older + messagesBeforeSync
                            oldestLoadedTimestamp = event.nextBeforeTimestamp
                            oldestLoadedId = event.nextBeforeId
                            hasOlderMessages = event.hasMore
                            _isLoadingOlder.value = false
                            return@collect
                        }
                        if (event.paged && messagesBeforeSync.isNotEmpty()) {
                            // A latest-page refresh must not make already loaded older pages
                            // vanish. The server's page is authoritative for its own range;
                            // retain only entries that predate it.
                            val pageOldestTimestamp = mapped.firstOrNull()?.timestamp
                            if (pageOldestTimestamp != null) {
                                val pageIds = mapped.asSequence().map { it.id }.toHashSet()
                                mapped = messagesBeforeSync
                                    .filter { it.timestamp < pageOldestTimestamp && it.id !in pageIds }
                                    .plus(mapped)
                            }
                        }
                        val historyHasAssistantResponse =
                            mapped.lastOrNull { !it.isToolCall }?.isUser == false
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
                                turnCoordinator.reset()
                                _liveTurnState.value = emptyChatTurnState(conversationId)
                                _drainActive.value = false
                                stopActiveHistoryPolling()
                                WsRepository.clearConversationActiveState(conversationId)
                                // _messages.value is about to be replaced wholesale by the
                                // persisted `mapped` list below, which no longer contains
                                // currentLiveMessageId. ChatAnimationRepository's drain job
                                // (ensureDrain) keeps ticking independently of that swap — if
                                // left running, its next emission finds streamingIdx == -1 in
                                // the new list and, since its mid-catch-up segmentText doesn't
                                // yet equal the now-final persisted text, falls into the
                                // append-not-replace branch of the animation observer and
                                // inserts a second, orphaned copy of the response that's never
                                // cleaned up. Cancelling the drain job here — the same instant
                                // we commit to history being authoritative — prevents any
                                // further stray emissions for this turn.
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
                            if (event.paged) {
                                oldestLoadedTimestamp = _messages.value.firstOrNull()?.timestamp ?: mapped.firstOrNull()?.timestamp
                                oldestLoadedId = _messages.value.firstOrNull()?.id ?: mapped.firstOrNull()?.id
                                hasOlderMessages = event.hasMore
                                _isLoadingOlder.value = false
                            }
                        }
                    }
                    event is WsEvent.ChatTurnEvent && event.conversationId == conversationId -> {
                        applyChatTurnEvent(event)
                    }
                    event is WsEvent.ChatActiveTurnSnapshot && event.conversationId == conversationId && event.status == "active" && event.events.isNotEmpty() -> {
                        // Preferred path: replay the desktop's sequence-ordered event log
                        // through the exact same fold the live wsClient.events collector uses
                        // (applyChatTurnEvent), so re-entering mid-turn lands in the identical
                        // state — text/thinking/tool-calls positioned in true chronological
                        // order — that staying connected the whole time would have produced,
                        // instead of the flattened-bucket approximation in the branch below.
                        // Guarded so a duplicate/redelivered snapshot (or one that raced behind
                        // live events that already arrived) doesn't re-run and re-freeze state.
                        val alreadyReplayed = _liveTurnState.value.turnId == event.turnId &&
                            _liveTurnState.value.lastSequence >= event.latestSequence
                        if (!alreadyReplayed) {
                            val restored = turnCoordinator.restore(event.events)
                            _liveTurnState.value = restored.state
                            snapshotRequestedForGap = restored.needsSnapshot
                        }
                    }
                    event is WsEvent.ChatActiveTurnSnapshot && event.conversationId == conversationId && event.status == "active" -> {
                        // Fallback for desktop builds that don't yet send `events` — restores
                        // tool calls that already ran (and the current activity) when
                        // re-entering a chat mid-generation. Without this, only tool calls that
                        // happened to start *after* re-entry ever appeared; everything from
                        // before was invisible until the whole turn settled, since neither
                        // WsRepository's own client-accumulated activeChatSnapshots (only
                        // populated while actively connected) nor liveTurnState carried it.
                        // Insert-if-absent, same as the tool_started handler above — a tool
                        // call already promoted (from a live tool_started/ChatToolCallEvent
                        // that raced ahead of this response) must not be duplicated. Note this
                        // path always renders all restored text before all restored tool calls
                        // regardless of their true interleaving — the `events` branch above is
                        // what actually fixes ordering.
                        if (!isTurnTerminal) {
                            _liveTurnState.value = _liveTurnState.value.copy(status = ChatTurnStatus.Active)
                            if (event.activity != null) {
                                _liveTurnState.value = _liveTurnState.value.copy(
                                    activity = ChatTurnActivity(
                                        state = event.activity.state,
                                        label = event.activity.label,
                                        toolName = event.activity.toolName,
                                        serverName = event.activity.serverName,
                                    ),
                                )
                            }
                        }
                        val current = _messages.value
                        val toInsert = mutableListOf<ChatMessage>()
                        // The restored lead-in text was written *before* any of the restored
                        // tool calls, so it must be inserted first — pre-registering it under
                        // currentLiveMessageId means the separate ChatAnimationRepository-driven
                        // observer (which owns the actual reveal animation) finds streamingIdx
                        // already >= 0 once it catches up and patches this entry in place,
                        // instead of racing to append its own copy of the text *after* the tool
                        // calls below, which left it stuck at the bottom looking like the newest
                        // thing generated instead of the oldest.
                        if (event.assistantText.isNotEmpty() && current.none { it.id == currentLiveMessageId }) {
                            toInsert.add(
                                ChatMessage(
                                    id = currentLiveMessageId,
                                    text = event.assistantText,
                                    isUser = false,
                                    isStreaming = true,
                                ),
                            )
                            textSegmentStart = event.assistantText.length
                        }
                        val missing = event.toolCalls.filter { tc ->
                            tc.id == null || current.none { it.id == tc.id && it.isToolCall }
                        }
                        toInsert.addAll(
                            missing.map { tc ->
                                ChatMessage(
                                    id = tc.id ?: UUID.randomUUID().toString(),
                                    text = "",
                                    isUser = false,
                                    isStreaming = tc.inProgress,
                                    isToolCall = true,
                                    toolName = tc.toolName,
                                    serverName = tc.serverName,
                                    toolArgs = tc.argsJson,
                                    toolResult = tc.result,
                                    toolSuccess = tc.success,
                                )
                            },
                        )
                        if (toInsert.isNotEmpty()) _messages.value = current + toInsert
                    }
                    event is WsEvent.ChatActiveTurnSnapshot && event.conversationId == conversationId -> {
                        // Authoritative status is "completed"/"failed" here (the "active" cases
                        // are handled by the two branches above). This is the correction path
                        // for the race where refreshMessages() applied stale local/WsRepository
                        // state as Active before this snapshot came back — without it, a turn
                        // missed while backgrounded (socket closed, so no live
                        // turn_completed/turn_failed push) left the "Thinking..." spinner
                        // running forever with no way to clear. Replay any not-yet-applied
                        // events first so the final tool-call/text ordering is correct even for
                        // a turn that finished entirely while this client was disconnected.
                        val alreadyReplayed = _liveTurnState.value.turnId == event.turnId &&
                            _liveTurnState.value.lastSequence >= event.latestSequence
                        if (!alreadyReplayed && event.events.isNotEmpty()) {
                            val restored = turnCoordinator.restore(event.events)
                            _liveTurnState.value = restored.state
                            snapshotRequestedForGap = restored.needsSnapshot
                        }
                        if (!isTurnTerminal) {
                            _liveTurnState.value = _liveTurnState.value.copy(
                                status = if (event.status == "failed") ChatTurnStatus.Failed else ChatTurnStatus.Completed,
                                thinkingBlocks = emptyList(),
                                pendingThinkingEnds = emptySet(),
                                activity = null,
                                generationStartedAt = null,
                            )
                        }
                        _drainActive.value = false
                        stopActiveHistoryPolling()
                        WsRepository.clearConversationActiveState(conversationId)
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
                                requestLatestHistory()
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
                    event is WsEvent.ChatToolCallEvent && event.conversationId == conversationId && wsClient !== WsRepository -> {
                        // Used to clear _liveTurnState.thinkingBlocks here on the theory that a
                        // tool call starts a fresh "thinking cycle" — but thinkingBlocks is keyed
                        // by blockId (reduceChatTurn's upsertThinkingBlock), so a new reasoning
                        // phase after this tool call already gets its own distinct blockId/bubble
                        // without needing the list wiped first. Wiping it here instead discarded
                        // every reasoning block accumulated *before* this tool call on every
                        // single tool call in the turn — for a Codex turn with many interleaved
                        // tool calls, that meant each reasoning bubble visibly vanished the
                        // moment the next tool call fired, then "came back" once the *next*
                        // reasoning phase started accumulating from scratch. Removed.
                        //
                        // If tool_started already inserted an in-progress placeholder for this
                        // same id (see the ChatTurnEvent branch above), update it in place instead
                        // of appending a second bubble — otherwise every tool call would render
                        // twice, once running and once completed. A transport that never sent
                        // tool_started (or a dropped event) falls back to the old append-only
                        // behavior via the -1 branch.
                        val current = _messages.value
                        val placeholderIdx = event.id?.let { id -> current.indexOfLast { it.id == id && it.isToolCall } } ?: -1
                        _messages.value = if (placeholderIdx >= 0) {
                            current.toMutableList().also {
                                it[placeholderIdx] = it[placeholderIdx].copy(
                                    isStreaming = false,
                                    toolName = event.toolName,
                                    serverName = event.serverName,
                                    toolArgs = event.args ?: it[placeholderIdx].toolArgs,
                                    toolResult = event.result,
                                    toolSuccess = event.success,
                                )
                            }
                        } else {
                            current + ChatMessage(
                                // A stable id (not the default "") so ChatRenderItem.ToolCall's key
                                // stays fixed for this tool call's whole life in the live-tracked
                                // list — otherwise its key derived from position among tool-call
                                // messages, which shifts (and forces a Compose remount) whenever a
                                // history-sync reconciliation changes how many/which tool calls
                                // precede it. Same bug class as the streaming-text key instability
                                // fixed via currentLiveMessageId, just for tool calls.
                                id = event.id ?: UUID.randomUUID().toString(),
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
                            requestLatestHistory()
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
                    event is WsEvent.TeachbackReady && awaitingTeachbackInsert -> {
                        awaitingTeachbackInsert = false
                        removePendingArtifactRefMessage("teachback")
                        insertArtifactRefMessage(event.artifactId, event.versionId, "teachback", conversationId)
                    }
                    event is WsEvent.TeachbackError && awaitingTeachbackInsert -> {
                        awaitingTeachbackInsert = false
                        removePendingArtifactRefMessage("teachback")
                        _slashCommandMessage.value = "Failed to generate teach-back: ${event.message}"
                    }
                    event is WsEvent.CodeChangeReport -> {
                        val pending = pendingCodeChangeAction
                        if (awaitingCodeChangePlan) {
                            awaitingCodeChangePlan = false
                            if (event.reportId != null) codeChangeReportId = event.reportId
                            when {
                                event.reportId == null ->
                                    _slashCommandMessage.value = "No code change plan found for this conversation. Run /code-change <description> first."
                                event.plan.isNullOrBlank() ->
                                    _slashCommandMessage.value = "No plan yet for this code change — investigation may still be running."
                                else ->
                                    // A generated plan can run to several paragraphs — a Snackbar would
                                    // truncate/auto-dismiss it before it's readable, so this goes into
                                    // the transcript as a normal message instead of _slashCommandMessage.
                                    WsRepository.insertMessage(conversationId, "system", formatCodeChangePlan(event))
                            }
                        }
                        if (pending != null) {
                            pendingCodeChangeAction = null
                            if (event.reportId == null) {
                                _slashCommandMessage.value = "No code change found for this conversation. Run /code-change <description> first."
                            } else {
                                codeChangeReportId = event.reportId
                                dispatchCodeChangeAction(pending, event.reportId)
                            }
                        }
                    }
                    event is WsEvent.CodeChangeAck -> {
                        when (event.kind) {
                            "code-change:submitted" -> if (awaitingCodeChangeSubmit) {
                                awaitingCodeChangeSubmit = false
                                codeChangeReportId = event.reportId
                                // The plan itself is persisted as a message server-side (see
                                // ws-handlers.ts's code-change:submit-description handler) rather
                                // than sent only via this event — the investigation can run for
                                // minutes, during which this ViewModel instance may no longer be
                                // alive to react (app backgrounded, user navigated away), so this
                                // Snackbar is just a best-effort nudge for whoever's still
                                // watching, not the only place the result appears. Run /code-plan
                                // to re-view it later if needed.
                                _slashCommandMessage.value = "Plan ready — run /code-execute to apply it."
                            }
                            "code-change:accepted", "code-change:completed" -> if (awaitingCodeChangeAccept) {
                                awaitingCodeChangeAccept = false
                                codeChangeReportId = event.reportId
                                _slashCommandMessage.value = "Code change executed, verified, and committed."
                            }
                            "code-change:pushed" -> if (awaitingCodeChangePush) {
                                awaitingCodeChangePush = false
                                _slashCommandMessage.value = "Changes pushed."
                            }
                        }
                    }
                    event is WsEvent.CodeChangeUndone -> {
                        if (awaitingCodeChangeUndo) {
                            awaitingCodeChangeUndo = false
                            _slashCommandMessage.value = if (event.rolledBack) {
                                "Code change undone."
                            } else {
                                "Nothing to undo: ${event.error ?: "no rollback available"}"
                            }
                        }
                    }
                    event is WsEvent.CodeChangeStatusResult && awaitingCodeChangeStatus -> {
                        awaitingCodeChangeStatus = false
                        // Multi-line summary — same reasoning as the plan above, a real message
                        // rather than a Snackbar so it stays readable and on-screen.
                        WsRepository.insertMessage(conversationId, "system", formatCodeChangeStatus(event))
                    }
                    event is WsEvent.CodeChangeError -> {
                        if (
                            awaitingCodeChangeSubmit || awaitingCodeChangePlan || awaitingCodeChangeAccept ||
                            awaitingCodeChangePush || awaitingCodeChangeUndo || awaitingCodeChangeStatus ||
                            pendingCodeChangeAction != null
                        ) {
                            awaitingCodeChangeSubmit = false
                            awaitingCodeChangePlan = false
                            awaitingCodeChangeAccept = false
                            awaitingCodeChangePush = false
                            awaitingCodeChangeUndo = false
                            awaitingCodeChangeStatus = false
                            pendingCodeChangeAction = null
                            _slashCommandMessage.value = "Code change error: ${event.error}"
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

    fun refreshMessages(showRefreshIndicator: Boolean = true) {
        _isRefreshing.value = showRefreshIndicator
        historyLoaded = false
        _liveTurnState.value = _liveTurnState.value.copy(thinkingBlocks = emptyList(), generationStartedAt = null)
        requestLatestHistory()
        if (wsClient === WsRepository) {
            wsClient.send("chat:get-active-turn", mapOf("conversationId" to conversationId))
        }
    }

    /** Fetches the page immediately before the oldest message currently displayed. */
    fun loadOlderMessages() {
        val beforeTimestamp = oldestLoadedTimestamp ?: return
        val beforeId = oldestLoadedId ?: return
        if (!hasOlderMessages || _isLoadingOlder.value) return
        _isLoadingOlder.value = true
        wsClient.send(
            "conversation:get-messages",
            mapOf(
                "conversationId" to conversationId,
                "limit" to HISTORY_PAGE_SIZE,
                "beforeTimestamp" to beforeTimestamp,
                "beforeId" to beforeId,
            ),
        )
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

    /**
     * `plan` is generated with a leading YAML front-matter block (confidence, root_cause,
     * affected_files) per the backend's investigation prompt — showing it raw in chat is exactly
     * the "clunky, raw YAML dumped into the UI" complaint that motivated retiring the old wizard.
     * The same three values already arrive parsed on this event, so this formats a clean summary
     * from those instead of re-displaying the YAML block.
     */
    private fun formatCodeChangePlan(event: WsEvent.CodeChangeReport): String {
        val body = event.plan.orEmpty().replace(Regex("^---\\n[\\s\\S]*?\\n---\\n?"), "").trim()
        val metaLines = buildList {
            event.confidence?.takeIf { it.isNotBlank() }?.let { add("Confidence: $it") }
            event.rootCause?.takeIf { it.isNotBlank() }?.let { add("Root cause: $it") }
            if (event.affectedFiles.isNotEmpty()) add("Affected files: ${event.affectedFiles.joinToString(", ")}")
        }
        val meta = if (metaLines.isNotEmpty()) metaLines.joinToString("\n") { "- $it" } else ""
        return listOf(meta, body).filter { it.isNotBlank() }.joinToString("\n\n")
    }

    /** Formats the code-change:get-status reply into a short chat-friendly summary for /code-status. */
    private fun formatCodeChangeStatus(event: WsEvent.CodeChangeStatusResult): String {
        if (event.reportId == null) {
            return "No code change in progress for this conversation."
        }
        val stepLine = "Step: ${event.step ?: "unknown"}"
        val titleLine = event.title?.takeIf { it.isNotBlank() }?.let { "Title: $it" }
        val gitLine = if (event.gitRepoOk) {
            "Git repo: ${event.gitRepoRelativePath?.takeIf { it.isNotBlank() } ?: "(workspace root)"}"
        } else {
            "Git repo: not found${event.gitRepoReason?.let { " ($it)" } ?: ""}"
        }
        return listOfNotNull(stepLine, titleLine, gitLine).joinToString("\n")
    }

    /** Unlike normal chat sends, the composer has no isStreaming/isAwaitingResponse-driven block
     *  on re-sending while a code-change command is in flight — without this guard the user could
     *  fire e.g. /code-execute twice concurrently and race two accept-plan requests against the
     *  same report. */
    private fun isCodeChangeBusy(): Boolean =
        awaitingCodeChangeSubmit || awaitingCodeChangePlan || awaitingCodeChangeAccept ||
            awaitingCodeChangePush || awaitingCodeChangeUndo || awaitingCodeChangeStatus ||
            pendingCodeChangeAction != null

    /** Runs [action] ("execute"/"push"/"undo") against the cached report id for this
     *  conversation, looking it up via code-change:get-report-for-conversation first if it isn't
     *  cached yet (e.g. app was restarted, or /code-change hasn't been run this session). */
    private fun runWithCodeChangeReportId(action: String) {
        val cached = codeChangeReportId
        if (cached != null) {
            dispatchCodeChangeAction(action, cached)
        } else {
            pendingCodeChangeAction = action
            WsRepository.getCodeChangeReportForConversation(conversationId)
        }
    }

    private fun dispatchCodeChangeAction(action: String, reportId: String) {
        when (action) {
            "execute" -> {
                awaitingCodeChangeAccept = true
                _slashCommandMessage.value = "Running the plan: applying the fix, verifying, and committing…"
                WsRepository.acceptCodeChangePlan(reportId)
            }
            "push" -> {
                awaitingCodeChangePush = true
                WsRepository.pushCodeChange(reportId)
            }
            "undo" -> {
                awaitingCodeChangeUndo = true
                WsRepository.undoCodeChange(reportId)
            }
        }
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
    fun trySlashCommand(
        rawInput: String,
        projectId: String?,
        onNewChat: () -> Unit = {},
        onOpenCodePanel: (String) -> Unit = {},
    ): Boolean {
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
                val matching = if (argText.isBlank()) {
                    MOBILE_SLASH_COMMANDS
                } else {
                    MOBILE_SLASH_COMMANDS.filter { it.name.contains(argText, ignoreCase = true) }
                }
                _slashCommandMessage.value = if (matching.isEmpty()) {
                    "No commands match \"$argText\"."
                } else {
                    val lines = matching.joinToString("\n") { "${it.usage} — ${it.description}" }
                    if (argText.isBlank()) "Available commands:\n$lines" else "Commands matching \"$argText\":\n$lines"
                }
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
            "/teachback" -> {
                awaitingTeachbackInsert = true
                insertPendingArtifactRefMessage("teachback")
                val topic = argText.replace(Regex("^(on|about|regarding)\\s+", RegexOption.IGNORE_CASE), "").ifBlank { null }
                WsRepository.generateTeachback(conversationId, projectId, topic)
            }
            "/code-change" -> {
                // A trailing "[repo]" (as the git-housekeeping commands use) would be ambiguous
                // against free-form description text that happens to end in brackets, so the
                // optional repo hint — only needed when the workspace has more than one git repo
                // — goes in brackets at the START instead: "/code-change [repo] <description>".
                val repoMatch = Regex("^\\[([^\\]]+)\\]\\s*(.*)$", RegexOption.DOT_MATCHES_ALL).find(argText)
                val description = repoMatch?.groupValues?.get(2)?.trim() ?: argText
                val repoArg = repoMatch?.groupValues?.get(1)?.trim()
                if (isCodeChangeBusy()) {
                    _slashCommandMessage.value = "A code change command is still running — wait for it to finish first."
                } else if (projectId.isNullOrBlank()) {
                    _slashCommandMessage.value = "Code changes require this conversation to be in a project."
                } else if (description.isBlank()) {
                    _slashCommandMessage.value = "Usage: /code-change [repo] <description of the change you want>"
                } else {
                    awaitingCodeChangeSubmit = true
                    _slashCommandMessage.value = "Investigating code change…"
                    WsRepository.submitCodeChangeDescription(conversationId, projectId, description, repoArg)
                }
            }
            "/code-plan" -> {
                if (isCodeChangeBusy()) {
                    _slashCommandMessage.value = "A code change command is still running — wait for it to finish first."
                } else {
                    awaitingCodeChangePlan = true
                    WsRepository.getCodeChangeReportForConversation(conversationId)
                }
            }
            "/code-execute" -> {
                if (isCodeChangeBusy()) {
                    _slashCommandMessage.value = "A code change command is still running — wait for it to finish first."
                } else {
                    runWithCodeChangeReportId("execute")
                }
            }
            "/code-push" -> {
                if (isCodeChangeBusy()) {
                    _slashCommandMessage.value = "A code change command is still running — wait for it to finish first."
                } else {
                    runWithCodeChangeReportId("push")
                }
            }
            "/code-undo" -> {
                if (isCodeChangeBusy()) {
                    _slashCommandMessage.value = "A code change command is still running — wait for it to finish first."
                } else {
                    runWithCodeChangeReportId("undo")
                }
            }
            "/code-status" -> {
                if (isCodeChangeBusy()) {
                    _slashCommandMessage.value = "A code change command is still running — wait for it to finish first."
                } else {
                    awaitingCodeChangeStatus = true
                    WsRepository.getCodeChangeStatus(conversationId)
                }
            }
            "/code" -> {
                if (projectId.isNullOrBlank()) {
                    _slashCommandMessage.value = "The git panel requires this conversation to be in a project."
                } else {
                    onOpenCodePanel(projectId)
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
        _thinkingEffortOverride.value = value
        sendModeOverride("thinkingEffortOverride", value)
    }

    fun setFullAutoApproveOverride(value: Boolean?) {
        _fullAutoApproveOverride.value = value
        sendModeOverride("fullAutoApproveOverride", value)
    }

    fun setTerminalSandboxOverride(value: Boolean?) {
        _terminalSandboxOverride.value = value
        sendModeOverride("terminalSandboxOverride", value)
    }

    fun setCliModeOverride(value: String?) {
        _cliModeOverride.value = value
        sendModeOverride("cliModeOverride", value)
    }

    fun setCodexExecutionModeOverride(value: String?) {
        _codexExecutionModeOverride.value = value
        sendModeOverride("codexExecutionModeOverride", value)
    }

    // A draft conversation (unsent first message) only exists as a client-side UUID — sending
    // conversation:set-mode for it now would target an id the desktop has never heard of and
    // silently no-op. Queue it instead; the WsRepository.conversations collector in init{} flushes
    // it the moment the conversation actually shows up server-side.
    private fun sendModeOverride(key: String, value: Any?) {
        val conversationExists = wsClient !== WsRepository || WsRepository.conversations.value.any { it.id == conversationId }
        if (conversationExists) {
            wsClient.send(
                "conversation:set-mode",
                mapOf(
                    "conversationId" to conversationId,
                    key to (value ?: JSONObject.NULL),
                ),
            )
        } else {
            pendingModeOverrides[key] = value
        }
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
        turnCoordinator.reset()
        _liveTurnState.value = emptyChatTurnState(conversationId).copy(
            status = ChatTurnStatus.Active,
            generationStartedAt = System.currentTimeMillis(),
        )
        // Drop any stale animation state from a prior turn (e.g. Retry) so the observer
        // below can't replay an already-settled ChatAnimationState against the freshly
        // synced history and append a duplicate copy of the previous answer.
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
            requestLatestHistory()
        }
    }

    private fun stopActiveHistoryPolling() {
        activeHistoryPollJob?.cancel()
        activeHistoryPollJob = null
    }

    private fun requestLatestHistory() {
        val payload = if (wsClient === WsRepository) {
            mapOf("conversationId" to conversationId, "limit" to HISTORY_PAGE_SIZE)
        } else {
            // Non-production WsClient implementations retain the original protocol shape.
            mapOf("conversationId" to conversationId)
        }
        wsClient.send("conversation:get-messages", payload)
    }

    /**
     * Implements stale-while-revalidate for an existing conversation. Room is the fast path on
     * entry; the following websocket request is still authoritative, but it must not blank the
     * cached timeline or show a pull-to-refresh spinner while it is in flight.
     */
    private fun hydrateCachedHistoryThenRefresh() {
        val repository = localData ?: return
        viewModelScope.launch {
            val cachedPage = withContext(Dispatchers.IO) {
                runCatching { repository.listPage(conversationId, HISTORY_PAGE_SIZE) }.getOrNull()
            }
            if (cachedPage != null && cachedPage.messages.isNotEmpty()) {
                val cachedMessages = withContext(Dispatchers.Default) {
                    cachedPage.messages.map { it.toChatMessage() }
                }
                _messages.value = cachedMessages
                oldestLoadedTimestamp = cachedMessages.firstOrNull()?.timestamp
                oldestLoadedId = cachedMessages.firstOrNull()?.id
                hasOlderMessages = cachedPage.hasMore
            }
            // The Room read is now the authoritative "did this conversation already have local
            // history" check — flip the loading flag regardless of the outcome so a genuinely
            // empty/new conversation still falls through to the empty state promptly.
            _isInitialHistoryLoading.value = false
            // Leave historyLoaded false: the incoming desktop page must reconcile even when the
            // cache is populated. The UI already has content, so this is deliberately silent.
            refreshMessages(showRefreshIndicator = false)
        }
    }

    private fun restoreInMemoryHistory() {
        val cachedMessages = ChatHistoryMemoryCache.get(conversationId) ?: return
        _messages.value = cachedMessages
        oldestLoadedTimestamp = cachedMessages.firstOrNull()?.timestamp
        oldestLoadedId = cachedMessages.firstOrNull()?.id
        _isInitialHistoryLoading.value = false
    }

}
