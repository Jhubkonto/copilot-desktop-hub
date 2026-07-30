package io.nexy.android.ui.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmVoiceRecorderTest {
    @Test
    fun pcmLevel_isSilentForZeroSamples() {
        assertEquals(0f, PcmVoiceRecorder.pcmLevel(ByteArray(32)), 0.0001f)
    }

    @Test
    fun pcmLevel_reportsNormalizedSignalStrength() {
        val samples = byteArrayOf(0xff.toByte(), 0x7f, 0xff.toByte(), 0x7f)
        assertTrue(PcmVoiceRecorder.pcmLevel(samples) > 0.99f)
    }

    @Test
    fun captureContract_matchesDesktopUploadContract() {
        assertEquals(16_000, PcmVoiceRecorder.SAMPLE_RATE)
        assertEquals(32 * 1024, PcmVoiceRecorder.CHUNK_BYTES)
        assertEquals(10 * 60 * 1000L, PcmVoiceRecorder.MAX_DURATION_MS)
    }
}
