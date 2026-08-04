package io.nexy.android.ui.share

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.nexy.android.data.WsRepository
import io.nexy.android.share.ShareIntentRepository
import io.nexy.android.ui.components.NexySearchField
import io.nexy.android.ui.components.NexyTopAppBar

@Composable
fun ShareToChatScreen(
    batchId: String,
    onBack: () -> Unit,
    onSelectConversation: (String) -> Unit,
    onNewChat: () -> Unit,
) {
    val context = LocalContext.current
    val batch = remember(batchId) { ShareIntentRepository.load(context, batchId) }
    val conversations by WsRepository.conversations.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    val filtered = remember(conversations, query) {
        val needle = query.trim()
        conversations
            .filterNot { it.archived }
            .filter {
                needle.isBlank() || it.title.contains(needle, ignoreCase = true) ||
                    it.project_name?.contains(needle, ignoreCase = true) == true ||
                    it.agent_name?.contains(needle, ignoreCase = true) == true
            }
            .sortedWith(compareByDescending<io.nexy.android.data.model.Conversation> { it.pinned }.thenByDescending { it.updated_at })
    }

    LaunchedEffect(Unit) { WsRepository.listConversations() }

    Scaffold(
        topBar = {
            NexyTopAppBar(
                titleContent = { Text("Share to chat") },
                onBack = {
                    ShareIntentRepository.discard(context, batchId)
                    onBack()
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            val accepted = batch?.attachments?.size ?: 0
            val description = buildString {
                if (accepted > 0) append("$accepted file${if (accepted == 1) "" else "s"}")
                if (!batch?.text.isNullOrBlank()) append(if (isNotEmpty()) " + shared text" else "Shared text")
                if ((batch?.rejectedCount ?: 0) > 0) append(" · ${batch?.rejectedCount} skipped")
            }
            Text(
                description.ifBlank { "Shared content" },
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.secondary,
            )
            NexySearchField(query, { query = it }, "Search conversations")
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    ListItem(
                        headlineContent = { Text("New chat") },
                        supportingContent = { Text("Review the attachments before sending") },
                        leadingContent = { Icon(Icons.Default.Add, contentDescription = null) },
                        modifier = Modifier.clickable(onClick = onNewChat),
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                items(filtered, key = { it.id }) { conversation ->
                    ListItem(
                        headlineContent = { Text(conversation.title.ifBlank { "Chat" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = {
                            val scope = conversation.project_name ?: conversation.agent_name ?: conversation.last_message
                            if (!scope.isNullOrBlank()) Text(scope, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        trailingContent = {
                            if (conversation.pinned) Icon(Icons.Default.PushPin, contentDescription = "Pinned")
                        },
                        modifier = Modifier.clickable { onSelectConversation(conversation.id) },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
                if (filtered.isEmpty()) {
                    item {
                        Text(
                            if (query.isBlank()) "No conversations yet." else "No matching conversations.",
                            modifier = Modifier.padding(24.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
