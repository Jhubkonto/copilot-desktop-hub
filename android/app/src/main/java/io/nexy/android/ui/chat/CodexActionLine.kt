package io.nexy.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material3.Text
import io.nexy.android.data.model.ThinkingBlock
import io.nexy.android.ui.theme.Gray400
import io.nexy.android.ui.theme.Gray500
import io.nexy.android.ui.theme.Gray600
import io.nexy.android.ui.theme.LocalNexyColors
import io.nexy.android.ui.theme.Red400
import io.nexy.android.ui.theme.Red600

// Result text is capped by *rendered* lines (Compose maxLines, wrapping-aware), not logical
// "\n"-delimited lines — a single long unwrapped line (e.g. one PowerShell error line) used to
// sail past a naive line-count cap since it counted as "one line" even after wrapping to 6+ rows
// on a phone-width screen. Long-press always copies the full, untruncated (but ANSI-cleaned)
// result to the clipboard regardless of what's visible, since maxLines-clipped Compose text
// doesn't lay out (and so can't be selected/copied) anything past the visible rows.
private const val RESULT_VISIBLE_LINES = 4

// A "codex-cli" serverName / "codex-reasoning-summary" blockId prefix are the same detection
// convention the desktop client uses (CodexActionLine.tsx) — the backend payload is identical
// for paired-Android and desktop chat requests, both routed through the same dispatchChatSend
// pipeline, so this check applies unmodified.
internal const val CODEX_SERVER_NAME = "codex-cli"
internal const val CODEX_REASONING_BLOCK_PREFIX = "codex-reasoning-summary"

internal fun isCodexToolCall(serverName: String?): Boolean = serverName == CODEX_SERVER_NAME

internal fun isCodexReasoning(blocks: List<ThinkingBlock>): Boolean =
    blocks.any { it.blockId.startsWith(CODEX_REASONING_BLOCK_PREFIX) }

internal fun collapsedReasoningPreview(content: String): String {
    val withoutControlCharacters = content.filter { character ->
        character == '\n' || character == '\t' || !character.isISOControl()
    }
    return withoutControlCharacters
        .replace(Regex("!\\[([^]]*)]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^]]+)]\\([^)]*\\)"), "$1")
        .replace(Regex("`([^`]*)`"), "$1")
        .replace(Regex("(?m)^\\s{0,3}(?:#{1,6}|[-*+]|>)\\s+"), "")
        .replace(Regex("\\s+"), " ")
        .trim()
}

/**
 * Compact CLI-style bullet line for Codex-CLI-originated tool calls — the Android counterpart
 * of desktop's CodexActionLine.tsx. Used instead of [ChatTimelineEntry]-wrapped [ToolCallBubble]
 * when [isCodexToolCall] is true, mimicking Codex's own terminal output rather than the generic
 * timeline bead.
 */
@Composable
fun CodexToolActionLine(msg: ChatMessage, inProgress: Boolean) {
    val isDark = LocalNexyColors.current.isDark
    val glyphColor = if (isDark) Gray500 else Gray400
    val verb = when {
        inProgress -> "Running:"
        msg.toolSuccess -> "Ran:"
        else -> "Failed:"
    }
    val verbColor = if (!inProgress && !msg.toolSuccess) (if (isDark) Red400 else Red600) else MaterialTheme.colorScheme.onSurface
    val primaryArg = remember(msg.toolArgs) {
        msg.toolArgs?.let { parseJsonKeyValuePairs(it)?.firstOrNull()?.second }
    }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Text("•", fontSize = 12.sp, color = glyphColor)
            Text(
                buildString {
                    append(verb)
                    append(' ')
                    append(msg.toolName ?: "tool")
                    if (!primaryArg.isNullOrBlank()) {
                        append(' ')
                        append(primaryArg)
                    }
                },
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                color = verbColor,
                modifier = Modifier.weight(1f),
            )
        }
        if (!msg.toolResult.isNullOrBlank()) {
            val cleanedResult = remember(msg.toolResult) { stripAnsiEscapes(msg.toolResult) }
            val clipboard = LocalClipboardManager.current
            val interactionSource = remember { MutableInteractionSource() }
            var showFullscreen by remember { mutableStateOf(false) }
            val resultColor = if (!msg.toolSuccess) (if (isDark) Red400 else Red600) else Gray500
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    "└ " + cleanedResult,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = resultColor,
                    maxLines = RESULT_VISIBLE_LINES,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .weight(1f)
                        .combinedClickable(
                            interactionSource = interactionSource,
                            indication = null,
                            onClick = {},
                            onLongClick = { clipboard.setText(AnnotatedString(cleanedResult)) },
                        ),
                )
                IconButton(onClick = { showFullscreen = true }, modifier = Modifier.size(20.dp)) {
                    Icon(
                        Icons.Default.OpenInFull,
                        contentDescription = "View full tool call result",
                        modifier = Modifier.size(12.dp),
                        tint = Gray400,
                    )
                }
            }
            if (showFullscreen) {
                CodexToolResultFullscreenDialog(
                    content = cleanedResult,
                    contentColor = resultColor,
                    onDismiss = { showFullscreen = false },
                )
            }
        }
    }
}

/**
 * Full-screen reader for a Codex tool call's complete, untruncated (but ANSI-cleaned) result —
 * the inline line caps at [RESULT_VISIBLE_LINES] rendered lines, so this is the desktop hover
 * tooltip's touch equivalent (CodexActionLine.tsx's `title` attribute has no touch analogue).
 */
@Composable
private fun CodexToolResultFullscreenDialog(
    content: String,
    contentColor: androidx.compose.ui.graphics.Color,
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
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    lineHeight = 18.sp,
                    color = contentColor,
                )
            }
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp),
            ) {
                Icon(Icons.Default.Close, contentDescription = "Close")
            }
        }
    }
}

/**
 * Compact reasoning-summary line for Codex-CLI thinking blocks — non-monospace, matching
 * desktop's reasoning bullet style (CodexActionLine.tsx:46-48). One bullet per block, mirroring
 * desktop rendering one reasoning-summary line per phase rather than joining every phase's
 * content into a single run-on paragraph.
 */
@Composable
fun CodexReasoningActionLine(blocks: List<ThinkingBlock>) {
    val isDark = LocalNexyColors.current.isDark
    val glyphColor = if (isDark) Gray500 else Gray400
    val textColor = if (isDark) Gray400 else Gray600

    Column(modifier = Modifier.fillMaxWidth()) {
        blocks.forEach { block ->
            if (block.content.isBlank()) return@forEach
            var expanded by rememberSaveable(block.blockId, block.done) {
                mutableStateOf(!block.done)
            }
            val preview = remember(block.content) {
                collapsedReasoningPreview(block.content).ifBlank { "Thought" }
            }
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { expanded = !expanded }
                        .padding(vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("•", fontSize = 12.sp, color = glyphColor)
                    Text(
                        if (expanded) "Thought" else preview,
                        fontSize = 12.sp,
                        color = textColor,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        if (expanded) Icons.Default.KeyboardArrowUp else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = if (expanded) "Collapse thought" else "Expand thought",
                        modifier = Modifier.size(16.dp),
                        tint = glyphColor,
                    )
                }
                if (expanded) {
                    SelectionContainer(modifier = Modifier.padding(start = 18.dp, end = 4.dp, bottom = 6.dp)) {
                        Text(
                            block.content,
                            fontSize = 12.sp,
                            color = textColor,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}
