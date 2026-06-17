package io.nexy.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.Conversation

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ConversationRow(
    conv: Conversation,
    onOpenChat: (String) -> Unit,
    onRename: ((id: String, currentTitle: String) -> Unit)? = null,
    onDelete: ((id: String) -> Unit)? = null,
) {
    val preview = conv.last_message ?: ""
    var menuExpanded by remember { mutableStateOf(false) }
    Surface(
        modifier = Modifier.fillMaxWidth().combinedClickable(
            onClick = { onOpenChat(conv.id) },
            onLongClick = { onRename?.invoke(conv.id, conv.title) },
        ),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = conv.title.ifBlank { "Untitled" },
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = timeAgo(conv.updated_at.toLongOrNull() ?: 0L),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 8.dp),
                )
                if (onRename != null || onDelete != null) {
                    Box {
                        IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(48.dp)) {
                            Icon(
                                Icons.Default.MoreVert,
                                contentDescription = "Chat actions",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            if (onRename != null) {
                                DropdownMenuItem(
                                    text = { Text("Rename") },
                                    leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onRename.invoke(conv.id, conv.title)
                                    },
                                )
                            }
                            if (onDelete != null) {
                                DropdownMenuItem(
                                    text = { Text("Delete") },
                                    leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onDelete.invoke(conv.id)
                                    },
                                )
                            }
                        }
                    }
                }
            }
            Row(
                modifier = Modifier.padding(top = 3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val contextParts = listOfNotNull(
                    conv.agent_name?.takeIf { it.isNotBlank() }?.let { "Agent: $it" },
                    conv.project_name?.takeIf { it.isNotBlank() }?.let { "Project: $it" },
                )
                Text(
                    text = contextParts.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (contextParts.isNotEmpty()) MaterialTheme.colorScheme.primary else Color.Transparent,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = preview,
                style = MaterialTheme.typography.bodySmall,
                color = if (preview.isNotEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else Color.Transparent,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

@Composable
fun FilterSheetItem(
    label: String,
    selected: Boolean,
    prefix: String? = null,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                if (prefix != null) {
                    Text(
                        prefix,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (selected) {
                Text(
                    "Selected",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun NewChatItem(
    label: String,
    dotColor: Color? = null,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (dotColor != null) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .background(dotColor, CircleShape),
                )
            }
            Text(label, style = MaterialTheme.typography.bodyLarge)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshableContent(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    content: @Composable () -> Unit,
) {
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        content()
    }
}
