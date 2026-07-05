package io.nexy.android.data

import java.util.UUID
import io.nexy.android.data.local.sanitizeSyncJson
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class StandaloneCanonicalFixtureTest {
    @Test
    fun canonicalFixtureRoundTripsWithoutFieldLoss() {
        val raw = checkNotNull(javaClass.classLoader?.getResourceAsStream("standalone-sync-v1.json"))
            .bufferedReader()
            .use { it.readText() }
        val fixture = JSONObject(raw)
        val entities = fixture.getJSONObject("entities")
        val expectedTypes = listOf("project", "agent", "conversation", "message", "wiki", "prompt", "skill")

        assertEquals(1, fixture.getInt("schemaVersion"))
        assertEquals(expectedTypes.toSet(), entities.keys().asSequence().toSet())
        expectedTypes.forEach { type ->
            UUID.fromString(entities.getJSONObject(type).getString("id"))
        }
        assertEquals(fixture.toString(), JSONObject(fixture.toString()).toString())
        assertEquals(
            listOf("turn_started", "assistant_text_delta", "turn_completed"),
            fixture.getJSONArray("normalizedChatTurn").let { turns ->
                (0 until turns.length()).map { turns.getJSONObject(it).getString("type") }
            },
        )
    }

    @Test
    fun synchronizationSerializationRemovesSecretsAndLocalPathsRecursively() {
        val sanitized = JSONObject(
            sanitizeSyncJson(
                """
                {
                  "content":"the word token in message content is retained",
                  "apiKey":"secret",
                  "rootDirectory":"/private",
                  "nested":{"authorization":"Bearer secret","enabled":true}
                }
                """.trimIndent(),
            ),
        )

        assertEquals("the word token in message content is retained", sanitized.getString("content"))
        assertEquals(true, sanitized.getJSONObject("nested").getBoolean("enabled"))
        assertEquals(false, sanitized.has("apiKey"))
        assertEquals(false, sanitized.has("rootDirectory"))
        assertEquals(false, sanitized.getJSONObject("nested").has("authorization"))
    }
}
