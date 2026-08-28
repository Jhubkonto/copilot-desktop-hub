package io.nexy.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownViewModeTest {
    @Test
    fun invalidOrMissingPreferenceDefaultsToRendered() {
        assertEquals(MarkdownViewMode.Rendered, MarkdownViewMode.fromStoredValue(null))
        assertEquals(MarkdownViewMode.Rendered, MarkdownViewMode.fromStoredValue("unknown"))
    }

    @Test
    fun modesRoundTripThroughStoredValues() {
        assertEquals(MarkdownViewMode.Rendered, MarkdownViewMode.fromStoredValue("rendered"))
        assertEquals(MarkdownViewMode.Raw, MarkdownViewMode.fromStoredValue("raw"))
    }
}
