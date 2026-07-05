package io.nexy.android.ui.home

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import io.nexy.android.ui.components.NexyConfirmDialog
import io.nexy.android.ui.components.NexyTopAppBar
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
    val conversations by WsRepository.conversations.collectAsState()
    val agents by WsRepository.agents.collectAsState()
    val projects by WsRepository.projects.collectAsState()
    val activeConversationIds by WsRepository.activeConversationIds.collectAsState()
    val completedConversationIds by WsRepository.completedConversationIds.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    var isRefreshing by remember { mutableStateOf(false) }
    var deletingConversation by remember { mutableStateOf<Conversation?>(null) }

    LaunchedEffect(Unit) {
        WsRepository.events.collect { event ->
            if (event is WsEvent.ConversationList) isRefreshing = false
        }
    }

    val title = when (scopeType) {
        HistoryScope.Agent -> agents.find { it.id == scopeId }?.let { agent ->
            if (agent.icon.isNotBlank()) "${agent.icon}  ${agent.name}" else agent.name
        } ?: "Agent chats"
        HistoryScope.Project -> projects.find { it.id == scopeId }?.name ?: "Project chats"
    }
    val filtered = remember(conversations, scopeType, scopeId, searchQuery) {
        val scoped = when (scopeType) {
            HistoryScope.Agent -> conversations.filter { it.agent_id == scopeId }
            HistoryScope.Project -> conversations.filter { it.project_id == scopeId }
        }
        val query = searchQuery.trim()
        if (query.isBlank()) scoped else scoped.filter { conversation ->
            listOfNotNull(conversation.title, conversation.last_message, conversation.agent_name, conversation.project_name)
                .any { it.contains(query, ignoreCase = true) }
        }
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
                            "${filtered.size} chat${if (filtered.size == 1) "" else "s"}",
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
                Icon(Icons.Default.Add, contentDescription = "New Chat")
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true; WsRepository.listConversations() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 12.dp),
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotBlank()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Close, contentDescription = "Clear search")
                        }
                    }
                },
                placeholder = { Text("Search chats", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, autoCorrectEnabled = true),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 8.dp))
            if (filtered.isEmpty()) {
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
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(filtered, key = { it.id }) { conversation ->
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
                }
            }
        }
        }
    }
}
