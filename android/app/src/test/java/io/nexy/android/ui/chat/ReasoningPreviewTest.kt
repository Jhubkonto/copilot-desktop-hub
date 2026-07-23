package io.nexy.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class ReasoningPreviewTest {

    @Test
    fun collapsedPreviewFlattensWhitespaceAndRemovesInlineMarkdownArtifacts() {
        val preview = collapsedReasoningPreview(
            """
            ## Now inspect both `factory` blocks
            and read [the implementation](https://example.test).
            """.trimIndent(),
        )

        assertEquals(
            "Now inspect both factory blocks and read the implementation.",
            preview,
        )
    }

    @Test
    fun collapsedPreviewRemovesControlCharacters() {
        assertEquals("Clean text", collapsedReasoningPreview("Clean\u0000\ttext"))
    }
}
