package io.nexy.android.ui.chat

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
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
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.model.activeModelDetail
import io.nexy.android.ui.model.activeModelLabel
import io.nexy.android.ui.model.emptyModelListDetail
import io.nexy.android.ui.model.modelSourceDetail
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    conversationId: String,
    agentId: String? = null,
    projectId: String? = null,
    onBack: () -> Unit,
    onOpenFork: ((String) -> Unit)? = null,
    vm: ChatViewModel = viewModel(factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>) =
            ChatViewModel(conversationId, agentId = agentId, projectId = projectId) as T
    }),
) {
    val messages by vm.messages.collectAsState()
    val isStreaming by vm.isStreaming.collectAsState()
    val isAwaitingResponse by vm.isAwaitingResponse.collectAsState()
    val isRefreshing by vm.isRefreshing.collectAsState()
    val activityLabel by vm.activityLabel.collectAsState()
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
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val context = LocalContext.current
    var showModelSheet by remember { mutableStateOf(false) }
    val modelSheetState = rememberModalBottomSheetState()
    var showActionsSheet by remember { mutableStateOf(false) }
    var showPromptSheet by remember { mutableStateOf(false) }
    var showInspectorSheet by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val sendError by vm.sendError.collectAsState()
    var deletingMessage by remember { mutableStateOf<ChatMessage?>(null) }
    val promptEntries by WsRepository.promptEntries.collectAsState()

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
                    snackbarHostState.showSnackbar("$name is larger than 4 MB and was not attached.")
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

    val clipboardManager = context.getSystemService(ClipboardManager::class.java)

    val pasteImage: () -> Unit = pasteImage@{
        val clip = clipboardManager.primaryClip ?: return@pasteImage
        val item = clip.getItemAt(0) ?: return@pasteImage
        val uri = item.uri ?: return@pasteImage
        val mimeType = context.contentResolver.getType(uri) ?: return@pasteImage
        if (!mimeType.startsWith("image/")) {
            scope.launch { snackbarHostState.showSnackbar("Clipboard item is not an image.") }
            return@pasteImage
        }
        val inputStream = context.contentResolver.openInputStream(uri) ?: return@pasteImage
        val bytes = inputStream.use { it.readBytes() }
        if (bytes.size > 4 * 1024 * 1024) {
            scope.launch { snackbarHostState.showSnackbar("Clipboard image is larger than 4 MB.") }
            return@pasteImage
        }
        val name = context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = runCatching { c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME) }.getOrElse { -1 }
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        } ?: "clipboard.png"
        val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        vm.addAttachment(name, mimeType, "data:$mimeType;base64,$b64", null)
    }

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

    LaunchedEffect(messages.size, isAwaitingResponse) {
        val itemCount = messages.size + if (isAwaitingResponse) 1 else 0
        if (itemCount > 0) listState.animateScrollToItem(itemCount - 1)
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
    val connectionBanner = when (connectionState) {
        ConnectionState.CONNECTED -> null
        ConnectionState.CONNECTING -> "Reconnecting to desktop..."
        ConnectionState.DISCONNECTED -> lastError?.let { "Disconnected: $it" } ?: "Disconnected from desktop"
    }

    if (showModelSheet) {
        ModalBottomSheet(
            onDismissRequest = { showModelSheet = false },
            sheetState = modelSheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "Chat model",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            modelSource?.let { source ->
                Text(
                    modelSourceDetail(source, models.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 12.dp),
                )
            }
            Text(
                activeModelDetail,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val vendorUnavailable: (String) -> Boolean = { vendor ->
                val cliKey = vendor.removeSuffix(" CLI").lowercase()
                val info = cliStatus[cliKey]
                info != null && !info.installed
            }
            if (models.isEmpty()) {
                Text(
                    emptyModelListDetail(modelSource),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
                ModelSheetItem(
                    label = "Default model",
                    vendor = null,
                    selected = activeModelId == "default",
                ) {
                    vm.setModel(null)
                    scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                }
            } else {
                val grouped = models.groupBy { it.vendor ?: "" }
                val hasVendorGroups = grouped.any { it.key.isNotBlank() }
                if (hasVendorGroups) {
                    grouped.forEach { (vendor, vendorModels) ->
                        val groupUnavailable = vendor.isNotBlank() && vendorUnavailable(vendor)
                        if (vendor.isNotBlank()) {
                            Text(
                                vendor,
                                style = MaterialTheme.typography.labelMedium,
                                color = if (groupUnavailable) MaterialTheme.colorScheme.error
                                        else MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                            )
                        }
                        vendorModels.forEach { model ->
                            ModelSheetItem(
                                label = model.label,
                                vendor = null,
                                selected = model.id == activeModelId,
                                unavailable = groupUnavailable,
                            ) {
                                vm.setModel(model.id)
                                scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                            }
                        }
                    }
                } else {
                    models.forEach { model ->
                        val modelUnavailable = model.vendor != null && vendorUnavailable(model.vendor)
                        ModelSheetItem(
                            label = model.label,
                            vendor = model.vendor,
                            selected = model.id == activeModelId,
                            unavailable = modelUnavailable,
                        ) {
                            vm.setModel(model.id)
                            scope.launch { modelSheetState.hide() }.invokeOnCompletion { showModelSheet = false }
                        }
                    }
                }
            }
            Spacer(Modifier.padding(bottom = 16.dp))
        }
    }

    if (showActionsSheet) {
        ConversationActionsSheet(
            conversationId = conversationId,
            onDismiss = { showActionsSheet = false },
            onForkNavigate = { forkedId ->
                onOpenFork?.invoke(forkedId)
            },
        )
    }

    if (showPromptSheet) {
        val promptSheetState = rememberModalBottomSheetState()
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
        val inspectorSheetState = rememberModalBottomSheetState()
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
                        IconButton(onClick = { vm.stopStream() }) {
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
                onInputChange = { input = it },
                attachments = attachments,
                onRemoveAttachment = { vm.removeAttachment(it) },
                canSend = canSend,
                onSend = { vm.sendMessage(input); input = "" },
                onAttachFile = { filePicker.launch("*/*") },
                onPasteImage = {
                    if (clipboardManager.primaryClipDescription?.hasMimeType("image/*") == true) {
                        pasteImage()
                    } else {
                        scope.launch { snackbarHostState.showSnackbar("No image in clipboard.") }
                    }
                },
                onCaptureScreen = onCaptureScreen,
                onInsertPrompt = {
                    WsRepository.listPrompts()
                    showPromptSheet = true
                },
                onShowInspector = { showInspectorSheet = true },
            )
        },
    ) { padding ->
        ChatRefreshableContent(
            isRefreshing = isRefreshing,
            onRefresh = { vm.refreshMessages() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                if (connectionBanner != null) {
                    ChatConnectionBanner(connectionBanner)
                }
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (messages.isEmpty() && !isAwaitingResponse) {
                        item {
                            EmptyChatContent(agentLabel = agentLabel, projectLabel = projectLabel)
                        }
                    }
                    itemsIndexed(messages) { _, msg ->
                        if (msg.isToolCall) {
                            ToolCallBubble(msg)
                        } else {
                            MessageBubble(
                                msg = msg,
                                onCopy = { copyMessage(clipboardManager, msg.text) },
                                onEdit = if (msg.isUser) { { input = msg.text } } else null,
                                onResend = if (msg.isUser) { { vm.sendMessage(msg.text) } } else null,
                                onDelete = if (msg.id.isNotBlank()) { { deletingMessage = msg } } else null,
                            )
                        }
                    }
                    if (isAwaitingResponse) {
                        item { ThinkingBubble(activityLabel) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatConnectionBanner(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun InspectorRow(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
