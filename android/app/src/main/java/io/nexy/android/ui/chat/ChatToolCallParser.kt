package io.nexy.android.ui.chat

import io.nexy.android.data.model.HistoryMessage

private val INJECTED_BLOCK_RE = Regex("""\[[A-Za-z][^\]]*]\n[\s\S]*?\[/[A-Za-z][^\]]*]\n*""")
private val CONTEXT_OBJECT_KEYS = listOf(
    "\"project",
    "\"context",
    "\"instructions",
    "\"rootDirectory",
    "\"sourceContext",
    "\"scope",
    "\"files",
    "\"agents",
)

internal fun stripInjectedContextBlocks(text: String): String {
    val withoutBracketBlocks = INJECTED_BLOCK_RE.replace(text, "").trimStart()
    return stripLeadingContextObject(withoutBracketBlocks).trimStart()
}

internal fun HistoryMessage.toChatMessage(): ChatMessage {
    if (role == "team-activity") {
        return ChatMessage(
            id = id,
            text = "",
            isUser = false,
            isStreaming = false,
            timestamp = timestamp,
            isToolCall = true,
            toolName = "Team activity",
            serverName = "Team activity",
            toolResult = summarizeTeamActivity(content),
            toolSuccess = true,
        )
    }

    if (role != "tool-call") {
        val rawText = if (role == "user") stripInjectedContextBlocks(content) else content
        // Wrap bare JSON objects/arrays in a code fence so they render legibly instead of as a wall of text
        val displayText = if (role != "user" && looksLikeRawJson(rawText)) "```json\n$rawText\n```" else rawText
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

internal fun looksLikeRawJson(text: String): Boolean {
    val trimmed = text.trim()
    if (trimmed.length < 2) return false
    return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
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

private fun summarizeTeamActivity(content: String): String {
    val names = """"agentName"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
        .findAll(content)
        .mapNotNull { it.groupValues.getOrNull(1) }
        .map { it.replace("\\\"", "\"") }
        .distinct()
        .toList()
    val tasks = """"task"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
        .findAll(content)
        .mapNotNull { it.groupValues.getOrNull(1) }
        .map { it.replace("\\n", "\n").replace("\\\"", "\"") }
        .take(3)
        .toList()
    return buildString {
        if (names.isNotEmpty()) append("Agents: ${names.joinToString(", ")}")
        if (tasks.isNotEmpty()) {
            if (isNotEmpty()) append("\n")
            append(tasks.joinToString("\n") { "Task: $it" })
        }
        if (isEmpty()) append("Team activity completed.")
    }
}

private fun stripLeadingContextObject(text: String): String {
    val trimmed = text.trimStart()
    if (trimmed.isEmpty()) return trimmed
    val opener = trimmed.first()
    val closer = when (opener) {
        '{' -> '}'
        '[' -> ']'
        else -> return text
    }
    val end = findBalancedEnd(trimmed, opener, closer) ?: return text
    val candidate = trimmed.substring(0, end + 1)
    if (!CONTEXT_OBJECT_KEYS.any { candidate.contains(it, ignoreCase = true) }) return text
    return trimmed.substring(end + 1)
}

private fun findBalancedEnd(text: String, opener: Char, closer: Char): Int? {
    var depth = 0
    var inString = false
    var escaped = false
    for (i in text.indices) {
        val ch = text[i]
        if (escaped) {
            escaped = false
            continue
        }
        if (ch == '\\' && inString) {
            escaped = true
            continue
        }
        if (ch == '"') {
            inString = !inString
            continue
        }
        if (inString) continue
        if (ch == opener) depth++
        if (ch == closer) {
            depth--
            if (depth == 0) return i
        }
    }
    return null
}
