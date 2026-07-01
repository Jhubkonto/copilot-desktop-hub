package io.nexy.android.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownCodeSplitterTest {

    @Test
    fun textOnlyMessageIsSingleTextSegment() {
        val segments = splitCodeBlocks("Just some **markdown** text.\nNo fences here.")

        assertEquals(1, segments.size)
        assertTrue(segments[0] is MessageSegment.Text)
        assertEquals("Just some **markdown** text.\nNo fences here.", (segments[0] as MessageSegment.Text).markdown)
    }

    @Test
    fun detectsFencedCodeBlockWithLanguage() {
        val md = "Before\n```kotlin\nval x = 1\n```\nAfter"
        val segments = splitCodeBlocks(md)

        assertEquals(3, segments.size)
        assertEquals(MessageSegment.Text("Before"), segments[0])
        assertEquals(MessageSegment.Code("kotlin", "val x = 1"), segments[1])
        assertEquals(MessageSegment.Text("After"), segments[2])
    }

    @Test
    fun detectsFencedCodeBlockWithoutLanguage() {
        val md = "```\nsome code\n```"
        val segments = splitCodeBlocks(md)

        assertEquals(1, segments.size)
        assertEquals(MessageSegment.Code(null, "some code"), segments[0])
    }

    @Test
    fun handlesMultipleCodeBlocksInOneMessage() {
        val md = "```python\nprint(1)\n```\nmiddle text\n```js\nconsole.log(2)\n```"
        val segments = splitCodeBlocks(md)

        assertEquals(3, segments.size)
        assertEquals(MessageSegment.Code("python", "print(1)"), segments[0])
        assertEquals(MessageSegment.Text("middle text"), segments[1])
        assertEquals(MessageSegment.Code("js", "console.log(2)"), segments[2])
    }

    @Test
    fun unterminatedFenceIsKeptAsText() {
        // Simulates a message still streaming in: the closing ``` hasn't arrived yet.
        val md = "Here is some code:\n```kotlin\nval x = 1"
        val segments = splitCodeBlocks(md)

        assertEquals(1, segments.size)
        assertTrue(segments[0] is MessageSegment.Text)
        assertEquals(md, (segments[0] as MessageSegment.Text).markdown)
    }

    @Test
    fun inlineBackticksAreNotTreatedAsFences() {
        val md = "Use `npm install` to install, then run `npm start`."
        val segments = splitCodeBlocks(md)

        assertEquals(1, segments.size)
        assertTrue(segments[0] is MessageSegment.Text)
        assertEquals(md, (segments[0] as MessageSegment.Text).markdown)
    }

    @Test
    fun emptyCodeBlockIsHandled() {
        val md = "```\n```"
        val segments = splitCodeBlocks(md)

        assertEquals(1, segments.size)
        assertEquals(MessageSegment.Code(null, ""), segments[0])
    }

    @Test
    fun emptyMessageProducesNoSegments() {
        val segments = splitCodeBlocks("")
        assertEquals(1, segments.size)
        assertEquals(MessageSegment.Text(""), segments[0])
    }
}
