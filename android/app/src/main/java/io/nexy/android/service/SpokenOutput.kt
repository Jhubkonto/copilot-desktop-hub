package io.nexy.android.service

data class SpokenOutputSettings(
    val voiceId: String? = null,
    val rate: Float = 1f,
    val pitch: Float = 1f,
    val offlineOnly: Boolean = true,
    val autoPlay: Boolean = false,
)

data class SpokenVoiceOption(
    val id: String,
    val label: String,
    val localeTag: String,
    val offline: Boolean,
)

fun normalizeSpokenOutputSettings(value: SpokenOutputSettings) = value.copy(
    voiceId = value.voiceId?.takeIf(String::isNotBlank),
    rate = value.rate.takeIf { it.isFinite() }?.coerceIn(0.5f, 2f) ?: 1f,
    pitch = value.pitch.takeIf { it.isFinite() }?.coerceIn(0.5f, 2f) ?: 1f,
)

enum class SpokenOutputKind { RESPONSE, QUICK_RECAP, AI_RECAP, NOTIFICATION_SUMMARY }

enum class SpokenPlaybackStatus { IDLE, PREPARING, PLAYING, PAUSED, ERROR }

data class SpokenPlaybackState(
    val status: SpokenPlaybackStatus = SpokenPlaybackStatus.IDLE,
    val messageId: String? = null,
    val conversationId: String? = null,
    val kind: SpokenOutputKind = SpokenOutputKind.RESPONSE,
    val model: String? = null,
    val error: String? = null,
)

private val fencedCode = Regex("```[\\s\\S]*?```")
private val commandLine = Regex(
    "^\\s*(?:[\\$>]\\s+|(?:npm|npx|pnpm|yarn|git|gradle|adb|docker|curl|wget|python|node)\\s+).+$",
    setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE),
)
private val markdownImage = Regex("!\\[[^]]*]\\([^)]+\\)")
private val markdownLink = Regex("\\[([^]]+)]\\([^)]+\\)")
private val url = Regex("\\b(?:https?://|www\\.)\\S+", RegexOption.IGNORE_CASE)
private val inlineCode = Regex("`[^`\\n]+`")
private val markdownMarker = Regex("(^|\\s)(?:#{1,6}|>|[-+*]|\\d+\\.)\\s+", RegexOption.MULTILINE)

fun sanitizeForSpeech(input: String): String = input
    .replace(fencedCode, " ")
    .replace(commandLine, " ")
    .replace(markdownImage, " ")
    .replace(markdownLink, "$1")
    .replace(url, " ")
    .replace(inlineCode, " ")
    .replace(markdownMarker, "$1")
    .replace(Regex("[*_~|]"), "")
    .replace(Regex("\\s+"), " ")
    .trim()

fun createQuickRecap(input: String, maxCharacters: Int = 420): String {
    require(maxCharacters > 0) { "maxCharacters must be positive" }
    val speech = sanitizeForSpeech(input)
    if (speech.length <= maxCharacters) return speech

    val sentences = Regex("[^.!?]+[.!?]+(?:\\s+|$)|[^.!?]+$")
        .findAll(speech)
        .map { it.value.trim() }
    var recap = ""
    for (sentence in sentences) {
        val next = "$recap $sentence".trim()
        if (next.length > maxCharacters) break
        recap = next
    }
    if (recap.isNotBlank()) return recap
    if (maxCharacters == 1) return "…"
    return speech.take(maxCharacters - 1).trimEnd() + "…"
}
