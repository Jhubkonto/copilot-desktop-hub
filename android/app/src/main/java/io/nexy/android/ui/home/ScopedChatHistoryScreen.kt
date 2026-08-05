package io.nexy.android.ui.home

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
import io.nexy.android.ui.components.NexyPaginationFooter
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.WsEvent
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import java.util.UUID
import kotlinx.coroutines.delay

enum class HistoryScope {
    Agent,
    Project,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScopedChatHistoryScreen(
    scopeType: HistoryScope,
    scopeId: String,
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
    onOpenDraftChat: (String, String?, String?) -> Unit,
    onOpenDebrief: ((String) -> Unit)? = null,
    onOpenQuiz: ((String) -> Unit)? = null,
) {
    val agents by WsRepository.agents.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val activeConversationIds by WsRepository.activeConversationIds.collectAsStateWithLifecycle()
    val completedConversationIds by WsRepository.completedConversationIds.collectAsStateWithLifecycle()
    var searchQuery by remember { mutableStateOf("") }
    var isRefreshing by remember { mutableStateOf(false) }
    var deletingConversation by remember { mutableStateOf<Conversation?>(null) }
    var conversations by remember { mutableStateOf<List<Conversation>>(emptyList()) }
    var totalCount by remember { mutableStateOf(0) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var hasMore by remember { mutableStateOf(false) }
    var isLoadingPage by remember { mutableStateOf(false) }
    var pageError by remember { mutableStateOf<String?>(null) }
    var pendingRequests by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    val listState = rememberLazyListState()
    var freshPageGeneration by remember { mutableStateOf(0) }

    fun requestPage(append: Boolean) {
        if (isLoadingPage && append) return
        val requestId = UUID.randomUUID().toString()
        pendingRequests = if (append) pendingRequests + (requestId to true) else mapOf(requestId to false)
        isLoadingPage = true
        pageError = null
        if (!append) {
            conversations = emptyList()
            totalCount = 0
            nextCursor = null
            hasMore = false
        }
        WsRepository.listConversationPage(
            scopeType = scopeType.name.lowercase(),
            scopeId = scopeId,
            query = searchQuery.trim(),
            cursor = if (append) nextCursor else null,
            requestId = requestId,
        )
    }

    RefreshConversationsOnResume {
        isRefreshing = true
        requestPage(append = false)
    }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            if (event is WsEvent.ConversationPage) {
                val append = pendingRequests[event.requestId] ?: return@collect
                pendingRequests = pendingRequests - event.requestId
                conversations = if (append) {
                    (conversations + event.conversations).distinctBy { it.id }
                } else {
                    freshPageGeneration += 1
                    event.conversations
                }
                totalCount = event.totalCount
                nextCursor = event.nextCursor
                hasMore = event.hasMore
                isLoadingPage = false
                isRefreshing = false
            }
        }
    }

    // A navigation entry keeps its LazyListState while a chat is open above it. Every fresh
    // history page represents entering/resuming this destination (or starting a new search), so
    // explicitly return to the newest conversation. Appended pagination pages intentionally keep
    // the user's position.
    LaunchedEffect(freshPageGeneration) {
        if (conversations.isNotEmpty()) listState.scrollToItem(0)
    }

    LaunchedEffect(scopeType, scopeId, searchQuery) {
        delay(if (searchQuery.isBlank()) 0 else 250)
        requestPage(append = false)
    }

    val title = when (scopeType) {
        HistoryScope.Agent -> agents.find { it.id == scopeId }?.let { agent ->
            if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name
        } ?: "Agent chats"
        HistoryScope.Project -> projects.find { it.id == scopeId }?.name ?: "Project chats"
    }

    deletingConversation?.let { conv ->
        NexyConfirmDialog(
            title = "Delete chat?",
            message = "\"${conv.title.ifBlank { "Untitled" }}\" will be permanently deleted.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                WsRepository.deleteConversation(conv.id)
                deletingConversation = null
            },
            onDismiss = { deletingConversation = null },
        )
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "$totalCount chat${if (totalCount == 1) "" else "s"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                onBack = onBack,
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    val id = UUID.randomUUID().toString()
                    when (scopeType) {
                        HistoryScope.Agent -> onOpenDraftChat(id, scopeId, null)
                        HistoryScope.Project -> onOpenDraftChat(id, null, scopeId)
                    }
                },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                NexyIcon(NexyIconName.Add, contentDescription = "New Chat")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true; requestPage(append = false) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
                singleLine = true,
                leadingIcon = { NexyIcon(NexyIconName.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotBlank()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            NexyIcon(NexyIconName.Close, contentDescription = "Clear search")
                        }
                    }
                },
                placeholder = { Text("Search chats", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                shape = MaterialTheme.shapes.small,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 8.dp))
            if (conversations.isEmpty() && isLoadingPage) {
                ConversationListSkeleton()
            } else if (conversations.isEmpty() && !isLoadingPage) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        if (searchQuery.isBlank()) "No chats yet." else "No matching chats.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (searchQuery.isNotBlank()) {
                        TextButton(onClick = { searchQuery = "" }) { Text("Clear search") }
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(conversations, key = { it.id }) { conversation ->
                        ConversationRow(
                            conv = conversation,
                            projects = projects,
                            onOpenChat = onOpenChat,
                            isActive = conversation.id in activeConversationIds,
                            isCompleted = conversation.id in completedConversationIds,
                            onDelete = { _ -> deletingConversation = conversation },
                            onDebrief = if (onOpenDebrief != null) { id -> onOpenDebrief(id) } else null,
                            onMarkComplete = { id -> WsRepository.markConversationComplete(id) },
                            onMarkIncomplete = { id -> WsRepository.markConversationIncomplete(id) },
                            onQuiz = if (onOpenQuiz != null) { id -> onOpenQuiz(id) } else null,
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    item(key = "pagination-footer") {
                        NexyPaginationFooter(
                            loadedCount = conversations.size,
                            totalCount = totalCount,
                            hasMore = hasMore,
                            isLoading = isLoadingPage,
                            error = pageError,
                            onLoadMore = { requestPage(append = true) },
                            onRetry = { requestPage(append = conversations.isNotEmpty()) },
                        )
                    }
                }
            }
        }
        }
    }
}
