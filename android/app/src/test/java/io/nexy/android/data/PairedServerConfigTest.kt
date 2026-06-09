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
    fun fromUrlRejectsMissingToken() {
        assertNull(PairedServerConfig.fromUrl("ws://192.168.1.10:53421"))
    }

    @Test
    fun fromUrlRejectsMissingHost() {
        assertNull(PairedServerConfig.fromUrl("not-a-url"))
    }
}
