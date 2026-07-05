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
        private const val PREFS_NAME = "nexy_preferences"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _preferStandaloneMode = MutableStateFlow(prefs.getBoolean(PREFER_STANDALONE_MODE, false))

    fun getPreferStandaloneMode(): Flow<Boolean> = _preferStandaloneMode

    fun setPreferStandaloneMode(value: Boolean) {
        prefs.edit().putBoolean(PREFER_STANDALONE_MODE, value).apply()
        _preferStandaloneMode.value = value
    }
}
