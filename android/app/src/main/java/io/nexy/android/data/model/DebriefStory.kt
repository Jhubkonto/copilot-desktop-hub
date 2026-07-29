package io.nexy.android.data.model

/** Mirrors shared/types.ts StoryMood. */
enum class StoryMood {
    problem, attempt, discovery, resolution;

    companion object {
        fun fromRaw(raw: String?): StoryMood = entries.find { it.name == raw } ?: discovery
    }
}

/** Mirrors shared/types.ts StoryBeat — the "svg" field is untrusted model output and must be
 * parsed/validated by StorySvg before being rendered (never drawn as-is). */
data class StoryBeat(
    val caption: String,
    val mood: StoryMood,
    val svg: String,
)

/** Mirrors shared/types.ts DebriefStory — a narrative retelling of a debrief. */
data class DebriefStory(
    val title: String,
    val beats: List<StoryBeat>,
)
