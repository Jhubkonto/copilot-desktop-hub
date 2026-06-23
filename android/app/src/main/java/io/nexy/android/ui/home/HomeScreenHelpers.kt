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
import io.nexy.android.data.ConnectionState

@Composable
fun ConnectionChip(
    state: ConnectionState,
    intentionalRestartExpected: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    data class ChipState(val state: ConnectionState, val restartExpected: Boolean)
    AnimatedContent(
        targetState = ChipState(state, intentionalRestartExpected),
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "connection-chip",
    ) { (currentState, restartExpected) ->
        val (label, color) = when {
            restartExpected && currentState != ConnectionState.CONNECTED ->
                "Reconnecting after update…" to Color(0xFF14B8A6)
            currentState == ConnectionState.CONNECTED -> "Connected" to Color(0xFF22C55E)
            currentState == ConnectionState.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
            currentState == ConnectionState.POLLING -> "Searching…" to Color(0xFFF59E0B)
            else -> "Disconnected" to Color(0xFFEF4444)
        }
        val clickMod = if (onClick != null) {
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable(onClick = onClick)
        } else Modifier
        Text(
            text = "● $label",
            color = color,
            style = MaterialTheme.typography.labelMedium,
            modifier = clickMod.padding(horizontal = 6.dp, vertical = 4.dp),
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
