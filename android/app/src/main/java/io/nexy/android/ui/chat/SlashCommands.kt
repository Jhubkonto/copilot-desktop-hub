package io.nexy.android.ui.chat

/** Mirrors desktop's SlashCommandDef shape (src/renderer/slash-commands.ts) — name, usage,
 * description — so the two command sets stay easy to compare. */
data class SlashCommandDef(
    val name: String,
    val usage: String,
    val description: String,
)

/**
 * A mobile-appropriate subset of desktop's built-in SLASH_COMMANDS: text-only, no-filesystem
 * commands that make sense on a phone. Desktop/filesystem-flavored ones (/cwd, /cd, /add-dir,
 * /list-dirs) have no Android equivalent and are intentionally omitted.
 */
val MOBILE_SLASH_COMMANDS: List<SlashCommandDef> = listOf(
    SlashCommandDef("/clear", "/clear", "Clear current conversation messages"),
    SlashCommandDef("/new", "/new", "Start a new chat"),
    SlashCommandDef("/help", "/help [filter]", "Show slash command help, optionally filtered by name"),
    SlashCommandDef("/model", "/model [name]", "Show or set conversation model"),
    SlashCommandDef("/debrief", "/debrief [model]", "Generate a session debrief as a re-runnable artifact"),
    SlashCommandDef("/quiz", "/quiz [model]", "Quiz yourself on this session (generates a debrief first if needed)"),
    SlashCommandDef("/complete", "/complete", "Mark this conversation complete"),
    SlashCommandDef("/incomplete", "/incomplete", "Mark this conversation incomplete"),
    SlashCommandDef(
        "/code-change",
        "/code-change [repo] <description>",
        "Investigate a code change and propose a plan. Add [repo] first if this workspace has more than one git repo",
    ),
    SlashCommandDef(
        "/code-plan",
        "/code-plan",
        "Show the current code-change plan for this conversation, if one exists",
    ),
    SlashCommandDef(
        "/code-execute",
        "/code-execute",
        "Run the current plan: apply the fix, verify it, and commit",
    ),
    SlashCommandDef(
        "/code-push",
        "/code-push",
        "Push the committed code change to the remote",
    ),
    SlashCommandDef(
        "/code-undo",
        "/code-undo",
        "Roll back the most recent code change commit",
    ),
    SlashCommandDef(
        "/code-status",
        "/code-status",
        "Show the current code-change step, plan summary, and git repo status",
    ),
    SlashCommandDef(
        "/code",
        "/code",
        "Open the git repo/branch panel for this project (branches, fetch, merge, changed files)",
    ),
)
