package io.nexy.android.ui.chat

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.FloatingActionButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.PromptEntry
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.snapshotFlow
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin
import io.noties.markwon.syntax.Prism4jTheme
import io.noties.markwon.syntax.SyntaxHighlightPlugin
import io.noties.prism4j.Prism4j
import android.text.SpannableStringBuilder
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyConnectionBanner
import io.nexy.android.ui.model.activeModelDetail
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import androidx.compose.runtime.withFrameNanos

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    conversationId: String,
    agentId: String? = null,
    projectId: String? = null,
    onBack: () -> Unit,
    onOpenFork: ((String) -> Unit)? = null,
    onOpenRemoteEditWithPrefill: ((String) -> Unit)? = null,
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
    val lastError by WsRepository.lastError.collectAsState()
    val conversation = conversations.find { it.id == conversationId }
    val title = conversation?.title?.ifBlank { null } ?: "Chat"
    val chatAgentId = conversation?.agent_id ?: agentId
    val chatAgent = chatAgentId?.let { id -> agents.find { it.id == id } }
    val chatBackend = chatAgent?.backend
    val draftFromVm by vm.draft.collectAsState()
    var input by remember { mutableStateOf(draftFromVm) }
    val listState = rememberLazyListState()
    var shouldAutoFollow by remember { mutableStateOf(true) }
    var hasInitiallyScrolled by remember { mutableStateOf(false) }
    var programmaticScrollInProgress by remember { mutableStateOf(false) }
    val context = LocalContext.current
    var showModelSheet by remember { mutableStateOf(false) }
    var modelQuery by remember { mutableStateOf("") }
    val modelSheetState = rememberModalBottomSheetState()
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
        programmaticScrollInProgress = true
        try {
            repeat(settlePasses.coerceAtLeast(1)) { pass ->
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

    LaunchedEffect(isAtBottom) {
        if (isAtBottom) shouldAutoFollow = true
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

    // Content signal: new messages, streaming chunks, thinking bubbles, or busy state changes should
    // stay pinned only while auto-follow is enabled.
    LaunchedEffect(messages.size, isAwaitingResponse, isStreaming, streamingTextLength, thinkingBlocksSize, thinkingTotalChars) {
        if (!hasInitiallyScrolled || !shouldAutoFollow) return@LaunchedEffect
        scrollToBottom(settlePasses = 4)
    }

    // Layout signal: AndroidView/Markwon content can change height after message data is already set.
    // While following the bottom, any late measurement that opens scrollable space is corrected.
    LaunchedEffect(hasInitiallyScrolled, shouldAutoFollow) {
        if (!hasInitiallyScrolled || !shouldAutoFollow) return@LaunchedEffect
        snapshotFlow {
            val layout = listState.layoutInfo
            val last = layout.visibleItemsInfo.lastOrNull()
            listOf(
                layout.totalItemsCount,
                layout.viewportStartOffset,
                layout.viewportEndOffset,
                last?.index ?: -1,
                last?.offset ?: 0,
                last?.size ?: 0,
            )
        }.collect {
            if (shouldAutoFollow && listState.canScrollForward) {
                scrollToBottom(settlePasses = 2)
            }
        }
    }

    // User scroll signal: once the user scrolls and leaves the bottom, stop auto-following until
    // they return to the bottom or press the arrow.
    LaunchedEffect(hasInitiallyScrolled) {
        if (!hasInitiallyScrolled) return@LaunchedEffect
        snapshotFlow { listState.isScrollInProgress to listState.canScrollForward }
            .collect { (scrolling, canScrollForward) ->
                if (!programmaticScrollInProgress && scrolling && canScrollForward) {
                    shouldAutoFollow = false
                } else if (!canScrollForward) {
                    shouldAutoFollow = true
                }
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
                else -> {}
            }
        }
    }

    var highlightedMessageId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(investigateMessage) {
        val msg = investigateMessage ?: return@LaunchedEffect
        investigateMessage = null
        onOpenRemoteEditWithPrefill?.invoke(msg.text)
    }

    DisposableEffect(conversationId) {
        WsRepository.activelyViewedConversationId.value = conversationId
        WsRepository.clearCompletedAway(conversationId)
        onDispose { WsRepository.activelyViewedConversationId.value = null }
    }

    val assistantBusy = isStreaming || isAwaitingResponse
    val canSend = (input.isNotBlank() || attachments.isNotEmpty()) && !assistantBusy && connectionState == ConnectionState.CONNECTED
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
    val connectionBanner = connectionState != ConnectionState.CONNECTED

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false; modelQuery = "" },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            val vendorUnavailable: (String) -> Boolean = { vendor ->
                val cliKey = vendor.removeSuffix(" CLI").lowercase()
                val info = cliStatus[cliKey]
                info != null && !info.installed
            }

            data class ModelItem(val model: io.nexy.android.data.model.ModelOption, val unavailable: Boolean)
            data class HeaderItem(val vendor: String, val unavailable: Boolean)

            val query = modelQuery.trim().lowercase()
            val sheetItems: List<Any> = buildList {
                val grouped = models.filterNot { it.id == "default" }.groupBy { it.vendor ?: "" }
                val hasVendorGroups = grouped.any { it.key.isNotBlank() }
                if (hasVendorGroups) {
                    grouped.forEach { (vendor, vendorModels) ->
                        val groupUnavailable = vendor.isNotBlank() && vendorUnavailable(vendor)
                        val filtered = if (query.isEmpty()) vendorModels
                                       else vendorModels.filter { it.label.lowercase().contains(query) }
                        if (filtered.isNotEmpty()) {
                            if (vendor.isNotBlank()) add(HeaderItem(vendor, groupUnavailable))
                            filtered.forEach { add(ModelItem(it, groupUnavailable)) }
                        }
                    }
                } else {
                    models.forEach { model ->
                        if (query.isEmpty() || model.label.lowercase().contains(query)) {
                            val modelUnavailable = model.vendor != null && vendorUnavailable(model.vendor)
                            add(ModelItem(model, modelUnavailable))
                        }
                    }
                }
            }

            val showDefault = query.isEmpty() || "default model".contains(query)

            LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    Text(
                        "Chat model",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                    OutlinedTextField(
                        value = modelQuery,
                        onValueChange = { modelQuery = it },
                        placeholder = { Text("Search models…", style = MaterialTheme.typography.bodyMedium) },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(20.dp)) },
                        trailingIcon = {
                            if (modelQuery.isNotEmpty()) {
                                IconButton(onClick = { modelQuery = "" }) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
                                }
                            }
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        shape = MaterialTheme.shapes.medium,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 4.dp))
                }

                if (showDefault) {
                    item {
                        ModelSheetItem(
                            label = "Default model",
                            vendor = null,
                            selected = activeModelId == "default",
                        ) {
                            vm.setModel(null)
                            modelQuery = ""
                            scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                        }
                    }
                }

                if (models.isEmpty()) {
                    item {
                        Text(
                            emptyModelListDetail(modelSource),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                        )
                    }
                } else {
                    items(sheetItems) { item ->
                        when (item) {
                            is HeaderItem -> Text(
                                item.vendor,
                                style = MaterialTheme.typography.labelMedium,
                                color = if (item.unavailable) MaterialTheme.colorScheme.error
                                        else MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                            )
                            is ModelItem -> ModelSheetItem(
                                label = item.model.label,
                                vendor = null,
                                selected = item.model.id == activeModelId,
                                unavailable = item.unavailable,
                            ) {
                                vm.setModel(item.model.id)
                                modelQuery = ""
                                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                            }
                        }
                    }

                    if (sheetItems.isEmpty() && !showDefault) {
                        item {
                            Text(
                                "No models match \"$modelQuery\"",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                            )
                        }
                    }
                }
            }
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
            Text(
                "Insert Prompt",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            if (promptEntries.isEmpty()) {
                Text(
                    "No saved prompts. Create some in the Prompt Library.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                )
            } else {
                promptEntries.forEach { prompt ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                val separator = if (input.isNotBlank() && !input.endsWith("\n")) "\n" else ""
                                input += "$separator${prompt.body}"
                                vm.setDraft(input)
                                scope.launch { promptSheetState.hide() }.invokeOnCompletion { showPromptSheet = false }
                            },
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
                            Text(prompt.title, style = MaterialTheme.typography.bodyLarge)
                            if (prompt.description.isNotBlank()) {
                                Text(
                                    prompt.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    if (showInspectorSheet) {
        ModalBottomSheet(
            onDismissRequest = { showInspectorSheet = false },
            sheetState = inspectorSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "Context Inspector",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                InspectorRow("Model", activeModelLabel)
                if (agentLabel != null) InspectorRow("Agent", agentLabel)
                if (projectLabel != null) InspectorRow("Project", projectLabel)
                val msgCount = messages.size
                InspectorRow("Messages", "$msgCount message${if (msgCount != 1) "s" else ""} in context")
                val backend = chatAgent?.backend
                if (!backend.isNullOrBlank()) InspectorRow("Backend", backend)
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
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
                title = { Text("Add to project sources") },
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

    val markwon = remember(context) {
        val prism4j = Prism4j(io.nexy.android.GrammarLocatorDef())
        // Custom theme: subtle tinted background with readable dark text instead of Darkula black
        val codeTheme = object : Prism4jTheme {
            override fun background(): Int = 0xFF1E1F2E.toInt() // deep navy, visible in both themes
            override fun textColor(): Int = 0xFFE8EAF6.toInt() // soft lavender-white
            override fun apply(language: String, syntax: io.noties.prism4j.Prism4j.Syntax, builder: SpannableStringBuilder, start: Int, end: Int) = Unit
        }
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(SyntaxHighlightPlugin.create(prism4j, codeTheme))
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
                onSend = { vm.sendMessage(input); input = ""; vm.setDraft("") },
                onAttachFile = { filePicker.launch("*/*") },
                onCaptureScreen = onCaptureScreen,
                onInsertPrompt = {
                    WsRepository.listPrompts()
                    showPromptSheet = true
                },
                onShowInspector = { showInspectorSheet = true },
                isListening = voiceInput.listening,
                onVoiceInput = voiceInput.toggle,
            )
        },
    ) { padding ->
        ChatRefreshableContent(
            isRefreshing = isRefreshing,
            onRefresh = { vm.refreshMessages() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                if (connectionBanner) {
                    NexyConnectionBanner(connectionState, lastError)
                }
                // True once the drain coroutine has created a streaming message in the list.
                // Used to suppress the duplicate ThinkingHistoryBubble in the awaiting section.
                val hasStreamingMessage = remember(messages) { messages.any { it.isStreaming } }

                // Group consecutive isToolCall messages into the assistant message that follows them.
                // This gives one animateItem() animation per response turn instead of one per block.
                val groupedMessages = remember(messages) {
                    val result = mutableListOf<ChatMessage>()
                    val pending = mutableListOf<ChatMessage>()
                    for (msg in messages) {
                        if (msg.isToolCall) {
                            pending.add(msg)
                        } else {
                            result.add(
                                if (!msg.isUser && pending.isNotEmpty())
                                    msg.copy(toolCalls = pending.toList())
                                else msg
                            )
                            pending.clear()
                        }
                    }
                    // Trailing tool calls with no following assistant message yet (mid-stream):
                    // render them individually so they're visible while the agent is still running.
                    result.addAll(pending)
                    result
                }

                // Map each assistant group index → the user message that immediately preceded it
                val requestByGroupIndex = remember(groupedMessages) {
                    val map = mutableMapOf<Int, ChatMessage>()
                    var lastUser: ChatMessage? = null
                    groupedMessages.forEachIndexed { idx, msg ->
                        if (msg.isUser) {
                            lastUser = msg
                        } else if (!msg.isToolCall && lastUser != null) {
                            map[idx] = lastUser!!
                        }
                    }
                    map
                }

                // LazyColumn item index offset: item 0 = ChatStartHeader, items 1..N = groupedMessages
                val lazyHeaderOffset = if (messages.isNotEmpty() || isAwaitingResponse) 1 else 0

                // Sticky "In reply to" banner: show when the topmost visible assistant message's
                // user request is scrolled above the viewport.
                val bannerRequest by remember(groupedMessages, requestByGroupIndex, lazyHeaderOffset) {
                    derivedStateOf {
                        val visibleItems = listState.layoutInfo.visibleItemsInfo
                        val firstVisibleIdx = visibleItems.firstOrNull()?.index ?: return@derivedStateOf null
                        // Find topmost visible assistant item
                        val topAssistantGroupIdx = visibleItems
                            .map { it.index - lazyHeaderOffset }
                            .filter { gi -> gi >= 0 && gi < groupedMessages.size && !groupedMessages[gi].isUser && !groupedMessages[gi].isToolCall }
                            .firstOrNull() ?: return@derivedStateOf null
                        val userMsg = requestByGroupIndex[topAssistantGroupIdx] ?: return@derivedStateOf null
                        // Only show banner if the user message itself is not visible
                        val userGroupIdx = groupedMessages.indexOf(userMsg)
                        val userLazyIdx = userGroupIdx + lazyHeaderOffset
                        val userIsVisible = visibleItems.any { it.index == userLazyIdx }
                        if (userIsVisible) return@derivedStateOf null
                        // Only show when scrolled past (user message is above the viewport)
                        if (userLazyIdx >= firstVisibleIdx) return@derivedStateOf null
                        val preview = userMsg.text.replace('\n', ' ').trim()
                        if (preview.isBlank()) null else Pair(userGroupIdx, if (preview.length > 120) preview.take(117) + "…" else preview)
                    }
                }

                val handleScrollToRequest: suspend (Int) -> Unit = { groupIdx ->
                    val lazyIdx = groupIdx + lazyHeaderOffset
                    listState.animateScrollToItem(lazyIdx)
                    val msgId = groupedMessages.getOrNull(groupIdx)?.id
                    if (msgId != null) {
                        highlightedMessageId = msgId
                        kotlinx.coroutines.delay(1600)
                        highlightedMessageId = null
                    }
                }

                androidx.compose.animation.AnimatedVisibility(
                    visible = bannerRequest != null,
                    enter = androidx.compose.animation.fadeIn() + androidx.compose.animation.expandVertically(),
                    exit = androidx.compose.animation.fadeOut() + androidx.compose.animation.shrinkVertically(),
                ) {
                    bannerRequest?.let { (groupIdx, preview) ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { scope.launch { handleScrollToRequest(groupIdx) } },
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

                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (messages.isEmpty() && !isAwaitingResponse) {
                        item {
                            EmptyChatContent(agentLabel = agentLabel, projectLabel = projectLabel)
                        }
                    } else {
                        item { ChatStartHeader() }
                    }
                    itemsIndexed(groupedMessages, key = { idx, msg -> msg.id.ifBlank { "${msg.isUser}_${msg.timestamp}_${msg.toolName}_$idx" } }) { msgIndex, msg ->
                        androidx.compose.foundation.layout.Column {
                            // Standalone trailing tool call (mid-stream, no following assistant msg yet)
                            if (msg.isToolCall) {
                                ToolCallBubble(msg, inProgress = false)
                                return@Column
                            }
                            val committedBlockIds = remember(msg.thinkingBlocks) {
                                msg.thinkingBlocks.map { it.blockId }.toSet()
                            }
                            // Live thinking: only show blocks not already committed to the message (C1 guard).
                            if (!msg.isUser && msg.isStreaming && liveThinkingBlocks.isNotEmpty()) {
                                val visibleLive = liveThinkingBlocks.filter { it.blockId !in committedBlockIds }
                                if (visibleLive.isNotEmpty()) {
                                    ThinkingHistoryBubble(visibleLive, isLive = true, responseIsStreaming = msg.text.isNotEmpty())
                                }
                            }
                            // Historical thinking: skip if streaming live blocks cover same content.
                            if (!msg.isUser && msg.thinkingBlocks.isNotEmpty() && !(msg.isStreaming && liveThinkingBlocks.isNotEmpty())) {
                                ThinkingHistoryBubble(msg.thinkingBlocks, isLive = false, responseIsStreaming = msg.isStreaming)
                            }
                            // Tool calls grouped inline above the response text
                            msg.toolCalls.forEach { tc ->
                                ToolCallBubble(tc, inProgress = tc.isStreaming)
                            }
                            val precedingUserText = if (!msg.isUser) {
                                groupedMessages.take(msgIndex).lastOrNull { it.isUser }?.text
                            } else null
                            val chatProjectId = conversation?.project_id ?: projectId
                            MessageBubble(
                                msg = msg,
                                onCopy = { copyMessage(clipboardManager, msg.text) },
                                onEdit = if (msg.isUser) { { input = msg.text; vm.setDraft(msg.text) } } else null,
                                onResend = if (msg.isUser) { { vm.sendMessage(msg.text) } } else null,
                                onDelete = if (msg.id.isNotBlank()) { { deletingMessage = msg } } else null,
                                onDeleteAfter = if (msg.id.isNotBlank() && msg.timestamp > 0L) { { deleteAfterMessage = msg } } else null,
                                isHighlighted = msg.isUser && msg.id == highlightedMessageId,
                                onRetry = if (!msg.isUser && precedingUserText != null) {
                                    { vm.sendMessage(precedingUserText) }
                                } else null,
                                onEditAssistant = if (!msg.isUser && msg.text.isNotBlank()) {
                                    { input = msg.text; vm.setDraft(msg.text) }
                                } else null,
                                onBranch = if (!msg.isUser && msg.timestamp > 0L) {
                                    { branchPending = true; WsRepository.forkConversation(conversationId, msg.timestamp) }
                                } else null,
                                onAddToProject = if (!msg.isUser && chatProjectId != null && msg.text.isNotBlank()) {
                                    { addToProjectMessage = msg; addToProjectTitle = "" }
                                } else null,
                            onInvestigateWithAi = if (!msg.isUser && msg.text.isNotBlank() && onOpenRemoteEditWithPrefill != null) {
                                    { investigateMessage = msg }
                                } else null,
                                onShare = if (!msg.isUser && msg.text.isNotBlank()) {
                                    {
                                        val intent = Intent(Intent.ACTION_SEND).apply {
                                            type = "text/plain"
                                            putExtra(Intent.EXTRA_TEXT, msg.text)
                                        }
                                        context.startActivity(Intent.createChooser(intent, "Share message"))
                                    }
                                } else null,
                                onReadAloud = if (!msg.isUser && msg.text.isNotBlank()) {
                                    {
                                        tts.stop()
                                        tts.speak(msg.text, TextToSpeech.QUEUE_FLUSH, null, msg.id)
                                    }
                                } else null,
                            )
                        } // animateItem Column
                    }
                    // Only show the awaiting-section when NOT actively streaming.
                    // When streaming, the message item already contains the live thinking bubble
                    // and text — showing ThinkingBubble here too causes a visible duplicate/flash.
                    if (isAwaitingResponse && !isStreaming) {
                        if (liveThinkingBlocks.isNotEmpty() && !hasStreamingMessage) {
                            item { ThinkingHistoryBubble(liveThinkingBlocks, isLive = true) }
                        }
                        item { ThinkingBubble(activityLabel, generationStartedAt) }
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
private fun InspectorRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
