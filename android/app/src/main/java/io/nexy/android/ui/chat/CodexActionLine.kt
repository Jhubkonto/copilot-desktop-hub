package io.nexy.android.ui.chat

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
            )
        }
        if (!msg.toolResult.isNullOrBlank()) {
            val cleanedResult = remember(msg.toolResult) { stripAnsiEscapes(msg.toolResult) }
            val clipboard = LocalClipboardManager.current
            val interactionSource = remember { MutableInteractionSource() }
            Text(
                "└ " + cleanedResult,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                color = if (!msg.toolSuccess) (if (isDark) Red400 else Red600) else Gray500,
                maxLines = RESULT_VISIBLE_LINES,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(start = 16.dp)
                    .combinedClickable(
                        interactionSource = interactionSource,
                        indication = null,
                        onClick = {},
                        onLongClick = { clipboard.setText(AnnotatedString(cleanedResult)) },
                    ),
            )
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
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text("•", fontSize = 12.sp, color = glyphColor)
                Text(block.content, fontSize = 12.sp, color = textColor)
            }
        }
    }
}
