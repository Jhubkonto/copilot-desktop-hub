package io.nexy.android.ui.voice

import android.Manifest
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresPermission
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

enum class PcmRecorderState { IDLE, RECORDING, STOPPED, CANCELLED, ERROR }

enum class PcmRecorderStopReason { RELEASED, USER_CANCELLED, DURATION_LIMIT, BACKGROUNDED, AUDIO_FOCUS_LOST, CAPTURE_ERROR }

data class PcmRecorderSnapshot(
    val state: PcmRecorderState = PcmRecorderState.IDLE,
    val durationMs: Long = 0,
    val capturedBytes: Long = 0,
    val level: Float = 0f,
    val stopReason: PcmRecorderStopReason? = null,
    val error: String? = null,
)

/**
 * Application-owned 16 kHz, mono, 16-bit PCM capture.
 *
 * Recording stops only when the owner calls [stop]/[cancel], Android revokes audio
 * focus, the app backgrounds, capture fails, or the ten-minute safety limit is
 * reached. Silence never ends a recording.
 */
class PcmVoiceRecorder(
    context: Context,
    private val onChunk: (ByteArray) -> Unit,
    private val onSnapshot: (PcmRecorderSnapshot) -> Unit,
    private val maxDurationMs: Long = MAX_DURATION_MS,
) : Closeable {
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val recording = AtomicBoolean(false)
    private val terminalDispatched = AtomicBoolean(false)
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    @Volatile private var cancelReason: PcmRecorderStopReason? = null

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
        ) {
            cancel(PcmRecorderStopReason.AUDIO_FOCUS_LOST)
        }
    }

    @Synchronized
    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    fun start(): Boolean {
        if (recording.get() || audioRecord != null) return false
        terminalDispatched.set(false)
        cancelReason = null
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
        if (minBuffer <= 0) {
            dispatchTerminal(PcmRecorderState.ERROR, PcmRecorderStopReason.CAPTURE_ERROR, "Microphone buffer is unavailable.")
            return false
        }
        val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener(focusListener)
            .build()
        if (audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            dispatchTerminal(PcmRecorderState.ERROR, PcmRecorderStopReason.AUDIO_FOCUS_LOST, "Microphone audio focus is unavailable.")
            return false
        }
        audioFocusRequest = focusRequest
        val recorder = try {
            AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AUDIO_FORMAT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(CHANNEL_CONFIG)
                        .build(),
                )
                .setBufferSizeInBytes(maxOf(minBuffer * 2, CHUNK_BYTES))
                .build()
        } catch (error: Exception) {
            abandonAudioFocus()
            dispatchTerminal(PcmRecorderState.ERROR, PcmRecorderStopReason.CAPTURE_ERROR, error.message ?: "Microphone could not start.")
            return false
        }
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            abandonAudioFocus()
            dispatchTerminal(PcmRecorderState.ERROR, PcmRecorderStopReason.CAPTURE_ERROR, "Microphone could not be initialized.")
            return false
        }
        audioRecord = recorder
        try {
            recorder.startRecording()
        } catch (error: Exception) {
            releaseRecorder()
            dispatchTerminal(PcmRecorderState.ERROR, PcmRecorderStopReason.CAPTURE_ERROR, error.message ?: "Microphone could not start.")
            return false
        }
        recording.set(true)
        dispatch(PcmRecorderSnapshot(state = PcmRecorderState.RECORDING))
        captureThread = Thread({ captureLoop(recorder) }, "nexy-pcm-recorder").also { it.start() }
        return true
    }

    fun stop() {
        if (recording.compareAndSet(true, false)) cancelReason = null
    }

    fun cancel(reason: PcmRecorderStopReason = PcmRecorderStopReason.USER_CANCELLED) {
        cancelReason = reason
        recording.set(false)
    }

    fun onAppBackgrounded() {
        cancel(PcmRecorderStopReason.BACKGROUNDED)
    }

    override fun close() {
        cancel(PcmRecorderStopReason.BACKGROUNDED)
    }

    private fun captureLoop(recorder: AudioRecord) {
        val buffer = ByteArray(CHUNK_BYTES)
        var capturedBytes = 0L
        val maxBytes = SAMPLE_RATE * BYTES_PER_SAMPLE * maxDurationMs / 1000
        var terminalState = PcmRecorderState.STOPPED
        var terminalReason = PcmRecorderStopReason.RELEASED
        var terminalError: String? = null
        try {
            while (recording.get()) {
                val read = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
                if (read < 0) {
                    terminalState = PcmRecorderState.ERROR
                    terminalReason = PcmRecorderStopReason.CAPTURE_ERROR
                    terminalError = "Microphone capture failed (code $read)."
                    break
                }
                if (read == 0) continue
                val remaining = (maxBytes - capturedBytes).coerceAtLeast(0).toInt()
                val accepted = minOf(read, remaining)
                if (accepted > 0) {
                    val chunk = buffer.copyOf(accepted)
                    capturedBytes += accepted
                    onChunk(chunk)
                    dispatch(
                        PcmRecorderSnapshot(
                            state = PcmRecorderState.RECORDING,
                            durationMs = capturedBytes * 1000 / (SAMPLE_RATE * BYTES_PER_SAMPLE),
                            capturedBytes = capturedBytes,
                            level = pcmLevel(chunk),
                        ),
                    )
                }
                if (capturedBytes >= maxBytes) {
                    terminalReason = PcmRecorderStopReason.DURATION_LIMIT
                    recording.set(false)
                }
            }
            cancelReason?.let {
                terminalState = PcmRecorderState.CANCELLED
                terminalReason = it
            }
        } catch (error: Exception) {
            terminalState = PcmRecorderState.ERROR
            terminalReason = PcmRecorderStopReason.CAPTURE_ERROR
            terminalError = error.message ?: "Microphone capture failed."
        } finally {
            releaseRecorder()
            dispatchTerminal(terminalState, terminalReason, terminalError, capturedBytes)
        }
    }

    @Synchronized
    private fun releaseRecorder() {
        recording.set(false)
        audioRecord?.let { recorder ->
            runCatching { if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop() }
            recorder.release()
        }
        audioRecord = null
        captureThread = null
        abandonAudioFocus()
    }

    private fun abandonAudioFocus() {
        audioFocusRequest?.let(audioManager::abandonAudioFocusRequest)
        audioFocusRequest = null
    }

    private fun dispatchTerminal(
        state: PcmRecorderState,
        reason: PcmRecorderStopReason,
        error: String?,
        bytes: Long = 0,
    ) {
        if (!terminalDispatched.compareAndSet(false, true)) return
        dispatch(
            PcmRecorderSnapshot(
                state = state,
                durationMs = bytes * 1000 / (SAMPLE_RATE * BYTES_PER_SAMPLE),
                capturedBytes = bytes,
                stopReason = reason,
                error = error,
            ),
        )
    }

    private fun dispatch(snapshot: PcmRecorderSnapshot) {
        mainHandler.post { onSnapshot(snapshot) }
    }

    companion object {
        const val SAMPLE_RATE = 16_000
        const val BYTES_PER_SAMPLE = 2
        const val CHUNK_BYTES = 32 * 1024
        const val MAX_DURATION_MS = 10 * 60 * 1000L
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

        internal fun pcmLevel(bytes: ByteArray): Float {
            if (bytes.size < 2) return 0f
            var sumSquares = 0.0
            var samples = 0
            var index = 0
            while (index + 1 < bytes.size) {
                val sample = (bytes[index].toInt() and 0xff) or (bytes[index + 1].toInt() shl 8)
                val signed = sample.toShort().toDouble()
                sumSquares += signed * signed
                samples += 1
                index += 2
            }
            return (sqrt(sumSquares / samples) / Short.MAX_VALUE).toFloat().coerceIn(0f, 1f)
        }
    }
}
