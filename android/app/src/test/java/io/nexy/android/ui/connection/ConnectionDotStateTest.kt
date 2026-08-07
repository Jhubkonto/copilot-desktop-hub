package io.nexy.android.ui.connection

import io.nexy.android.data.EffectiveConnectionMode
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionDotStateTest {
    @Test
    fun `each mode maps to its dot state`() {
        assertEquals(ConnectionDotState.CONNECTED, resolveConnectionDotState(EffectiveConnectionMode.CONNECTED))
        assertEquals(ConnectionDotState.STANDALONE, resolveConnectionDotState(EffectiveConnectionMode.STANDALONE_BY_CHOICE))
        assertEquals(ConnectionDotState.DISCONNECTED, resolveConnectionDotState(EffectiveConnectionMode.DISCONNECTED))
    }

    @Test
    fun `connecting and searching collapse into one connecting dot`() {
        assertEquals(ConnectionDotState.CONNECTING, resolveConnectionDotState(EffectiveConnectionMode.CONNECTING))
        assertEquals(ConnectionDotState.CONNECTING, resolveConnectionDotState(EffectiveConnectionMode.SEARCHING))
    }

    @Test
    fun `pending restart shows a reconnect presentation unless already connected`() {
        val reconnecting = getConnectionDotPresentation(ConnectionDotState.DISCONNECTED, intentionalRestartExpected = true)
        assertEquals("Reconnecting after update…", reconnecting.label)

        val connected = getConnectionDotPresentation(ConnectionDotState.CONNECTED, intentionalRestartExpected = true)
        assertEquals("Connected", connected.label)
    }

    @Test
    fun `every state has a presentation`() {
        for (state in ConnectionDotState.entries) {
            val presentation = getConnectionDotPresentation(state)
            assertEquals(false, presentation.label.isBlank())
            assertEquals(false, presentation.accessibilityDescription.isBlank())
        }
    }
}
