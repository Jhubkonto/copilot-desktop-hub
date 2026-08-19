package io.nexy.android.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class PreferenceStore private constructor(context: Context) {
    companion object {
        private var instance: PreferenceStore? = null

        fun getInstance(context: Context): PreferenceStore {
            return instance ?: PreferenceStore(context.applicationContext).also { instance = it }
        }

        private const val PREFER_STANDALONE_MODE = "prefer_standalone_mode"
        private const val EMERGENCY_STOP_ACTIVE = "emergency_stop_active"
        private const val HAS_COMPLETED_FIRST_LAUNCH = "has_completed_first_launch"
        private const val FEATURE_VOICE_DOCK_V1 = "feature_voice_dock_v1"
        private const val VOICE_DOCK_FLOATING = "voice_dock_floating"
        private const val VOICE_DOCK_TAP_MODE = "voice_dock_tap_mode"
        private const val VOICE_DOCK_HINT_SHOWN = "voice_dock_hint_shown"
        private const val VOICE_DOCK_POSITION_PORTRAIT = "voice_dock_position_portrait"
        private const val VOICE_DOCK_POSITION_LANDSCAPE = "voice_dock_position_landscape"
        private const val PREFS_NAME = "nexy_preferences"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _preferStandaloneMode = MutableStateFlow(prefs.getBoolean(PREFER_STANDALONE_MODE, false))
    private val _voiceDockV1 = MutableStateFlow(prefs.getBoolean(FEATURE_VOICE_DOCK_V1, true))

    fun getPreferStandaloneMode(): Flow<Boolean> = _preferStandaloneMode

    fun setPreferStandaloneMode(value: Boolean) {
        prefs.edit().putBoolean(PREFER_STANDALONE_MODE, value).apply()
        _preferStandaloneMode.value = value
    }

    /**
     * True once the branded splash has been shown at least once. Lets the app skip the splash on
     * every subsequent cold start — the Room cache is the durable source of truth, so a returning
     * user should land straight on Home instead of re-watching the logo animation on each relaunch.
     */
    fun hasCompletedFirstLaunch(): Boolean = prefs.getBoolean(HAS_COMPLETED_FIRST_LAUNCH, false)

    fun setFirstLaunchCompleted() {
        if (prefs.getBoolean(HAS_COMPLETED_FIRST_LAUNCH, false)) return
        prefs.edit().putBoolean(HAS_COMPLETED_FIRST_LAUNCH, true).apply()
    }

    fun isEmergencyStopActive(): Boolean = prefs.getBoolean(EMERGENCY_STOP_ACTIVE, false)

    fun setEmergencyStopActive(value: Boolean) {
        prefs.edit().putBoolean(EMERGENCY_STOP_ACTIVE, value).apply()
    }

    fun getVoiceDockV1(): Flow<Boolean> = _voiceDockV1

    fun setVoiceDockV1(value: Boolean) {
        prefs.edit().putBoolean(FEATURE_VOICE_DOCK_V1, value).apply()
        _voiceDockV1.value = value
    }

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
