package io.nexy.android.ui.settings

import io.nexy.android.data.model.ProviderInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression coverage for item 7 of the UX correctness roadmap: ProvidersScreen (merged
 * local+desktop list) and GlobalSettingsScreen (local-only list) previously disagreed on
 * whether a provider was "configured" — the merged list treated desktop's flag as
 * sufficient, so it showed "Connected" for providers with no usable local key, while
 * GlobalSettingsScreen (correctly, local-only) still greyed them out. `configured` must
 * now always mean "usable on this device," with `configuredOnDesktopOnly` carrying the
 * separate "known but not usable here" signal.
 */
class ProviderMergeTest {

    @Test
    fun localKeyWinsOverDesktopFlag_configuredMeansUsableHere() {
        val local = listOf(ProviderInfo("anthropic", "Anthropic", configured = true))
        val remote = listOf(ProviderInfo("anthropic", "Anthropic", configured = true))

        val merged = mergeProviderLists(local, remote)

        val anthropic = merged.single { it.id == "anthropic" }
        assertTrue(anthropic.configured)
        assertFalse(anthropic.configuredOnDesktopOnly)
    }

    @Test
    fun desktopOnlyKeyIsNeverReportedAsConfiguredLocally() {
        val local = listOf(ProviderInfo("anthropic", "Anthropic", configured = false))
        val remote = listOf(ProviderInfo("anthropic", "Anthropic", configured = true))

        val merged = mergeProviderLists(local, remote)

        val anthropic = merged.single { it.id == "anthropic" }
        assertFalse("configured must require a real local key, not just desktop's flag", anthropic.configured)
        assertTrue(anthropic.configuredOnDesktopOnly)
    }

    @Test
    fun notConfiguredAnywhereIsNeitherStateSet() {
        val local = listOf(ProviderInfo("anthropic", "Anthropic", configured = false))
        val remote = listOf(ProviderInfo("anthropic", "Anthropic", configured = false))

        val merged = mergeProviderLists(local, remote)

        val anthropic = merged.single { it.id == "anthropic" }
        assertFalse(anthropic.configured)
        assertFalse(anthropic.configuredOnDesktopOnly)
    }

    @Test
    fun desktopOnlyProviderWithNoLocalEntryPassesThroughUnchanged() {
        // e.g. "azure" has no standalone/local equivalent at all — it only ever appears
        // in the desktop-reported list, never in StandaloneProviderStore's local list.
        val local = emptyList<ProviderInfo>()
        val remote = listOf(ProviderInfo("azure", "Azure OpenAI", configured = true))

        val merged = mergeProviderLists(local, remote)

        val azure = merged.single { it.id == "azure" }
        assertTrue(azure.configured)
        assertFalse(azure.configuredOnDesktopOnly)
    }

    @Test
    fun resultIsSortedByLabel() {
        val local = listOf(
            ProviderInfo("openrouter", "OpenRouter", configured = false),
            ProviderInfo("anthropic", "Anthropic", configured = true),
        )
        val remote = emptyList<ProviderInfo>()

        val merged = mergeProviderLists(local, remote)

        assertEquals(listOf("Anthropic", "OpenRouter"), merged.map { it.label })
    }
}
