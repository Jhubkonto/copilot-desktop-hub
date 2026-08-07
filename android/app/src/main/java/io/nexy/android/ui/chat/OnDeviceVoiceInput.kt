package io.nexy.android.ui.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.ModelDownloadListener
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.nexy.android.ui.voice.usableVoiceTranscript
import java.util.Locale

data class OnDeviceVoiceInput(
    val listening: Boolean,
    val processing: Boolean,
    val start: () -> Unit,
    val stop: () -> Unit,
    val cancel: () -> Unit,
    val toggle: () -> Unit,
)

private fun requestOfflineSpeechModel(
    context: android.content.Context,
    recognizer: SpeechRecognizer,
    intent: Intent,
    onReady: () -> Unit,
    onMessage: (String) -> Unit,
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        recognizer.triggerModelDownload(intent, ContextCompat.getMainExecutor(context), object : ModelDownloadListener {
            override fun onProgress(completedPercent: Int) {
                if (completedPercent == 0 || completedPercent == 50) {
                    onMessage("Downloading offline speech recognition: $completedPercent%")
                }
            }
            override fun onSuccess() {
                onMessage("Offline speech recognition is ready.")
                onReady()
            }
            override fun onScheduled() {
                onMessage("Android scheduled the offline speech model download. Try voice input again when it completes.")
            }
            override fun onError(error: Int) {
                onMessage("Android could not download the offline speech model (code $error). Check Google speech services and try again.")
            }
        })
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        recognizer.triggerModelDownload(intent)
        onMessage("Android started downloading the offline speech model. Try voice input again when it completes.")
    } else {
        onMessage("Install the offline speech recognition language in Android settings. TTS voice data is separate from speech recognition.")
    }
}

@Composable
fun OnDeviceVoiceButton(onText: (String) -> Unit, enabled: Boolean = true) {
    val context = LocalContext.current
    val voice = rememberOnDeviceVoiceInput(
        onText = onText,
        onError = { Toast.makeText(context, it, Toast.LENGTH_LONG).show() },
    )
    IconButton(onClick = voice.toggle, enabled = enabled && !voice.processing) {
        if (voice.processing) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Icon(
                Icons.Default.Mic,
                contentDescription = if (voice.listening) "Stop voice input" else "Start voice input",
                tint = if (voice.listening) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun rememberOnDeviceVoiceInput(onText: (String) -> Unit, onError: (String) -> Unit): OnDeviceVoiceInput {
    val context = LocalContext.current
    val currentText by rememberUpdatedState(onText)
    val currentError by rememberUpdatedState(onError)
    var listening by remember { mutableStateOf(false) }
    var processing by remember { mutableStateOf(false) }
    var recognizer by remember { mutableStateOf<SpeechRecognizer?>(null) }

    fun start(isRetry: Boolean = false) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            currentError("On-device speech recognition is not available on this device.")
            return
        }
        recognizer?.destroy()
        recognizer = null
        processing = false
        val local = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        val recognitionIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        }
        recognizer = local
        local.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { listening = true }
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() {
                listening = false
                processing = true
            }
            override fun onError(error: Int) {
                listening = false
                processing = false
                if (error == SpeechRecognizer.ERROR_CLIENT && !isRetry) {
                    local.destroy()
                    Handler(Looper.getMainLooper()).postDelayed({ start(true) }, 250)
                    return
                }
                if (error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) {
                    requestOfflineSpeechModel(
                        context = context,
                        recognizer = local,
                        intent = recognitionIntent,
                        onReady = { local.startListening(recognitionIntent) },
                        onMessage = currentError,
                    )
                    return
                }
                local.destroy()
                if (recognizer === local) recognizer = null
                val message = when (error) {
                    SpeechRecognizer.ERROR_AUDIO -> "The microphone could not capture audio."
                    SpeechRecognizer.ERROR_CLIENT -> "The on-device recognizer could not start. Install the offline speech language in Android settings and try again."
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required for voice input."
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "The current language is not supported by the on-device recognizer."
                    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "The offline speech recognition language is unavailable."
                    SpeechRecognizer.ERROR_NO_MATCH -> "No speech was recognized."
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Voice recognition is already in use."
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was detected."
                    else -> "On-device voice recognition failed (code $error)."
                }
                currentError(message)
            }
            override fun onResults(results: Bundle?) {
                listening = false
                processing = false
                local.destroy()
                if (recognizer === local) recognizer = null
                results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.let(::usableVoiceTranscript)
                    ?.let(currentText)
            }
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        local.startListening(recognitionIntent)
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) start() else currentError("Microphone permission is required for voice input.")
    }
    val startVoice = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            start()
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    val stopVoice = {
        recognizer?.stopListening()
        listening = false
        processing = true
    }
    val cancelVoice = {
        recognizer?.cancel()
        listening = false
        processing = false
    }
    val toggle = remember(listening) {{ if (listening) stopVoice() else startVoice() }}
    DisposableEffect(Unit) { onDispose { recognizer?.destroy() } }
    return OnDeviceVoiceInput(listening, processing, startVoice, stopVoice, cancelVoice, toggle)
}
