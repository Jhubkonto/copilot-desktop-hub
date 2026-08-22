package io.nexy.android.ui.fileviewer

/** Destination used when a file-viewer route is restored after an app reload. */
internal enum class FileViewerKind {
    MARKDOWN,
    IMAGE,
}

/** Keep route recovery and project-file click handling on the same image allow-list. */
internal fun fileViewerKind(path: String): FileViewerKind {
    return when (path.substringAfterLast('.', "").lowercase()) {
        "avif", "bmp", "gif", "jpeg", "jpg", "png", "webp" -> FileViewerKind.IMAGE
        else -> FileViewerKind.MARKDOWN
    }
}

internal fun String.isRemoteImagePath(): Boolean = fileViewerKind(this) == FileViewerKind.IMAGE
