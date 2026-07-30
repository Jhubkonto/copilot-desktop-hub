package io.nexy.android.ui.voice

private val EMPTY_AUDIO_MARKER = Regex(
    pattern = """^\[\s*blank[\s_-]*audio\s*]$""",
    option = RegexOption.IGNORE_CASE,
)

/**
 * Returns editable speech text, or null when the recognizer reports no speech.
 *
 * whisper.cpp can return `[BLANK_AUDIO]` as a successful transcription for an
 * empty or silent recording. That marker must never be inserted in a composer.
 */
internal fun usableVoiceTranscript(text: String): String? =
    text.trim().takeIf { it.isNotEmpty() && !EMPTY_AUDIO_MARKER.matches(it) }
