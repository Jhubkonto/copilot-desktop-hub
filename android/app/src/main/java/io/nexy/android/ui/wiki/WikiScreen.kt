package io.nexy.android.ui.wiki

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Surface
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import io.nexy.android.ui.components.NexyTopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.nexy.android.data.model.WikiEntry
import io.nexy.android.data.model.WikiExtractionCandidate
import io.nexy.android.data.WsRepository
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.model.ProjectWikiMcpStatus
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyFormSheet
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WikiScreen(
    projectId: String,
    conversationId: String? = null,
    initialEntryId: String? = null,
    onBack: () -> Unit,
    onNavigateToConversation: ((conversationId: String) -> Unit)? = null,
    vm: WikiViewModel = viewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val connectionState by WsRepository.connectionState.collectAsStateWithLifecycle()
    val wikiMcpStatus = WsRepository.wikiMcpStatuses.collectAsStateWithLifecycle().value[projectId]
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var wikiMcpStatusLoading by remember(projectId) { mutableStateOf(true) }
    var wikiMcpActionLoading by remember(projectId) { mutableStateOf(false) }
    var wikiMcpStatusError by remember(projectId) { mutableStateOf<String?>(null) }

    LaunchedEffect(state.error) {
        val err = state.error ?: return@LaunchedEffect
        scope.launch { snackbarHostState.showSnackbar(err) }
        vm.dismissError()
    }

    LaunchedEffect(projectId) {
        wikiMcpStatusLoading = true
        wikiMcpStatusError = null
        vm.load(projectId)
        WsRepository.getWikiMcpStatus(projectId)
    }
    LaunchedEffect(projectId) {
        WsRepository.events.collect { event ->
            when (event) {
                is io.nexy.android.data.model.WsEvent.WikiMcpStatus -> {
                    if (event.status.projectId == projectId) {
                        wikiMcpStatusLoading = false
                        wikiMcpStatusError = null
                        wikiMcpActionLoading = false
                    }
                }
                is io.nexy.android.data.model.WsEvent.WikiMcpError -> {
                    if (event.projectId == projectId) {
                        wikiMcpStatusLoading = false
                        wikiMcpStatusError = event.message
                        wikiMcpActionLoading = false
                        snackbarHostState.showSnackbar(event.message)
                    }
                }
                else -> Unit
            }
        }
    }
    LaunchedEffect(initialEntryId, state.entries) {
        val entryId = initialEntryId?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        if (state.selectedEntry?.id != entryId) {
            state.entries.firstOrNull { it.id == entryId }?.let(vm::selectEntry)
        }
    }

    if (state.showExtractionSheet) {
        WikiExtractionSheet(
            candidates = state.extractionCandidates,
            selectedIndices = state.selectedCandidateIndices,
            onToggle = { vm.toggleCandidateSelection(it) },
            onConfirm = { vm.confirmExtraction() },
            onDismiss = { vm.dismissExtraction() },
        )
    }

    val selected = state.selectedEntry
    if (selected != null) {
        WikiEntryScreen(
            entry = selected,
            isEditing = state.isEditing,
            editTitle = state.editTitle,
            editBody = state.editBody,
            editTags = state.editTags,
            onBack = { vm.clearSelection() },
            onStartEdit = { vm.startEdit() },
            onCancelEdit = { vm.cancelEdit() },
            onSaveEdit = { vm.saveEdit() },
            onDelete = { vm.deleteEntry(selected.id); vm.clearSelection() },
            onTitleChange = { vm.setEditTitle(it) },
            onBodyChange = { vm.setEditBody(it) },
            onTagsChange = { vm.setEditTags(it) },
            onNavigateToConversation = onNavigateToConversation,
        )
        return
    }

    if (state.showCreateSheet) {
        CreateWikiEntrySheet(
            title = state.editTitle,
            body = state.editBody,
            tags = state.editTags,
            onTitleChange = { vm.setEditTitle(it) },
            onBodyChange = { vm.setEditBody(it) },
            onTagsChange = { vm.setEditTags(it) },
            onConfirm = { vm.createEntry() },
            onDismiss = { vm.dismissCreate() },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Project Wiki", style = MaterialTheme.typography.titleMedium) },
                onBack = onBack,
                actions = {
                    if (conversationId != null) {
                        if (state.isExtracting) {
                            NexyIcon(NexyIconName.Busy, "Extracting", modifier = Modifier.padding(horizontal = 12.dp), tint = MaterialTheme.colorScheme.primary)
                        } else {
                            TextButton(onClick = { vm.extractFromConversation(conversationId) }) {
                                Text("Extract")
                            }
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { vm.showCreate() }) {
                NexyIcon(NexyIconName.Add, contentDescription = "New entry")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            WikiMcpAccessCard(
                status = wikiMcpStatus,
                connected = connectionState == ConnectionState.CONNECTED,
                statusLoading = wikiMcpStatusLoading,
                actionLoading = wikiMcpActionLoading,
                statusError = wikiMcpStatusError,
                onRetry = {
                    wikiMcpStatusLoading = true
                    wikiMcpStatusError = null
                    WsRepository.getWikiMcpStatus(projectId)
                },
                onConnect = {
                    wikiMcpActionLoading = true
                    wikiMcpStatusError = null
                    WsRepository.startWikiMcp(projectId)
                },
                onDisconnect = {
                    wikiMcpActionLoading = true
                    wikiMcpStatusError = null
                    WsRepository.stopWikiMcp(projectId)
                },
                onCopy = { status ->
                    val config = status.toMcpClientConfig()
                    if (config != null) {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("Nexy project wiki MCP", config))
                        scope.launch { snackbarHostState.showSnackbar("MCP configuration copied") }
                    }
                },
                onShare = { status ->
                    val config = status.toMcpClientConfig()
                    if (config != null) {
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "application/json"
                            putExtra(Intent.EXTRA_TEXT, config)
                        }, "Share project wiki MCP configuration"))
                    }
                },
            )
            PullToRefreshBox(
                isRefreshing = state.isLoading,
                onRefresh = {
                    vm.load(projectId)
                    wikiMcpStatusLoading = true
                    wikiMcpStatusError = null
                    WsRepository.getWikiMcpStatus(projectId)
                },
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) {
            if (state.entries.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("No wiki entries yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Text("Tap + to create the first one.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (conversationId != null) {
                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = { vm.extractFromConversation(conversationId) }, enabled = !state.isExtracting) {
                        Text("Extract learnings from this conversation")
                    }
                }
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(state.entries) { entry ->
                    WikiEntryRow(entry = entry, onClick = { vm.selectEntry(entry) })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
            }
        }
    }
}

@Composable
private fun WikiMcpAccessCard(
    status: ProjectWikiMcpStatus?,
    connected: Boolean,
    statusLoading: Boolean,
    actionLoading: Boolean,
    statusError: String?,
    onRetry: () -> Unit,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onCopy: (ProjectWikiMcpStatus) -> Unit,
    onShare: (ProjectWikiMcpStatus) -> Unit,
) {
    val running = status?.running == true
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("External LLM access", style = MaterialTheme.typography.titleSmall)
            Text(
                if (statusLoading) "Checking whether the project MCP bridge is already running…"
                else if (statusError != null) "Could not determine the project MCP bridge status."
                else if (!connected) "Connect to the Nexy desktop to control this project's MCP bridge."
                else if (running) "The desktop bridge is running. External clients can use this project's capability packs."
                else "Expose this project to an external MCP client through the paired desktop.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (statusLoading) {
                    TextButton(onClick = {}, enabled = false) { Text("Checking…") }
                } else if (statusError != null) {
                    TextButton(onClick = onRetry) { Text("Retry") }
                } else if (running) {
                    TextButton(onClick = onDisconnect, enabled = !actionLoading) { Text(if (actionLoading) "Stopping…" else "Disconnect") }
                    if (status?.stdio != null) {
                        TextButton(onClick = { onCopy(status) }) { Text("Copy config") }
                        TextButton(onClick = { onShare(status) }) { Text("Share") }
                    }
                } else {
                    TextButton(onClick = onConnect, enabled = connected && !actionLoading) { Text(if (actionLoading) "Starting…" else "Connect") }
                }
            }
        }
    }
}

private fun ProjectWikiMcpStatus.toMcpClientConfig(): String? {
    val bridge = stdio ?: return null
    val envJson = org.json.JSONObject()
    bridge.env.forEach { (key, value) -> envJson.put(key, value) }
    val serverJson = org.json.JSONObject()
        .put("command", bridge.command)
        .put("args", org.json.JSONArray(bridge.args))
        .put("env", envJson)
    return org.json.JSONObject()
        .put("mcpServers", org.json.JSONObject().put("nexy-project", serverJson))
        .toString(2)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WikiEntryRow(entry: WikiEntry, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(entry.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        if (entry.body.isNotBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(entry.body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        if (entry.tags.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                entry.tags.forEach { tag ->
                    AssistChip(onClick = {}, label = { Text(tag, style = MaterialTheme.typography.labelSmall) })
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun WikiEntryScreen(
    entry: WikiEntry,
    isEditing: Boolean,
    editTitle: String,
    editBody: String,
    editTags: String,
    onBack: () -> Unit,
    onStartEdit: () -> Unit,
    onCancelEdit: () -> Unit,
    onSaveEdit: () -> Unit,
    onDelete: () -> Unit,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
    onNavigateToConversation: ((String) -> Unit)? = null,
) {
    var showDeleteDialog by remember { mutableStateOf(false) }

    // Mirrors the TopAppBar's `onBack = if (isEditing) onCancelEdit else onBack` below — without
    // this, system/gesture back skips straight out instead of stepping back one level at a time.
    BackHandler { if (isEditing) onCancelEdit() else onBack() }

    if (showDeleteDialog) {
        NexyConfirmDialog(
            title = "Delete entry?",
            message = "\"${entry.title}\" will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = { showDeleteDialog = false; onDelete() },
            onDismiss = { showDeleteDialog = false },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text(if (isEditing) "Edit Entry" else entry.title, style = MaterialTheme.typography.titleMedium) },
                onBack = if (isEditing) onCancelEdit else onBack,
                actions = {
                    if (isEditing) {
                        TextButton(onClick = onSaveEdit) { Text("Save") }
                    } else {
                        IconButton(onClick = onStartEdit) { NexyIcon(NexyIconName.Edit, contentDescription = "Edit") }
                        IconButton(onClick = { showDeleteDialog = true }) { NexyIcon(NexyIconName.Delete, contentDescription = "Delete") }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            if (isEditing) {
                OutlinedTextField(value = editTitle, onValueChange = onTitleChange, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editBody, onValueChange = onBodyChange, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 4, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = editTags, onValueChange = onTagsChange, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done))
            } else {
                Text(entry.body, style = MaterialTheme.typography.bodyMedium)
                if (entry.tags.isNotEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    Text("Tags", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        entry.tags.forEach { tag ->
                            AssistChip(onClick = {}, label = { Text(tag) })
                        }
                    }
                }
                val srcConv = entry.sourceConversationId
                if (srcConv != null && onNavigateToConversation != null) {
                    Spacer(Modifier.height(20.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(Modifier.height(8.dp))
                    Text("Source", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "View source conversation",
                        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable { onNavigateToConversation(srcConv) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateWikiEntrySheet(
    title: String,
    body: String,
    tags: String,
    onTitleChange: (String) -> Unit,
    onBodyChange: (String) -> Unit,
    onTagsChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    NexyFormSheet(
        title = "New Wiki Entry",
        confirmLabel = "Create",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        confirmEnabled = title.isNotBlank(),
    ) {
        OutlinedTextField(value = title, onValueChange = onTitleChange, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true, imeAction = ImeAction.Next))
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(value = body, onValueChange = onBodyChange, label = { Text("Body") }, modifier = Modifier.fillMaxWidth(), minLines = 3, keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true))
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(value = tags, onValueChange = onTagsChange, label = { Text("Tags (comma-separated)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WikiExtractionSheet(
    candidates: List<WikiExtractionCandidate>,
    selectedIndices: Set<Int>,
    onToggle: (Int) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    NexyFormSheet(
        title = "Extracted Learnings (${selectedIndices.size} selected)",
        confirmLabel = "Add Selected",
        onConfirm = onConfirm,
        onDismiss = onDismiss,
        confirmEnabled = selectedIndices.isNotEmpty(),
    ) {
        if (candidates.isEmpty()) {
            Text("No learnings were extracted from this conversation.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text("Select which entries to add to the wiki:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            candidates.forEachIndexed { index, candidate ->
                var expanded by remember { mutableStateOf(false) }
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { onToggle(index) }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Checkbox(checked = index in selectedIndices, onCheckedChange = { onToggle(index) })
                    Column(modifier = Modifier.weight(1f).padding(start = 4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(candidate.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                            if (candidate.body.isNotBlank()) {
                                IconButton(onClick = { expanded = !expanded }) {
                                    NexyIcon(
                                        if (expanded) NexyIconName.ChevronUp else NexyIconName.ChevronDown,
                                        contentDescription = if (expanded) "Collapse preview" else "Expand preview",
                                    )
                                }
                            }
                        }
                        if (expanded) {
                            val previewLines = candidate.body.lines().take(5).joinToString("\n")
                            Column {
                                Surface(
                                    shape = MaterialTheme.shapes.extraSmall,
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        previewLines,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(8.dp),
                                    )
                                }
                                Spacer(Modifier.height(4.dp))
                            }
                        }
                        if (candidate.tags.isNotEmpty()) {
                            Text(candidate.tags.joinToString(", "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                if (index < candidates.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
