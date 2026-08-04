package io.nexy.android.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import io.nexy.android.ui.components.NexyTopAppBar

/** Full-screen counterpart to the right-edge pinned-chat shelf. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PinnedChatsScreen(
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    val projects by WsRepository.projects.collectAsStateWithLifecycle()
    val activeConversationIds by WsRepository.activeConversationIds.collectAsStateWithLifecycle()
    val pinnedConversations = remember(conversations) { conversations.filter { it.pinned } }
    var isRefreshing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        // This screen is reachable independently of HomeViewModel, so request the authoritative
        // list instead of assuming the paginated Chats tab has already populated shared state.
        WsRepository.listConversations()
    }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = {
                    Column {
                        Text("Pinned chats", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "${pinnedConversations.size} quick access",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }
                },
                onBack = onBack,
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = {
                isRefreshing = true
                WsRepository.listConversations()
                isRefreshing = false
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (pinnedConversations.isEmpty()) {
                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "No pinned chats yet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Pin a conversation from its chat menu to keep it here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    itemsIndexed(pinnedConversations, key = { _, conversation -> conversation.id }) { index, conversation ->
                        ConversationRow(
                            conv = conversation,
                            index = index,
                            projects = projects,
                            onOpenChat = onOpenChat,
                            isActive = conversation.id in activeConversationIds,
                            isCompleted = conversation.completed_at != null,
                            onTogglePin = { id, pinned -> WsRepository.setPinnedConversation(id, pinned) },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}
