package io.nexy.android.ui.fileviewer

import org.junit.Assert.assertEquals
import org.junit.Test

class FileViewerPathTest {
    @Test
    fun imageReadPrefersDedicatedCommandButHasLegacyFallback() {
        assertEquals(
            listOf("fs:read-image", "fs:read-file"),
            imageReadCommands(),
        )
    }

    @Test
    fun restoredMarkdownRouteTreatsRasterImageAsImageViewer() {
        assertEquals(FileViewerKind.IMAGE, fileViewerKind("C:\\workspace\\img_1.png"))
        assertEquals(FileViewerKind.IMAGE, fileViewerKind("/workspace/photo.JPEG"))
    }

    @Test
    fun markdownRouteRemainsMarkdownForDocuments() {
        assertEquals(FileViewerKind.MARKDOWN, fileViewerKind("/workspace/README.md"))
        assertEquals(FileViewerKind.MARKDOWN, fileViewerKind("/workspace/diagram.svg"))
    }
}
