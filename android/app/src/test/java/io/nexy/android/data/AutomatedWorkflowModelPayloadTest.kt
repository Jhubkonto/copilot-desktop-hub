package io.nexy.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression coverage for item 8 of the follow-up roadmap: the workflow generator had no model
 * picker, unlike every other AI generator screen. Confirms the payload sent to the desktop
 * includes the chosen model when set, and omits the key entirely (rather than sending a literal
 * null) when the user leaves it on the default.
 */
class AutomatedWorkflowModelPayloadTest {

    @Test
    fun startPayloadIncludesModelWhenSet() {
        val payload = WsRepository.buildAutomatedWorkflowStartPayload(
            projectId = "proj-1",
            sessionId = "session-1",
            initialMessage = "Ship the release",
            model = "claude-sonnet-4-6",
        )
        assertEquals("claude-sonnet-4-6", payload["model"])
    }

    @Test
    fun startPayloadOmitsModelKeyWhenNull() {
        val payload = WsRepository.buildAutomatedWorkflowStartPayload(
            projectId = "proj-1",
            sessionId = "session-1",
            initialMessage = "Ship the release",
            model = null,
        )
        assertFalse(payload.containsKey("model"))
    }

    @Test
    fun messagePayloadIncludesModelWhenSet() {
        val history = listOf(WsRepository.AutomatedWorkflowChatMessage("user", "Ship the release"))
        val payload = WsRepository.buildAutomatedWorkflowMessagePayload(
            projectId = "proj-1",
            sessionId = "session-1",
            history = history,
            model = "gpt-5.4",
        )
        assertEquals("gpt-5.4", payload["model"])
    }

    @Test
    fun messagePayloadOmitsModelKeyWhenNull() {
        val history = listOf(WsRepository.AutomatedWorkflowChatMessage("user", "Ship the release"))
        val payload = WsRepository.buildAutomatedWorkflowMessagePayload(
            projectId = "proj-1",
            sessionId = "session-1",
            history = history,
            model = null,
        )
        assertFalse(payload.containsKey("model"))
    }

    @Test
    fun startPayloadOmitsProjectIdKeyWhenNull() {
        // A standalone (project-less) workflow generation must omit the key entirely, not send a
        // literal null — mirrors the model field's own omit-when-unset convention, and lets
        // ws-handlers.ts's existing "missing/blank projectId means global" handling apply.
        val payload = WsRepository.buildAutomatedWorkflowStartPayload(
            projectId = null,
            sessionId = "session-1",
            initialMessage = "Ship the release",
            model = null,
        )
        assertFalse(payload.containsKey("projectId"))
    }

    @Test
    fun startPayloadIncludesProjectIdWhenSet() {
        val payload = WsRepository.buildAutomatedWorkflowStartPayload(
            projectId = "proj-1",
            sessionId = "session-1",
            initialMessage = "Ship the release",
            model = null,
        )
        assertEquals("proj-1", payload["projectId"])
    }

    @Test
    fun messagePayloadOmitsProjectIdKeyWhenNull() {
        val history = listOf(WsRepository.AutomatedWorkflowChatMessage("user", "Ship the release"))
        val payload = WsRepository.buildAutomatedWorkflowMessagePayload(
            projectId = null,
            sessionId = "session-1",
            history = history,
            model = null,
        )
        assertFalse(payload.containsKey("projectId"))
    }

    @Test
    fun messagePayloadMapsHistoryEntries() {
        val history = listOf(
            WsRepository.AutomatedWorkflowChatMessage("user", "Ship the release"),
            WsRepository.AutomatedWorkflowChatMessage("assistant", "Sure, here's a plan"),
        )
        val payload = WsRepository.buildAutomatedWorkflowMessagePayload("proj-1", "session-1", history, null)

        @Suppress("UNCHECKED_CAST")
        val messages = payload["messages"] as List<Map<String, String>>
        assertEquals(2, messages.size)
        assertEquals("user", messages[0]["role"])
        assertEquals("Ship the release", messages[0]["content"])
        assertTrue(messages[1]["role"] == "assistant")
    }
}
