package io.nexy.android.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.NewContentConversation
import io.nexy.android.ui.components.NexyTopAppBar
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewContentScreen(onBack: () -> Unit, onOpenChat: (String) -> Unit) {
    val serverConversations by WsRepository.newContentConversations.collectAsStateWithLifecycle()
    val unreadIds by WsRepository.completedWhileAwayIds.collectAsStateWithLifecycle()
    val cachedConversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val conversations = remember(serverConversations, unreadIds, cachedConversations) {
        val serverById = serverConversations.associateBy { it.conversationId }
        unreadIds.mapNotNull { id ->
            serverById[id] ?: cachedConversations.firstOrNull { it.id == id }?.let { cached ->
                NewContentConversation(
                    conversationId = cached.id,
                    title = cached.title,
                    projectId = cached.project_id,
                    projectName = cached.project_name,
                    agentId = cached.agent_id,
                    agentName = cached.agent_name,
                    preview = cached.last_message,
                    newContentAt = System.currentTimeMillis(),
                )
            }
        }.sortedByDescending { it.newContentAt }
    }
    var isRefreshing by remember { mutableStateOf(false) }
    Scaffold(topBar = {
        NexyTopAppBar(
            titleContent = {
                Column {
                    Text("New content", maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        "${conversations.size} unread chat${if (conversations.size == 1) "" else "s"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            },
            onBack = onBack,
            actions = {
                if (conversations.isNotEmpty()) {
                    TextButton(onClick = { WsRepository.markAllNewContentRead() }) { Text("Mark all read") }
                }
            },
        )
    }) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true; WsRepository.getNewContent(); isRefreshing = false },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (conversations.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text("You're all caught up.", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Chats with new assistant content will appear here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(conversations, key = { it.conversationId }) { item ->
                        NewContentRow(item, onOpenChat)
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun NewContentRow(item: NewContentConversation, onOpenChat: (String) -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().clickable { onOpenChat(item.conversationId) }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(item.title, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(item.newContentAt)),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            item.preview?.replace(Regex("\\s+"), " ")?.trim().takeUnless { it.isNullOrBlank() }
                ?: "New assistant content is ready.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        val context = listOfNotNull(item.agentName, item.projectName).joinToString(" · ")
        if (context.isNotBlank()) {
            Text(context, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}
