package io.nexy.android.ui.voice

import android.Manifest
import android.content.Context
import androidx.annotation.RequiresPermission
import io.nexy.android.data.WsClient
import java.io.Closeable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class VoiceDockUiState(
    val recorder: PcmRecorderSnapshot = PcmRecorderSnapshot(),
    val transcription: VoiceTranscriptionState = VoiceTranscriptionState.Idle,
) {
    val recording: Boolean get() = recorder.state == PcmRecorderState.RECORDING
    val busy: Boolean
        get() = recording ||
            transcription is VoiceTranscriptionState.Starting ||
            transcription is VoiceTranscriptionState.Uploading ||
            transcription is VoiceTranscriptionState.Transcribing
}

/**
 * Owns the single recorder/upload lifecycle used by the Android composer dock.
 *
 * The controller never submits a chat message. A successful transcript is
 * returned to the screen so it can be merged into the editable composer draft.
 */
class VoiceDockController(
    context: Context,
    wsClient: WsClient,
    scope: CoroutineScope,
    private val onTranscript: (String) -> Unit,
) : Closeable {
    private val appContext = context.applicationContext
    private val transcriptionClient = PairedVoiceTranscriptionClient(wsClient, scope)
    private val _state = MutableStateFlow(VoiceDockUiState())
    val state: StateFlow<VoiceDockUiState> = _state
    private var recorder: PcmVoiceRecorder? = null
    private val transcriptionJob: Job = scope.launch {
        transcriptionClient.state.collect { transcription ->
            _state.value = _state.value.copy(transcription = transcription)
            if (transcription is VoiceTranscriptionState.Complete) {
                usableVoiceTranscript(transcription.text)?.let(onTranscript)
            }
        }
    }

    @Synchronized
    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    fun start(): Boolean {
        if (_state.value.busy || recorder != null) return false
        _state.value = VoiceDockUiState(transcription = VoiceTranscriptionState.Starting)
        transcriptionClient.begin()
        val nextRecorder = PcmVoiceRecorder(
            context = appContext,
            onChunk = transcriptionClient::appendPcm,
            onSnapshot = ::onRecorderSnapshot,
        )
        recorder = nextRecorder
        if (!nextRecorder.start()) {
            recorder = null
            transcriptionClient.cancel()
            return false
        }
        return true
    }

    @Synchronized
    fun stop() {
        recorder?.stop()
    }

    @Synchronized
    fun cancel(reason: PcmRecorderStopReason = PcmRecorderStopReason.USER_CANCELLED) {
        recorder?.cancel(reason)
        transcriptionClient.cancel()
        if (recorder == null) {
            _state.value = _state.value.copy(
                recorder = PcmRecorderSnapshot(
                    state = PcmRecorderState.CANCELLED,
                    stopReason = reason,
                ),
            )
        }
    }

    fun onAppBackgrounded() {
        cancel(PcmRecorderStopReason.BACKGROUNDED)
    }

    override fun close() {
        cancel(PcmRecorderStopReason.BACKGROUNDED)
        recorder?.close()
        recorder = null
        transcriptionJob.cancel()
        transcriptionClient.close()
    }

    @Synchronized
    private fun onRecorderSnapshot(snapshot: PcmRecorderSnapshot) {
        _state.value = _state.value.copy(recorder = snapshot)
        when (snapshot.state) {
            PcmRecorderState.STOPPED -> {
                recorder = null
                if (snapshot.capturedBytes > 0) {
                    transcriptionClient.finish()
                } else {
                    transcriptionClient.cancel()
                }
            }
            PcmRecorderState.CANCELLED, PcmRecorderState.ERROR -> {
                recorder = null
                transcriptionClient.cancel()
            }
            else -> Unit
        }
    }
}

internal fun voiceDockStateLabel(state: VoiceDockUiState, tapMode: Boolean): String = when {
    state.recording -> "Recording ${formatVoiceDuration(state.recorder.durationMs)}"
    state.transcription is VoiceTranscriptionState.Transcribing -> "Transcribing…"
    state.transcription is VoiceTranscriptionState.Starting -> "Connecting…"
    state.transcription is VoiceTranscriptionState.Uploading -> "Recording…"
    state.transcription is VoiceTranscriptionState.Error ->
        (state.transcription as VoiceTranscriptionState.Error).message
    state.recorder.state == PcmRecorderState.ERROR -> state.recorder.error ?: "Recording failed"
    tapMode -> "Tap to record"
    else -> "Hold to record"
}

internal fun formatVoiceDuration(durationMs: Long): String {
    val totalSeconds = durationMs.coerceAtLeast(0) / 1_000
    return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
}
