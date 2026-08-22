package io.nexy.android.ui.fileexplorer

import io.nexy.android.ui.fileviewer.isRemoteImagePath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileExplorerPathTest {
    @Test
    fun parentPathSupportsWindowsDriveRoots() {
        assertEquals("C:\\Users", "C:\\Users\\Julian".parentPath())
        assertEquals("C:\\", "C:\\Users".parentPath())
        assertNull("C:\\".parentPath())
    }

    @Test
    fun parentPathSupportsUnixRootsAndTrailingSeparators() {
        assertEquals("/home", "/home/julian/".parentPath())
        assertEquals("/", "/home".parentPath())
        assertNull("/".parentPath())
    }

    @Test
    fun recognizesRasterImagesForProjectBrowsing() {
        assertEquals(true, "preview.PNG".isRemoteImagePath())
        assertEquals(true, "photo.webp".isRemoteImagePath())
        assertEquals(false, "diagram.svg".isRemoteImagePath())
        assertEquals(false, "notes.md".isRemoteImagePath())
    }
}
