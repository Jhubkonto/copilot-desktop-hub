package io.nexy.android.ui.fileviewer

/**
 * The dedicated command is preferred by current desktops. The generic command is retained as a
 * delayed fallback for desktops that already support binary image reads but predate
 * `fs:read-image`.
 */
internal const val IMAGE_READ_FALLBACK_DELAY_MS = 1_000L

internal fun imageReadCommands(): List<String> = listOf("fs:read-image", "fs:read-file")
