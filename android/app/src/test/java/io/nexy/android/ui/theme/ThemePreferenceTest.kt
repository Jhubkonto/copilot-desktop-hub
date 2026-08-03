package io.nexy.android.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Test

class ThemePreferenceTest {
    @Test
    fun `ui style parses independently from brightness preference`() {
        assertEquals(UiStylePreference.Classic, UiStylePreference.fromStoredValue(null))
        assertEquals(UiStylePreference.Classic, UiStylePreference.fromStoredValue("classic"))
        assertEquals(UiStylePreference.EightBit, UiStylePreference.fromStoredValue("8bit"))
        assertEquals(ThemePreference.Dark, ThemePreference.fromStoredValue("dark"))
    }

    @Test
    fun `unknown values use safe platform defaults`() {
        assertEquals(UiStylePreference.Classic, UiStylePreference.fromStoredValue("unknown"))
        assertEquals(ThemePreference.System, ThemePreference.fromStoredValue("unknown"))
    }
}
