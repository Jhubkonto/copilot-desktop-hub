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
        private const val READ_ALOUD_ENABLED = "read_aloud_enabled"
        private const val PREFS_NAME = "nexy_preferences"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _preferStandaloneMode = MutableStateFlow(prefs.getBoolean(PREFER_STANDALONE_MODE, false))
    private val _readAloudEnabled = MutableStateFlow(prefs.getBoolean(READ_ALOUD_ENABLED, false))

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
}
