package io.nexy.android.ui.chat

import android.widget.TextView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
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
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Article
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Difference
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.OpenInFull
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
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
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.foundation.BorderStroke
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.theme.Blue100
import io.nexy.android.ui.theme.Blue400
import io.nexy.android.ui.theme.Blue500
import io.nexy.android.ui.theme.Blue900
import io.nexy.android.ui.theme.Gray100
import io.nexy.android.ui.theme.Gray400
import io.nexy.android.ui.theme.Gray500
import io.nexy.android.ui.theme.Gray900
import io.nexy.android.ui.theme.Green500
import io.nexy.android.ui.theme.Indigo50
import io.nexy.android.ui.theme.Indigo200
import io.nexy.android.ui.theme.Indigo400
import io.nexy.android.ui.theme.Indigo500
import io.nexy.android.ui.theme.Indigo900
import io.nexy.android.ui.theme.Indigo950
import io.nexy.android.ui.theme.LocalNexyColors
import io.nexy.android.ui.theme.Purple50
import io.nexy.android.ui.theme.Purple200
import io.nexy.android.ui.theme.Purple400
import io.nexy.android.ui.theme.Purple500
import io.nexy.android.ui.theme.Purple700
import io.nexy.android.ui.theme.Purple900
import io.nexy.android.ui.theme.Purple950
import io.nexy.android.ui.theme.Red500
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

/**
 * The ephemeral "awaiting response" indicator, shown before any text/reasoning has streamed in
 * for a turn. Mirrors desktop's `live-activity` render item (ChatMessages.tsx:636-661) exactly:
 * icon+label row, then a bouncing-dots row *below* it — not the raw backend activity label text
 * (e.g. a CLI-specific "Started Codex turn." string), and not purple — this is a distinct visual
 * state from the (purple) reasoning-content bubbles below, gated on `activity.state`, not on
 * whatever raw text the backend happened to send.
 */
@Composable
fun ThinkingBubble(activity: ChatTurnActivity, generationStartedAt: Long? = null) {
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
    val isTool = activity.state == "tool"
    val isDark = LocalNexyColors.current.isDark
    val blue = if (isDark) Blue400 else Blue500
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val dotColor = if (isDark) Gray500 else Gray400

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (isTool) {
                val pulseTransition = rememberInfiniteTransition(label = "tool-icon-pulse")
                val pulseAlpha by pulseTransition.animateFloat(
                    initialValue = 1f,
                    targetValue = 0.5f,
                    animationSpec = infiniteRepeatable(tween(1000), repeatMode = RepeatMode.Reverse),
                    label = "tool-icon-pulse-alpha",
                )
                Icon(
                    Icons.Default.Build,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp).alpha(pulseAlpha),
                    tint = blue,
                )
            } else {
                androidx.compose.material3.CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = textColor,
                )
            }
            if (isTool) {
                val toolLabel = activity.toolName ?: activity.label
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Using ", style = MaterialTheme.typography.bodyMedium, color = textColor)
                    Text(toolLabel, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, color = blue)
                    if (!activity.serverName.isNullOrBlank()) {
                        Text(" · ${activity.serverName}", style = MaterialTheme.typography.bodyMedium, color = dotColor)
                    }
                }
            } else {
                Text(
                    if (elapsedSec > 0) "Thinking · ${elapsedSec}s" else "Thinking...",
                    style = MaterialTheme.typography.bodyMedium,
                    color = textColor,
                )
            }
        }
        TypingDots(dotColor)
    }
}

@Composable
fun TypingDots(dotColor: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
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
                        dotColor,
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size((8 * scale).dp)
                        .background(dotColor, CircleShape),
                )
            }
        }
    }
}

// Cap on the reasoning viewport — roughly six lines. Short content sizes to itself;
// once content exceeds this height it scrolls within the window instead of the bubble
// growing further, so the surrounding layout never shifts unboundedly while reasoning
// streams in, and stays exactly the same size once done — no auto-collapse, so there's
// no jarring shrink right as the answer arrives.
private val THINKING_VIEWPORT_MAX_HEIGHT = 120.dp

// Generous upper bound on how much of a settled block's text the inline card actually lays
// out — see the comment at inlineDisplayContent below for why this exists at all.
private const val THINKING_INLINE_PREVIEW_CHARS = 1200

@Composable
fun ThinkingHistoryBubble(
    blocks: List<ThinkingBlock>,
    isLive: Boolean = false,
) {
    if (blocks.isEmpty()) return
    var collapsed by remember { mutableStateOf(false) }
    var showFullscreen by remember { mutableStateOf(false) }
    val totalChars = blocks.sumOf { it.content.length }
    val combinedContent = remember(blocks) { blocks.joinToString("\n\n") { it.content } }
    // The inline card's viewport is capped at THINKING_VIEWPORT_MAX_HEIGHT (~6 lines) and, for
    // a settled block, never scrolls past its initial position 0 (touch-scroll is disabled
    // below; live blocks alone auto-scroll to their tail via the LaunchedEffect that follows).
    // So only the first ~120dp of text is ever visible in the card regardless of how long the
    // full block is — laying out the entire string anyway wastes text-measurement work that
    // scales with content length, which is exactly what makes scrolling past large reasoning
    // blocks (often legacy ones from before a turn's reasoning was split into several smaller
    // phase blocks) visibly janky. The full, untruncated text is still one tap away via the
    // fullscreen view. Live blocks are excluded: truncating to the first N characters there
    // would defeat the tail-following auto-scroll below, and a still-streaming block isn't
    // what's implicated in this jitter anyway.
    val inlineDisplayContent = if (!isLive && combinedContent.length > THINKING_INLINE_PREVIEW_CHARS) {
        combinedContent.take(THINKING_INLINE_PREVIEW_CHARS) + "…"
    } else {
        combinedContent
    }
    val scrollState = rememberScrollState()

    // Keep the viewport scrolled to the latest reasoning text as it streams in.
    LaunchedEffect(combinedContent, isLive, collapsed) {
        if (isLive && !collapsed) scrollState.scrollTo(scrollState.maxValue)
    }

    // Fade in on first appearance — this bubble is often nested inline inside an
    // AssistantMessage item rather than its own lazy item, so it doesn't get the
    // LazyColumn's animateItem() fade; animate it directly instead. Gated to isLive only:
    // this composable's `remember` state lives inside the parent AssistantMessage item's
    // composition, not its own lazy item, so scrolling a tall message (many reasoning
    // blocks) off-screen and back disposes and recomposes it from scratch — alpha would
    // reset to 0 and this LaunchedEffect would refire, replaying the fade every time a
    // historical block scrolls back into view. That's the "jitter" scrolling past a long
    // reasoning-heavy turn. Only a genuinely new live/streaming block should fade in.
    val alpha = remember { Animatable(if (isLive) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (isLive) alpha.animateTo(1f, animationSpec = tween(280, easing = FastOutSlowInEasing))
    }

    val isDark = LocalNexyColors.current.isDark
    val textColor = if (isDark) Purple400 else Purple700
    val iconColor = if (isDark) Purple400 else Purple500
    val contentTextColor = if (isDark) Color(0xFFE9D5FF) else Purple900

    ChatTimelineEntry(beadColor = thinkingBeadColor(streaming = isLive), pulse = isLive) {
        Column(modifier = Modifier.fillMaxWidth().alpha(alpha.value)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { collapsed = !collapsed }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Default.Psychology,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = iconColor,
                )
                Text(
                    if (isLive) "Reasoning…" else "Reasoning · ${if (totalChars > 2000) ">${totalChars / 1000}k" else "~${maxOf(100, totalChars / 100 * 100)}"} chars",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = textColor,
                    modifier = Modifier.weight(1f),
                )
                if (!collapsed && totalChars > 0) {
                    IconButton(onClick = { showFullscreen = true }, modifier = Modifier.size(24.dp)) {
                        Icon(
                            Icons.Default.OpenInFull,
                            contentDescription = "View full reasoning text",
                            modifier = Modifier.size(13.dp),
                            tint = iconColor,
                        )
                    }
                }
                Icon(
                    if (collapsed) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Default.KeyboardArrowDown,
                    contentDescription = if (collapsed) "Expand thinking" else "Collapse thinking",
                    modifier = Modifier.size(16.dp),
                    tint = iconColor,
                )
            }
            AnimatedVisibility(
                visible = !collapsed,
                enter = expandVertically(animationSpec = tween(200, easing = LinearOutSlowInEasing)),
                exit = shrinkVertically(animationSpec = tween(200, easing = LinearOutSlowInEasing)),
            ) {
                SelectionContainer(
                    modifier = Modifier
                        .padding(vertical = 4.dp)
                        .heightIn(max = THINKING_VIEWPORT_MAX_HEIGHT)
                        // Touch-driven scroll disabled: this viewport is nested inside the
                        // outer LazyColumn, and Compose gives a nested scrollable first claim
                        // on drag gestures — a finger's drag path crossing this box mid-scroll
                        // would partially intercept the gesture before handing the remainder
                        // back to the list, producing a stutter every time you scroll past a
                        // reasoning block. `enabled = false` only blocks touch input; the
                        // auto-scroll-to-latest-text LaunchedEffect above still drives
                        // scrollState programmatically while live. Reading a long completed
                        // block past the 120dp cap now goes through the fullscreen view instead.
                        .verticalScroll(scrollState, enabled = false)
                        .fillMaxWidth(),
                ) {
                    Text(
                        inlineDisplayContent,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                        color = contentTextColor,
                    )
                }
            }
        }
    }

    if (showFullscreen) {
        ThinkingFullscreenDialog(
            content = combinedContent,
            contentTextColor = contentTextColor,
            onDismiss = { showFullscreen = false },
        )
    }
}

/**
 * Full-screen reader for a reasoning block's complete text. The inline viewport caps at
 * [THINKING_VIEWPORT_MAX_HEIGHT] and no longer accepts touch-scroll (see the comment at its
 * `verticalScroll` call site), so this is the only way to read a long completed block past
 * that cap — mirrors CodeBlockWebView's fullscreen dialog for the same reason and UX.
 */
@Composable
private fun ThinkingFullscreenDialog(
    content: String,
    contentTextColor: Color,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            SelectionContainer(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) {
                Text(
                    content,
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                    color = contentTextColor,
                )
            }
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "Close fullscreen reasoning view",
                    tint = MaterialTheme.colorScheme.onBackground,
                )
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
    onSaveAsArtifact: (() -> Unit)? = null,
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
                    if (onAddToProject != null) DropdownMenuItem(text = { Text("Save to wiki") }, onClick = { menuExpanded = false; onAddToProject() })
                    if (onSaveAsArtifact != null) DropdownMenuItem(text = { Text("Save as artifact") }, onClick = { menuExpanded = false; onSaveAsArtifact() })
                    if (onInvestigateWithAi != null) DropdownMenuItem(text = { Text("Create code change") }, onClick = { menuExpanded = false; onInvestigateWithAi() })
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
                            // Fenced code blocks are pulled out of the markdown before Markwon
                            // ever sees it and rendered by a dedicated composable (plain text
                            // while streaming, a syntax-highlighted WebView island once
                            // settled) — everything else still goes through Markwon/TextView.
                            val segments = remember(msg.text) { splitCodeBlocks(msg.text) }
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                segments.forEachIndexed { index, segment ->
                                    key(index) {
                                        when (segment) {
                                            is MessageSegment.Text -> {
                                                if (segment.markdown.isNotBlank()) {
                                                    // Always the same TextView instance — switching between a
                                                    // Compose Text and this AndroidView based on isStreaming
                                                    // caused a hard view-type swap (a visible pop) the instant
                                                    // streaming ended. Plain text is set directly while
                                                    // streaming to avoid re-parsing markdown on every chunk;
                                                    // Markwon only parses once the message settles.
                                                    AndroidView(
                                                        modifier = Modifier.fillMaxWidth(),
                                                        factory = { ctx ->
                                                            TextView(ctx).also { tv ->
                                                                tv.setTextColor(textColorArgb)
                                                                tv.textSize = 14f
                                                                tv.setTextIsSelectable(true)
                                                            }
                                                        },
                                                        update = { tv ->
                                                            tv.setTextColor(textColorArgb)
                                                            if (msg.isStreaming) {
                                                                tv.text = segment.markdown
                                                            } else {
                                                                markwon.setMarkdown(tv, segment.markdown)
                                                            }
                                                        },
                                                    )
                                                }
                                            }
                                            is MessageSegment.Code -> {
                                                if (msg.isStreaming) {
                                                    // No WebView while streaming — creating/tearing one
                                                    // down on every streamed chunk would be expensive and
                                                    // jank-prone. Real syntax highlighting kicks in once
                                                    // the message settles, matching the Markwon text swap.
                                                    Surface(
                                                        modifier = Modifier.fillMaxWidth(),
                                                        color = Color(0xFF1E1E2E),
                                                        shape = RoundedCornerShape(8.dp),
                                                    ) {
                                                        Text(
                                                            segment.code,
                                                            modifier = Modifier.padding(12.dp),
                                                            color = Color(0xFFCDD6F4),
                                                            fontFamily = FontFamily.Monospace,
                                                            style = MaterialTheme.typography.bodySmall,
                                                        )
                                                    }
                                                } else {
                                                    CodeBlockWebView(
                                                        language = segment.language,
                                                        code = segment.code,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (!msg.isStreaming && (!msg.model.isNullOrBlank() || msg.inputTokens > 0 || msg.outputTokens > 0)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!msg.model.isNullOrBlank()) {
                                    Text(
                                        "Model: ${msg.model}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
                                    )
                                }
                                if (msg.inputTokens > 0 || msg.outputTokens > 0) {
                                    Text(
                                        "${msg.inputTokens}↑ ${msg.outputTokens}↓",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
                                    )
                                }
                            }
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
                            if (onAddToProject != null) DropdownMenuItem(text = { Text("Save to wiki") }, onClick = { overflowExpanded = false; onAddToProject() })
                            if (onSaveAsArtifact != null) DropdownMenuItem(text = { Text("Save as artifact") }, onClick = { overflowExpanded = false; onSaveAsArtifact() })
                            if (onInvestigateWithAi != null) DropdownMenuItem(text = { Text("Create code change") }, onClick = { overflowExpanded = false; onInvestigateWithAi() })
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
        val isDark = LocalNexyColors.current.isDark
        val bubbleColor = if (isDark) Blue900.copy(alpha = 0.6f) else Blue100
        val textColor = if (isDark) Gray100 else Gray900
        val bubbleShape = RoundedCornerShape(8.dp)
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
            Box(modifier = Modifier.fillMaxWidth(0.8f)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(bubbleColor, bubbleShape)
                    .combinedClickable(onClick = {}, onLongClick = { menuExpanded = true })
                    .padding(horizontal = 16.dp, vertical = 12.dp),
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

// Exact truncation thresholds mirrored from desktop's ToolCallBlock.tsx:20-22, so the
// "+N more lines" breakpoint feels identical between platforms.
internal const val RESULT_PREVIEW_LINES = 3
internal const val RESULT_PREVIEW_CHARS = 240
internal const val RESULT_MAX_CHARS = 2000

internal data class ResultPreview(val text: String, val hiddenLineCount: Int, val truncated: Boolean)

internal fun buildResultPreview(result: String, lineCap: Int = RESULT_PREVIEW_LINES): ResultPreview {
    val lines = result.split("\n")
    val previewLines = lines.take(lineCap)
    var preview = previewLines.joinToString("\n")
    var hiddenLineCount = (lines.size - lineCap).coerceAtLeast(0)
    val charTruncated = preview.length > RESULT_PREVIEW_CHARS
    if (charTruncated) preview = preview.take(RESULT_PREVIEW_CHARS)
    return ResultPreview(preview, hiddenLineCount, truncated = hiddenLineCount > 0 || charTruncated)
}

internal fun buildExpandedResult(result: String): String =
    if (result.length > RESULT_MAX_CHARS) result.take(RESULT_MAX_CHARS) + "\n…(truncated)" else result

@Composable
fun ToolCallBubble(msg: ChatMessage, inProgress: Boolean = false) {
    val hasDetails = !msg.toolArgs.isNullOrBlank() || !msg.toolResult.isNullOrBlank()
    // Pure user-toggle expand/collapse — desktop removed the timed auto-collapse entirely
    // (ToolCallBlock.tsx no longer has one), so Android must not reintroduce it either.
    var expanded by remember { mutableStateOf(inProgress && hasDetails) }
    LaunchedEffect(inProgress, hasDetails) {
        if (inProgress && hasDetails) expanded = true
    }
    val preview = when {
        inProgress -> "Running…"
        msg.toolResult?.isNotBlank() == true -> cleanToolResultPreview(msg.toolResult)
        msg.toolSuccess -> "Completed"
        else -> "Failed"
    }

    ChatTimelineEntry(beadColor = toolCallBeadColor(inProgress, msg.toolSuccess), pulse = inProgress) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = hasDetails) { expanded = !expanded }
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Crossfade(targetState = inProgress, label = "tool-status-icon") { running ->
                    if (running) {
                        Icon(
                            Icons.Default.Psychology,
                            contentDescription = "Tool running",
                            modifier = Modifier.size(14.dp),
                            tint = Blue500,
                        )
                    } else {
                        Icon(
                            if (msg.toolSuccess) Icons.Default.CheckCircle else Icons.Default.Error,
                            contentDescription = if (msg.toolSuccess) "Tool succeeded" else "Tool failed",
                            modifier = Modifier.size(14.dp),
                            tint = if (msg.toolSuccess) Green500 else Red500,
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
                        shape = RoundedCornerShape(4.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Text(
                            msg.serverName,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 0.dp),
                        )
                    }
                }
                Text(
                    preview,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (hasDetails) {
                    Icon(
                        if (expanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = if (expanded) "Collapse tool details" else "Expand tool details",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(animationSpec = tween(200, easing = LinearOutSlowInEasing)),
                exit = shrinkVertically(animationSpec = tween(200, easing = LinearOutSlowInEasing)),
            ) {
                Column(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (!msg.toolArgs.isNullOrBlank()) {
                        ToolDetailSection(label = "Arguments", value = msg.toolArgs)
                    }
                    if (!msg.toolResult.isNullOrBlank()) {
                        ToolResultPreviewSection(result = msg.toolResult, isError = !msg.toolSuccess)
                    }
                }
            }
        }
    }
}

@Composable
private fun ToolResultPreviewSection(result: String, isError: Boolean) {
    var expanded by remember { mutableStateOf(false) }
    val cleaned = remember(result) { stripAnsiEscapes(result) }
    val lineCap = if (isError) RESULT_PREVIEW_LINES + 1 else RESULT_PREVIEW_LINES
    val preview = remember(cleaned, lineCap) { buildResultPreview(cleaned, lineCap) }
    val textColor = if (isError) Red500 else MaterialTheme.colorScheme.onSurfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            "RESULT",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        SelectionContainer {
            Text(
                if (expanded) buildExpandedResult(cleaned) else preview.text,
                fontSize = 11.sp,
                lineHeight = 17.sp,
                fontFamily = FontFamily.Monospace,
                color = textColor,
            )
        }
        if (preview.truncated) {
            Text(
                if (expanded) "Show less" else if (preview.hiddenLineCount > 0) "+${preview.hiddenLineCount} more line(s)" else "Show more",
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier.clickable { expanded = !expanded },
            )
        }
    }
}

// Strips ANSI/VT100 escape sequences (SGR color codes, cursor movement, etc.) that raw CLI
// subprocess output — e.g. Codex's own PowerShell "Run Command" tool results — can embed
// directly in the string. Left unstripped these render as either invisible control-byte tofu
// boxes or, once unescapeJsonString correctly decodes \uXXXX escapes, literal "ESC[31;1m"-style
// noise, neither of which is meaningful in a chat bubble with no terminal to interpret them.
private val ANSI_ESCAPE_RE = Regex("\u001B\\[[0-9;]*[a-zA-Z]")

internal fun stripAnsiEscapes(text: String): String = text.replace(ANSI_ESCAPE_RE, "")

internal fun cleanToolResultPreview(result: String): String {
    val trimmed = stripAnsiEscapes(result.trim())
    // If it looks like JSON, extract a meaningful summary rather than raw structure
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        // Try to find a "content", "text", "message", or "result" string field
        val summaryField = listOf("content", "text", "message", "result", "output", "error")
        for (field in summaryField) {
            val pattern = """"$field"\s*:\s*"((?:\\.|[^"\\]){1,120})"""".toRegex()
            val match = pattern.find(trimmed)
            if (match != null) {
                val v = unescapeJsonString(match.groupValues[1]).trim()
                if (v.isNotBlank()) return stripAnsiEscapes(v).replace(Regex("\\s+"), " ")
            }
        }
        // Fall back to a compact single-line version of the JSON
        return trimmed.replace(Regex("\\s+"), " ").take(100)
    }
    return trimmed.replace(Regex("\\s+"), " ").take(100)
}

internal fun parseJsonKeyValuePairs(json: String): List<Pair<String, String>>? {
    val trimmed = json.trim()
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null
    val result = mutableListOf<Pair<String, String>>()
    // Match top-level string and primitive values only (skip nested objects/arrays)
    val stringVal = """"(\w+)"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
    val primitiveVal = """"(\w+)"\s*:\s*(-?\d+\.?\d*|true|false|null)""".toRegex()
    val allMatches = (stringVal.findAll(trimmed) + primitiveVal.findAll(trimmed))
        .sortedBy { it.range.first }
    for (m in allMatches) {
        val key = m.groupValues[1]
        val value = stripAnsiEscapes(unescapeJsonString(m.groupValues[2])).trim()
        if (value.isNotBlank()) result.add(key to value.take(120))
    }
    return if (result.isEmpty()) null else result
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
    // Inline mono key: value lines, no card chrome — mirrors ToolCallBlock.tsx:113-118
    // rather than desktop's older raw-JSON dump in a bordered box.
    val pairs = remember(value) { parseJsonKeyValuePairs(value) }
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        if (pairs != null) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                pairs.forEach { (k, v) ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "$k:",
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
                        )
                        Text(
                            v,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        } else {
            Text(
                value,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Inline chat card for a `__artifact-ref:` sentinel message — the Android counterpart of
 * desktop's ArtifactCard.tsx/DebriefArtifactCard.tsx/QuizArtifactCard.tsx. Bordered/tinted card
 * matching desktop's color language (indigo for debrief/quiz, purple for generic artifacts) with
 * a kind badge and the artifact's real title once fetched. Still deep-links into the existing
 * Debrief/Quiz/Artifacts screens for full detail rather than rendering the content inline.
 */
@Composable
fun ArtifactRefBubble(
    ref: ArtifactRef,
    onOpenDebrief: () -> Unit,
    onOpenQuiz: () -> Unit,
    onOpenArtifact: () -> Unit,
) {
    var fetchedTitle by remember(ref.artifactId) { mutableStateOf<String?>(null) }
    // The __artifact-ref: chat message caches a `kind` snapshot at the time it was written,
    // which can end up stale or missing (e.g. an older ref updated by
    // pinLatestPendingArtifactRefMessage without re-deriving kind) even though the artifacts
    // table row itself has the correct kind — that mismatch is exactly what caused a real
    // quiz card to show the generic "Artifact" label/color and route to the artifact detail
    // page instead of the quiz screen on tap. The fetched artifact detail is authoritative;
    // prefer it over the message-embedded kind once it arrives, same as fetchedTitle already
    // overrides any placeholder title.
    var fetchedKind by remember(ref.artifactId) { mutableStateOf<String?>(null) }
    val effectiveKind = fetchedKind ?: ref.kind

    LaunchedEffect(ref.artifactId, ref.pending) {
        if (!ref.pending && ref.artifactId.isNotBlank()) WsRepository.getArtifact(ref.artifactId)
    }
    LaunchedEffect(ref.artifactId) {
        WsRepository.events.collect { event ->
            if (event is WsEvent.ArtifactDetail && event.artifact?.id == ref.artifactId) {
                fetchedTitle = event.artifact.title
                fetchedKind = event.artifact.kind
            }
        }
    }

    val kindLabel = when (effectiveKind) {
        "debrief" -> "Debrief"
        "quiz" -> "Quiz"
        else -> "Artifact"
    }
    val fallbackTitle = when {
        ref.pending && effectiveKind == "debrief" -> "Generating debrief…"
        ref.pending && effectiveKind == "quiz" -> "Generating quiz…"
        ref.pending -> "Generating…"
        effectiveKind == "debrief" -> "Open debrief"
        effectiveKind == "quiz" -> "Start quiz"
        else -> "View artifact"
    }
    val icon = when (effectiveKind) {
        "debrief" -> Icons.AutoMirrored.Filled.MenuBook
        "quiz" -> Icons.Default.Psychology
        else -> Icons.AutoMirrored.Filled.Article
    }
    val isIndigo = effectiveKind == "debrief" || effectiveKind == "quiz"

    val isDark = LocalNexyColors.current.isDark
    val bubbleColor = when {
        isIndigo && isDark -> Indigo950.copy(alpha = 0.3f)
        isIndigo -> Indigo50
        isDark -> Purple950.copy(alpha = 0.3f)
        else -> Purple50
    }
    val borderColor = when {
        isIndigo && isDark -> Indigo900.copy(alpha = 0.6f)
        isIndigo -> Indigo200
        isDark -> Purple900.copy(alpha = 0.6f)
        else -> Purple200
    }
    val accentColor = when {
        isIndigo && isDark -> Indigo400
        isIndigo -> Indigo500
        isDark -> Purple400
        else -> Purple500
    }
    val titleColor = when {
        isIndigo && isDark -> Indigo400
        isIndigo -> Indigo900
        isDark -> Purple400
        else -> Purple700
    }

    Surface(
        // Dispatch on effectiveKind (fetched artifact detail), not the possibly-stale
        // ref.kind embedded in the chat message — this is the actual fix for tapping a quiz
        // card and landing on the generic artifact detail page instead of the quiz screen.
        onClick = {
            when (effectiveKind) {
                "debrief" -> onOpenDebrief()
                "quiz" -> onOpenQuiz()
                else -> onOpenArtifact()
            }
        },
        enabled = !ref.pending,
        shape = RoundedCornerShape(10.dp),
        color = bubbleColor,
        border = BorderStroke(1.dp, borderColor),
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = accentColor)
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    kindLabel,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = accentColor,
                )
                Text(
                    fetchedTitle ?: fallbackTitle,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                    color = titleColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (ref.pending) {
                androidx.compose.material3.CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = accentColor,
                )
            } else {
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = accentColor,
                )
            }
        }
    }
}

