package io.nexy.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.nexy.android.MainActivity
import io.nexy.android.data.PreferenceStore
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class NexySpeechService : Service() {
    private var tts: TextToSpeech? = null
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var audioFocusRequest: AudioFocusRequest? = null
    private var activeUtteranceId: String? = null
    private var spokenText = ""
    private var resumeOffset = 0
    private var lastRangeStart = 0
    private var messageId: String? = null
    private var conversationId: String? = null
    private var kind = SpokenOutputKind.RESPONSE
    private var model: String? = null
    private var pausedByFocusLoss = false
    private var pendingPlay = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> stopPlayback()
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (_state.value.status == SpokenPlaybackStatus.PLAYING) {
                    pausedByFocusLoss = true
                    pausePlayback()
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (pausedByFocusLoss) {
                    pausedByFocusLoss = false
                    resumePlayback()
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        setupNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action ?: ACTION_PLAY) {
            ACTION_PLAY -> preparePlayback(intent ?: return START_NOT_STICKY)
            ACTION_PAUSE -> pausePlayback()
            ACTION_RESUME -> resumePlayback()
            ACTION_REPLAY -> replay()
            ACTION_STOP -> stopPlayback()
        }
        return START_NOT_STICKY
    }

    private fun preparePlayback(intent: Intent) {
        val rawText = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        val requestedKind = intent.getStringExtra(EXTRA_KIND)
            ?.let { runCatching { SpokenOutputKind.valueOf(it) }.getOrNull() }
            ?: SpokenOutputKind.RESPONSE
        model = intent.getStringExtra(EXTRA_MODEL)
        val safeText = when (requestedKind) {
            SpokenOutputKind.QUICK_RECAP -> createQuickRecap(rawText)
            else -> sanitizeForSpeech(rawText)
        }
        if (safeText.isBlank()) {
            publishError("This response has no speech-safe text to read.")
            stopSelf()
            return
        }

        activeUtteranceId = null
        tts?.stop()
        releaseAudioFocus()
        spokenText = safeText
        resumeOffset = 0
        lastRangeStart = 0
        messageId = intent.getStringExtra(EXTRA_MESSAGE_ID)
        conversationId = intent.getStringExtra(EXTRA_CONVERSATION_ID)
        kind = requestedKind
        pendingPlay = true
        publish(SpokenPlaybackStatus.PREPARING)
        startForeground(NOTIFICATION_ID, createNotification())
        initializeTts()
    }

    private fun initializeTts() {
        if (tts != null) {
            if (pendingPlay) speakFromOffset()
            return
        }
        tts = TextToSpeech(applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) {
                publishError("Android text-to-speech is unavailable.")
                finishService()
                return@TextToSpeech
            }
            tts?.language = Locale.getDefault()
            tts?.setOnUtteranceProgressListener(progressListener)
            if (pendingPlay) speakFromOffset()
        }
    }

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            if (utteranceId == activeUtteranceId) publish(SpokenPlaybackStatus.PLAYING)
        }

        override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
            if (utteranceId == activeUtteranceId) lastRangeStart = resumeOffset + start
        }

        override fun onDone(utteranceId: String?) {
            if (utteranceId == activeUtteranceId) finishService()
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) = Unit

        override fun onError(utteranceId: String?) {
            if (utteranceId == activeUtteranceId) {
                publishError("Speech playback failed.")
                finishService(keepError = true)
            }
        }

        @Deprecated("Deprecated in API 29")
        override fun onError(utteranceId: String?, errorCode: Int) = onError(utteranceId)
    }

    private fun speakFromOffset() {
        val engine = tts ?: return
        val settings = PreferenceStore.getInstance(this).currentSpokenOutputSettings()
        val availableVoices = engine.voices.orEmpty()
        val selectedVoice = settings.voiceId
            ?.let { id -> availableVoices.firstOrNull { it.name == id } }
            ?.takeUnless { settings.offlineOnly && it.isNetworkConnectionRequired }
            ?: availableVoices
                .filter { it.locale.language == Locale.getDefault().language }
                .firstOrNull { !settings.offlineOnly || !it.isNetworkConnectionRequired }
        if (settings.offlineOnly && selectedVoice == null) {
            publishError("No installed offline voice is available for the current language.")
            finishService(keepError = true)
            return
        }
        selectedVoice?.let { engine.voice = it }
        engine.setSpeechRate(settings.rate)
        engine.setPitch(settings.pitch)

        if (!requestAudioFocus()) {
            publishError("Speech audio focus is unavailable.")
            finishService(keepError = true)
            return
        }
        val remaining = spokenText.drop(resumeOffset)
        if (remaining.isBlank()) {
            finishService()
            return
        }
        pendingPlay = false
        activeUtteranceId = UUID.randomUUID().toString()
        engine.speak(remaining, TextToSpeech.QUEUE_FLUSH, null, activeUtteranceId)
        updateNotification()
    }

    private fun pausePlayback() {
        if (_state.value.status != SpokenPlaybackStatus.PLAYING) return
        resumeOffset = lastRangeStart.coerceIn(0, spokenText.length)
        activeUtteranceId = null
        tts?.stop()
        releaseAudioFocus()
        publish(SpokenPlaybackStatus.PAUSED)
        updateNotification()
    }

    private fun resumePlayback() {
        if (_state.value.status != SpokenPlaybackStatus.PAUSED) return
        pendingPlay = true
        publish(SpokenPlaybackStatus.PREPARING)
        speakFromOffset()
    }

    private fun replay() {
        if (spokenText.isBlank()) return
        activeUtteranceId = null
        tts?.stop()
        releaseAudioFocus()
        resumeOffset = 0
        lastRangeStart = 0
        pendingPlay = true
        publish(SpokenPlaybackStatus.PREPARING)
        initializeTts()
    }

    private fun stopPlayback() {
        activeUtteranceId = null
        pendingPlay = false
        tts?.stop()
        finishService()
    }

    private fun requestAudioFocus(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            audioFocusRequest = request
            audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                focusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    private fun releaseAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let(audioManager::abandonAudioFocusRequest)
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(focusListener)
        }
    }

    private fun publish(status: SpokenPlaybackStatus) {
        _state.value = SpokenPlaybackState(status, messageId, conversationId, kind, model)
    }

    private fun publishError(error: String) {
        _state.value = SpokenPlaybackState(
            status = SpokenPlaybackStatus.ERROR,
            messageId = messageId,
            conversationId = conversationId,
            kind = kind,
            model = model,
            error = error,
        )
    }

    private fun finishService(keepError: Boolean = false) {
        releaseAudioFocus()
        activeUtteranceId = null
        pendingPlay = false
        if (!keepError) _state.value = SpokenPlaybackState()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            conversationId.orEmpty().hashCode(),
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                conversationId?.let { putExtra("deeplink", "chat/$it") }
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val status = _state.value.status
        val builder = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(
                when (kind) {
                    SpokenOutputKind.QUICK_RECAP -> "Quick Recap"
                    SpokenOutputKind.AI_RECAP -> "AI Recap"
                    SpokenOutputKind.NOTIFICATION_SUMMARY -> "Reading summary"
                    SpokenOutputKind.RESPONSE -> "Reading response"
                },
            )
            .setContentText(if (status == SpokenPlaybackStatus.PAUSED) "Paused" else "Nexy spoken playback")
            .setContentIntent(openIntent)
            .setOngoing(status != SpokenPlaybackStatus.PAUSED)
            .setOnlyAlertOnce(true)
            .addAction(
                if (status == SpokenPlaybackStatus.PAUSED) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                if (status == SpokenPlaybackStatus.PAUSED) "Resume" else "Pause",
                serviceAction(if (status == SpokenPlaybackStatus.PAUSED) ACTION_RESUME else ACTION_PAUSE, 1),
            )
            .addAction(android.R.drawable.ic_media_rew, "Replay", serviceAction(ACTION_REPLAY, 2))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", serviceAction(ACTION_STOP, 3))
        return builder.build()
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, createNotification())
    }

    private fun serviceAction(action: String, requestCode: Int) = PendingIntent.getService(
        this,
        requestCode,
        Intent(this, NexySpeechService::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun setupNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Speech Playback",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
    }

    override fun onDestroy() {
        releaseAudioFocus()
        tts?.stop()
        tts?.shutdown()
        tts = null
        if (_state.value.status != SpokenPlaybackStatus.ERROR) {
            _state.value = SpokenPlaybackState()
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_PLAY = "io.nexy.android.speech.PLAY"
        const val ACTION_PAUSE = "io.nexy.android.speech.PAUSE"
        const val ACTION_RESUME = "io.nexy.android.speech.RESUME"
        const val ACTION_REPLAY = "io.nexy.android.speech.REPLAY"
        const val ACTION_STOP = "io.nexy.android.speech.STOP"
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_MESSAGE_ID = "messageId"
        private const val EXTRA_CONVERSATION_ID = "conversationId"
        private const val EXTRA_KIND = "kind"
        private const val EXTRA_MODEL = "model"
        private const val NOTIFICATION_ID = 5001
        private const val NOTIFICATION_CHANNEL_ID = "speech_playback"

        private val _state = MutableStateFlow(SpokenPlaybackState())
        val state: StateFlow<SpokenPlaybackState> = _state.asStateFlow()
        private var lastRequest: PlaybackRequest? = null

        private data class PlaybackRequest(
            val text: String,
            val messageId: String?,
            val conversationId: String?,
            val kind: SpokenOutputKind,
            val model: String?,
        )

        fun play(
            context: Context,
            text: String,
            messageId: String?,
            conversationId: String?,
            kind: SpokenOutputKind = SpokenOutputKind.RESPONSE,
            model: String? = null,
        ) {
            lastRequest = PlaybackRequest(text, messageId, conversationId, kind, model)
            val intent = Intent(context, NexySpeechService::class.java)
                .setAction(ACTION_PLAY)
                .putExtra(EXTRA_TEXT, text)
                .putExtra(EXTRA_MESSAGE_ID, messageId)
                .putExtra(EXTRA_CONVERSATION_ID, conversationId)
                .putExtra(EXTRA_KIND, kind.name)
                .putExtra(EXTRA_MODEL, model)
            ContextCompat.startForegroundService(context, intent)
        }

        fun command(context: Context, action: String) {
            if (_state.value.status == SpokenPlaybackStatus.ERROR) {
                when (action) {
                    ACTION_REPLAY -> {
                        lastRequest?.let { play(context, it.text, it.messageId, it.conversationId, it.kind, it.model) }
                        return
                    }
                    ACTION_STOP -> {
                        _state.value = SpokenPlaybackState()
                        return
                    }
                }
            }
            if (_state.value.status == SpokenPlaybackStatus.IDLE) return
            context.startService(Intent(context, NexySpeechService::class.java).setAction(action))
        }
    }
}
