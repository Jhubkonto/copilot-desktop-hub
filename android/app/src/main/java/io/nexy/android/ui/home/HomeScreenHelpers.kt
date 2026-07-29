package io.nexy.android.ui.home

import androidx.compose.ui.graphics.Color
import io.nexy.android.data.BackgroundActivity

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
