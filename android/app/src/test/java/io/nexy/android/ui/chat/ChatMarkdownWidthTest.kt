package io.nexy.android.ui.chat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatMarkdownWidthTest {

    @Test
    fun markdownWaitsUntilViewAndHolderHaveTargetWidth() {
        assertFalse(isMarkdownWidthReady(targetWidthPx = 879, viewWidthPx = 0, parentWidthPx = 0))
        assertFalse(isMarkdownWidthReady(targetWidthPx = 879, viewWidthPx = 879, parentWidthPx = 0))
        assertFalse(isMarkdownWidthReady(targetWidthPx = 879, viewWidthPx = 0, parentWidthPx = 879))
        assertTrue(isMarkdownWidthReady(targetWidthPx = 879, viewWidthPx = 879, parentWidthPx = 879))
    }
}
