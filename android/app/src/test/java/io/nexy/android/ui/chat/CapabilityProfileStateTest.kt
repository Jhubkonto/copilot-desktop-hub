package io.nexy.android.ui.chat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CapabilityProfileStateTest {

    @Test
    fun usesThePersistedProfileForTheSelectedScope() {
        val selection = capabilitySelectionForScope(
            profileJson = """{"skillIds":["chat-skill"],"mcp":[{"serverId":"browser","trust":"auto"}]}""",
            preflightJson = """{
                "scopeProfiles": {
                    "chat": {"skillIds":["chat-skill"],"mcp":[{"serverId":"browser","trust":"auto"}]},
                    "agent": {"skillIds":["agent-skill"],"mcp":[{"serverId":"browser","trust":"block"}]}
                }
            }""",
            scope = "agent",
        )

        assertEquals(setOf("agent-skill"), selection.skillIds)
        assertEquals("block", selection.mcpTrustByServer["browser"])
    }

    @Test
    fun preservesApprovalModesAndDefaultsMalformedModesSafely() {
        val selection = parseCapabilitySelection(
            JSONObject("""{
                "mcp": [
                    {"serverId":"auto-server","trust":"auto"},
                    {"serverId":"blocked-server","trust":"block"},
                    {"serverId":"legacy-server","trust":"unexpected"}
                ]
            }"""),
        )

        assertEquals("auto", selection.mcpTrustByServer["auto-server"])
        assertEquals("block", selection.mcpTrustByServer["blocked-server"])
        assertEquals("always-ask", selection.mcpTrustByServer["legacy-server"])
        assertTrue(selection.mcpTrustByServer.keys.containsAll(listOf("auto-server", "blocked-server", "legacy-server")))
    }
}
