package io.nexy.android.ui.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceDockPlacementTest {
    @Test
    fun `clamps dock inside system and IME safe area`() {
        val bounds = VoiceDockSafeBounds(
            widthPx = 1_080f,
            heightPx = 2_400f,
            dockWidthPx = 192f,
            dockHeightPx = 216f,
            leftInsetPx = 24f,
            topInsetPx = 72f,
            rightInsetPx = 24f,
            bottomInsetPx = 72f,
            imeHeightPx = 720f,
            composerHeightPx = 240f,
        )

        assertEquals(DockPixelPosition(864f, 1_224f), NormalizedDockPosition(5f, 4f).toPixels(bounds))
    }

    @Test
    fun `round trips reachable normalized position`() {
        val bounds = VoiceDockSafeBounds(
            widthPx = 2_000f,
            heightPx = 1_200f,
            dockWidthPx = 192f,
            dockHeightPx = 216f,
            bottomInsetPx = 48f,
            composerHeightPx = 180f,
        )
        val position = NormalizedDockPosition(0.25f, 0.75f)
        assertEquals(position, position.toPixels(bounds).toNormalized(bounds))
        assertEquals(VoiceDockOrientation.LANDSCAPE, voiceDockOrientation(bounds.widthPx, bounds.heightPx))
    }
}
