package io.nexy.android.ui.chat

import android.widget.TextView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Share
import androidx.compose.animation.Crossfade
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.runtime.compositionLocalOf
import io.nexy.android.data.model.ThinkingBlock
import io.noties.markwon.Markwon
import kotlinx.coroutines.delay

val LocalMarkwon = compositionLocalOf<Markwon> { error("No Markwon provided") }

@Composable
fun ChatStartHeader() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 24.dp, bottom = 12.dp, start = 16.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
            thickness = 0.5.dp,
        )
        Text(
            "Start of conversation",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
            thickness = 0.5.dp,
        )
    }
}

@Composable
fun ThinkingBubble(label: String, generationStartedAt: Long? = null) {
    var elapsedSec by remember { mutableIntStateOf(0) }
    LaunchedEffect(generationStartedAt) {
        if (generationStartedAt == null || generationStartedAt == 0L) {
            elapsedSec = 0
            return@LaunchedEffect
        }
        while (true) {
            elapsedSec = ((System.currentTimeMillis() - generationStartedAt) / 1000L).toInt().coerceAtLeast(0)
            delay(250L)
        }
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.Start,
    ) {
        Surface(
            shape = RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val displayLabel = if (elapsedSec > 0) "$label · ${elapsedSec}s" else label
                Text(
                    displayLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TypingDots()
            }
        }
    }
}

@Composable
fun TypingDots() {
    val transition = rememberInfiniteTransition(label = "typing-dots")
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { index ->
            val fraction by transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = keyframes {
                        durationMillis = 1000
                        0f at 0
                        1f at 300
                        0f at 600
                        0f at 1000
                    },
                    repeatMode = RepeatMode.Restart,
                    initialStartOffset = StartOffset(index * 180),
                ),
                label = "typing-dot-$index",
            )
            val alpha = 0.35f + fraction * 0.65f
            val scale = 0.75f + fraction * 0.25f
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .alpha(alpha)
                    .background(
                        MaterialTheme.colorScheme.onSurfaceVariant,
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size((8 * scale).dp)
                        .background(MaterialTheme.colorScheme.onSurfaceVariant, CircleShape),
                )
            }
        }
    }
}

@Composable
fun ThinkingHistoryBubble(
    blocks: List<ThinkingBlock>,
    isLive: Boolean = false,
    responseIsStreaming: Boolean = false,
) {
    if (blocks.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    var userCollapsed by remember { mutableStateOf(false) }
    val totalChars = blocks.sumOf { it.content.length }

    // Track hasContent without restarting the collapse timer on every chunk (M4).
    val hasContent = totalChars > 0

    // Expand when live blocks arrive; collapse immediately when response starts streaming.
    // Only depends on isLive and hasContent — totalChars changes do NOT restart the effect.
    LaunchedEffect(isLive, hasContent) {
        if (isLive && hasContent && !userCollapsed) expanded = true
    }

    // Collapse immediately when the response starts streaming.
    LaunchedEffect(responseIsStreaming) {
        if (responseIsStreaming && !isLive) {
            expanded = false
            userCollapsed = false
        }
    }

    // Auto-collapse 2s after done — only fires once when isLive flips false.
    LaunchedEffect(isLive) {
        if (!isLive && !responseIsStreaming && expanded) {
            delay(2000)
            expanded = false
            userCollapsed = false
        }
    }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    val next = !expanded
                    expanded = next
                    if (!next && isLive) userCollapsed = true
                    if (next) userCollapsed = false
                }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Default.Psychology,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = MaterialTheme.colorScheme.tertiary,
            )
            Text(
                if (isLive) "Reasoning…" else "Reasoning · ${if (totalChars > 2000) ">${totalChars / 1000}k" else "~${maxOf(100, totalChars / 100 * 100)}"} chars",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.weight(1f),
            )
            Icon(
                if (expanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = if (expanded) "Collapse thinking" else "Expand thinking",
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut(),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                blocks.forEach { block ->
                    if (block.content.isNotBlank()) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                block.content,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(8.dp),
                                maxLines = 30,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MessageBubble(
    msg: ChatMessage,
    onCopy: () -> Unit,
    onEdit: (() -> Unit)?,
    onResend: (() -> Unit)?,
    onDelete: (() -> Unit)? = null,
    onDeleteAfter: (() -> Unit)? = null,
    onRetry: (() -> Unit)? = null,
    onEditAssistant: (() -> Unit)? = null,
    onBranch: (() -> Unit)? = null,
    onAddToProject: (() -> Unit)? = null,
    onShare: (() -> Unit)? = null,
    onReadAloud: (() -> Unit)? = null,
    onInvestigateWithAi: (() -> Unit)? = null,
    isHighlighted: Boolean = false,
) {
    val isUser = msg.isUser
    val timeLabel = relativeTime(msg.timestamp)

    if (!isUser) {
        // --- Assistant: full-width, no bubble, left-border accent ---
        var menuExpanded by remember { mutableStateOf(false) }
        var overflowExpanded by remember { mutableStateOf(false) }
        val textColor = MaterialTheme.colorScheme.onSurface
        val textColorArgb = textColor.toArgb()
        val markwon = LocalMarkwon.current

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 2.dp),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .combinedClickable(onClick = {}, onLongClick = { menuExpanded = true }),
            ) {
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(text = { Text("Copy") }, onClick = { menuExpanded = false; onCopy() })
                    if (onRetry != null) DropdownMenuItem(text = { Text("Retry") }, onClick = { menuExpanded = false; onRetry() })
                    if (onEditAssistant != null) DropdownMenuItem(text = { Text("Edit message") }, onClick = { menuExpanded = false; onEditAssistant() })
                    if (onBranch != null) DropdownMenuItem(text = { Text("Branch in new chat") }, onClick = { menuExpanded = false; onBranch() })
                    if (onAddToProject != null) DropdownMenuItem(text = { Text("Add to project sources") }, onClick = { menuExpanded = false; onAddToProject() })
                    if (onInvestigateWithAi != null) DropdownMenuItem(text = { Text("Remote Edit") }, onClick = { menuExpanded = false; onInvestigateWithAi() })
                    if (onReadAloud != null) DropdownMenuItem(text = { Text("Read aloud") }, onClick = { menuExpanded = false; onReadAloud() })
                    if (onDelete != null) DropdownMenuItem(text = { Text("Delete") }, onClick = { menuExpanded = false; onDelete() })
                    if (onDeleteAfter != null) DropdownMenuItem(text = { Text("Delete from here") }, onClick = { menuExpanded = false; onDeleteAfter() })
                }
                Row(modifier = Modifier.fillMaxWidth()) {
                    // left-border accent
                    Box(
                        modifier = Modifier
                            .width(2.dp)
                            .height(if (msg.text.isBlank()) 20.dp else 36.dp)
                            .background(
                                MaterialTheme.colorScheme.outlineVariant,
                                RoundedCornerShape(1.dp),
                            )
                            .padding(end = 12.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (msg.text.isNotBlank()) {
                            if (msg.isStreaming) {
                                // Plain text during streaming — avoids re-parsing markdown on every chunk
                                SelectionContainer {
                                    Text(
                                        text = msg.text,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = textColor,
                                    )
                                }
                            } else {
                                AndroidView(
                                    factory = { ctx ->
                                        TextView(ctx).also { tv ->
                                            tv.setTextColor(textColorArgb)
                                            tv.textSize = 14f
                                            tv.setTextIsSelectable(true)
                                            markwon.setMarkdown(tv, msg.text)
                                        }
                                    },
                                    update = { tv ->
                                        tv.setTextColor(textColorArgb)
                                        markwon.setMarkdown(tv, msg.text)
                                    },
                                )
                            }
                        }
                        if (!msg.isStreaming && (msg.inputTokens > 0 || msg.outputTokens > 0)) {
                            Text(
                                "${msg.inputTokens}↑ ${msg.outputTokens}↓",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
                            )
                        }
                    }
                }
            }
            if (!msg.isStreaming && msg.text.isNotBlank()) {
                Row(
                    modifier = Modifier.padding(start = 12.dp, top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onCopy, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.ContentCopy, contentDescription = "Copy message", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (onShare != null) {
                        IconButton(onClick = onShare, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Default.Share, contentDescription = "Share message", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (onReadAloud != null) {
                        IconButton(onClick = onReadAloud, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Default.RecordVoiceOver, contentDescription = "Read aloud", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Box {
                        IconButton(onClick = { overflowExpanded = true }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Default.MoreVert, contentDescription = "More message actions", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DropdownMenu(expanded = overflowExpanded, onDismissRequest = { overflowExpanded = false }) {
                            if (onRetry != null) DropdownMenuItem(text = { Text("Retry") }, onClick = { overflowExpanded = false; onRetry() })
                            if (onEditAssistant != null) DropdownMenuItem(text = { Text("Edit message") }, onClick = { overflowExpanded = false; onEditAssistant() })
                            if (onBranch != null) DropdownMenuItem(text = { Text("Branch in new chat") }, onClick = { overflowExpanded = false; onBranch() })
                            if (onAddToProject != null) DropdownMenuItem(text = { Text("Add to project sources") }, onClick = { overflowExpanded = false; onAddToProject() })
                            if (onInvestigateWithAi != null) DropdownMenuItem(text = { Text("Remote Edit") }, onClick = { overflowExpanded = false; onInvestigateWithAi() })
                            DropdownMenuItem(text = { Text("Delete") }, onClick = { overflowExpanded = false; onDelete?.invoke() }, enabled = onDelete != null)
                        }
                    }
                }
            }
            if (timeLabel != null && !msg.isStreaming) {
                Text(
                    timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 2.dp),
                )
            }
        }
    } else {
        // --- User: right-aligned pill bubble ---
        var menuExpanded by remember { mutableStateOf(false) }
        val bubbleColor = MaterialTheme.colorScheme.primary
        val textColor = MaterialTheme.colorScheme.onPrimary
        val bubbleShape = RoundedCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomStart = 16.dp, bottomEnd = 16.dp)
        val displayText = remember(msg.text) { stripInjectedContextBlocks(msg.text) }

        val highlightAlpha = remember { Animatable(0f) }
        LaunchedEffect(isHighlighted) {
            if (isHighlighted) {
                highlightAlpha.snapTo(0.35f)
                highlightAlpha.animateTo(0f, animationSpec = tween(durationMillis = 1400))
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
            horizontalAlignment = Alignment.End,
        ) {
            Box(modifier = Modifier.widthIn(max = 300.dp)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(bubbleColor, bubbleShape)
                    .combinedClickable(onClick = {}, onLongClick = { menuExpanded = true })
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(text = { Text("Copy") }, onClick = { menuExpanded = false; onCopy() })
                    if (onEdit != null) DropdownMenuItem(text = { Text("Edit") }, onClick = { menuExpanded = false; onEdit() })
                    if (onResend != null) DropdownMenuItem(text = { Text("Resend") }, onClick = { menuExpanded = false; onResend() })
                    if (onDelete != null) DropdownMenuItem(text = { Text("Delete") }, onClick = { menuExpanded = false; onDelete() })
                    if (onDeleteAfter != null) DropdownMenuItem(text = { Text("Delete from here") }, onClick = { menuExpanded = false; onDeleteAfter() })
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (displayText.isNotBlank()) {
                        Text(displayText, color = textColor, style = MaterialTheme.typography.bodyMedium)
                    }
                    if (msg.attachments.isNotEmpty()) {
                        val thumbs = msg.attachments.filter { it.type == "image" && it.thumbnailDataUrl != null }
                        if (thumbs.isNotEmpty()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 4.dp)) {
                                thumbs.forEach { att ->
                                    val bmp = remember(att.thumbnailDataUrl) { decodeDataUrl(att.thumbnailDataUrl!!) }
                                    if (bmp != null) {
                                        Image(
                                            bitmap = bmp.asImageBitmap(),
                                            contentDescription = att.name,
                                            contentScale = ContentScale.Crop,
                                            modifier = Modifier.height(96.dp).width(120.dp).clip(RoundedCornerShape(8.dp)),
                                        )
                                    }
                                }
                            }
                        }
                        msg.attachments.filter { it.type != "image" || it.thumbnailDataUrl == null }.forEach { att ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Icon(Icons.Default.Image, contentDescription = null, modifier = Modifier.size(12.dp), tint = textColor.copy(alpha = 0.7f))
                                Text(att.name, style = MaterialTheme.typography.labelSmall, color = textColor.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    if (msg.sendFailed) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(Icons.Default.Error, contentDescription = "Send failed", modifier = Modifier.size(12.dp), tint = MaterialTheme.colorScheme.error)
                            Text("Not delivered · tap Resend", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
            // Highlight flash overlay drawn on top of the bubble
            if (highlightAlpha.value > 0f) {
                Box(
                    modifier = Modifier
                        .matchParentSize()
                        .background(Color.White.copy(alpha = highlightAlpha.value), bubbleShape),
                )
            }
            } // wrapper Box
            if (timeLabel != null && !msg.isStreaming) {
                Text(
                    timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                )
            }
        }
    }
}

@Composable
fun ToolCallBubble(msg: ChatMessage, inProgress: Boolean = false) {
    val isTeamActivity = msg.serverName == "Team activity"
    // Completed team activity bubbles start expanded so content is visible without interaction.
    val hasDetails = !msg.toolArgs.isNullOrBlank() || !msg.toolResult.isNullOrBlank()
    var expanded by remember { mutableStateOf(isTeamActivity && !inProgress && hasDetails) }
    var userCollapsed by remember { mutableStateOf(false) }
    val preview = when {
        inProgress -> "Running…"
        msg.toolResult?.isNotBlank() == true -> msg.toolResult.replace(Regex("\\s+"), " ").trim()
        msg.toolSuccess -> "Completed"
        else -> "Failed"
    }

    // Track hasDetails without restarting the collapse timer when result arrives (M4).
    val hasDetailsRef = remember { mutableStateOf(hasDetails) }
    hasDetailsRef.value = hasDetails

    // Expand when in-progress and details arrive; only depends on inProgress (M4).
    // Team activity bubbles never auto-collapse — they hold orchestration context the user needs.
    LaunchedEffect(inProgress) {
        if (inProgress) {
            if (hasDetailsRef.value && !userCollapsed) expanded = true
        } else if (!isTeamActivity && expanded && !userCollapsed) {
            delay(2000)
            expanded = false
            userCollapsed = false
        }
    }

    // Expand when details first arrive mid-progress (hasDetails flips true while inProgress).
    LaunchedEffect(hasDetails) {
        if (inProgress && hasDetails && !userCollapsed) expanded = true
    }

    // Re-expand when content updates arrive while in-progress (prevents collapse between steps).
    LaunchedEffect(msg.toolResult, msg.toolArgs) {
        if (inProgress && hasDetailsRef.value && !userCollapsed) expanded = true
    }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = hasDetails) {
                    val next = !expanded
                    expanded = next
                    if (!next && inProgress) userCollapsed = true
                    if (next) userCollapsed = false
                }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Crossfade(targetState = inProgress, label = "tool-status-icon") { running ->
                if (running) {
                    Icon(
                        Icons.Default.Psychology,
                        contentDescription = "Tool running",
                        modifier = Modifier.size(15.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Icon(
                        if (msg.toolSuccess) Icons.Default.CheckCircle else Icons.Default.Error,
                        contentDescription = if (msg.toolSuccess) "Tool succeeded" else "Tool failed",
                        modifier = Modifier.size(15.dp),
                        tint = if (msg.toolSuccess) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    )
                }
            }
            Text(
                msg.toolName ?: "Tool call",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (!msg.serverName.isNullOrBlank()) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Text(
                        msg.serverName,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Text(
                preview,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (hasDetails) {
                Icon(
                    if (expanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = if (expanded) "Collapse tool details" else "Expand tool details",
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut(),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (!msg.toolArgs.isNullOrBlank()) {
                    ToolDetailSection(label = "Arguments", value = msg.toolArgs)
                }
                if (!msg.toolResult.isNullOrBlank()) {
                    ToolDetailSection(label = "Result", value = msg.toolResult)
                }
            }
        }
    }
}

private fun relativeTime(timestampMs: Long): String? {
    if (timestampMs <= 0L) return null
    val diff = System.currentTimeMillis() - timestampMs
    return when {
        diff < 60_000L -> "just now"
        diff < 3_600_000L -> "${diff / 60_000L} min ago"
        diff < 86_400_000L -> "${diff / 3_600_000L} hr ago"
        else -> "${diff / 86_400_000L} days ago"
    }
}

@Composable
fun ToolDetailSection(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        Surface(
            shape = RoundedCornerShape(6.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                value,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(8.dp),
            )
        }
    }
}
