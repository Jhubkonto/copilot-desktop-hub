package io.nexy.android.ui.chat

import android.Manifest
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import android.speech.tts.TextToSpeech
import java.util.Locale
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import io.nexy.android.ui.theme.Blue500
import io.nexy.android.ui.theme.Gray400
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
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
import io.nexy.android.ui.model.agentBackendLockDetail
import io.nexy.android.ui.model.agentBackendLockLabel
import io.nexy.android.ui.model.activeModelDetail
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import androidx.compose.runtime.withFrameNanos

/** Small "Completed" indicator shown in the chat header's title area when the open
 * conversation is marked complete — the in-chat counterpart to the checkmark already shown
 * for completed conversations in list screens (e.g. ScopedChatHistoryScreen). */
@Composable
fun ChatCompletedBadge() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            modifier = Modifier.size(12.dp),
            tint = Color(0xFF34D399),
        )
        Text(
            "Completed",
            maxLines = 1,
            style = MaterialTheme.typography.labelSmall,
            color = Color(0xFF34D399),
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
    onOpenFork: ((String) -> Unit)? = null,
    onOpenRemoteEditWithPrefill: ((String, String) -> Unit)? = null,
    onOpenCodePanel: ((String) -> Unit)? = null,
    onOpenAutomatedWorkflow: ((String) -> Unit)? = null,
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
    val messages by vm.messages.collectAsState()
    val isStreaming by vm.isStreaming.collectAsState()
    val isAwaitingResponse by vm.isAwaitingResponse.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    val activityLabel by vm.activityLabel.collectAsState()
    val liveActivity by vm.liveActivity.collectAsState()
    val liveThinkingBlocks by vm.liveThinkingBlocks.collectAsState()
    val generationStartedAt by vm.generationStartedAt.collectAsState()
    val selectedModel by vm.selectedModel.collectAsState()
    val attachments by vm.attachments.collectAsState()
    val conversations by WsRepository.conversations.collectAsState()
    val agents by WsRepository.agents.collectAsState()
    val projects by WsRepository.projects.collectAsState()
    val models by WsRepository.models.collectAsState()
    val modelSource by WsRepository.modelSource.collectAsState()
    val cliStatus by WsRepository.cliStatus.collectAsState()
    val connectionState by WsRepository.connectionState.collectAsState()
    val capabilities by WsRepository.capabilities.collectAsState()
    val lastError by WsRepository.lastError.collectAsState()
    val effectiveMode by WsRepository.effectiveMode.collectAsState()
    val conversation = conversations.find { it.id == conversationId }
    val isCompleted = conversation?.completed_at != null
    val conversationRating = conversation?.rating
    val title = conversation?.title?.ifBlank { null } ?: "Chat"
    val chatThinkingEffortOverride = conversation?.thinking_effort_override
    val chatFullAutoApproveOverride = conversation?.full_auto_approve_override
    val chatAgentId = conversation?.agent_id ?: agentId
    val chatAgent = chatAgentId?.let { id -> agents.find { it.id == id } }
    val chatBackend = chatAgent?.backend
    val statusProjectId = conversation?.project_id ?: projectId
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

    val customSlashCommands by vm.customSlashCommands.collectAsState()
    val draftFromVm by vm.draft.collectAsState()
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
    val listState = rememberLazyListState()
    var shouldAutoFollow by remember { mutableStateOf(true) }
    var hasInitiallyScrolled by remember { mutableStateOf(false) }
    var programmaticScrollInProgress by remember { mutableStateOf(false) }
    val context = LocalContext.current
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()
    var showModeSheet by remember { mutableStateOf(false) }
    val modeSheetState = rememberModalBottomSheetState()
    var showActionsSheet by remember { mutableStateOf(false) }
    var showPromptSheet by remember { mutableStateOf(false) }
    val promptSheetState = rememberModalBottomSheetState()
    var showInspectorSheet by remember { mutableStateOf(false) }
    val inspectorSheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val voiceInput = rememberOnDeviceVoiceInput(
        onText = { text -> input = if (input.isBlank()) text else "${input.trimEnd()} $text"; vm.setDraft(input) },
        onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
    )
    val sendError by vm.sendError.collectAsState()
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
    var pendingApproval by remember { mutableStateOf<io.nexy.android.data.model.WsEvent.ToolApprovalRequest?>(null) }
    val promptEntries by WsRepository.promptEntries.collectAsState()
    var relaunchFilePicker by remember { mutableStateOf(false) }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        for (uri in uris) {
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
                val text = try {
                    bytes.toString(Charsets.UTF_8).also {
                        Charsets.UTF_8.newDecoder()
                            .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                            .decode(java.nio.ByteBuffer.wrap(bytes))
                    }
                } catch (e: java.nio.charset.CharacterCodingException) {
                    scope.launch { snackbarHostState.showSnackbar("$name is a binary file and cannot be attached as text.") }
                    continue
                }
                vm.addAttachment(name, mimeType, null, text)
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

    val attachLatestScreenshot: () -> Unit = attachLatestScreenshot@{
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.MIME_TYPE,
        )
        val selection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ?"
        } else {
            "${MediaStore.Images.Media.DATA} LIKE ?"
        }
        val selectionArg = "%Screenshot%"
        val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
        val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val cursor = context.contentResolver.query(uri, projection, selection, arrayOf(selectionArg), sortOrder)
            ?: run {
                scope.launch { snackbarHostState.showSnackbar("Could not query screenshots.") }
                return@attachLatestScreenshot
            }
        val imageUri = cursor.use { c ->
            if (!c.moveToFirst()) return@use null
            val idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val id = c.getLong(idCol)
            android.content.ContentUris.withAppendedId(uri, id)
        }
        if (imageUri == null) {
            scope.launch { snackbarHostState.showSnackbar("No screenshots found.") }
            return@attachLatestScreenshot
        }
        val mimeType = context.contentResolver.getType(imageUri) ?: "image/png"
        val name = context.contentResolver.query(imageUri, null, null, null, null)?.use { c ->
            val idx = runCatching { c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME) }.getOrElse { -1 }
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        } ?: "screenshot.png"
        val inputStream = context.contentResolver.openInputStream(imageUri) ?: run {
            scope.launch { snackbarHostState.showSnackbar("Could not read screenshot.") }
            return@attachLatestScreenshot
        }
        val bytes = inputStream.use { it.readBytes() }
        if (bytes.size > 4 * 1024 * 1024) {
            scope.launch { snackbarHostState.showSnackbar("Screenshot is larger than 4 MB.") }
            return@attachLatestScreenshot
        }
        val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        vm.addAttachment(name, mimeType, "data:$mimeType;base64,$b64", null)
    }

    val screenshotPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Manifest.permission.READ_MEDIA_IMAGES
    } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
    }

    val screenshotPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) attachLatestScreenshot()
        else scope.launch { snackbarHostState.showSnackbar("Permission denied — cannot read screenshots.") }
    }

    val onCaptureScreen: () -> Unit = {
        val granted = ContextCompat.checkSelfPermission(context, screenshotPermission) == PackageManager.PERMISSION_GRANTED
        if (granted) attachLatestScreenshot()
        else screenshotPermissionLauncher.launch(screenshotPermission)
    }

    suspend fun scrollToBottom(animated: Boolean = false, settlePasses: Int = 1) {
        if (!shouldAutoFollow) return
        programmaticScrollInProgress = true
        try {
            repeat(settlePasses.coerceAtLeast(1)) { pass ->
                if (!shouldAutoFollow) return
                val itemCount = listState.layoutInfo.totalItemsCount
                if (itemCount <= 0) return
                if (animated && pass == 0) {
                    listState.animateScrollToItem(itemCount - 1, scrollOffset = Int.MAX_VALUE)
                } else {
                    listState.scrollToItem(itemCount - 1, scrollOffset = Int.MAX_VALUE)
                }
                // Markwon AndroidView content can report a larger measured height after it is first revealed.
                withFrameNanos {}
                if (!listState.canScrollForward) return
            }
        } finally {
            programmaticScrollInProgress = false
        }
    }

    val isAtBottom by remember {
        derivedStateOf { !listState.canScrollForward }
    }

    // Initial entry: wait for real chat content, then keep correcting while rich text settles.
    LaunchedEffect(Unit) {
        snapshotFlow { listState.layoutInfo.totalItemsCount }
            .first { it > 0 }
        shouldAutoFollow = true
        scrollToBottom(settlePasses = 12)
        hasInitiallyScrolled = true
    }

    val streamingTextLength = remember(messages) { messages.lastOrNull { it.isStreaming }?.text?.length ?: 0 }
    val thinkingBlocksSize = liveThinkingBlocks.size
    val thinkingTotalChars = liveThinkingBlocks.sumOf { it.content.length }
    // Track team activity content changes (in-place updates don't change messages.size)
    val teamActivityResultLength = remember(messages) { messages.filter { it.serverName == "Team activity" }.sumOf { (it.toolResult?.length ?: 0) + (it.toolArgs?.length ?: 0) } }

    // Content signal: new messages, streaming chunks, thinking bubbles, or busy state changes should
    // stay pinned only while auto-follow is enabled.
    LaunchedEffect(messages.size, isAwaitingResponse, isStreaming, streamingTextLength, thinkingBlocksSize, thinkingTotalChars, teamActivityResultLength) {
        if (!hasInitiallyScrolled || !shouldAutoFollow) return@LaunchedEffect
        scrollToBottom(settlePasses = 4)
    }

    // Layout signal: AndroidView/Markwon content can change height after message data is already set.
    // Only watches item count and the last item's size — not scroll position — so normal scrolling
    // through the list never triggers this. Only fires when auto-follow is on and not mid-scroll.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        snapshotFlow {
            val layout = listState.layoutInfo
            val last = layout.visibleItemsInfo.lastOrNull()
            Triple(
                if (shouldAutoFollow) 1 else 0,
                layout.totalItemsCount,
                last?.size ?: 0,
            )
        }.collect {
            if (shouldAutoFollow && !listState.isScrollInProgress && listState.canScrollForward) {
                scrollToBottom(settlePasses = 2)
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

    LaunchedEffect(conversation?.model) {
        vm.loadModel(conversation?.model)
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

    val slashCommandMessage by vm.slashCommandMessage.collectAsState()
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
        onDispose { WsRepository.activelyViewedConversationId.value = null }
    }

    val assistantBusy = isStreaming || isAwaitingResponse
    val canSend = (input.isNotBlank() || attachments.isNotEmpty()) &&
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
    val activeModelDetail = activeModelDetail(selectedModel, chatAgent, modelSource)
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
                onSetThinkingEffort = { vm.setThinkingEffortOverride(it) },
                onSetFullAutoApprove = { vm.setFullAutoApproveOverride(it) },
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

    val tts = remember(context) {
        var engine: TextToSpeech? = null
        engine = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                engine?.language = Locale.getDefault()
            }
        }
        engine
    }
    DisposableEffect(Unit) {
        onDispose { tts.stop(); tts.shutdown() }
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
                        Text(
                            activeModelLabel,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 118.dp),
                        )
                    }
                    IconButton(onClick = { showModeSheet = true }) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = "Chat mode settings",
                            tint = if (chatThinkingEffortOverride != null || chatFullAutoApproveOverride != null)
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (assistantBusy) {
                        val stopPulse = rememberInfiniteTransition(label = "stop-pulse")
                        val stopAlpha by stopPulse.animateFloat(
                            initialValue = 1f,
                            targetValue = 0.4f,
                            animationSpec = infiniteRepeatable(
                                animation = tween(700, easing = FastOutSlowInEasing),
                                repeatMode = RepeatMode.Reverse,
                            ),
                            label = "stop-alpha",
                        )
                        IconButton(
                            onClick = { vm.stopStream() },
                            modifier = Modifier.graphicsLayer { alpha = stopAlpha },
                        ) {
                            Icon(Icons.Default.Stop, contentDescription = "Stop")
                        }
                    }
                    IconButton(onClick = { showActionsSheet = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "More actions")
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
                onCaptureScreen = onCaptureScreen,
                onInsertPrompt = {
                    WsRepository.listPrompts()
                    showPromptSheet = true
                },
                onShowInspector = { showInspectorSheet = true },
                isListening = voiceInput.listening,
                onVoiceInput = voiceInput.toggle,
                customSlashCommands = customSlashCommands,
            )
        },
    ) { padding ->
        val renderItems = remember(messages, isAwaitingResponse, isStreaming, liveThinkingBlocks, liveActivity, generationStartedAt) {
            buildChatRenderItems(
                messages = messages,
                liveThinkingBlocks = liveThinkingBlocks,
                isAwaitingResponse = isAwaitingResponse,
                isStreaming = isStreaming,
                activity = liveActivity,
                generationStartedAt = generationStartedAt,
            )
        }

        // LazyColumn item index offset: item 0 = ChatStartHeader, items 1..N = renderItems
        val lazyHeaderOffset = if (renderItems.isNotEmpty()) 1 else 0

        val handleScrollToRequest: suspend (Int) -> Unit = { itemIdx ->
            programmaticScrollInProgress = true
            shouldAutoFollow = false
            val lazyIdx = itemIdx + lazyHeaderOffset
            try {
                listState.animateScrollToItem(lazyIdx)
            } finally {
                programmaticScrollInProgress = false
            }
            val msgId = (renderItems.getOrNull(itemIdx) as? ChatRenderItem.UserMessage)?.message?.id
            if (msgId != null) {
                highlightedMessageId = msgId
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

                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (renderItems.isEmpty()) {
                        item {
                            EmptyChatContent(agentLabel = agentLabel, projectLabel = projectLabel)
                        }
                    } else {
                        item { ChatStartHeader() }
                    }
                    items(
                        renderItems,
                        key = { item -> item.key },
                        contentType = { item ->
                            when (item) {
                                is ChatRenderItem.UserMessage -> 0
                                is ChatRenderItem.ToolCall -> 1
                                is ChatRenderItem.AssistantMessage -> 2
                                is ChatRenderItem.LiveThinking -> 3
                                is ChatRenderItem.LiveActivity -> 4
                                is ChatRenderItem.ArtifactCard -> 5
                                is ChatRenderItem.ThinkingBlockItem -> 6
                            }
                        },
                    ) { item ->
                        // animateItem() smooths reordering within the list via placementSpec.
                        // fadeIn/fadeOut used to be enabled here (280ms/180ms, later tried at
                        // 60ms) to soften the live→settled item swap, but any nonzero fade
                        // duration means two multi-line text items briefly coexist at partial
                        // alpha in the same slot — for stacked paragraph text that reads as
                        // garbled/double-printed rather than a clean cross-dissolve, and it
                        // reproduced on every new message append, not just the live-item swap.
                        // Disabled outright: items now appear/disappear at their measured
                        // position with no alpha-coexistence window. Only smooth repositioning
                        // (existing items shifting for an insertion) is animated.
                        Column(
                            modifier = Modifier
                                .animateItem(
                                    fadeInSpec = null,
                                    fadeOutSpec = null,
                                    placementSpec = tween(320, easing = FastOutSlowInEasing),
                                )
                                .fillMaxWidth(),
                        ) {
                        when (item) {
                            is ChatRenderItem.ToolCall -> {
                                if (isCodexToolCall(item.message.serverName)) {
                                    ChatTimelineGroup {
                                        ChatTimelineEntry(beadColor = toolCallBeadColor(inProgress = false, success = item.message.toolSuccess)) {
                                            CodexToolActionLine(item.message, inProgress = false)
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup { ToolCallBubble(item.message, inProgress = false) }
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
                            is ChatRenderItem.LiveThinking -> {
                                if (isCodexReasoning(item.blocks)) {
                                    ChatTimelineGroup {
                                        item.blocks.forEach { block ->
                                            key(block.blockId) {
                                                ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = !block.done), pulse = !block.done) {
                                                    CodexReasoningActionLine(listOf(block))
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    ChatTimelineGroup {
                                        item.blocks.forEach { block ->
                                            key(block.blockId) { ThinkingHistoryBubble(listOf(block), isLive = true) }
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
                                val precedingUserMessage = renderItems
                                    .take(renderItems.indexOf(item))
                                    .filterIsInstance<ChatRenderItem.UserMessage>()
                                    .lastOrNull()?.message
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
                                                item.liveThinkingBlocks.forEach { block ->
                                                    key(block.blockId) {
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
                                                item.liveThinkingBlocks.forEach { block ->
                                                    key(block.blockId) { ThinkingHistoryBubble(listOf(block), isLive = true) }
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
                                        onReadAloud = if (msg.text.isNotBlank()) {
                                            {
                                                tts.stop()
                                                tts.speak(msg.text, TextToSpeech.QUEUE_FLUSH, null, msg.id)
                                            }
                                        } else null,
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
                                onDeny = {
                                    WsRepository.send("tool:reject", mapOf("requestId" to approval.requestId))
                                    pendingApproval = null
                                },
                            )
                        }
                    }
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
                renderItems = renderItems,
                lazyHeaderOffset = lazyHeaderOffset,
                onScrollToRequest = { itemIdx -> scope.launch { handleScrollToRequest(itemIdx) } },
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .offset { IntOffset(0, topBannersHeightPx) },
            )
            // Scroll-to-bottom button shown whenever the user is scrolled above the bottom
            AnimatedVisibility(
                visible = hasInitiallyScrolled && !isAtBottom,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                FloatingActionButton(
                    onClick = {
                        scope.launch {
                            shouldAutoFollow = true
                            scrollToBottom(animated = false, settlePasses = 12)
                        }
                    },
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Scroll to bottom", modifier = Modifier.size(20.dp))
                }
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

