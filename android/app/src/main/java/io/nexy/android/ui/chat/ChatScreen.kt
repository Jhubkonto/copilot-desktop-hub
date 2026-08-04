package io.nexy.android.ui.chat

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import android.Manifest
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.OpenableColumns
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.IntOffset
import androidx.compose.material3.FloatingActionButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import io.nexy.android.ui.theme.Blue500
import io.nexy.android.ui.theme.Green500
import io.nexy.android.ui.theme.Gray400
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.PreferenceStore
import io.nexy.android.data.WsRepository
import io.nexy.android.data.repository.InternetState
import io.nexy.android.data.model.PromptEntry
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.snapshotFlow
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tables.TableTheme
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.linkify.LinkifyPlugin
import io.noties.markwon.syntax.Prism4jTheme
import io.noties.markwon.syntax.SyntaxHighlightPlugin
import io.noties.prism4j.Prism4j
import android.text.SpannableStringBuilder
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.prompts.CreatePromptSheet
import io.nexy.android.ui.model.agentBackendLockDetail
import io.nexy.android.ui.model.agentBackendLockLabel
import io.nexy.android.ui.model.activeModelDetail
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.model.resolveAvailableProjectDefault
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import io.nexy.android.ui.model.cliBackendForModel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.runtime.withFrameNanos
import io.nexy.android.ui.voice.PcmRecorderStopReason
import io.nexy.android.ui.voice.PcmRecorderSnapshot
import io.nexy.android.ui.voice.PcmRecorderState
import io.nexy.android.ui.voice.VoiceDock
import io.nexy.android.ui.voice.VoiceDockController
import io.nexy.android.ui.voice.VoiceDockUiState
import io.nexy.android.service.NexySpeechService
import io.nexy.android.service.SpokenOutputKind
import io.nexy.android.service.createQuickRecap
import io.nexy.android.service.sanitizeForSpeech
import io.nexy.android.service.SpokenPlaybackStatus
import io.nexy.android.share.ShareIntentRepository

/**
 * Snapshot key for the auto-follow re-pin effect. Value-equality across all fields is what makes
 * `snapshotFlow` emit only on a real change: [lastBottom] (the last visible item's bottom edge) and
 * [canScrollForward] catch a sibling segment's late height growth displacing the tail below the fold,
 * which [itemCount] + the last item's own size alone did not.
 */
private data class ScrollPinSignal(
    val follow: Boolean,
    val itemCount: Int,
    val lastIndex: Int,
    val lastBottom: Int,
    val canScrollForward: Boolean,
)

private fun decodeUtf8Text(bytes: ByteArray): String? = runCatching {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
        .decode(java.nio.ByteBuffer.wrap(bytes))
        .toString()
}.getOrNull()

/** Small "Completed" indicator shown in the chat header's title area when the open
 * conversation is marked complete — the in-chat counterpart to the checkmark already shown
 * for completed conversations in list screens (e.g. ScopedChatHistoryScreen). */
@Composable
fun ChatCompletedBadge() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        NexyIcon(
            NexyIconName.CheckedBox,
            contentDescription = null,
            modifier = Modifier.size(14.dp),
            tint = Green500,
        )
        Text(
            "Completed",
            maxLines = 1,
            style = MaterialTheme.typography.labelSmall,
            color = Green500,
        )
    }
}

/** Passive "N/5" star readout shown in the chat header once a conversation has been rated —
 * mutation happens via ConversationActionsSheet, mirroring how ChatCompletedBadge is a
 * read-only indicator for the /complete slash command's state. */
@Composable
fun ChatRatingBadge(rating: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(
            Icons.Default.Star,
            contentDescription = null,
            modifier = Modifier.size(12.dp),
            tint = Color(0xFFF59E0B),
        )
        Text(
            "$rating/5",
            maxLines = 1,
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFFF59E0B),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    conversationId: String,
    agentId: String? = null,
    projectId: String? = null,
    onBack: () -> Unit,
    onOpenArtifacts: ((String?) -> Unit)? = null,
    onOpenDebrief: ((String) -> Unit)? = null,
    // (conversationId, artifactId) — artifactId is the specific quiz card tapped, so the
    // quiz screen can load that exact artifact instead of re-deriving "the quiz for this
    // conversation" (see ArtifactRefBubble's onOpenQuiz dispatch for why that matters).
    onOpenQuiz: ((String, String) -> Unit)? = null,
    onOpenTeachback: ((String, String) -> Unit)? = null,
    onOpenFork: ((String) -> Unit)? = null,
    onOpenRemoteEditWithPrefill: ((String, String) -> Unit)? = null,
    onOpenCodePanel: ((String) -> Unit)? = null,
    onOpenAutomatedWorkflow: ((String) -> Unit)? = null,
    onOpenDesktopPathPicker: (() -> Unit)? = null,
    initialMessageId: String? = null,
    sharedBatchId: String? = null,
    onNewChat: ((String?, String?) -> Unit)? = null,
    vm: ChatViewModel = viewModel(
        factory = remember(conversationId, agentId, projectId) {
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>) =
                    ChatViewModel(conversationId, agentId = agentId, projectId = projectId) as T
            }
        },
    ),
) {
    val messages by vm.messages.collectAsStateWithLifecycle()
    LaunchedEffect(messages.isNotEmpty()) {
        if (messages.isNotEmpty()) {
            withFrameNanos { }
            vm.reportFirstMessageFrameRendered(messages.size)
            withFrameNanos { }
            vm.reportVisibleRichContentSettled(messages.size)
        }
    }
    val isStreaming by vm.isStreaming.collectAsStateWithLifecycle()
    val isAwaitingResponse by vm.isAwaitingResponse.collectAsStateWithLifecycle()
    val isRefreshing by vm.isRefreshing.collectAsStateWithLifecycle()
    val isLoadingOlder by vm.isLoadingOlder.collectAsStateWithLifecycle()
    val isInitialHistoryLoading by vm.isInitialHistoryLoading.collectAsStateWithLifecycle()
    val isReconcilingHistory by vm.isReconcilingHistory.collectAsStateWithLifecycle()
    val activityLabel by vm.activityLabel.collectAsStateWithLifecycle()
    val liveActivity by vm.liveActivity.collectAsStateWithLifecycle()
    val liveThinkingBlocks by vm.liveThinkingBlocks.collectAsStateWithLifecycle()
    val liveTurnState by vm.liveTurnState.collectAsStateWithLifecycle()
    val generationStartedAt by vm.generationStartedAt.collectAsStateWithLifecycle()
    val selectedModel by vm.selectedModel.collectAsStateWithLifecycle()
    val attachments by vm.attachments.collectAsStateWithLifecycle()
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val models by WsRepository.models.collectAsStateWithLifecycle()
    val modelSource by WsRepository.modelSource.collectAsStateWithLifecycle()
    val cliStatus by WsRepository.cliStatus.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val capabilities by WsRepository.capabilities.collectAsStateWithLifecycle()
    val voiceCapabilities by WsRepository.voiceCapabilities.collectAsStateWithLifecycle()
    val lastError by WsRepository.lastError.collectAsStateWithLifecycle()
    val effectiveMode by WsRepository.effectiveMode.collectAsStateWithLifecycle()
    val emergencyStopActive by WsRepository.emergencyStopActive.collectAsStateWithLifecycle()
    val conversation = conversations.find { it.id == conversationId }
    val isCompleted = conversation?.completed_at != null
    val conversationRating = conversation?.rating
    val title = conversation?.title?.ifBlank { null } ?: "Chat"
    val chatThinkingEffortOverride by vm.thinkingEffortOverride.collectAsStateWithLifecycle()
    val chatFullAutoApproveOverride by vm.fullAutoApproveOverride.collectAsStateWithLifecycle()
    val chatAgenticModeOverride by vm.agenticModeOverride.collectAsStateWithLifecycle()
    val chatTerminalSandboxOverride by vm.terminalSandboxOverride.collectAsStateWithLifecycle()
    val chatCliModeOverride by vm.cliModeOverride.collectAsStateWithLifecycle()
    val chatCodexExecutionModeOverride by vm.codexExecutionModeOverride.collectAsStateWithLifecycle()
    val chatAgentId = conversation?.agent_id ?: agentId
    val chatAgent = chatAgentId?.let { id -> agents.find { it.id == id } }
    val activeCliBackend = (chatAgent?.backend ?: modelSource?.backend)
        ?.takeIf { it == "claude-cli" || it == "codex-cli" }
        ?: cliBackendForModel(models.find { it.id == selectedModel })
    val chatBackend = chatAgent?.backend
    val statusProjectId = conversation?.project_id ?: projectId
    val chatProject = statusProjectId?.let { id -> projects.find { it.id == id } }
    val availableProjectDefault = resolveAvailableProjectDefault(chatProject?.defaultModel, models)
    val projectDefaultApplied = conversation?.model.isNullOrBlank() &&
        availableProjectDefault != null &&
        selectedModel == availableProjectDefault
    var chatAgentFullAutoApprove by remember { mutableStateOf(false) }
    var chatProjectWorkflowMode by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(chatAgentId) {
        if (chatAgentId != null) WsRepository.requestAgentFull(chatAgentId) else chatAgentFullAutoApprove = false
    }
    LaunchedEffect(statusProjectId) {
        if (!statusProjectId.isNullOrBlank()) WsRepository.getProjectConfig(statusProjectId) else chatProjectWorkflowMode = null
    }

    var activeWorkflowRun by remember { mutableStateOf<io.nexy.android.data.model.AutomatedWorkflowRunInfo?>(null) }
    var dismissedWorkflowStepId by remember { mutableStateOf<String?>(null) }

    // Keyed on connectionState too — not just statusProjectId — so a reconnect re-fetches
    // instead of leaving the banner showing whatever state it had before the phone disconnected
    // (a run can fully progress through several auto-executed steps while disconnected). Mirrors
    // RemoteEditReportDetailScreen.kt's established pattern. Not gated on workflowMode: Automated
    // Workflow is a fully independent, top-level feature, so a run started in any project mode
    // must still surface here, otherwise it executes with silent, invisible progress.
    LaunchedEffect(statusProjectId, connectionState) {
        dismissedWorkflowStepId = null
        if (!statusProjectId.isNullOrBlank() && connectionState == ConnectionState.CONNECTED) {
            WsRepository.listAutomatedWorkflowRuns(statusProjectId)
        } else if (statusProjectId.isNullOrBlank()) {
            activeWorkflowRun = null
        }
    }

    // "Current" means "needs a human's attention" — running (informational only),
    // awaiting_confirmation (needs approval), or failed (needs retry/skip) — rather than "the
    // next one a human would manually start" (steps auto-advance now).
    val currentWorkflowStep = remember(activeWorkflowRun) {
        activeWorkflowRun?.steps?.firstOrNull {
            it.status == "running" || it.status == "awaiting_confirmation" || it.status == "failed"
        }
    }

    val customSlashCommands by vm.customSlashCommands.collectAsStateWithLifecycle()
    val draftFromVm by vm.draft.collectAsStateWithLifecycle()
    var input by remember { mutableStateOf(draftFromVm) }
    var editingMessageId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(draftFromVm) {
        if (input.isBlank() && draftFromVm.isNotBlank()) input = draftFromVm
    }
    // Consumes a prefill left by an entry point outside chat (e.g. the /code panel's "Resolve
    // with AI in chat" action) that navigated here wanting a command prefilled rather than
    // firing it itself before this screen — and this screen's ChatViewModel — existed.
    LaunchedEffect(conversationId) {
        WsRepository.pendingComposerPrefill?.let { prefill ->
            WsRepository.pendingComposerPrefill = null
            input = prefill
            vm.setDraft(prefill)
        }
    }
    val restoredViewState = remember(conversationId) { ChatHistoryMemoryCache.getViewState(conversationId) }
    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = restoredViewState?.itemIndex ?: 0,
        initialFirstVisibleItemScrollOffset = restoredViewState?.itemOffset ?: 0,
    )
    var shouldAutoFollow by remember(conversationId) { mutableStateOf(restoredViewState?.shouldAutoFollow ?: true) }
    var hasInitiallyScrolled by remember(conversationId) { mutableStateOf(restoredViewState != null) }
    var programmaticScrollInProgress by remember { mutableStateOf(false) }
    var olderPageArmed by remember { mutableStateOf(true) }
    val context = LocalContext.current
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()
    var showModeSheet by remember { mutableStateOf(false) }
    val modeSheetState = rememberModalBottomSheetState()
    var showActionsSheet by remember { mutableStateOf(false) }
    var showEmergencyStopConfirmation by remember { mutableStateOf(false) }
    var showPromptSheet by remember { mutableStateOf(false) }
    val promptSheetState = rememberModalBottomSheetState()
    var showInspectorSheet by remember { mutableStateOf(false) }
    val inspectorSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(sharedBatchId) {
        val batchId = sharedBatchId ?: return@LaunchedEffect
        val batch = withContext(Dispatchers.IO) { ShareIntentRepository.load(context, batchId) }
        if (batch == null) {
            snackbarHostState.showSnackbar("The shared files are no longer available.")
            return@LaunchedEffect
        }
        batch.text?.let { sharedText ->
            input = if (input.isBlank()) sharedText else "$input\n$sharedText"
            vm.setDraft(input)
        }
        var imported = 0
        for (attachment in batch.attachments) {
            val bytes = withContext(Dispatchers.IO) {
                runCatching { java.io.File(attachment.localPath).readBytes() }.getOrNull()
            } ?: continue
            val dataUrl = "data:${attachment.mimeType};base64," +
                android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            vm.addAttachment(
                name = attachment.name,
                mimeType = attachment.mimeType,
                dataUrl = dataUrl,
                textContent = decodeUtf8Text(bytes),
            )
            imported++
        }
        ShareIntentRepository.discard(context, batchId)
        if (batch.rejectedCount > 0) {
            snackbarHostState.showSnackbar("$imported attached · ${batch.rejectedCount} skipped because of size or access limits.")
        }
    }
    val preferenceStore = remember(context) { PreferenceStore.getInstance(context) }
    val voiceDockEnabled by preferenceStore.getVoiceDockV1().collectAsState(initial = true)
    val spokenOutputEnabled by preferenceStore.getSpokenOutputV1().collectAsState(initial = true)
    val spokenOutputSettings by preferenceStore.getSpokenOutputSettings().collectAsState(
        initial = preferenceStore.currentSpokenOutputSettings(),
    )
    val spokenPlaybackState by NexySpeechService.state.collectAsStateWithLifecycle()
    var aiRecapPendingMessageId by remember { mutableStateOf<String?>(null) }
    var voiceDockFloating by remember {
        mutableStateOf(voiceDockEnabled && preferenceStore.isVoiceDockFloating())
    }
    val transcriptHandler by rememberUpdatedState(newValue = { text: String ->
        input = if (input.isBlank()) text else "${input.trimEnd()} $text"
        vm.setDraft(input)
    })
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { transcriptHandler(it) },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )
    val voiceDockController = remember(context, scope) {
        VoiceDockController(
            context = context,
            wsClient = WsRepository,
            scope = scope,
            onTranscript = { transcriptHandler(it) },
        )
    }
    val voiceDockState by voiceDockController.state.collectAsStateWithLifecycle()
    val usePairedVoice = connectionState == ConnectionState.CONNECTED &&
        voiceCapabilities.audioUpload &&
        voiceCapabilities.localWhisperReady
    val effectiveVoiceDockState = if (usePairedVoice) {
        voiceDockState
    } else {
        VoiceDockUiState(
            recorder = PcmRecorderSnapshot(
                state = if (voiceInput.listening) PcmRecorderState.RECORDING else PcmRecorderState.IDLE,
            ),
        )
    }
    var startAfterPermission by remember { mutableStateOf(false) }
    val voicePermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted && startAfterPermission) {
            NexySpeechService.command(context, NexySpeechService.ACTION_STOP)
            voiceDockController.start()
        } else if (!granted) {
            scope.launch { snackbarHostState.showSnackbar("Microphone permission is required for Voice Dock.") }
        }
        startAfterPermission = false
    }
    val startVoiceDockRecording: () -> Unit = {
        when {
            !usePairedVoice -> voiceInput.start()
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> {
                NexySpeechService.command(context, NexySpeechService.ACTION_STOP)
                voiceDockController.start()
            }
            else -> {
                startAfterPermission = true
                voicePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
    val stopVoiceDockRecording: () -> Unit = {
        if (usePairedVoice) voiceDockController.stop() else voiceInput.stop()
    }
    val cancelVoiceDockRecording: () -> Unit = {
        if (usePairedVoice) voiceDockController.cancel() else voiceInput.cancel()
    }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(voiceDockController, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                voiceDockController.onAppBackgrounded()
                voiceInput.cancel()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            voiceDockController.close()
        }
    }
    LaunchedEffect(voiceDockEnabled) {
        if (voiceDockEnabled && preferenceStore.isVoiceDockFloating()) {
            voiceDockFloating = true
        } else if (!voiceDockEnabled) {
            voiceDockFloating = false
            preferenceStore.setVoiceDockFloating(false)
            voiceDockController.cancel(PcmRecorderStopReason.USER_CANCELLED)
        }
    }

    var wasStreamingForAutoPlay by remember(conversationId) { mutableStateOf(false) }
    LaunchedEffect(isStreaming, spokenOutputEnabled, spokenOutputSettings.autoPlay, messages) {
        if (
            wasStreamingForAutoPlay &&
            !isStreaming &&
            spokenOutputEnabled &&
            spokenOutputSettings.autoPlay
        ) {
            messages.lastOrNull { !it.isUser && !it.isStreaming && it.text.isNotBlank() }?.let { message ->
                NexySpeechService.play(
                    context = context,
                    text = message.text,
                    messageId = message.id,
                    conversationId = conversationId,
                )
            }
        }
        wasStreamingForAutoPlay = isStreaming
    }
    val sendError by vm.sendError.collectAsStateWithLifecycle()
    var deletingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var deleteAfterMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var addToProjectMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var addToProjectTitle by remember { mutableStateOf("") }
    var branchPending by remember { mutableStateOf(false) }
    var investigateMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var promoteArtifactMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var promoteArtifactTitle by remember { mutableStateOf("") }
    var promoteArtifactKind by remember { mutableStateOf("document") }
    var promoteArtifactScopeType by remember { mutableStateOf("global") }
    var promoteArtifactFilePath by remember { mutableStateOf("output.md") }
    var pendingPromotedMessageId by remember { mutableStateOf<String?>(null) }
    var savePromptMessage by remember { mutableStateOf<ChatMessage?>(null) }
    var savePromptTitle by remember { mutableStateOf("") }
    var savePromptBody by remember { mutableStateOf("") }
    var savePromptDescription by remember { mutableStateOf("") }
    var savePromptCategory by remember { mutableStateOf("Custom") }
    var savePromptTags by remember { mutableStateOf("") }
    var savePromptScope by remember { mutableStateOf("global") }
    var savePromptPending by remember { mutableStateOf(false) }
    var pendingApproval by remember { mutableStateOf<io.nexy.android.data.model.WsEvent.ToolApprovalRequest?>(null) }
    val promptEntries by WsRepository.promptEntries.collectAsStateWithLifecycle()
    var relaunchFilePicker by remember { mutableStateOf(false) }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        // A few document providers repeat the same content URI in this result even when the
        // user selected it once. Avoid reading and enqueueing that duplicate in the first place.
        for (uri in uris.distinct()) {
            val cursor = context.contentResolver.query(uri, null, null, null, null) ?: continue
            val name = cursor.use { c ->
                val idx = c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)
                c.moveToFirst()
                c.getString(idx)
            } ?: "attachment"
            val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val inputStream = context.contentResolver.openInputStream(uri)
            if (inputStream == null) {
                scope.launch { snackbarHostState.showSnackbar("$name could not be read.") }
                continue
            }
            val bytes = inputStream.use { it.readBytes() }
            if (bytes.size > 4 * 1024 * 1024) {
                scope.launch {
                    val result = snackbarHostState.showSnackbar(
                        message = "$name is larger than 4 MB and was not attached.",
                        actionLabel = "Choose another",
                    )
                    if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) {
                        relaunchFilePicker = true
                    }
                }
                continue
            }
            if (mimeType.startsWith("image/")) {
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                vm.addAttachment(name, mimeType, "data:$mimeType;base64,$b64", null)
            } else {
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                vm.addAttachment(name, mimeType, "data:$mimeType;base64,$b64", decodeUtf8Text(bytes))
            }
        }
    }

    LaunchedEffect(Unit) {
        WsRepository.pendingSelectedAttachmentPath.collect { path ->
            if (!path.isNullOrBlank()) {
                vm.addDesktopPathAttachment(path)
                WsRepository.pendingSelectedAttachmentPath.value = null
            }
        }
    }

    LaunchedEffect(relaunchFilePicker) {
        if (relaunchFilePicker) {
            relaunchFilePicker = false
            filePicker.launch("*/*")
        }
    }

    val clipboardManager = context.getSystemService(ClipboardManager::class.java)

    // Expanding a persisted history into timeline items may involve hundreds of reasoning
    // blocks, tool calls, and timestamp sorts. Do it away from the Compose thread so the
    // app bar/composer can draw immediately when a conversation is opened. The cache retains
    // the settled prefix, so token reveal updates only expand the active tail.
    val renderTimelineCache = remember { ChatRenderTimelineCache() }
    val renderItems by produceState<List<ChatRenderItem>?>(
        initialValue = null,
        messages,
        isAwaitingResponse,
        isStreaming,
        liveThinkingBlocks,
        liveTurnState,
        liveActivity,
        generationStartedAt,
    ) {
        value = withContext(Dispatchers.Default) {
            renderTimelineCache.build(
                messages = messages,
                activeTurn = liveTurnState,
                liveThinkingBlocks = liveThinkingBlocks,
                isAwaitingResponse = isAwaitingResponse,
                isStreaming = isStreaming,
                activity = liveActivity,
                generationStartedAt = generationStartedAt,
            )
        }
    }
    val completedRenderItems = renderItems.orEmpty()
    val isBuildingInitialRenderItems = renderItems == null

    // Snapshot of where the last item sits relative to the viewport, for the truncated-tail hunt.
    // `tailBelowFold` alongside `canScrollFwd=false` is the contradiction that flags a clipped tail.
    fun logScrollGeometry(stage: String, extra: String = "") {
        val layout = listState.layoutInfo
        val last = layout.visibleItemsInfo.lastOrNull()
        val lastBottom = last?.let { it.offset + it.size } ?: 0
        val viewportEnd = layout.viewportEndOffset
        val tailBelowFold = lastBottom > viewportEnd + 1
        ChatLayoutDiagnostics.recordScroll(
            stage,
            "follow=$shouldAutoFollow items=${layout.totalItemsCount} lastIdx=${last?.index ?: -1} " +
                "lastBottom=$lastBottom viewportEnd=$viewportEnd tailBelowFold=$tailBelowFold " +
                "canScrollFwd=${listState.canScrollForward} scrolling=${listState.isScrollInProgress}" +
                if (extra.isBlank()) "" else " $extra",
        )
    }

    // Re-pin to the bottom every frame and keep going until the list is genuinely at rest, rather
    // than firing a fixed 1-2 passes and hoping the observer re-triggers. The log proved why a small
    // fixed count is not enough: a message ABOVE the tail can receive its real text (e.g. 135 -> 3143
    // chars) or finish its Markwon AndroidView measurement many frames AFTER the list first declared
    // "at-bottom", pushing the tail below the fold. A single settle pass cannot outlast content that
    // legitimately grows over several frames, and the re-pin snapshotFlow only re-emits on a discrete
    // signal change — so once geometry stalls at a wrong resting position nothing re-drives it.
    //
    // Loop until one of: (a) the true bottom is reached (canScrollForward == false); (b) the tail's
    // bottom edge has stopped moving for two consecutive frames while still below the fold — a genuine
    // row-measurement shortfall that more scrolling cannot fix, logged distinctly so it is unambiguous
    // in the next capture; or (c) the frame budget is spent (guards against streaming, where content
    // grows every frame — the content-signal effect re-invokes us on the next chunk anyway).
    suspend fun scrollToBottom(animated: Boolean = false, maxFrames: Int = 12) {
        if (!shouldAutoFollow) return
        programmaticScrollInProgress = true
        try {
            var lastBottomSeen = Int.MIN_VALUE
            var stableFrames = 0
            repeat(maxFrames.coerceAtLeast(1)) { pass ->
                if (!shouldAutoFollow) return
                val itemCount = listState.layoutInfo.totalItemsCount
                if (itemCount <= 0) return
                listState.scrollToItem(itemCount - 1, scrollOffset = Int.MAX_VALUE)
                // Markwon AndroidView content can report a larger measured height after it is first revealed.
                withFrameNanos {}
                if (!listState.canScrollForward) {
                    logScrollGeometry("settle-final", "pass=$pass reason=at-bottom")
                    return
                }
                val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
                val bottom = last?.let { it.offset + it.size } ?: 0
                if (bottom == lastBottomSeen) {
                    // Height has stopped changing but canScrollForward is still true: content below
                    // the committed fold that re-pinning cannot reveal (the row itself is short).
                    if (++stableFrames >= 2) {
                        logScrollGeometry("settle-final", "pass=$pass reason=stable-below-fold")
                        return
                    }
                } else {
                    stableFrames = 0
                    lastBottomSeen = bottom
                }
            }
            logScrollGeometry("settle-final", "reason=frames-exhausted")
        } finally {
            programmaticScrollInProgress = false
        }
    }

    val isAtBottom by remember {
        derivedStateOf { !listState.canScrollForward }
    }

    // Initial entry: a single correction after the first layout is enough for the common case.
    // Further asynchronous height changes are handled by the layout observer below.
    LaunchedEffect(conversationId) {
        if (restoredViewState != null) return@LaunchedEffect
        snapshotFlow { renderItems != null && listState.layoutInfo.totalItemsCount > 0 }
            .first { it }
        shouldAutoFollow = true
        scrollToBottom()
        hasInitiallyScrolled = true
    }

    DisposableEffect(conversationId, listState) {
        onDispose {
            ChatHistoryMemoryCache.putViewState(
                conversationId,
                ChatHistoryMemoryCache.ViewState(
                    itemIndex = listState.firstVisibleItemIndex,
                    itemOffset = listState.firstVisibleItemScrollOffset,
                    shouldAutoFollow = shouldAutoFollow,
                ),
            )
        }
    }

    val streamingTextLength = remember(messages) { messages.lastOrNull { it.isStreaming }?.text?.length ?: 0 }
    val thinkingBlocksSize = liveThinkingBlocks.size
    val thinkingTotalChars = liveThinkingBlocks.sumOf { it.content.length }
    // Track tool-call content changes (e.g. Team activity, Codex CLI) — these mutate an existing
    // placeholder message in place on completion, so messages.size alone won't catch the update.
    val toolActivityResultLength = remember(messages) { messages.filter { it.serverName != null }.sumOf { (it.toolResult?.length ?: 0) + (it.toolArgs?.length ?: 0) } }

    // Content signal: new messages, streaming chunks, thinking bubbles, or busy state changes should
    // stay pinned only while auto-follow is enabled.
    LaunchedEffect(messages.size, isAwaitingResponse, isStreaming, streamingTextLength, thinkingBlocksSize, thinkingTotalChars, toolActivityResultLength) {
        if (!hasInitiallyScrolled || !shouldAutoFollow) return@LaunchedEffect
        scrollToBottom()
    }

    // Layout signal: AndroidView/Markwon content can change height after message data is already set.
    // A single assistant reply is split into several sibling lazy items (thinking blocks, tool calls,
    // text segments, then the tail AssistantMessage). Watching only the *last visible item's own size*
    // missed the dominant case: an AndroidView/Markwon TextView in a segment ABOVE the tail finishes
    // its StaticLayout a frame later and grows, pushing the tail below the fold WITHOUT changing the
    // tail's own size or the item count — so no re-pin fired and the last segment stayed clipped until
    // an unrelated relayout (tapping a bubble, a manual scroll) forced a re-measure. So the signal now
    // also tracks the last visible item's bottom edge (offset + size) and whether content still exists
    // below the fold (canScrollForward): any late height change that displaces the tail re-triggers the
    // pin. Still scroll-position-independent for normal reading — the collect guard requires auto-follow
    // to be on (disabled the moment the user scrolls up) and no in-progress gesture, and it self-
    // terminates because canScrollForward goes false once the true bottom is reached.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        snapshotFlow {
            val layout = listState.layoutInfo
            val last = layout.visibleItemsInfo.lastOrNull()
            ScrollPinSignal(
                follow = shouldAutoFollow,
                itemCount = layout.totalItemsCount,
                lastIndex = last?.index ?: -1,
                lastBottom = last?.let { it.offset + it.size } ?: 0,
                canScrollForward = listState.canScrollForward,
            )
        }.collect {
            if (shouldAutoFollow && !listState.isScrollInProgress && listState.canScrollForward) {
                logScrollGeometry("repin-fire")
                scrollToBottom()
            } else {
                // Why we did NOT re-pin. If the tail is clipped yet this logs canScrollFwd=false,
                // the re-pin self-terminated while content was still below the committed fold.
                val reason = when {
                    !shouldAutoFollow -> "no-follow"
                    listState.isScrollInProgress -> "scrolling"
                    else -> "at-bottom"
                }
                logScrollGeometry("repin-skip", "reason=$reason")
            }
        }
    }

    // User scroll signal: once the user scrolls and leaves the bottom, stop auto-following until
    // they return to the bottom or press the arrow.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        var wasScrolling = false
        snapshotFlow { listState.isScrollInProgress to listState.canScrollForward }
            .collect { (scrolling, canScrollForward) ->
                if (!programmaticScrollInProgress) {
                    if (scrolling && canScrollForward) {
                        shouldAutoFollow = false
                    } else if (wasScrolling && !scrolling && !canScrollForward) {
                        shouldAutoFollow = true
                    }
                }
                wasScrolling = scrolling
            }
    }

    LaunchedEffect(conversation?.model, availableProjectDefault) {
        val storedModel = conversation?.model?.takeIf { modelId ->
            modelId.isNotBlank() && modelId != "default" && models.any { it.id == modelId }
        }
        vm.loadModel(storedModel ?: availableProjectDefault)
    }

    val requestModelList = {
        WsRepository.send(
            "model:list",
            buildMap {
                if (!chatBackend.isNullOrBlank()) put("backend", chatBackend)
                if (!chatAgentId.isNullOrBlank()) put("agentId", chatAgentId)
            },
        )
    }

    LaunchedEffect(chatBackend, chatAgentId) {
        requestModelList()
    }

    LaunchedEffect(sendError) {
        val error = sendError ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(error)
        vm.clearSendError()
    }

    val slashCommandMessage by vm.slashCommandMessage.collectAsStateWithLifecycle()
    LaunchedEffect(slashCommandMessage) {
        val message = slashCommandMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        vm.consumeSlashCommandMessage()
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            when (event) {
                is io.nexy.android.data.model.WsEvent.ConversationForked -> {
                    if (branchPending) {
                        branchPending = false
                        onOpenFork?.invoke(event.conversationId)
                    }
                }
                is io.nexy.android.data.model.WsEvent.VoiceAiRecap -> {
                    if (aiRecapPendingMessageId == event.messageId) {
                        aiRecapPendingMessageId = null
                        NexySpeechService.play(
                            context,
                            event.spokenText,
                            event.messageId,
                            conversationId,
                            SpokenOutputKind.AI_RECAP,
                            event.model ?: event.generationKind,
                        )
                    }
                }
                is io.nexy.android.data.model.WsEvent.VoiceAiRecapError -> {
                    if (aiRecapPendingMessageId == event.messageId) {
                        aiRecapPendingMessageId = null
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                is io.nexy.android.data.model.WsEvent.ToolApprovalRequest -> {
                    pendingApproval = event
                }
                is io.nexy.android.data.model.WsEvent.ChatToolCallEvent -> {
                    if (event.conversationId == conversationId) {
                        pendingApproval = null
                    }
                }
                is io.nexy.android.data.model.WsEvent.ChatActivity -> {
                    if (event.conversationId == conversationId &&
                        (event.state == "complete" || event.state == "error")) {
                        pendingApproval = null
                    }
                }
                is io.nexy.android.data.model.WsEvent.ArtifactPromoted -> {
                    if (pendingPromotedMessageId != null && event.messageId == pendingPromotedMessageId) {
                        pendingPromotedMessageId = null
                        promoteArtifactMessage = null
                        val result = snackbarHostState.showSnackbar(
                            message = "Artifact saved",
                            actionLabel = "View",
                        )
                        if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) {
                            onOpenArtifacts?.invoke(event.artifactId)
                        }
                    }
                }
                is io.nexy.android.data.model.WsEvent.ArtifactPromoteError -> {
                    if (pendingPromotedMessageId != null && event.messageId == pendingPromotedMessageId) {
                        pendingPromotedMessageId = null
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                is io.nexy.android.data.model.WsEvent.PromptEntryCreated -> {
                    if (savePromptPending) {
                        savePromptPending = false
                        savePromptMessage = null
                        snackbarHostState.showSnackbar("Prompt saved")
                    }
                }
                is io.nexy.android.data.model.WsEvent.PromptError -> {
                    if (savePromptPending) {
                        savePromptPending = false
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                is io.nexy.android.data.model.WsEvent.AgentFull -> {
                    if (event.config.id == chatAgentId) chatAgentFullAutoApprove = event.config.fullAutoApprove
                }
                is io.nexy.android.data.model.WsEvent.ProjectConfig -> {
                    if (event.id == statusProjectId) chatProjectWorkflowMode = event.config.workflowMode
                }
                is io.nexy.android.data.model.WsEvent.AutomatedWorkflowRunsList -> {
                    if (event.projectId == statusProjectId) {
                        val active = event.runs.firstOrNull { it.status != "done" && it.status != "cancelled" }
                        if (active != null) WsRepository.getAutomatedWorkflowRun(active.id) else activeWorkflowRun = null
                    }
                }
                is io.nexy.android.data.model.WsEvent.AutomatedWorkflowRunDetailReady -> {
                    val run = event.run
                    if (run != null && run.projectId == statusProjectId) {
                        activeWorkflowRun = run
                    }
                }
                is io.nexy.android.data.model.WsEvent.AutomatedWorkflowRunsError -> {
                    // Approve/Retry/Skip in the banner below send WS commands with no reply
                    // path other than this event — without surfacing it, a failed action (e.g. a
                    // race with another device that already resolved the step) looks identical to
                    // "still processing" and the user has no idea their tap did nothing.
                    snackbarHostState.showSnackbar(event.message)
                }
                else -> {}
            }
        }
    }

    // Compose retains the first visible item's keyed position when entries are prepended. Start
    // the request just before the hard top so the next page is ready without a blank boundary.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.firstOrNull()?.index ?: Int.MAX_VALUE }
            .collect { firstVisibleIndex ->
                if (firstVisibleIndex > 2) {
                    olderPageArmed = true
                } else if (olderPageArmed) {
                    olderPageArmed = false
                    vm.loadOlderMessages()
                }
            }
    }

    var highlightedMessageId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(investigateMessage) {
        val msg = investigateMessage ?: return@LaunchedEffect
        investigateMessage = null
        val chatProjectId = conversation?.project_id ?: projectId
        if (connectionState != ConnectionState.CONNECTED) {
            scope.launch { snackbarHostState.showSnackbar("Not connected to desktop") }
        } else if (chatProjectId.isNullOrBlank()) {
            // no-op: entry point is already hidden when there's no project
        } else if (projects.find { it.id == chatProjectId }?.rootDirectory.isNullOrBlank()) {
            scope.launch { snackbarHostState.showSnackbar("Code changes require this project to have a configured workspace") }
        } else {
            // Prefill in place rather than navigating away — /code-change now runs against
            // whichever conversation the user is already in, there's no separate screen to open.
            val plainContent = msg.text.replace(Regex("\\s+"), " ").trim()
            input = "/code-change $plainContent"
            vm.setDraft(input)
        }
    }

    DisposableEffect(conversationId) {
        WsRepository.activelyViewedConversationId.value = conversationId
        WsRepository.clearCompletedAway(conversationId)
        io.nexy.android.notification.ActivityBadgeManager.markSeen(
            context,
            io.nexy.android.notification.ActivityBadgeManager.chatDestination(conversationId),
        )
        onDispose { WsRepository.activelyViewedConversationId.value = null }
    }

    val assistantBusy = isStreaming || isAwaitingResponse
    LaunchedEffect(emergencyStopActive) {
        if (emergencyStopActive && assistantBusy) vm.stopStream()
    }
    val canSend = (input.isNotBlank() || attachments.isNotEmpty()) &&
        !emergencyStopActive &&
        !assistantBusy &&
        (connectionState == ConnectionState.CONNECTED || capabilities.internetState != InternetState.UNAVAILABLE)
    val draftAgent = agentId?.let { id -> agents.find { it.id == id } }
    val draftProject = projectId?.let { id -> projects.find { it.id == id } }
    val agentLabel = conversation?.agent_name?.let { name ->
        val icon = conversation.agent_icon
        if (!icon.isNullOrBlank()) "$icon  $name" else name
    } ?: draftAgent?.let { agent ->
        if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name
    }
    val projectLabel = conversation?.project_name ?: draftProject?.name
    val activeModelId = selectedModel ?: "default"
    val activeModelLabel = activeModelLabel(selectedModel, models)
    val activeModelDetail = if (projectDefaultApplied) {
        "Project default"
    } else {
        activeModelDetail(selectedModel, chatAgent, modelSource)
    }
    val backendLockLabel = agentBackendLockLabel(chatAgent)
    val backendLockDetail = agentBackendLockDetail(chatAgent)
    val connectionBanner = connectionState != ConnectionState.CONNECTED

    fun suggestedArtifactTitle(text: String): String {
        val heading = Regex("""(?m)^\s{0,3}#{1,6}\s+(.+?)\s*$""").find(text)?.groupValues?.getOrNull(1)?.trim()
        return heading ?: conversation?.title?.takeIf { it.isNotBlank() } ?: "New Artifact"
    }

    fun suggestedArtifactFilePath(kind: String): String = when (kind) {
        "prompt" -> "prompt.md"
        "code" -> "output.ts"
        "other" -> "output.txt"
        else -> "output.md"
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ModelPickerSheet(
                title = "Chat model",
                models = models,
                cliStatus = cliStatus,
                selectedModelId = activeModelId,
                subtitle = backendLockDetail,
                emptyStateText = emptyModelListDetail(modelSource),
                effectiveMode = effectiveMode,
            ) { modelId ->
                vm.setModel(modelId)
                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
            }
        }
    }

    if (showModeSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModeSheet = false },
            sheetState = modeSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ChatModeSheet(
                thinkingEffortOverride = chatThinkingEffortOverride,
                fullAutoApproveOverride = chatFullAutoApproveOverride,
                agenticModeOverride = chatAgenticModeOverride,
                terminalSandboxOverride = chatTerminalSandboxOverride,
                activeCliBackend = activeCliBackend,
                showAgenticMode = effectiveMode != EffectiveConnectionMode.STANDALONE_BY_CHOICE,
                cliModeOverride = chatCliModeOverride,
                codexExecutionModeOverride = chatCodexExecutionModeOverride,
                onSetThinkingEffort = { vm.setThinkingEffortOverride(it) },
                onSetFullAutoApprove = { vm.setFullAutoApproveOverride(it) },
                onSetAgenticMode = { vm.setAgenticModeOverride(it) },
                onSetTerminalSandboxOverride = { vm.setTerminalSandboxOverride(it) },
                onSetCliMode = { vm.setCliModeOverride(it) },
                onSetCodexExecutionMode = { vm.setCodexExecutionModeOverride(it) },
            )
        }
    }

    if (showActionsSheet) {
        ConversationActionsSheet(
            conversationId = conversationId,
            onDismiss = { showActionsSheet = false },
            onForkNavigate = { forkedId ->
                onOpenFork?.invoke(forkedId)
            },
            onImportNavigate = { importedId ->
                onOpenFork?.invoke(importedId)
            },
        )
    }

    if (showEmergencyStopConfirmation) {
        AlertDialog(
            onDismissRequest = { showEmergencyStopConfirmation = false },
            title = { Text("Emergency stop all conversations?") },
            text = { Text("This immediately cancels every active response and blocks new messages until you explicitly resume.") },
            confirmButton = {
                TextButton(onClick = {
                    showEmergencyStopConfirmation = false
                    WsRepository.activateEmergencyStop()
                }) { Text("Emergency stop", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showEmergencyStopConfirmation = false }) { Text("Cancel") }
            },
        )
    }

    if (showPromptSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPromptSheet = false },
            sheetState = promptSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            PromptLibrarySheetContent(promptEntries = promptEntries) { body ->
                val separator = if (input.isNotBlank() && !input.endsWith("\n")) "\n" else ""
                input += "$separator$body"
                vm.setDraft(input)
                scope.launch { promptSheetState.hide() }.invokeOnCompletion { showPromptSheet = false }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    if (showInspectorSheet) {
        ContextInspectorSheet(
            conversationId = conversationId,
            onDismiss = { showInspectorSheet = false },
            sheetState = inspectorSheetState,
        )
    }

    savePromptMessage?.let {
        val chatProjectId = conversation?.project_id ?: projectId
        CreatePromptSheet(
            title = savePromptTitle,
            body = savePromptBody,
            description = savePromptDescription,
            category = savePromptCategory,
            tags = savePromptTags,
            scope = savePromptScope,
            showProjectScope = !chatProjectId.isNullOrBlank(),
            onTitleChange = { savePromptTitle = it },
            onBodyChange = { savePromptBody = it },
            onDescriptionChange = { savePromptDescription = it },
            onCategoryChange = { savePromptCategory = it },
            onTagsChange = { savePromptTags = it },
            onScopeChange = { savePromptScope = it },
            onConfirm = {
                savePromptPending = true
                WsRepository.createPrompt(
                    title = savePromptTitle.trim(),
                    body = savePromptBody,
                    description = savePromptDescription.trim(),
                    category = savePromptCategory.trim().ifBlank { "Custom" },
                    tags = savePromptTags.split(",").map { tag -> tag.trim() }.filter { tag -> tag.isNotBlank() },
                    scope = savePromptScope,
                    projectId = if (savePromptScope == "project") chatProjectId else null,
                )
            },
            onDismiss = { if (!savePromptPending) savePromptMessage = null },
            sheetTitle = "Save as prompt",
            confirmLabel = if (savePromptPending) "Saving…" else "Save",
            saving = savePromptPending,
        )
    }

    deletingMessage?.let { message ->
        NexyConfirmDialog(
            title = "Delete message?",
            message = "This message will be removed from the paired desktop conversation.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                vm.deleteMessage(message.id)
                deletingMessage = null
            },
            onDismiss = { deletingMessage = null },
        )
    }

    deleteAfterMessage?.let { message ->
        NexyConfirmDialog(
            title = "Delete from here?",
            message = "This message and all messages after it will be removed from the conversation.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                vm.deleteMessagesAfter(conversationId, message.timestamp)
                deleteAfterMessage = null
            },
            onDismiss = { deleteAfterMessage = null },
        )
    }

    addToProjectMessage?.let { message ->
        val chatProjectId = conversation?.project_id ?: projectId
        if (chatProjectId != null) {
            AlertDialog(
                onDismissRequest = { addToProjectMessage = null; addToProjectTitle = "" },
                title = { Text("Save to wiki") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "Save this message as a wiki entry in the project.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = addToProjectTitle,
                            onValueChange = { addToProjectTitle = it },
                            label = { Text("Title") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val title = addToProjectTitle.trim().ifBlank { "From chat" }
                            WsRepository.createWikiEntry(chatProjectId, title, message.text, emptyList())
                            scope.launch { snackbarHostState.showSnackbar("Added to project sources.") }
                            addToProjectMessage = null
                            addToProjectTitle = ""
                        },
                    ) { Text("Add") }
                },
                dismissButton = {
                    TextButton(onClick = { addToProjectMessage = null; addToProjectTitle = "" }) { Text("Cancel") }
                },
            )
        }
    }

    promoteArtifactMessage?.let { message ->
        val chatProjectId = conversation?.project_id ?: projectId
        AlertDialog(
            onDismissRequest = {
                if (pendingPromotedMessageId == null) {
                    promoteArtifactMessage = null
                }
            },
            title = { Text("Save as artifact") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Save this assistant response as a versioned artifact.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = promoteArtifactTitle,
                        onValueChange = { promoteArtifactTitle = it },
                        label = { Text("Title") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = promoteArtifactKind,
                        onValueChange = {
                            promoteArtifactKind = it
                            promoteArtifactFilePath = suggestedArtifactFilePath(it)
                        },
                        label = { Text("Kind") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = promoteArtifactScopeType,
                        onValueChange = { promoteArtifactScopeType = if (it == "project") "project" else "global" },
                        label = { Text("Scope (global or project)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = promoteArtifactFilePath,
                        onValueChange = { promoteArtifactFilePath = it },
                        label = { Text("File path") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (promoteArtifactScopeType == "project" && chatProjectId.isNullOrBlank()) {
                        Text(
                            "This chat is not attached to a project, so only global scope is available.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val scopeType = if (promoteArtifactScopeType == "project" && !chatProjectId.isNullOrBlank()) "project" else "global"
                        pendingPromotedMessageId = message.id
                        WsRepository.promoteArtifactMessage(
                            conversationId = conversationId,
                            messageId = message.id,
                            title = promoteArtifactTitle.trim(),
                            kind = promoteArtifactKind.trim().ifBlank { "document" },
                            scopeType = scopeType,
                            scopeProjectId = if (scopeType == "project") chatProjectId else null,
                            filePath = promoteArtifactFilePath.trim(),
                        )
                    },
                    enabled = pendingPromotedMessageId == null && promoteArtifactFilePath.isNotBlank(),
                ) { Text(if (pendingPromotedMessageId == null) "Save" else "Saving…") }
            },
            dismissButton = {
                TextButton(
                    onClick = { promoteArtifactMessage = null },
                    enabled = pendingPromotedMessageId == null,
                ) { Text("Cancel") }
            },
        )
    }

    val colorScheme = MaterialTheme.colorScheme
    val markwon = remember(context, colorScheme) {
        val prism4j = Prism4j(io.nexy.android.GrammarLocatorDef())
        // Custom theme: subtle tinted background with readable dark text instead of Darkula black
        val codeTheme = object : Prism4jTheme {
            override fun background(): Int = 0xFF1E1F2E.toInt() // deep navy, visible in both themes
            override fun textColor(): Int = 0xFFE8EAF6.toInt() // soft lavender-white
            override fun apply(language: String, syntax: io.noties.prism4j.Prism4j.Syntax, builder: SpannableStringBuilder, start: Int, end: Int) = Unit
        }
        val dip = io.noties.markwon.utils.Dip.create(context)
        val tableTheme = TableTheme.emptyBuilder()
            .tableBorderColor(colorScheme.outlineVariant.toArgb())
            .tableBorderWidth(dip.toPx(1))
            .tableCellPadding(dip.toPx(8))
            .tableHeaderRowBackgroundColor(colorScheme.surfaceVariant.toArgb())
            .tableEvenRowBackgroundColor(colorScheme.surface.toArgb())
            .tableOddRowBackgroundColor(colorScheme.surfaceVariant.copy(alpha = 0.3f).toArgb())
            .build()
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(tableTheme))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(SyntaxHighlightPlugin.create(prism4j, codeTheme))
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(
                TaskListPlugin.create(
                    colorScheme.primary.toArgb(),
                    colorScheme.onPrimary.toArgb(),
                    colorScheme.outline.toArgb(),
                ),
            )
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder
                        .linkColor(colorScheme.primary.toArgb())
                        .codeTextColor(colorScheme.onSurfaceVariant.toArgb())
                        .codeBackgroundColor(colorScheme.surfaceVariant.toArgb())
                        .blockQuoteColor(colorScheme.outline.toArgb())
                }
            })
            .build()
    }
    CompositionLocalProvider(LocalMarkwon provides markwon) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                contentSyncInProgress = isReconcilingHistory,
                titleContent = {
                    Column {
                        Text(title, maxLines = 1, style = MaterialTheme.typography.titleMedium)
                        val subtitle = when {
                            agentLabel != null && projectLabel != null -> "$agentLabel · $projectLabel"
                            agentLabel != null -> agentLabel
                            projectLabel != null -> projectLabel
                            else -> null
                        }
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (backendLockLabel != null) {
                            Text(
                                backendLockLabel,
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (chatProjectWorkflowMode == "automated-delegation" || chatProjectWorkflowMode == "orchestrated") {
                            Text(
                                if (chatProjectWorkflowMode == "orchestrated") "Orchestrated workflow" else "Automated workflow",
                                maxLines = 1,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (chatAgentFullAutoApprove) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                Icon(
                                    Icons.Default.Warning,
                                    contentDescription = null,
                                    modifier = Modifier.size(12.dp),
                                    tint = MaterialTheme.colorScheme.error,
                                )
                                Text(
                                    "Auto-approve is on",
                                    maxLines = 1,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                        if (isCompleted) {
                            ChatCompletedBadge()
                        }
                        if (conversationRating != null) {
                            ChatRatingBadge(conversationRating)
                        }
                    }
                },
                onBack = onBack,
                actions = {
                    TextButton(onClick = {
                        requestModelList()
                        WsRepository.getCliStatus()
                        showModelSheet = true
                    }) {
                        Icon(
                            Icons.Default.Tune,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(modifier = Modifier.size(6.dp))
                        Column(modifier = Modifier.widthIn(max = 118.dp)) {
                            Text(
                                activeModelLabel,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (projectDefaultApplied) {
                                Text(
                                    "Project default",
                                    maxLines = 1,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    IconButton(onClick = { showModeSheet = true }) {
                        NexyIcon(
                            NexyIconName.Settings,
                            contentDescription = "Chat mode settings",
                            tint = if (chatThinkingEffortOverride != null || chatFullAutoApproveOverride != null || chatTerminalSandboxOverride != null || (activeCliBackend != null && chatCliModeOverride != null))
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (assistantBusy) {
                        IconButton(
                            onClick = { vm.stopStream() },
                        ) {
                            NexyIcon(NexyIconName.Stop, contentDescription = "Stop")
                        }
                    }
                    IconButton(
                        onClick = {
                            if (emergencyStopActive) WsRepository.resumeConversations()
                            else showEmergencyStopConfirmation = true
                        },
                    ) {
                        NexyIcon(
                            if (emergencyStopActive) NexyIconName.Play else NexyIconName.Warning,
                            contentDescription = if (emergencyStopActive) "Resume conversations" else "Emergency stop all conversations",
                            tint = if (emergencyStopActive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (conversation != null) {
                        IconButton(
                            onClick = {
                                WsRepository.setPinnedConversation(conversationId, !conversation.pinned)
                            },
                        ) {
                            NexyIcon(
                                NexyIconName.Pin,
                                contentDescription = if (conversation.pinned) "Unpin conversation" else "Pin conversation",
                                tint = if (conversation.pinned)
                                    MaterialTheme.colorScheme.secondary
                                else
                                    MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    IconButton(onClick = { showActionsSheet = true }) {
                        NexyIcon(NexyIconName.More, contentDescription = "More actions")
                    }
                },
            )
        },
        bottomBar = {
            ChatInputBar(
                input = input,
                onInputChange = { input = it; vm.setDraft(it) },
                attachments = attachments,
                onRemoveAttachment = { vm.removeAttachment(it) },
                canSend = canSend,
                onSend = {
                    val chatProjectId = conversation?.project_id ?: projectId
                    val chatAgentId = conversation?.agent_id ?: agentId
                    if (editingMessageId == null && vm.trySlashCommand(
                            input,
                            chatProjectId,
                            onNewChat = { onNewChat?.invoke(chatAgentId, chatProjectId) },
                            onOpenCodePanel = { pid -> onOpenCodePanel?.invoke(pid) },
                        )) {
                        input = ""
                        vm.setDraft("")
                    } else {
                        editingMessageId?.let { vm.editMessage(it, input) } ?: vm.sendMessage(input)
                        editingMessageId = null
                        input = ""
                        vm.setDraft("")
                    }
                },
                onAttachFile = { filePicker.launch("*/*") },
                onAttachDesktopPath = onOpenDesktopPathPicker,
                onInsertPrompt = {
                    // Project prompts must be requested with the active project. Calling the
                    // unscoped list here replaces the repository flow with global prompts only,
                    // making a newly saved project prompt disappear from this picker.
                    WsRepository.listPrompts(conversation?.project_id ?: projectId)
                    showPromptSheet = true
                },
                onShowInspector = { showInspectorSheet = true },
                isListening = if (usePairedVoice && voiceDockEnabled) voiceDockState.recording else voiceInput.listening,
                onVoiceInput = {
                    val listening = if (usePairedVoice && voiceDockEnabled) voiceDockState.recording else voiceInput.listening
                    if (!listening) {
                        NexySpeechService.command(context, NexySpeechService.ACTION_STOP)
                    }
                    if (usePairedVoice && voiceDockEnabled) {
                        if (voiceDockState.recording) stopVoiceDockRecording() else startVoiceDockRecording()
                    } else {
                        voiceInput.toggle()
                    }
                },
                voiceDockAvailable = voiceDockEnabled,
                voiceDockFloating = voiceDockFloating,
                onFloatVoiceDock = {
                    voiceDockFloating = true
                    preferenceStore.setVoiceDockFloating(true)
                },
                customSlashCommands = customSlashCommands,
            )
        },
    ) { padding ->
        // LazyColumn item index offset: item 0 = ChatStartHeader, items 1..N = renderItems
        val lazyHeaderOffset = if (completedRenderItems.isNotEmpty()) 1 else 0

        val handleScrollToRequest: suspend (Int) -> Unit = { itemIdx ->
            programmaticScrollInProgress = true
            shouldAutoFollow = false
            val lazyIdx = itemIdx + lazyHeaderOffset
            try {
                listState.scrollToItem(lazyIdx)
            } finally {
                programmaticScrollInProgress = false
            }
            val msgId = (completedRenderItems.getOrNull(itemIdx) as? ChatRenderItem.UserMessage)?.message?.id
            if (msgId != null) {
                highlightedMessageId = msgId
                kotlinx.coroutines.delay(1600)
                highlightedMessageId = null
            }
        }

        var sourceAnchorHandled by remember(conversationId, initialMessageId) {
            mutableStateOf(false)
        }
        LaunchedEffect(initialMessageId, completedRenderItems) {
            val target = initialMessageId?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
            if (sourceAnchorHandled) return@LaunchedEffect
            val index = completedRenderItems.indexOfFirst { item ->
                when (item) {
                    is ChatRenderItem.UserMessage -> item.message.id == target
                    is ChatRenderItem.AssistantMessage -> item.message.id == target
                    is ChatRenderItem.ToolCall -> item.message.id == target
                    is ChatRenderItem.ThinkingBlockItem -> item.messageId == target
                    is ChatRenderItem.TextSegmentItem -> item.messageId == target
                    is ChatRenderItem.ArtifactCard -> item.messageId == target
                    else -> false
                }
            }
            if (index >= 0) {
                sourceAnchorHandled = true
                programmaticScrollInProgress = true
                shouldAutoFollow = false
                try {
                    listState.scrollToItem(index + lazyHeaderOffset)
                } finally {
                    programmaticScrollInProgress = false
                }
                highlightedMessageId = target
                kotlinx.coroutines.delay(1600)
                highlightedMessageId = null
            }
        }

        ChatRefreshableContent(
            isRefreshing = isRefreshing,
            onRefresh = { vm.refreshMessages() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
            // Height (px) of the in-flow banners below (connection + workflow step), measured so
            // the floating InReplyToBanner overlay can sit just beneath them without overlapping.
            var topBannersHeightPx by remember { mutableStateOf(0) }

            Column(modifier = Modifier.fillMaxSize()) {
                Column(modifier = Modifier.onGloballyPositioned { topBannersHeightPx = it.size.height }) {
                    if (connectionBanner) {
                        NexyConnectionBanner(connectionState, lastError)
                    }

                    val bannerRun = activeWorkflowRun
                    val bannerStep = currentWorkflowStep
                    // Keyed on status+attempt, not just the step's stable logical id: a retried step
                    // keeps the same id, so dismissing a failed-step banner must not permanently
                    // silence it once that same step fails again on a later attempt.
                    val bannerStepKey = bannerStep?.let { "${it.id}:${it.status}:${it.attempt}" }
                    if (bannerRun != null && bannerStep != null && bannerStepKey != dismissedWorkflowStepId) {
                        val gated = bannerRun.confirmationMode == "gated"
                        Surface(color = MaterialTheme.colorScheme.primaryContainer) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                val statusSuffix = when (bannerStep.status) {
                                    "running" -> " — running…"
                                    "awaiting_confirmation" -> if (gated) " — ready for your review" else " — advancing automatically…"
                                    "failed" -> " — failed" + (bannerStep.error?.let { ": $it" } ?: "")
                                    else -> ""
                                }
                                Text(
                                    "${bannerRun.title} — Step ${bannerStep.stepIndex + 1} of ${bannerRun.steps.size}: ${bannerStep.title}$statusSuffix",
                                    style = MaterialTheme.typography.labelSmall,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                if (bannerStep.status == "awaiting_confirmation" && gated) {
                                    TextButton(onClick = { WsRepository.confirmAutomatedWorkflowStep(bannerRun.id, bannerStep.dbId) }) {
                                        Text("Approve", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                if (bannerStep.status == "failed") {
                                    TextButton(onClick = { WsRepository.retryAutomatedWorkflowStep(bannerRun.id, bannerStep.dbId) }) {
                                        Text("Retry", style = MaterialTheme.typography.labelSmall)
                                    }
                                    TextButton(onClick = { WsRepository.skipAutomatedWorkflowStep(bannerRun.id, bannerStep.dbId) }) {
                                        Text("Skip", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                TextButton(onClick = { bannerRun.projectId?.let { onOpenAutomatedWorkflow?.invoke(it) } }) {
                                    Text("View", style = MaterialTheme.typography.labelSmall)
                                }
                                IconButton(onClick = { dismissedWorkflowStepId = bannerStepKey }, modifier = Modifier.size(28.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = "Dismiss workflow step banner", modifier = Modifier.size(14.dp))
                                }
                            }
                        }
                    }
                }

                Box(modifier = Modifier.weight(1f)) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (isLoadingOlder) {
                        item(key = "older-history-loading") {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                Text(
                                    "Loading older messages…",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Gray400,
                                )
                            }
                        }
                    }
                    if (isBuildingInitialRenderItems) {
                        item(key = "chat-timeline-building") {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                                horizontalArrangement = Arrangement.Center,
                            ) {
                                Text("Preparing conversation…", style = MaterialTheme.typography.labelSmall, color = Gray400)
                            }
                        }
                    } else if (completedRenderItems.isEmpty() && isInitialHistoryLoading) {
                        item(key = "chat-history-skeleton") {
                            ChatLoadingSkeleton()
                        }
                    } else if (completedRenderItems.isEmpty()) {
                        item {
                            EmptyChatContent(agentLabel = agentLabel, projectLabel = projectLabel)
                        }
                    } else {
                        item { ChatStartHeader() }
                    }
                    items(
                        completedRenderItems,
                        key = { item -> item.key },
                        contentType = { item ->
                            when (item) {
                                is ChatRenderItem.UserMessage -> 0
                                is ChatRenderItem.ToolCall -> 1
                                // Assistant/text-segment rows host Android TextView/WebView
                                // children. Do not recycle one message's embedded View holder as
                                // another message: a stale narrow measurement can otherwise
                                // survive while scrolling historical content. The LazyColumn
                                // still virtualizes off-screen rows, but these content types make
                                // each embedded-view row mount with its own width contract.
                                is ChatRenderItem.AssistantMessage -> "assistant:${item.key}"
                                is ChatRenderItem.LiveThinking -> 3
                                is ChatRenderItem.LiveActivity -> 4
                                is ChatRenderItem.ArtifactCard -> 5
                                is ChatRenderItem.ThinkingBlockItem -> 6
                                is ChatRenderItem.TextSegmentItem -> "text-segment:${item.key}"
                            }
                        },
                    ) { item ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .onGloballyPositioned { coordinates ->
                                    ChatLayoutDiagnostics.record(
                                        messageKey = item.key,
                                        stage = "lazy-item-${item::class.simpleName}",
                                        widthPx = coordinates.size.width,
                                        heightPx = coordinates.size.height,
                                    )
                                    // Late-growth cross-check: did THIS lazy row re-measure taller?
                                    // Paired with the "holder" stream (Markwon AndroidView height),
                                    // a holder growth with no matching row growth = clipped tail.
                                    ChatLayoutDiagnostics.noteHeight(item.key, "row", coordinates.size.height)
                                },
                        ) {
                        when (item) {
                            is ChatRenderItem.ToolCall -> {
                                val inProgress = item.message.isStreaming
                                if (isCodexToolCall(item.message.serverName)) {
                                    ChatTimelineGroup {
                                        ChatTimelineEntry(
                                            beadColor = toolCallBeadColor(inProgress = inProgress, success = item.message.toolSuccess),
                                            pulse = inProgress,
                                        ) {
                                            CodexToolActionLine(item.message, inProgress = inProgress)
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup { ToolCallBubble(item.message, inProgress = inProgress) }
                                }
                            }
                            is ChatRenderItem.ThinkingBlockItem -> {
                                if (isCodexReasoning(listOf(item.block))) {
                                    ChatTimelineGroup {
                                        ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !item.block.done), pulse = !item.block.done) {
                                            CodexReasoningActionLine(listOf(item.block))
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup { ThinkingHistoryBubble(listOf(item.block), isLive = false) }
                                }
                            }
                            is ChatRenderItem.TextSegmentItem -> {
                                ChatTimelineGroup {
                                    ChatTimelineEntry(beadColor = Gray400) {
                                        ExpandedResponseTextSegment(
                                            content = item.block.content,
                                            debugKey = item.key,
                                        )
                                    }
                                }
                            }
                            is ChatRenderItem.LiveThinking -> {
                                if (isCodexReasoning(item.blocks)) {
                                    ChatTimelineGroup {
                                        item.blocks.forEachIndexed { index, block ->
                                            key("${block.blockId}:$index") {
                                                ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !block.done), pulse = !block.done) {
                                                    CodexReasoningActionLine(listOf(block))
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup {
                                        item.blocks.forEachIndexed { index, block ->
                                            key("${block.blockId}:$index") { ThinkingHistoryBubble(listOf(block), isLive = true) }
                                        }
                                    }
                                }
                            }
                            is ChatRenderItem.LiveActivity -> {
                                val isTool = item.activity.state == "tool"
                                ChatTimelineGroup {
                                    ChatTimelineEntry(beadColor = if (isTool) Blue500 else Gray400, pulse = true) {
                                        ThinkingBubble(item.activity, item.generationStartedAt)
                                    }
                                }
                            }
                            is ChatRenderItem.ArtifactCard -> {
                                val targetConversationId = item.ref.conversationId ?: conversationId
                                ArtifactRefBubble(
                                    ref = item.ref,
                                    onOpenDebrief = { onOpenDebrief?.invoke(targetConversationId) },
                                    onOpenQuiz = { onOpenQuiz?.invoke(targetConversationId, item.ref.artifactId) },
                                    onOpenTeachback = { onOpenTeachback?.invoke(targetConversationId, item.ref.artifactId) },
                                    onOpenArtifact = { onOpenArtifacts?.invoke(item.ref.artifactId) },
                                )
                            }
                            is ChatRenderItem.UserMessage -> {
                                val msg = item.message
                                val chatProjectId = conversation?.project_id ?: projectId
                                MessageBubble(
                                    msg = msg,
                                    onCopy = { copyMessage(clipboardManager, msg.text) },
                                    onEdit = {
                                        editingMessageId = msg.id.takeIf { it.isNotBlank() }
                                        input = msg.text
                                        vm.setDraft(msg.text)
                                    },
                                    onResend = { vm.retryMessage(msg.id, msg.text) },
                                    onDelete = if (msg.id.isNotBlank()) { { deletingMessage = msg } } else null,
                                    onDeleteAfter = if (msg.id.isNotBlank() && msg.timestamp > 0L) { { deleteAfterMessage = msg } } else null,
                                    onSaveAsPrompt = if (msg.text.isNotBlank()) {
                                        {
                                            val body = stripInjectedContextBlocks(msg.text).trim()
                                            savePromptMessage = msg
                                            savePromptBody = body
                                            savePromptTitle = body.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().take(64)
                                            savePromptDescription = ""
                                            savePromptCategory = "Custom"
                                            savePromptTags = ""
                                            savePromptScope = if (!chatProjectId.isNullOrBlank()) "project" else "global"
                                        }
                                    } else null,
                                    isHighlighted = msg.id == highlightedMessageId,
                                    onRetry = null,
                                    onEditAssistant = null,
                                    onBranch = null,
                                    onAddToProject = null,
                                    onInvestigateWithAi = null,
                                    onShare = null,
                                    onReadAloud = null,
                                )
                            }
                            is ChatRenderItem.AssistantMessage -> {
                                val msg = item.message
                                val precedingUserMessage = item.precedingUserMessage
                                val chatProjectId = conversation?.project_id ?: projectId
                                androidx.compose.foundation.layout.Column {
                                    // Historical (settled) thinking blocks no longer render here — they're
                                    // emitted as their own top-level ChatRenderItem.ThinkingBlockItem entries
                                    // by buildChatRenderItems, immediately preceding this item (see its doc
                                    // for why: avoids bursting a reasoning-heavy turn's composition/measure
                                    // work into a single LazyColumn item). Only still-live thinking blocks and
                                    // this turn's tool calls render inline here.
                                    val hasTimelineContent = item.liveThinkingBlocks.isNotEmpty() ||
                                        msg.toolCalls.isNotEmpty()
                                    if (hasTimelineContent) {
                                        if (isCodexReasoning(item.liveThinkingBlocks) || isCodexReasoning(msg.thinkingBlocks)) {
                                            ChatTimelineGroup {
                                                item.liveThinkingBlocks.forEachIndexed { index, block ->
                                                    key("${block.blockId}:$index") {
                                                        ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !block.done), pulse = !block.done) {
                                                            CodexReasoningActionLine(listOf(block))
                                                        }
                                                    }
                                                }
                                                msg.toolCalls.forEach { tc ->
                                                    if (isCodexToolCall(tc.serverName)) {
                                                        ChatTimelineEntry(beadColor = toolCallBeadColor(inProgress = tc.isStreaming, success = tc.toolSuccess), pulse = tc.isStreaming) {
                                                            CodexToolActionLine(tc, inProgress = tc.isStreaming)
                                                        }
                                                    } else {
                                                        ToolCallBubble(tc, inProgress = tc.isStreaming)
                                                    }
                                                }
                                            }
                                        } else {
                                            ChatTimelineGroup {
                                                // Live thinking blocks pre-filtered by buildChatRenderItems (C1 guard).
                                                // Each block is its own bubble — desktop shows each reasoning phase
                                                // separately (ThinkingBlock.tsx renders once per block), so joining
                                                // every block's content into one combined bubble here (the old
                                                // behavior) collapsed a multi-phase turn into a single "> 2k chars"
                                                // blob instead of one bubble per phase.
                                                item.liveThinkingBlocks.forEachIndexed { index, block ->
                                                    key("${block.blockId}:$index") { ThinkingHistoryBubble(listOf(block), isLive = true) }
                                                }
                                                // Tool calls grouped inline above the response text
                                                msg.toolCalls.forEach { tc ->
                                                    ToolCallBubble(tc, inProgress = tc.isStreaming)
                                                }
                                            }
                                        }
                                    }
                                    MessageBubble(
                                        msg = msg,
                                        displayText = item.displayText,
                                        onCopy = { copyMessage(clipboardManager, msg.text) },
                                        onEdit = null,
                                        onResend = null,
                                        onDelete = if (msg.id.isNotBlank()) { { deletingMessage = msg } } else null,
                                    onDeleteAfter = if (msg.id.isNotBlank() && msg.timestamp > 0L) { { deleteAfterMessage = msg } } else null,
                                    isHighlighted = false,
                                    onRetry = if (precedingUserMessage != null) {
                                        { vm.retryMessage(precedingUserMessage.id, precedingUserMessage.text) }
                                    } else null,
                                        onEditAssistant = if (msg.text.isNotBlank()) {
                                            {
                                                editingMessageId = msg.id.takeIf { it.isNotBlank() }
                                                input = msg.text
                                                vm.setDraft(msg.text)
                                            }
                                        } else null,
                                        onBranch = if (msg.timestamp > 0L) {
                                            { branchPending = true; WsRepository.forkConversation(conversationId, msg.timestamp) }
                                        } else null,
                                        onAddToProject = if (chatProjectId != null && msg.text.isNotBlank()) {
                                            { addToProjectMessage = msg; addToProjectTitle = "" }
                                        } else null,
                                        onSaveAsArtifact = if (msg.text.isNotBlank()) {
                                            {
                                                promoteArtifactMessage = msg
                                                promoteArtifactTitle = suggestedArtifactTitle(msg.text)
                                                promoteArtifactKind = "document"
                                                promoteArtifactScopeType = if (!chatProjectId.isNullOrBlank()) "project" else "global"
                                                promoteArtifactFilePath = suggestedArtifactFilePath("document")
                                            }
                                        } else null,
                                        onSaveAsPrompt = if (msg.text.isNotBlank()) {
                                            {
                                                val body = msg.text.trim()
                                                savePromptMessage = msg
                                                savePromptBody = body
                                                savePromptTitle = body.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().take(64)
                                                savePromptDescription = ""
                                                savePromptCategory = "Custom"
                                                savePromptTags = ""
                                                savePromptScope = if (!chatProjectId.isNullOrBlank()) "project" else "global"
                                            }
                                        } else null,
                                        onInvestigateWithAi = if (
                                            msg.text.isNotBlank() &&
                                            onOpenRemoteEditWithPrefill != null &&
                                            !chatProjectId.isNullOrBlank() &&
                                            !projects.find { it.id == chatProjectId }?.rootDirectory.isNullOrBlank() &&
                                            connectionState == ConnectionState.CONNECTED
                                        ) {
                                            { investigateMessage = msg }
                                        } else null,
                                        onShare = if (msg.text.isNotBlank()) {
                                            {
                                                val intent = Intent(Intent.ACTION_SEND).apply {
                                                    type = "text/plain"
                                                    putExtra(Intent.EXTRA_TEXT, msg.text)
                                                }
                                                context.startActivity(Intent.createChooser(intent, "Share message"))
                                            }
                                        } else null,
                                        onReadAloud = if (spokenOutputEnabled && msg.text.isNotBlank()) {
                                            {
                                                if (connectionState == ConnectionState.CONNECTED) {
                                                    WsRepository.send(
                                                        "voice:save-spoken-output",
                                                        mapOf(
                                                            "messageId" to msg.id,
                                                            "spokenText" to sanitizeForSpeech(msg.text),
                                                            "outputKind" to "response",
                                                        ),
                                                    )
                                                }
                                                NexySpeechService.play(context, msg.text, msg.id, conversationId)
                                            }
                                        } else null,
                                        onQuickRecap = if (spokenOutputEnabled && msg.text.isNotBlank()) {
                                            {
                                                val quickRecap = createQuickRecap(msg.text)
                                                if (connectionState == ConnectionState.CONNECTED) {
                                                    WsRepository.send(
                                                        "voice:save-spoken-output",
                                                        mapOf(
                                                            "messageId" to msg.id,
                                                            "spokenText" to quickRecap,
                                                            "outputKind" to "quick-recap",
                                                        ),
                                                    )
                                                }
                                                NexySpeechService.play(
                                                    context,
                                                    quickRecap,
                                                    msg.id,
                                                    conversationId,
                                                    SpokenOutputKind.QUICK_RECAP,
                                                )
                                            }
                                        } else null,
                                        onAiRecap = if (
                                            spokenOutputEnabled &&
                                            msg.text.isNotBlank() &&
                                            connectionState == ConnectionState.CONNECTED
                                        ) {
                                            {
                                                if (aiRecapPendingMessageId == null) {
                                                    aiRecapPendingMessageId = msg.id
                                                    WsRepository.send(
                                                        "voice:generate-ai-recap",
                                                        mapOf("messageId" to msg.id),
                                                    )
                                                }
                                            }
                                        } else null,
                                        aiRecapLoading = aiRecapPendingMessageId == msg.id,
                                        spokenPlaybackState = spokenPlaybackState.takeIf {
                                            it.messageId == msg.id && it.status != SpokenPlaybackStatus.IDLE
                                        },
                                        onPauseSpeech = {
                                            NexySpeechService.command(context, NexySpeechService.ACTION_PAUSE)
                                        },
                                        onResumeSpeech = {
                                            NexySpeechService.command(context, NexySpeechService.ACTION_RESUME)
                                        },
                                        onStopSpeech = {
                                            NexySpeechService.command(context, NexySpeechService.ACTION_STOP)
                                        },
                                        onReplaySpeech = {
                                            NexySpeechService.command(context, NexySpeechService.ACTION_REPLAY)
                                        },
                                    )
                                }
                            }
                        }
                        }
                    }
                    pendingApproval?.let { approval ->
                        item(key = "approval-${approval.requestId}") {
                            ToolApprovalCard(
                                approval = approval,
                                onApprove = {
                                    WsRepository.send("tool:approve", mapOf("requestId" to approval.requestId))
                                    pendingApproval = null
                                },
                                onKeepPlanning = {
                                    WsRepository.send("tool:reject", mapOf("requestId" to approval.requestId))
                                    pendingApproval = null
                                },
                                onDeny = {
                                    WsRepository.send("tool:reject", mapOf("requestId" to approval.requestId))
                                    pendingApproval = null
                                },
                            )
                        }
                    }
                }
                ChatScrollbar(
                    listState = listState,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .fillMaxHeight()
                        .padding(vertical = 4.dp, horizontal = 2.dp),
                )
                }
            }
            // Floating overlay, not in-flow: an in-flow banner here previously resized the
            // Column's weighted LazyColumn area every time this scroll-position-driven banner
            // mounted/unmounted, which shifted the visible items and read as a jitter right as
            // the user scrolled past the point where the banner's target crossed the viewport
            // edge. Offsetting by topBannersHeightPx keeps it below the connection/workflow
            // banners instead of stacking on top of them (the reason it was made in-flow before).
            InReplyToBanner(
                listState = listState,
                renderItems = completedRenderItems,
                lazyHeaderOffset = lazyHeaderOffset,
                onScrollToRequest = { itemIdx -> scope.launch { handleScrollToRequest(itemIdx) } },
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .offset { IntOffset(0, topBannersHeightPx) },
            )
            // Scroll-to-bottom button shown whenever the user is scrolled above the bottom
            if (hasInitiallyScrolled && !isAtBottom) {
                FloatingActionButton(
                    onClick = {
                        scope.launch {
                            shouldAutoFollow = true
                            scrollToBottom(animated = false)
                        }
                    },
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp).size(40.dp),
                ) {
                    Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Scroll to bottom", modifier = Modifier.size(20.dp))
                }
            }
            if (voiceDockEnabled && voiceDockFloating) {
                VoiceDock(
                    state = effectiveVoiceDockState,
                    preferences = preferenceStore,
                    onStartRecording = startVoiceDockRecording,
                    onStopRecording = stopVoiceDockRecording,
                    onCancelRecording = cancelVoiceDockRecording,
                    onDock = { voiceDockFloating = false },
                )
            }
            } // Box
        }
    }
    } // CompositionLocalProvider
}

@Composable
private fun InReplyToBanner(
    listState: androidx.compose.foundation.lazy.LazyListState,
    renderItems: List<ChatRenderItem>,
    lazyHeaderOffset: Int,
    modifier: Modifier = Modifier,
    onScrollToRequest: (Int) -> Unit,
) {
    // derivedStateOf is scoped here so only this composable recomposes on every scroll frame,
    // not the parent Box/Column/LazyColumn.
    val bannerRequest by remember(renderItems, lazyHeaderOffset) {
        derivedStateOf {
            val visibleItems = listState.layoutInfo.visibleItemsInfo
            val firstVisibleIdx = visibleItems.firstOrNull()?.index ?: return@derivedStateOf null
            val topAssistantRenderIdx = visibleItems
                .map { it.index - lazyHeaderOffset }
                .filter { ri -> ri >= 0 && ri < renderItems.size && renderItems[ri] is ChatRenderItem.AssistantMessage }
                .firstOrNull() ?: return@derivedStateOf null
            // Never show the banner for the latest exchange — while the user scrolls down
            // through the final turn to reach the true bottom of the conversation, this
            // condition would otherwise flip true/false on nearly every scroll frame as the
            // preceding user message crosses the viewport's top edge, and the banner
            // appearing/disappearing shrinks and grows the LazyColumn's available height out
            // from under an in-progress drag, which was stranding users mid-scroll unable to
            // reach the bottom. There's also no value in "in reply to" for the message you
            // just sent — it's the one on screen.
            val lastAssistantRenderIdx = renderItems.indexOfLast { it is ChatRenderItem.AssistantMessage }
            if (topAssistantRenderIdx == lastAssistantRenderIdx) return@derivedStateOf null
            // Find the preceding user message
            val precedingUserRenderIdx = (topAssistantRenderIdx - 1 downTo 0)
                .firstOrNull { renderItems[it] is ChatRenderItem.UserMessage } ?: return@derivedStateOf null
            val userLazyIdx = precedingUserRenderIdx + lazyHeaderOffset
            if (visibleItems.any { it.index == userLazyIdx }) return@derivedStateOf null
            if (userLazyIdx >= firstVisibleIdx) return@derivedStateOf null
            val userMsg = (renderItems[precedingUserRenderIdx] as ChatRenderItem.UserMessage).message
            val preview = userMsg.text.replace('\n', ' ').trim()
            if (preview.isBlank()) null else Pair(precedingUserRenderIdx, if (preview.length > 120) preview.take(117) + "…" else preview)
        }
    }
    bannerRequest?.let { (groupIdx, preview) ->
        Surface(
            modifier = modifier
                .fillMaxWidth()
                .clickable { onScrollToRequest(groupIdx) },
            color = MaterialTheme.colorScheme.surfaceVariant,
            shadowElevation = 2.dp,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "In reply to",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    preview,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
