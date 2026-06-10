package io.nexy.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairedServerConfigTest {
    @Test
    fun fromUrlSplitsEndpointAndToken() {
        val config = PairedServerConfig.fromUrl("ws://192.168.1.10:53421?token=abc123")

        assertEquals("ws://192.168.1.10:53421", config?.endpoint)
        assertEquals("abc123", config?.token)
        assertEquals("ws://192.168.1.10:53421?token=abc123", config?.connectUrl)
    }

    @Test
    fun fromUrlPreservesPathWhenPresent() {
        val config = PairedServerConfig.fromUrl("wss://example.test:443/mobile?token=secure")

        assertEquals("wss://example.test:443/mobile", config?.endpoint)
        assertEquals("secure", config?.token)
    }

    @Test
    fun fromUrlAcceptsSecureWebSocketPairingUrls() {
        val config = PairedServerConfig.fromUrl("wss://nexy.example/mobile?token=secure")

        assertEquals("wss://nexy.example/mobile", config?.endpoint)
        assertEquals("secure", config?.token)
        assertEquals("wss://nexy.example/mobile?token=secure", config?.connectUrl)
    }

    @Test
    fun fromUrlRejectsMissingToken() {
        assertNull(PairedServerConfig.fromUrl("ws://192.168.1.10:53421"))
    }

    @Test
    fun fromUrlRejectsMissingHost() {
        assertNull(PairedServerConfig.fromUrl("not-a-url"))
    }

    @Test
    fun profileIdIsStableForEndpoint() {
        val first = PairedServerConfig.profileIdForEndpoint("ws://192.168.1.10:53421")
        val second = PairedServerConfig.profileIdForEndpoint("WS://192.168.1.10:53421")

        assertEquals(first, second)
    }

    @Test
    fun displayNameUsesHostAndPort() {
        assertEquals(
            "192.168.1.10:53421",
            PairedServerConfig.displayNameForEndpoint("ws://192.168.1.10:53421"),
        )
    }

    @Test
    fun profileFromConfigUsesEndpointIdentity() {
        val config = PairedServerConfig("ws://192.168.1.10:53421", "abc123")
        val profile = PairedServerProfile.fromConfig(config, now = 123L)

        assertEquals(config.id, profile.id)
        assertEquals(config.endpoint, profile.endpoint)
        assertEquals(config.token, profile.token)
        assertEquals(config.displayName, profile.name)
        assertEquals(123L, profile.lastUsedAt)
        assertEquals(config, profile.toConfig())
    }
}
