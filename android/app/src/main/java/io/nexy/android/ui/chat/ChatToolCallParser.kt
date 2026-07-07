package io.nexy.android.ui.chat

import io.nexy.android.data.model.HistoryMessage
import org.json.JSONObject

private const val ARTIFACT_REF_PREFIX = "__artifact-ref:"
private const val CODE_CHANGE_REF_PREFIX = "__code-change-ref:"

private fun parseArtifactRef(content: String): ArtifactRef? = runCatching {
    val json = JSONObject(content.removePrefix(ARTIFACT_REF_PREFIX))
    ArtifactRef(
        artifactId = json.getString("artifactId"),
        versionId = if (json.has("versionId") && !json.isNull("versionId")) json.getString("versionId") else null,
        kind = if (json.has("kind") && !json.isNull("kind")) json.getString("kind") else null,
        conversationId = if (json.has("conversationId") && !json.isNull("conversationId")) json.getString("conversationId") else null,
    )
}.getOrNull()

private fun parseCodeChangeRef(content: String): CodeChangeRef? = runCatching {
    CodeChangeRef(reportId = JSONObject(content.removePrefix(CODE_CHANGE_REF_PREFIX)).getString("reportId"))
}.getOrNull()

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
        val steps = parseTeamActivitySteps(content)
        val stepCount = steps.size
        val hasError = steps.any { it.status == "error" }
        val label = if (stepCount > 0) "$stepCount step${if (stepCount != 1) "s" else ""}" else "Team activity"
        return ChatMessage(
            id = id,
            text = "",
            isUser = false,
            isStreaming = false,
            timestamp = timestamp,
            isToolCall = true,
            toolName = "🤝 $label",
            serverName = "Team activity",
            toolResult = summarizeTeamActivity(content),
            toolSuccess = !hasError,
        )
    }

    if (role == "system" && content.startsWith(ARTIFACT_REF_PREFIX)) {
        parseArtifactRef(content)?.let { ref ->
            return ChatMessage(id = id, text = "", isUser = false, isStreaming = false, timestamp = timestamp, artifactRef = ref)
        }
    }
    if (role == "system" && content.startsWith(CODE_CHANGE_REF_PREFIX)) {
        parseCodeChangeRef(content)?.let { ref ->
            return ChatMessage(id = id, text = "", isUser = false, isStreaming = false, timestamp = timestamp, codeChangeRef = ref)
        }
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

private data class TeamActivityStepData(
    val agentIcon: String,
    val agentName: String,
    val task: String,
    val status: String,
    val result: String?,
    val durationMs: Long?,
)

private fun parseTeamActivitySteps(content: String): List<TeamActivityStepData> {
    // Locate the "steps" array inside the JSON object
    val stepsStart = content.indexOf("\"steps\"")
    if (stepsStart < 0) return emptyList()
    val arrayStart = content.indexOf('[', stepsStart)
    if (arrayStart < 0) return emptyList()

    // Walk the array to find each top-level object boundary
    val steps = mutableListOf<TeamActivityStepData>()
    var i = arrayStart + 1
    while (i < content.length) {
        while (i < content.length && content[i].isWhitespace()) i++
        if (i >= content.length || content[i] == ']') break
        if (content[i] != '{') { i++; continue }

        // Find the matching closing brace
        var depth = 0
        var inStr = false
        var escaped = false
        val objStart = i
        var objEnd = -1
        for (j in i until content.length) {
            val ch = content[j]
            if (escaped) { escaped = false; continue }
            if (ch == '\\' && inStr) { escaped = true; continue }
            if (ch == '"') { inStr = !inStr; continue }
            if (inStr) continue
            if (ch == '{') depth++
            if (ch == '}') { depth--; if (depth == 0) { objEnd = j; break } }
        }
        if (objEnd < 0) break

        val obj = content.substring(objStart, objEnd + 1)
        steps.add(
            TeamActivityStepData(
                agentIcon  = jsonString(obj, "agentIcon") ?: "",
                agentName  = jsonString(obj, "agentName") ?: "",
                task       = jsonString(obj, "task") ?: "",
                status     = jsonString(obj, "status") ?: "done",
                result     = jsonString(obj, "result"),
                durationMs = run {
                    val m = """"durationMs"\s*:\s*(\d+)""".toRegex().find(obj)
                    m?.groupValues?.getOrNull(1)?.toLongOrNull()
                },
            )
        )
        i = objEnd + 1
        // skip comma
        while (i < content.length && (content[i].isWhitespace() || content[i] == ',')) i++
    }
    return steps
}

private fun summarizeTeamActivity(content: String): String {
    val steps = parseTeamActivitySteps(content)
    if (steps.isEmpty()) return "Team activity completed."
    return buildString {
        steps.forEachIndexed { idx, step ->
            if (idx > 0) append("\n\n")
            val badge = listOf(step.agentIcon, step.agentName).filter { it.isNotBlank() }.joinToString(" ")
            val statusMark = when (step.status) { "error" -> "✗" else -> "✓" }
            val duration = step.durationMs?.let { ms ->
                if (ms < 1000) " (${ms}ms)" else " (${ms / 1000.0}s)".let { s ->
                    // trim trailing zeros: "1.0s" → "1s", "1.50s" → "1.5s"
                    s.replace(Regex("\\.?0+s$"), "s")
                }
            } ?: ""
            append("$statusMark ${badge.ifBlank { "Agent" }}$duration")
            append("\nTask: ${step.task}")
            if (!step.result.isNullOrBlank()) {
                append("\nResult: ${step.result}")
            }
        }
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
