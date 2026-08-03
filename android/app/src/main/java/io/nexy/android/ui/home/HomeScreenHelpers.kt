package io.nexy.android.ui.home

import androidx.compose.ui.graphics.Color
import io.nexy.android.data.BackgroundActivity
import io.nexy.android.ui.theme.GeneratedNexyColors

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
    "red" -> GeneratedNexyColors.ProjectRedMain
    "orange" -> GeneratedNexyColors.ProjectOrangeMain
    "yellow" -> GeneratedNexyColors.ProjectYellowMain
    "green" -> GeneratedNexyColors.ProjectGreenMain
    "teal", "cyan" -> GeneratedNexyColors.ProjectCyanMain
    "blue" -> GeneratedNexyColors.ProjectBlueMain
    "indigo", "purple" -> GeneratedNexyColors.ProjectPurpleMain
    "pink" -> GeneratedNexyColors.ProjectPinkMain
    "gray", "grey" -> GeneratedNexyColors.ProjectGrayMain
    else -> GeneratedNexyColors.ProjectBlueMain
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
