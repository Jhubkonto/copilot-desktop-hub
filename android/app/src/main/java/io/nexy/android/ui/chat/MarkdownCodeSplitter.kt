package io.nexy.android.ui.chat

sealed class MessageSegment {
    data class Text(val markdown: String) : MessageSegment()
    data class Code(val language: String?, val code: String) : MessageSegment()
}

private val FENCE_OPEN = Regex("""^```([\w+-]*)[ \t]*$""")
private val FENCE_CLOSE = Regex("""^```[ \t]*$""")

/**
 * Splits raw markdown into alternating [MessageSegment.Text] / [MessageSegment.Code] segments
 * so fenced code blocks can be rendered by a dedicated composable instead of Markwon.
 *
 * An unterminated fence (opened but not yet closed — the tail end of a message still streaming
 * in) is treated as still part of a [MessageSegment.Text] segment, so the code block doesn't
 * flicker into existence mid-fence while more of the message is still arriving.
 */
fun splitCodeBlocks(markdown: String): List<MessageSegment> {
    val segments = mutableListOf<MessageSegment>()
    val textLines = mutableListOf<String>()
    val lines = markdown.split("\n")

    var i = 0
    fun flushText() {
        if (textLines.isNotEmpty()) {
            segments.add(MessageSegment.Text(textLines.joinToString("\n")))
            textLines.clear()
        }
    }

    while (i < lines.size) {
        val line = lines[i]
        val openMatch = FENCE_OPEN.find(line)
        if (openMatch == null) {
            textLines.add(line)
            i++
            continue
        }

        // Found an opening fence — look ahead for a matching close.
        var closeIndex = -1
        for (j in (i + 1) until lines.size) {
            if (FENCE_CLOSE.matches(lines[j])) {
                closeIndex = j
                break
            }
        }

        if (closeIndex == -1) {
            // Unterminated fence (streaming-partial) — keep as text, don't split it out.
            textLines.add(line)
            i++
            continue
        }

        flushText()
        val language = openMatch.groupValues[1].takeIf { it.isNotBlank() }
        val code = lines.subList(i + 1, closeIndex).joinToString("\n")
        segments.add(MessageSegment.Code(language, code))
        i = closeIndex + 1
    }

    flushText()
    return segments
}
