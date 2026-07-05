package io.nexy.android.data

import org.junit.Test
import org.junit.Assert.*

class EffectiveConnectionModeTest {

    @Test
    fun standalonePreferenceOverridesConnectedState() {
        val result = deriveEffectiveMode(
            connectionState = ConnectionState.CONNECTED,
            preferStandaloneMode = true
        )
        assertEquals(EffectiveConnectionMode.STANDALONE_BY_CHOICE, result)
    }

    @Test
    fun standalonePreferenceOverridesDisconnectedState() {
        val result = deriveEffectiveMode(
            connectionState = ConnectionState.DISCONNECTED,
            preferStandaloneMode = true
        )
        assertEquals(EffectiveConnectionMode.STANDALONE_BY_CHOICE, result)
    }

    @Test
    fun connectedStateWithoutPreference_returnsConnected() {
        val result = deriveEffectiveMode(
            connectionState = ConnectionState.CONNECTED,
            preferStandaloneMode = false
        )
        assertEquals(EffectiveConnectionMode.CONNECTED, result)
    }

    @Test
    fun connectingStateWithoutPreference_returnsConnecting() {
        val result = deriveEffectiveMode(
            connectionState = ConnectionState.CONNECTING,
            preferStandaloneMode = false
        )
        assertEquals(EffectiveConnectionMode.CONNECTING, result)
    }

    @Test
    fun pollingStateWithoutPreference_returnsSearching() {
        val result = deriveEffectiveMode(
            connectionState = ConnectionState.POLLING,
            preferStandaloneMode = false
        )
        assertEquals(EffectiveConnectionMode.SEARCHING, result)
    }

    @Test
    fun disconnectedStateWithoutPreference_returnsDisconnected() {
        val result = deriveEffectiveMode(
            connectionState = ConnectionState.DISCONNECTED,
            preferStandaloneMode = false
        )
        assertEquals(EffectiveConnectionMode.DISCONNECTED, result)
    }

    @Test
    fun standalonePreferenceAlwaysPrioritized() {
        val states = listOf(
            ConnectionState.CONNECTED,
            ConnectionState.CONNECTING,
            ConnectionState.POLLING,
            ConnectionState.DISCONNECTED
        )
        for (state in states) {
            val result = deriveEffectiveMode(
                connectionState = state,
                preferStandaloneMode = true
            )
            assertEquals("Failed for state $state", EffectiveConnectionMode.STANDALONE_BY_CHOICE, result)
        }
    }
}
