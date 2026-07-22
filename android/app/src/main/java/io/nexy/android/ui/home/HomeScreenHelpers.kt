package io.nexy.android.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.nexy.android.data.BackgroundActivity
import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.ui.connection.getEffectiveModePresentation

// Whether it's safe to flip Standalone/Remote mode right now. Switching mid-stream would yank
// the active chat/generation/sync out from under itself, so the toggle is gated on all of these
// being empty/false rather than just connection state.
fun hasActiveActivity(
    activeConversationIds: Set<String>,
    pendingConversationIds: Set<String>,
    syncInProgress: Boolean,
    backgroundActivities: List<BackgroundActivity>,
): Boolean =
    activeConversationIds.isNotEmpty() ||
        pendingConversationIds.isNotEmpty() ||
        syncInProgress ||
        backgroundActivities.isNotEmpty()

/**
 * The ever-present connectivity indicator in the home top bar. Also doubles as the Standalone/
 * Remote mode toggle: tapping it flips the mode immediately when [isBusy] is false, or calls
 * [onBusyTap] (to explain why not) when something is currently active.
 */
@Composable
fun ConnectionChip(
    mode: EffectiveConnectionMode,
    intentionalRestartExpected: Boolean = false,
    isBusy: Boolean = false,
    onToggle: () -> Unit,
    onBusyTap: () -> Unit,
) {
    run {
        val presentation = getEffectiveModePresentation(mode, intentionalRestartExpected)
        Text(
            text = "● ${presentation.label}",
            color = presentation.color,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable(onClick = { if (isBusy) onBusyTap() else onToggle() })
                .padding(horizontal = 6.dp, vertical = 4.dp),
        )
    }
}

fun projectColor(color: String): Color = when (color.lowercase()) {
    "red" -> Color(0xFFEF4444)
    "orange" -> Color(0xFFF97316)
    "yellow" -> Color(0xFFEAB308)
    "green" -> Color(0xFF22C55E)
    "teal" -> Color(0xFF14B8A6)
    "blue" -> Color(0xFF3B82F6)
    "indigo" -> Color(0xFF6366F1)
    "purple" -> Color(0xFFA855F7)
    "pink" -> Color(0xFFEC4899)
    else -> Color(0xFF3B82F6)
}

fun timeAgo(ms: Long): String {
    if (ms == 0L) return ""
    val diff = System.currentTimeMillis() - ms
    return when {
        diff < 60_000 -> "just now"
        diff < 3_600_000 -> "${diff / 60_000}m ago"
        diff < 86_400_000 -> "${diff / 3_600_000}h ago"
        else -> "${diff / 86_400_000}d ago"
    }
}
