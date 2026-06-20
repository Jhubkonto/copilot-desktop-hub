package io.nexy.android.ui.chat

import android.widget.TextView
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import io.nexy.android.data.model.ThinkingBlock
import io.noties.markwon.Markwon

@Composable
fun ThinkingBubble(label: String) {
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
                Text(
                    label,
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
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        repeat(3) { index ->
            val alpha by transition.animateFloat(
                initialValue = 0.35f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = keyframes {
                        durationMillis = 900
                        0.35f at 0
                        1f at 250
                        0.35f at 500
                    },
                    repeatMode = RepeatMode.Restart,
                    initialStartOffset = StartOffset(index * 150),
                ),
                label = "typing-dot-$index",
            )
            Box(
                modifier = Modifier
                    .size(5.dp)
                    .alpha(alpha)
                    .background(MaterialTheme.colorScheme.onSurfaceVariant, CircleShape),
            )
        }
    }
}

@Composable
fun ThinkingHistoryBubble(blocks: List<ThinkingBlock>) {
    if (blocks.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val totalChars = blocks.sumOf { it.content.length }
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.Start,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 320.dp),
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
        ) {
            Column(
                modifier = Modifier
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
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
                        "Thought for ${if (totalChars > 2000) ">2k" else "~${totalChars / 100 * 100}"} chars",
                        style = MaterialTheme.typography.labelSmall,
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
                if (expanded) {
                    blocks.forEach { block ->
                        if (block.content.isNotBlank()) {
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = MaterialTheme.colorScheme.surface,
                            ) {
                                Text(
                                    block.content,
                                    style = MaterialTheme.typography.labelSmall,
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
}

@Composable
fun MessageBubble(
    msg: ChatMessage,
    onCopy: () -> Unit,
    onEdit: (() -> Unit)?,
    onResend: (() -> Unit)?,
    onDelete: (() -> Unit)? = null,
    onDeleteAfter: (() -> Unit)? = null,
) {
    val isUser = msg.isUser
    var menuExpanded by remember { mutableStateOf(false) }
    val bubbleColor = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val textColor = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    val textColorArgb = textColor.toArgb()

    val bubbleShape = if (isUser)
        RoundedCornerShape(topStart = 16.dp, topEnd = 4.dp, bottomStart = 16.dp, bottomEnd = 16.dp)
    else
        RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 16.dp)

    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .background(bubbleColor, bubbleShape)
                .combinedClickable(
                    onClick = {},
                    onLongClick = { menuExpanded = true },
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                DropdownMenuItem(
                    text = { Text("Copy") },
                    onClick = { menuExpanded = false; onCopy() },
                )
                if (onEdit != null) {
                    DropdownMenuItem(
                        text = { Text("Edit") },
                        onClick = { menuExpanded = false; onEdit() },
                    )
                }
                if (onResend != null) {
                    DropdownMenuItem(
                        text = { Text("Resend") },
                        onClick = { menuExpanded = false; onResend() },
                    )
                }
                if (onDelete != null) {
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        onClick = { menuExpanded = false; onDelete() },
                    )
                }
                if (onDeleteAfter != null) {
                    DropdownMenuItem(
                        text = { Text("Delete from here") },
                        onClick = { menuExpanded = false; onDeleteAfter() },
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (msg.text.isNotBlank()) {
                    if (isUser) {
                        Text(msg.text, color = textColor, style = MaterialTheme.typography.bodyMedium)
                    } else {
                        AndroidView(
                            factory = { ctx ->
                                TextView(ctx).also { tv ->
                                    tv.setTextColor(textColorArgb)
                                    tv.textSize = 14f
                                    Markwon.create(ctx).setMarkdown(tv, msg.text)
                                }
                            },
                            update = { tv ->
                                tv.setTextColor(textColorArgb)
                                Markwon.create(tv.context).setMarkdown(tv, msg.text)
                            },
                        )
                    }
                }
                if (msg.attachments.isNotEmpty()) {
                    val thumbs = msg.attachments.filter { it.type == "image" && it.thumbnailDataUrl != null }
                    if (thumbs.isNotEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(bottom = 4.dp),
                        ) {
                            thumbs.forEach { att ->
                                val bmp = remember(att.thumbnailDataUrl) { decodeDataUrl(att.thumbnailDataUrl!!) }
                                if (bmp != null) {
                                    Image(
                                        bitmap = bmp.asImageBitmap(),
                                        contentDescription = att.name,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .height(96.dp)
                                            .width(120.dp)
                                            .clip(RoundedCornerShape(8.dp)),
                                    )
                                }
                            }
                        }
                    }
                    msg.attachments.filter { it.type != "image" || it.thumbnailDataUrl == null }.forEach { att ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(
                                Icons.Default.Image,
                                contentDescription = null,
                                modifier = Modifier.size(12.dp),
                                tint = textColor.copy(alpha = 0.7f),
                            )
                            Text(
                                att.name,
                                style = MaterialTheme.typography.labelSmall,
                                color = textColor.copy(alpha = 0.7f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                if (msg.sendFailed && isUser) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = "Send failed",
                            modifier = Modifier.size(12.dp),
                            tint = MaterialTheme.colorScheme.error,
                        )
                        Text(
                            "Not delivered · tap Resend",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
                if (!isUser && !msg.isStreaming && (msg.inputTokens > 0 || msg.outputTokens > 0)) {
                    Text(
                        "${msg.inputTokens}↑ ${msg.outputTokens}↓",
                        style = MaterialTheme.typography.labelSmall,
                        color = textColor.copy(alpha = 0.45f),
                    )
                }
            }
        }
    }
}

@Composable
fun ToolCallBubble(msg: ChatMessage) {
    var expanded by remember { mutableStateOf(false) }
    val hasDetails = !msg.toolArgs.isNullOrBlank() || !msg.toolResult.isNullOrBlank()
    val preview = when {
        msg.toolResult?.isNotBlank() == true -> msg.toolResult.replace(Regex("\\s+"), " ").trim()
        msg.toolSuccess -> "Completed"
        else -> "Failed"
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.Start,
    ) {
        Surface(
            modifier = Modifier.widthIn(max = 320.dp),
            shape = RoundedCornerShape(10.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.72f),
            tonalElevation = 1.dp,
        ) {
            Column(
                modifier = Modifier
                    .clickable(enabled = hasDetails) { expanded = !expanded }
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        if (msg.toolSuccess) Icons.Default.CheckCircle else Icons.Default.Error,
                        contentDescription = null,
                        modifier = Modifier.size(15.dp),
                        tint = if (msg.toolSuccess) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    )
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
                            color = MaterialTheme.colorScheme.surface,
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
                    if (hasDetails) {
                        Icon(
                            if (expanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = if (expanded) "Collapse tool details" else "Expand tool details",
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    preview,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = if (expanded) 3 else 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (expanded) {
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
                maxLines = 10,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
