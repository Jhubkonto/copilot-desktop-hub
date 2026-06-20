package io.nexy.android.ui.chat

import io.nexy.android.data.model.HistoryMessage

private val INJECTED_BLOCK_RE = Regex("""\[[A-Za-z][^\]]*]\n[\s\S]*?\[/[A-Za-z][^\]]*]\n*""")

internal fun HistoryMessage.toChatMessage(): ChatMessage {
    if (role != "tool-call") {
        val displayText = if (role == "user") INJECTED_BLOCK_RE.replace(content, "").trimStart() else content
        return ChatMessage(
            id = id,
            text = displayText,
            isUser = role == "user",
            isStreaming = false,
            timestamp = timestamp,
            attachments = attachments,
            thinkingBlocks = thinkingBlocks,
        )
    }

    return runCatching {
        ChatMessage(
            id = id,
            text = jsonString(content, "toolResult").orEmpty(),
            isUser = false,
            isStreaming = false,
            timestamp = timestamp,
            isToolCall = true,
            toolName = jsonString(content, "toolName"),
            serverName = jsonString(content, "serverName"),
            toolArgs = jsonObject(content, "toolArgs"),
            toolResult = jsonString(content, "toolResult").orEmpty(),
            toolSuccess = jsonBoolean(content, "toolSuccess") ?: true,
        )
    }.getOrElse {
        ChatMessage(
            id = id,
            text = content,
            isUser = false,
            isStreaming = false,
            timestamp = timestamp,
            isToolCall = true,
            toolName = "Tool call",
            toolResult = content,
        )
    }
}

internal fun jsonString(json: String, key: String): String? {
    val pattern = """"$key"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
    return pattern.find(json)?.groupValues?.getOrNull(1)
        ?.replace("\\\"", "\"")
        ?.replace("\\n", "\n")
        ?.replace("\\\\", "\\")
        ?.takeIf { it.isNotBlank() }
}

internal fun jsonBoolean(json: String, key: String): Boolean? {
    val pattern = """"$key"\s*:\s*(true|false)""".toRegex()
    return pattern.find(json)?.groupValues?.getOrNull(1)?.toBooleanStrictOrNull()
}

internal fun jsonObject(json: String, key: String): String? {
    val keyMatch = """"$key"\s*:\s*\{""".toRegex().find(json) ?: return null
    val start = keyMatch.range.last
    var depth = 0
    var inString = false
    var escaped = false
    for (i in start until json.length) {
        val ch = json[i]
        if (escaped) {
            escaped = false
            continue
        }
        if (ch == '\\' && inString) {
            escaped = true
            continue
        }
        if (ch == '"') inString = !inString
        if (inString) continue
        if (ch == '{') depth++
        if (ch == '}') {
            depth--
            if (depth == 0) return json.substring(start, i + 1)
        }
    }
    return null
}
