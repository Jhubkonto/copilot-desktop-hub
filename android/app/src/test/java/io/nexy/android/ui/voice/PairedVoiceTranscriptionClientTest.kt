package io.nexy.android.ui.voice

import io.nexy.android.data.WsClient
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PairedVoiceTranscriptionClientTest {
    private class FakeWsClient : WsClient {
        override val events = MutableSharedFlow<WsEvent>(extraBufferCapacity = 8)
        val commands = mutableListOf<Pair<String, Map<String, Any>>>()
        override fun send(command: String, data: Map<String, Any>) {
            commands += command to data
        }
    }

    @Test
    fun queuesEarlyAudioThenUploadsInSequenceAndFinishes() = runTest {
        val ws = FakeWsClient()
        val client = PairedVoiceTranscriptionClient(ws, backgroundScope)
        client.begin()
        client.appendPcm(byteArrayOf(1, 2))
        client.finish()
        ws.events.emit(WsEvent.VoiceUploadStarted("session-1", 32 * 1024, 1024))
        runCurrent()

        assertEquals(
            listOf("voice:upload-start", "voice:upload-chunk", "voice:upload-finish"),
            ws.commands.map { it.first },
        )
        assertEquals(0, ws.commands[1].second["sequence"])
        assertTrue(client.state.value is VoiceTranscriptionState.Transcribing)

        ws.events.emit(WsEvent.VoiceTranscription("session-1", "hello"))
        runCurrent()
        assertEquals(VoiceTranscriptionState.Complete("hello"), client.state.value)
        client.close()
    }

    @Test
    fun cancelDoesNotRequestTranscription() = runTest {
        val ws = FakeWsClient()
        val client = PairedVoiceTranscriptionClient(ws, backgroundScope)
        client.begin()
        ws.events.emit(WsEvent.VoiceUploadStarted("session-2", 32 * 1024, 1024))
        runCurrent()
        client.cancel()

        assertEquals("voice:upload-cancel", ws.commands.last().first)
        assertTrue(client.state.value is VoiceTranscriptionState.Cancelled)
        assertTrue(ws.commands.none { it.first == "voice:upload-finish" })
        client.close()
    }
}
