package io.nexy.android.ui.connection

import androidx.compose.ui.graphics.Color
import io.nexy.android.data.EffectiveConnectionMode

/**
 * Connectivity, independent of content sync.
 *
 * This is the dot the user taps to reach the connection sheet. It answers only "what is my link to
 * the desktop?" — the sibling [ContentSyncState] owns whether pulled content is fresh. An active
 * connect and a background rediscovery (CONNECTING / SEARCHING) collapse into one CONNECTING dot,
 * since from the user's side both mean "trying to reach the desktop".
 */
enum class ConnectionDotState { DISCONNECTED, CONNECTING, CONNECTED, STANDALONE }

fun resolveConnectionDotState(mode: EffectiveConnectionMode): ConnectionDotState = when (mode) {
    EffectiveConnectionMode.CONNECTED -> ConnectionDotState.CONNECTED
    EffectiveConnectionMode.CONNECTING,
    EffectiveConnectionMode.SEARCHING -> ConnectionDotState.CONNECTING
    EffectiveConnectionMode.STANDALONE_BY_CHOICE -> ConnectionDotState.STANDALONE
    EffectiveConnectionMode.DISCONNECTED -> ConnectionDotState.DISCONNECTED
}

data class ConnectionDotPresentation(
    val label: String,
    val color: Color,
    val accessibilityDescription: String,
)

private val ConnectedGreen = Color(0xFF22C55E)
private val ConnectingAmber = Color(0xFFF59E0B)
private val DisconnectedRed = Color(0xFFEF4444)
private val StandalonePurple = Color(0xFF8B5CF6)
private val ReconnectTeal = Color(0xFF14B8A6)

fun getConnectionDotPresentation(
    state: ConnectionDotState,
    intentionalRestartExpected: Boolean = false,
): ConnectionDotPresentation {
    if (intentionalRestartExpected && state != ConnectionDotState.CONNECTED) {
        return ConnectionDotPresentation(
            "Reconnecting after update…",
            ReconnectTeal,
            "Reconnecting to the desktop after an update",
        )
    }
    return when (state) {
        ConnectionDotState.CONNECTED ->
            ConnectionDotPresentation("Connected", ConnectedGreen, "Connected to the desktop")
        ConnectionDotState.CONNECTING ->
            ConnectionDotPresentation("Connecting…", ConnectingAmber, "Connecting to the desktop")
        ConnectionDotState.DISCONNECTED ->
            ConnectionDotPresentation("Disconnected", DisconnectedRed, "Not connected to the desktop")
        ConnectionDotState.STANDALONE ->
            ConnectionDotPresentation("Standalone", StandalonePurple, "Standalone on-device mode")
    }
}
