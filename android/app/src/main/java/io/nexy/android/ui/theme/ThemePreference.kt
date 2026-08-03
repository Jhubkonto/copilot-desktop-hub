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

enum class UiStylePreference(val storedValue: String, val label: String) {
    Classic("classic", "Classic"),
    EightBit("8bit", "8-bit");

    companion object {
        fun fromStoredValue(value: String?): UiStylePreference =
            entries.firstOrNull { it.storedValue == value } ?: Classic
    }
}

object ThemePreferenceStore {
    private const val PREFS_NAME = "nexy_preferences"
    private const val KEY_THEME = "theme_preference"
    private const val KEY_UI_STYLE = "ui_style_preference"

    private val _themePreference = MutableStateFlow(ThemePreference.System)
    val themePreference: StateFlow<ThemePreference> = _themePreference
    private val _uiStylePreference = MutableStateFlow(UiStylePreference.Classic)
    val uiStylePreference: StateFlow<UiStylePreference> = _uiStylePreference

    private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        val stored = appContext
            ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.getString(KEY_THEME, null)
        _themePreference.value = ThemePreference.fromStoredValue(stored)
        val storedUiStyle = appContext
            ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.getString(KEY_UI_STYLE, null)
        _uiStylePreference.value = UiStylePreference.fromStoredValue(storedUiStyle)
    }

    fun setThemePreference(preference: ThemePreference) {
        _themePreference.value = preference
        appContext
            ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.edit()
            ?.putString(KEY_THEME, preference.storedValue)
            ?.apply()
    }

    fun setUiStylePreference(preference: UiStylePreference) {
        _uiStylePreference.value = preference
        appContext
            ?.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            ?.edit()
            ?.putString(KEY_UI_STYLE, preference.storedValue)
            ?.apply()
    }
}
