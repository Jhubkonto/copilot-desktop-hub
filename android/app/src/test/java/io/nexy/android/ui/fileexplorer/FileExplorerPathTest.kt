package io.nexy.android.ui.fileexplorer

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
}
