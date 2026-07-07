package io.nexy.android.ui.settings

import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionDiagnosticsTest {
    @Test
    fun buildsDiagnosticsForSecureProfile() {
        val profile = PairedServerProfile(
            id = "profile-1",
            name = "nexy.example",
            endpoint = "wss://nexy.example/mobile",
            token = "secret",
            lastUsedAt = 123L,
        )

        val diagnostics = buildConnectionDiagnostics(
            activeProfile = profile,
            connectionState = ConnectionState.CONNECTED,
            serverVersion = "1.2.3",
            lastError = null,
        )

        assertEquals("nexy.example", diagnostics.profileName)
        assertEquals("wss://nexy.example/mobile", diagnostics.endpoint)
        assertEquals("wss", diagnostics.scheme)
        assertEquals("Secure WebSocket", connectionSchemeDetail(diagnostics.scheme))
        assertEquals("Connected to desktop", connectionStateLabel(diagnostics.connectionState))
        assertEquals("1.2.3", diagnostics.serverVersion)
    }

    @Test
    fun buildsFallbackDiagnosticsWithoutProfile() {
        val diagnostics = buildConnectionDiagnostics(
            activeProfile = null,
            connectionState = ConnectionState.DISCONNECTED,
            serverVersion = "",
            lastError = "Connection refused",
        )

        assertEquals("No active profile", diagnostics.profileName)
        assertEquals("Not configured", diagnostics.endpoint)
        assertEquals("Unknown", diagnostics.scheme)
        assertEquals("Connection refused", diagnostics.lastError)
    }
}
