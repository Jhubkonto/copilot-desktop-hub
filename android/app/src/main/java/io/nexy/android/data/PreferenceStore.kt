package io.nexy.android.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import io.nexy.android.service.SpokenOutputSettings
import io.nexy.android.service.normalizeSpokenOutputSettings

class PreferenceStore private constructor(context: Context) {
    companion object {
        private var instance: PreferenceStore? = null

        fun getInstance(context: Context): PreferenceStore {
            return instance ?: PreferenceStore(context.applicationContext).also { instance = it }
        }

        private const val PREFER_STANDALONE_MODE = "prefer_standalone_mode"
        private const val READ_ALOUD_ENABLED = "read_aloud_enabled"
        private const val FEATURE_VOICE_DOCK_V1 = "feature_voice_dock_v1"
        private const val FEATURE_SPOKEN_OUTPUT_V1 = "feature_spoken_output_v1"
        private const val VOICE_DOCK_FLOATING = "voice_dock_floating"
        private const val VOICE_DOCK_TAP_MODE = "voice_dock_tap_mode"
        private const val VOICE_DOCK_HINT_SHOWN = "voice_dock_hint_shown"
        private const val VOICE_DOCK_POSITION_PORTRAIT = "voice_dock_position_portrait"
        private const val VOICE_DOCK_POSITION_LANDSCAPE = "voice_dock_position_landscape"
        private const val SPOKEN_OUTPUT_VOICE_ID = "spoken_output_voice_id"
        private const val SPOKEN_OUTPUT_RATE = "spoken_output_rate"
        private const val SPOKEN_OUTPUT_PITCH = "spoken_output_pitch"
        private const val SPOKEN_OUTPUT_OFFLINE_ONLY = "spoken_output_offline_only"
        private const val SPOKEN_OUTPUT_AUTO_PLAY = "spoken_output_auto_play"
        private const val PREFS_NAME = "nexy_preferences"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _preferStandaloneMode = MutableStateFlow(prefs.getBoolean(PREFER_STANDALONE_MODE, false))
    private val _readAloudEnabled = MutableStateFlow(prefs.getBoolean(READ_ALOUD_ENABLED, false))
    private val _voiceDockV1 = MutableStateFlow(prefs.getBoolean(FEATURE_VOICE_DOCK_V1, true))
    private val _spokenOutputV1 = MutableStateFlow(prefs.getBoolean(FEATURE_SPOKEN_OUTPUT_V1, false))
    private val _spokenOutputSettings = MutableStateFlow(readSpokenOutputSettings())

    fun getPreferStandaloneMode(): Flow<Boolean> = _preferStandaloneMode

    fun setPreferStandaloneMode(value: Boolean) {
        prefs.edit().putBoolean(PREFER_STANDALONE_MODE, value).apply()
        _preferStandaloneMode.value = value
    }

    fun getReadAloudEnabled(): Flow<Boolean> = _readAloudEnabled

    fun setReadAloudEnabled(value: Boolean) {
        prefs.edit().putBoolean(READ_ALOUD_ENABLED, value).apply()
        _readAloudEnabled.value = value
    }

    fun getVoiceDockV1(): Flow<Boolean> = _voiceDockV1

    fun setVoiceDockV1(value: Boolean) {
        prefs.edit().putBoolean(FEATURE_VOICE_DOCK_V1, value).apply()
        _voiceDockV1.value = value
    }

    fun getSpokenOutputV1(): Flow<Boolean> = _spokenOutputV1

    fun setSpokenOutputV1(value: Boolean) {
        prefs.edit().putBoolean(FEATURE_SPOKEN_OUTPUT_V1, value).apply()
        _spokenOutputV1.value = value
    }

    fun getSpokenOutputSettings(): Flow<SpokenOutputSettings> = _spokenOutputSettings

    fun currentSpokenOutputSettings(): SpokenOutputSettings = _spokenOutputSettings.value

    fun setSpokenOutputSettings(value: SpokenOutputSettings) {
        val sanitized = normalizeSpokenOutputSettings(value)
        prefs.edit()
            .putString(SPOKEN_OUTPUT_VOICE_ID, sanitized.voiceId)
            .putFloat(SPOKEN_OUTPUT_RATE, sanitized.rate)
            .putFloat(SPOKEN_OUTPUT_PITCH, sanitized.pitch)
            .putBoolean(SPOKEN_OUTPUT_OFFLINE_ONLY, sanitized.offlineOnly)
            .putBoolean(SPOKEN_OUTPUT_AUTO_PLAY, sanitized.autoPlay)
            .apply()
        _spokenOutputSettings.value = sanitized
    }

    private fun readSpokenOutputSettings() = SpokenOutputSettings(
        voiceId = prefs.getString(SPOKEN_OUTPUT_VOICE_ID, null),
        rate = prefs.getFloat(SPOKEN_OUTPUT_RATE, 1f).takeIf { it.isFinite() }?.coerceIn(0.5f, 2f) ?: 1f,
        pitch = prefs.getFloat(SPOKEN_OUTPUT_PITCH, 1f).takeIf { it.isFinite() }?.coerceIn(0.5f, 2f) ?: 1f,
        offlineOnly = prefs.getBoolean(SPOKEN_OUTPUT_OFFLINE_ONLY, true),
        autoPlay = prefs.getBoolean(SPOKEN_OUTPUT_AUTO_PLAY, false),
    )

    fun isVoiceDockFloating(): Boolean = prefs.getBoolean(VOICE_DOCK_FLOATING, false)

    fun setVoiceDockFloating(value: Boolean) {
        prefs.edit().putBoolean(VOICE_DOCK_FLOATING, value).apply()
    }

    fun isVoiceDockTapMode(): Boolean = prefs.getBoolean(VOICE_DOCK_TAP_MODE, false)

    fun setVoiceDockTapMode(value: Boolean) {
        prefs.edit().putBoolean(VOICE_DOCK_TAP_MODE, value).apply()
    }

    fun hasShownVoiceDockHint(): Boolean = prefs.getBoolean(VOICE_DOCK_HINT_SHOWN, false)

    fun setVoiceDockHintShown() {
        prefs.edit().putBoolean(VOICE_DOCK_HINT_SHOWN, true).apply()
    }

    fun getVoiceDockPosition(orientation: VoiceDockPreferenceOrientation): Pair<Float, Float> {
        val key = when (orientation) {
            VoiceDockPreferenceOrientation.PORTRAIT -> VOICE_DOCK_POSITION_PORTRAIT
            VoiceDockPreferenceOrientation.LANDSCAPE -> VOICE_DOCK_POSITION_LANDSCAPE
        }
        val parts = prefs.getString(key, null)?.split(',')
        val x = parts?.getOrNull(0)?.toFloatOrNull()
        val y = parts?.getOrNull(1)?.toFloatOrNull()
        return if (x != null && y != null && x.isFinite() && y.isFinite()) {
            x.coerceIn(0f, 1f) to y.coerceIn(0f, 1f)
        } else {
            1f to 0.72f
        }
    }

    fun setVoiceDockPosition(
        orientation: VoiceDockPreferenceOrientation,
        x: Float,
        y: Float,
    ) {
        val key = when (orientation) {
            VoiceDockPreferenceOrientation.PORTRAIT -> VOICE_DOCK_POSITION_PORTRAIT
            VoiceDockPreferenceOrientation.LANDSCAPE -> VOICE_DOCK_POSITION_LANDSCAPE
        }
        prefs.edit()
            .putString(key, "${x.coerceIn(0f, 1f)},${y.coerceIn(0f, 1f)}")
            .apply()
    }

    fun resetVoiceDockPosition(orientation: VoiceDockPreferenceOrientation) {
        val key = when (orientation) {
            VoiceDockPreferenceOrientation.PORTRAIT -> VOICE_DOCK_POSITION_PORTRAIT
            VoiceDockPreferenceOrientation.LANDSCAPE -> VOICE_DOCK_POSITION_LANDSCAPE
        }
        prefs.edit().remove(key).apply()
    }
}

enum class VoiceDockPreferenceOrientation { PORTRAIT, LANDSCAPE }
