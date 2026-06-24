package io.nexy.android.ui.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ConversationRow(
    conv: Conversation,
    index: Int = 0,
    projects: List<Project> = emptyList(),
    onOpenChat: (String) -> Unit,
    isActive: Boolean = false,
    hasNewContent: Boolean = false,
    isCompleted: Boolean = false,
    onRename: ((id: String, currentTitle: String) -> Unit)? = null,
    onDelete: ((id: String) -> Unit)? = null,
    onTogglePin: ((id: String, pinned: Boolean) -> Unit)? = null,
    onDebrief: ((id: String) -> Unit)? = null,
    onMarkComplete: ((id: String) -> Unit)? = null,
    onQuiz: ((id: String) -> Unit)? = null,
) {
    val preview = conv.last_message ?: ""
    var menuExpanded by remember { mutableStateOf(false) }
    val rowColor = if (index % 2 == 0) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant
    val agentColor = MaterialTheme.colorScheme.primary
    val mutedColor = MaterialTheme.colorScheme.onSurfaceVariant

    // Look up the project color for the left accent bar
    val projectAccentColor = conv.project_id?.let { pid ->
        projects.find { it.id == pid }?.color?.let { projectColor(it) }
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .combinedClickable(
                onClick = { onOpenChat(conv.id) },
                onLongClick = { onRename?.invoke(conv.id, conv.title) },
            ),
        color = rowColor,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Left project accent bar (4dp, same as project rows)
            if (projectAccentColor != null) {
                Box(modifier = Modifier.width(4.dp).fillMaxHeight().background(projectAccentColor))
            }

            // Main content
            Row(
                modifier = Modifier
                    .weight(1f)
                    .padding(
                        start = if (projectAccentColor != null) 12.dp else 16.dp,
                        end = 4.dp,
                        top = 10.dp,
                        bottom = 10.dp,
                    ),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Left: two-line content
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    // Line 1: pin icon + activity dot + title + timestamp
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (conv.pinned) {
                            Icon(
                                Icons.Default.PushPin,
                                contentDescription = null,
                                modifier = Modifier.size(11.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (isActive) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(12.dp),
                                strokeWidth = 1.5.dp,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        } else if (hasNewContent) {
                            Box(
                                modifier = Modifier
                                    .size(7.dp)
                                    .background(
                                        color = MaterialTheme.colorScheme.primary,
                                        shape = CircleShape,
                                    ),
                            )
                        }
                        AnimatedVisibility(
                            visible = isCompleted,
                            enter = fadeIn(tween(300)) + scaleIn(tween(300), initialScale = 0.6f),
                        ) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = "Complete",
                                modifier = Modifier.size(13.dp),
                                tint = Color(0xFF34D399),
                            )
                        }
                        Text(
                            text = conv.title.ifBlank { "Untitled" },
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = timeAgo(conv.updated_at.toLongOrNull() ?: 0L),
                            style = MaterialTheme.typography.labelSmall,
                            color = mutedColor,
                        )
                    }
                    // Line 2: colored agent name + optional project name + preview
                    val agentName = conv.agent_name?.takeIf { it.isNotBlank() }
                    val projectName = conv.project_name?.takeIf { it.isNotBlank() }
                    val hasContext = agentName != null || projectName != null
                    val hasPreview = preview.isNotBlank()
                    if (hasContext || hasPreview) {
                        val line2 = buildAnnotatedString {
                            if (agentName != null) {
                                pushStyle(SpanStyle(color = agentColor))
                                append(agentName)
                                pop()
                            }
                            if (agentName != null && projectName != null) {
                                pushStyle(SpanStyle(color = mutedColor))
                                append("  ·  ")
                                pop()
                            }
                            if (projectName != null) {
                                pushStyle(SpanStyle(color = mutedColor))
                                append(projectName)
                                pop()
                            }
                            if (hasContext && hasPreview) {
                                pushStyle(SpanStyle(color = mutedColor))
                                append("  ·  ")
                                pop()
                            }
                            if (hasPreview) {
                                pushStyle(SpanStyle(color = mutedColor))
                                append(preview)
                                pop()
                            }
                        }
                        Text(
                            text = line2,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                // Right: compact ⋮ menu
                if (onRename != null || onDelete != null || onTogglePin != null || onDebrief != null || onMarkComplete != null || onQuiz != null) {
                    Box {
                        IconButton(
                            onClick = { menuExpanded = true },
                            modifier = Modifier.size(36.dp),
                        ) {
                            Icon(
                                Icons.Default.MoreVert,
                                contentDescription = "Chat actions",
                                modifier = Modifier.size(18.dp),
                                tint = mutedColor,
                            )
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            if (onTogglePin != null) {
                                DropdownMenuItem(
                                    text = { Text(if (conv.pinned) "Unpin" else "Pin") },
                                    leadingIcon = { Icon(Icons.Default.PushPin, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onTogglePin.invoke(conv.id, !conv.pinned)
                                    },
                                )
                            }
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
                            if (onDebrief != null) {
                                DropdownMenuItem(
                                    text = { Text("Debrief") },
                                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.Article, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onDebrief.invoke(conv.id)
                                    },
                                )
                            }
                            if (onMarkComplete != null && !isCompleted) {
                                DropdownMenuItem(
                                    text = { Text("Mark complete") },
                                    leadingIcon = { Icon(Icons.Default.CheckCircle, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onMarkComplete.invoke(conv.id)
                                    },
                                )
                            }
                            if (onQuiz != null && isCompleted) {
                                DropdownMenuItem(
                                    text = { Text("Quiz me") },
                                    leadingIcon = { Icon(Icons.Default.Psychology, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onQuiz.invoke(conv.id)
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PendingConversationRow() {
    val infiniteTransition = rememberInfiniteTransition(label = "pending-dot")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pending-dot-alpha",
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(72.dp)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .background(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                    shape = CircleShape,
                ),
        )
        Text(
            "Starting chat…",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
