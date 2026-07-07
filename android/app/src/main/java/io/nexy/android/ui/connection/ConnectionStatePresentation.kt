package io.nexy.android.ui.connection

import androidx.compose.ui.graphics.Color
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode

data class ConnectionStatePresentation(
    val label: String,
    val color: Color,
)

fun getConnectionStatePresentation(
    state: ConnectionState,
    intentionalRestartExpected: Boolean = false,
): ConnectionStatePresentation {
    val (label, color) = when {
        intentionalRestartExpected && state != ConnectionState.CONNECTED ->
            "Reconnecting after update…" to Color(0xFF14B8A6)
        state == ConnectionState.CONNECTED -> "Connected to desktop" to Color(0xFF22C55E)
        state == ConnectionState.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
        state == ConnectionState.POLLING -> "Searching…" to Color(0xFFF59E0B)
        else -> "Disconnected" to Color(0xFFEF4444)
    }
    return ConnectionStatePresentation(label, color)
}

fun getEffectiveModePresentation(
    mode: EffectiveConnectionMode,
    intentionalRestartExpected: Boolean = false,
): ConnectionStatePresentation {
    val (label, color) = when {
        intentionalRestartExpected && mode != EffectiveConnectionMode.CONNECTED ->
            "Reconnecting after update…" to Color(0xFF14B8A6)
        mode == EffectiveConnectionMode.CONNECTED -> "Connected to desktop" to Color(0xFF22C55E)
        mode == EffectiveConnectionMode.CONNECTING -> "Connecting…" to Color(0xFFF59E0B)
        mode == EffectiveConnectionMode.SEARCHING -> "Searching…" to Color(0xFFF59E0B)
        mode == EffectiveConnectionMode.STANDALONE_BY_CHOICE -> "Standalone mode" to Color(0xFF8B5CF6)
        else -> "Disconnected" to Color(0xFFEF4444)
    }
    return ConnectionStatePresentation(label, color)
}

fun connectionStateLabel(state: ConnectionState): String =
    getConnectionStatePresentation(state).label
