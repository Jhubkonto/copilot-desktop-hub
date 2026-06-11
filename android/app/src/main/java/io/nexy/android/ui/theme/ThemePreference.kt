package io.nexy.android.ui.theme

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class ThemePreference(val storedValue: String, val label: String) {
    System("system", "System"),
    Light("light", "Light"),
    Dark("dark", "Dark");

    companion object {
        fun fromStoredValue(value: String?): ThemePreference =
            entries.firstOrNull { it.storedValue == value } ?: System
    }
}

object ThemePreferenceStore {
    private const val PREFS_NAME = "nexy_preferences"
    private const val KEY_THEME = "theme_preference"

    private val _themePreference = MutableStateFlow(ThemePreference.System)
    val themePreference: StateFlow<ThemePreference> = _themePreference

    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        val stored = appContext
            ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.getString(KEY_THEME, null)
        _themePreference.value = ThemePreference.fromStoredValue(stored)
    }

    fun setThemePreference(preference: ThemePreference) {
        _themePreference.value = preference
        appContext
            ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.edit()
            ?.putString(KEY_THEME, preference.storedValue)
            ?.apply()
    }
}
