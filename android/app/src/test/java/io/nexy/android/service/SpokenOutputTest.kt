package io.nexy.android.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SpokenOutputTest {
    @Test
    fun `sanitizer removes code commands urls and markdown`() {
        val input = """
            # Result
            Use **the safe path** from [the guide](https://example.com/guide).
            `inlineCode()`
            ```kotlin
            dangerous()
            ```
            npm run build
            Keep this sentence.
        """.trimIndent()

        val spoken = sanitizeForSpeech(input)

        assertEquals("Result Use the safe path from the guide. Keep this sentence.", spoken)
        assertFalse(spoken.contains("example.com"))
        assertFalse(spoken.contains("dangerous"))
        assertFalse(spoken.contains("npm"))
    }

    @Test
    fun `quick recap is deterministic bounded and sentence aware`() {
        val input = "First result is complete. Second detail is intentionally long. Third detail should not be included."

        assertEquals("First result is complete.", createQuickRecap(input, 40))
        assertEquals(createQuickRecap(input, 40), createQuickRecap(input, 40))
    }

    @Test
    fun `quick recap truncates a single long sentence`() {
        assertEquals("abcd…", createQuickRecap("abcdefghij", 5))
    }

    @Test
    fun `settings normalization matches desktop bounds`() {
        val normalized = normalizeSpokenOutputSettings(
            SpokenOutputSettings(voiceId = "", rate = 9f, pitch = Float.NaN),
        )

        assertEquals(null, normalized.voiceId)
        assertEquals(2f, normalized.rate)
        assertEquals(1f, normalized.pitch)
    }
}
