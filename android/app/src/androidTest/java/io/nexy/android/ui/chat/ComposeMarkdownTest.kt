package io.nexy.android.ui.chat

import androidx.compose.ui.graphics.Color
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.noties.markwon.Markwon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ComposeMarkdownTest {
    private val markwon = Markwon.create(ApplicationProvider.getApplicationContext())
    private val colors = InlineMarkdownColors(link = Color.Blue, codeBackground = Color.LightGray)

    private fun convert(markdown: String) =
        spannedToInlineAnnotatedString(markwon.toMarkdown(markdown), colors)

    @Test
    fun inlineProseRendersAsAnnotatedString() {
        val result = convert("A settled **narration** sentence with `code` and _emphasis_.")
        assertNotNull("inline-only markdown should convert", result)
        // Text content is preserved without the markdown control characters.
        assertTrue(result!!.text.contains("narration"))
        assertTrue(result.text.contains("code"))
        assertTrue(result.spanStyles.isNotEmpty())
    }

    @Test
    fun plainProseConvertsToItsOwnText() {
        val result = convert("Now let me look at the desktop mode constants.")
        assertNotNull(result)
        assertEquals("Now let me look at the desktop mode constants.", result!!.text.trim())
    }

    @Test
    fun headingFallsBackToTextView() {
        // A heading carries a block-level span with no lossless inline form.
        assertNull(convert("# A heading"))
    }

    @Test
    fun bulletListFallsBackToTextView() {
        assertNull(convert("- first\n- second\n- third"))
    }
}
