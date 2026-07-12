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
import io.nexy.android.MainActivity
import java.util.Locale

class NexySpeechService : Service() {

    private var tts: TextToSpeech? = null
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var currentUtteranceId: String? = null

    override fun onCreate() {
        super.onCreate()
        setupNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        val conversationId = intent.getStringExtra("conversationId") ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        val summary = intent.getStringExtra("summary") ?: run {
            stopSelf()
            return START_NOT_STICKY
        }

        currentUtteranceId = conversationId
        startForeground(NOTIFICATION_ID, createForegroundNotification(conversationId))

        initializeTts {
            speakSummary(summary, conversationId)
        }

        return START_NOT_STICKY
    }

    private fun initializeTts(onReady: () -> Unit) {
        if (tts != null) {
            onReady()
            return
        }

        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.getDefault()
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        if (utteranceId == currentUtteranceId) {
                            releaseAudioFocus()
                            stopSelf()
                        }
                    }

                    override fun onError(utteranceId: String?) {
                        if (utteranceId == currentUtteranceId) {
                            releaseAudioFocus()
                            stopSelf()
                        }
                    }

                    @Deprecated("Deprecated in API 29")
                    override fun onError(utteranceId: String?, errorCode: Int) {
                        onError(utteranceId)
                    }
                })
                onReady()
            } else {
                stopSelf()
            }
        }
    }

    private fun speakSummary(summary: String, utteranceId: String) {
        val ttsEngine = tts ?: return
        requestAudioFocus()
        ttsEngine.speak(summary, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
    }

    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(audioAttributes)
                .build()
            audioManager.requestAudioFocus(focusRequest)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        }
    }

    private fun releaseAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioManager.abandonAudioFocusRequest(
                AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).build()
            )
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }
    }

    private fun createForegroundNotification(conversationId: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            conversationId.hashCode(),
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("deeplink", "chat/$conversationId")
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Reading summary…")
            .setContentText("Touch to open chat")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .build()
    }

    private fun setupNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Speech Playback",
                NotificationManager.IMPORTANCE_LOW,
            )
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIFICATION_ID = 5001
        private const val NOTIFICATION_CHANNEL_ID = "speech_playback"
    }
}
