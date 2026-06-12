package io.nexy.android.ui.home

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import io.nexy.android.data.ConnectionState

@Composable
fun ConnectionChip(state: ConnectionState) {
    val (label, color) = when (state) {
        ConnectionState.CONNECTED -> "Connected" to Color(0xFF22C55E)
        ConnectionState.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
        ConnectionState.DISCONNECTED -> "Disconnected" to Color(0xFFEF4444)
    }
    Text(
        text = "● $label",
        color = color,
        style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(end = 4.dp),
    )
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
