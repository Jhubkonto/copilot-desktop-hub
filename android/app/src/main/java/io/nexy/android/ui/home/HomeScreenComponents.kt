package io.nexy.android.ui.home

import android.animation.ValueAnimator
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.nexy.android.data.model.Conversation
import io.nexy.android.data.model.Project
import io.nexy.android.ui.components.nexyDither
import io.nexy.android.ui.icons.NexyIcon
import io.nexy.android.ui.icons.NexyIconName
import io.nexy.android.ui.theme.Green500
import io.nexy.android.ui.theme.LocalNexyEightBit
import io.nexy.android.ui.theme.NexyNotificationDotShape

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
    onMarkIncomplete: ((id: String) -> Unit)? = null,
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
                            NexyIcon(
                                NexyIconName.Pin,
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
                                        shape = NexyNotificationDotShape,
                                    ),
                            )
                        }
                        if (isCompleted) {
                            NexyIcon(
                                NexyIconName.CheckedBox,
                                contentDescription = "Complete",
                                modifier = Modifier.size(16.dp),
                                tint = Green500,
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
                if (onRename != null || onDelete != null || onTogglePin != null || onDebrief != null || onMarkComplete != null || onMarkIncomplete != null || onQuiz != null) {
                    Box {
                        IconButton(
                            onClick = { menuExpanded = true },
                            modifier = Modifier.size(36.dp),
                        ) {
                            NexyIcon(
                                NexyIconName.More,
                                contentDescription = "Chat actions",
                                modifier = Modifier.size(18.dp),
                                tint = mutedColor,
                            )
                        }
                        DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                            if (onTogglePin != null) {
                                DropdownMenuItem(
                                    text = { Text(if (conv.pinned) "Unpin" else "Pin") },
                                    leadingIcon = { NexyIcon(NexyIconName.Pin, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onTogglePin.invoke(conv.id, !conv.pinned)
                                    },
                                )
                            }
                            if (onRename != null) {
                                DropdownMenuItem(
                                    text = { Text("Rename") },
                                    leadingIcon = { NexyIcon(NexyIconName.Prompt, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onRename.invoke(conv.id, conv.title)
                                    },
                                )
                            }
                            if (onMarkComplete != null && !isCompleted) {
                                DropdownMenuItem(
                                    text = { Text("Mark complete") },
                                    leadingIcon = { NexyIcon(NexyIconName.Check, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onMarkComplete.invoke(conv.id)
                                    },
                                )
                            }
                            if (onMarkIncomplete != null && isCompleted) {
                                DropdownMenuItem(
                                    text = { Text("Mark incomplete") },
                                    leadingIcon = { NexyIcon(NexyIconName.Close, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onMarkIncomplete.invoke(conv.id)
                                    },
                                )
                            }
                            if (onDebrief != null) {
                                DropdownMenuItem(
                                    text = { Text("Debrief") },
                                    leadingIcon = { NexyIcon(NexyIconName.Artifact, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onDebrief.invoke(conv.id)
                                    },
                                )
                            }
                            if (onQuiz != null) {
                                DropdownMenuItem(
                                    text = { Text("Quiz me") },
                                    leadingIcon = { NexyIcon(NexyIconName.Rating, contentDescription = null) },
                                    onClick = {
                                        menuExpanded = false
                                        onQuiz.invoke(conv.id)
                                    },
                                )
                            }
                            if (onDelete != null) {
                                DropdownMenuItem(
                                    text = { Text("Delete") },
                                    leadingIcon = { NexyIcon(NexyIconName.Delete, contentDescription = null) },
                                    colors = MenuDefaults.itemColors(
                                        textColor = MaterialTheme.colorScheme.error,
                                        leadingIconColor = MaterialTheme.colorScheme.error,
                                    ),
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
        }
    }
}

@Composable
fun PendingConversationRow() {
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
                    color = MaterialTheme.colorScheme.primary,
                    shape = MaterialTheme.shapes.extraSmall,
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

// Placeholder rows shown while a chat history list's first page is still loading — echoes
// ConversationRow's 72dp shape (accent bar + two text lines) so the swap to real rows doesn't
// jump the layout. Shares the same pulse styling as ChatLoadingSkeleton so both list and message
// loading states feel like one system.
@Composable
fun ConversationListSkeleton(rows: Int = 6) {
    if (LocalNexyEightBit.current) {
        val motionEnabled = !LocalInspectionMode.current && ValueAnimator.areAnimatorsEnabled()
        val transition = rememberInfiniteTransition(label = "retro-history-skeleton-pulse")
        val pulseAlpha by transition.animateFloat(
            initialValue = 1f,
            targetValue = if (motionEnabled) 0.62f else 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 1_400),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "retro-history-skeleton-pulse-alpha",
        )
        HistorySkeletonRows(
            rows = rows,
            shape = RoundedCornerShape(2.dp),
            modifier = Modifier
                .graphicsLayer(alpha = pulseAlpha)
                .nexyDither(
                    background = MaterialTheme.colorScheme.surfaceVariant,
                    foreground = MaterialTheme.colorScheme.outlineVariant,
                ),
        )
        return
    }

    val transition = rememberInfiniteTransition(label = "history-skeleton-pulse")
    val pulseAlpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.9f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 700),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "history-skeleton-pulse-alpha",
    )
    HistorySkeletonRows(
        rows = rows,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.background(
            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = pulseAlpha * 0.25f),
        ),
    )
}

@Composable
private fun HistorySkeletonRows(
    rows: Int,
    shape: RoundedCornerShape,
    modifier: Modifier,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        repeat(rows) { index ->
            Row(
                modifier = Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(if (index % 2 == 0) 0.55f else 0.4f)
                            .height(14.dp)
                            .clip(shape)
                            .then(modifier),
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(0.85f)
                            .height(12.dp)
                            .clip(shape)
                            .then(modifier),
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
