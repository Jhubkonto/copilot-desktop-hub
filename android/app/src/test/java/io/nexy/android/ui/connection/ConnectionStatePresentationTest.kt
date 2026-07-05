package io.nexy.android.ui.connection

import androidx.compose.ui.graphics.Color
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.EffectiveConnectionMode
import org.junit.Test
import org.junit.Assert.*

class ConnectionStatePresentationTest {

    @Test
    fun connectedState_returnsConnectedLabel() {
        val result = getConnectionStatePresentation(ConnectionState.CONNECTED)
        assertEquals("Connected", result.label)
        assertEquals(Color(0xFF22C55E), result.color)
    }

    @Test
    fun connectingState_returnsConnectingLabel() {
        val result = getConnectionStatePresentation(ConnectionState.CONNECTING)
        assertEquals("Connecting…", result.label)
        assertEquals(Color(0xFFF59E0B), result.color)
    }

    @Test
    fun pollingState_returnsSearchingLabel() {
        val result = getConnectionStatePresentation(ConnectionState.POLLING)
        assertEquals("Searching…", result.label)
        assertEquals(Color(0xFFF59E0B), result.color)
    }

    @Test
    fun disconnectedState_returnsDisconnectedLabel() {
        val result = getConnectionStatePresentation(ConnectionState.DISCONNECTED)
        assertEquals("Disconnected", result.label)
        assertEquals(Color(0xFFEF4444), result.color)
    }

    @Test
    fun intentionalRestartExpectedWithDisconnected_returnsReconnectingLabel() {
        val result = getConnectionStatePresentation(
            ConnectionState.DISCONNECTED,
            intentionalRestartExpected = true
        )
        assertEquals("Reconnecting after update…", result.label)
        assertEquals(Color(0xFF14B8A6), result.color)
    }

    @Test
    fun intentionalRestartExpectedWithConnecting_returnsReconnectingLabel() {
        val result = getConnectionStatePresentation(
            ConnectionState.CONNECTING,
            intentionalRestartExpected = true
        )
        assertEquals("Reconnecting after update…", result.label)
        assertEquals(Color(0xFF14B8A6), result.color)
    }

    @Test
    fun intentionalRestartExpectedWithConnected_ignoresRestart() {
        val result = getConnectionStatePresentation(
            ConnectionState.CONNECTED,
            intentionalRestartExpected = true
        )
        assertEquals("Connected", result.label)
        assertEquals(Color(0xFF22C55E), result.color)
    }

    @Test
    fun connectionStateLabelFunction_returnsLabelOnly() {
        assertEquals("Connected", connectionStateLabel(ConnectionState.CONNECTED))
        assertEquals("Connecting…", connectionStateLabel(ConnectionState.CONNECTING))
        assertEquals("Searching…", connectionStateLabel(ConnectionState.POLLING))
        assertEquals("Disconnected", connectionStateLabel(ConnectionState.DISCONNECTED))
    }

    @Test
    fun effectiveModeConnected_returnsConnectedLabel() {
        val result = getEffectiveModePresentation(EffectiveConnectionMode.CONNECTED)
        assertEquals("Connected", result.label)
        assertEquals(Color(0xFF22C55E), result.color)
    }

    @Test
    fun effectiveModeStandaloneByChoice_returnsStandaloneModeLabel() {
        val result = getEffectiveModePresentation(EffectiveConnectionMode.STANDALONE_BY_CHOICE)
        assertEquals("Standalone mode", result.label)
        assertEquals(Color(0xFF8B5CF6), result.color)
    }

    @Test
    fun effectiveModeConnecting_returnsConnectingLabel() {
        val result = getEffectiveModePresentation(EffectiveConnectionMode.CONNECTING)
        assertEquals("Connecting…", result.label)
        assertEquals(Color(0xFFF59E0B), result.color)
    }

    @Test
    fun effectiveModeSearching_returnsSearchingLabel() {
        val result = getEffectiveModePresentation(EffectiveConnectionMode.SEARCHING)
        assertEquals("Searching…", result.label)
        assertEquals(Color(0xFFF59E0B), result.color)
    }

    @Test
    fun effectiveModeDisconnected_returnsDisconnectedLabel() {
        val result = getEffectiveModePresentation(EffectiveConnectionMode.DISCONNECTED)
        assertEquals("Disconnected", result.label)
        assertEquals(Color(0xFFEF4444), result.color)
    }
}
