package io.nexy.android.ui.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceDockControllerTest {
    @Test
    fun `state label describes hold tap recording and transcription states`() {
        assertEquals("Hold to record", voiceDockStateLabel(VoiceDockUiState(), tapMode = false))
        assertEquals("Tap to record", voiceDockStateLabel(VoiceDockUiState(), tapMode = true))
        assertEquals(
            "Recording 1:05",
            voiceDockStateLabel(
                VoiceDockUiState(
                    recorder = PcmRecorderSnapshot(
                        state = PcmRecorderState.RECORDING,
                        durationMs = 65_000,
                    ),
                ),
                tapMode = false,
            ),
        )
        assertEquals(
            "Transcribing…",
            voiceDockStateLabel(
                VoiceDockUiState(
                    transcription = VoiceTranscriptionState.Transcribing("session"),
                ),
                tapMode = false,
            ),
        )
    }

    @Test
    fun `error label does not expose audio or transcript content`() {
        val state = VoiceDockUiState(
            transcription = VoiceTranscriptionState.Error(
                code = "desktop-timeout",
                message = "Desktop did not respond.",
            ),
        )
        assertEquals("Desktop did not respond.", voiceDockStateLabel(state, tapMode = false))
    }

    @Test
    fun `blank audio transcripts are not composer text`() {
        assertNull(usableVoiceTranscript(""))
        assertNull(usableVoiceTranscript("   "))
        assertNull(usableVoiceTranscript("[BLANK_AUDIO]"))
        assertNull(usableVoiceTranscript("[ blank audio ]"))
        assertEquals("Keep this text", usableVoiceTranscript("  Keep this text  "))
    }
}
