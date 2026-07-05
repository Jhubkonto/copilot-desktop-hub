package io.nexy.android.ui.model

import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.model.ModelOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelFilteringTest {

    private val apiModel = ModelOption("gpt-5-mini", "GPT-5 mini", "OpenAI", isCliSourced = false)
    private val cliModel = ModelOption("claude-sonnet-4-6", "Claude Sonnet 4.6", "Claude CLI", isCliSourced = true)

    @Test
    fun standaloneByChoiceHidesCliSourcedModels() {
        val result = filterModelsForMode(listOf(apiModel, cliModel), EffectiveConnectionMode.STANDALONE_BY_CHOICE)
        assertEquals(listOf(apiModel), result)
    }

    @Test
    fun connectedShowsAllModels() {
        val result = filterModelsForMode(listOf(apiModel, cliModel), EffectiveConnectionMode.CONNECTED)
        assertEquals(listOf(apiModel, cliModel), result)
    }

    @Test
    fun disconnectedShowsAllModels() {
        val result = filterModelsForMode(listOf(apiModel, cliModel), EffectiveConnectionMode.DISCONNECTED)
        assertEquals(listOf(apiModel, cliModel), result)
    }

    // Regression test for the ModelPickerSheet bug where the "no vendor groups" fallback
    // branch iterated the raw `models` list instead of the mode-filtered list, silently
    // defeating standalone-mode CLI filtering whenever none of the models had a vendor tag.
    @Test
    fun buildModelSheetItemsFiltersCliModelsInFallbackBranchWithNoVendorGroups() {
        val unvendoredApiModel = ModelOption("gpt-5-mini", "GPT-5 mini", vendor = null, isCliSourced = false)
        val unvendoredCliModel = ModelOption("claude-sonnet-4-6", "Claude Sonnet 4.6", vendor = null, isCliSourced = true)

        val items = buildModelSheetItems(
            models = listOf(unvendoredApiModel, unvendoredCliModel),
            cliStatus = emptyMap(),
            effectiveMode = EffectiveConnectionMode.STANDALONE_BY_CHOICE,
            query = "",
        )

        val modelIds = items.filterIsInstance<ModelSheetEntry.Item>().map { it.model.id }
        assertEquals(listOf("gpt-5-mini"), modelIds)
        assertFalse(modelIds.contains("claude-sonnet-4-6"))
    }

    @Test
    fun buildModelSheetItemsKeepsCliModelsWhenConnected() {
        val unvendoredApiModel = ModelOption("gpt-5-mini", "GPT-5 mini", vendor = null, isCliSourced = false)
        val unvendoredCliModel = ModelOption("claude-sonnet-4-6", "Claude Sonnet 4.6", vendor = null, isCliSourced = true)

        val items = buildModelSheetItems(
            models = listOf(unvendoredApiModel, unvendoredCliModel),
            cliStatus = emptyMap(),
            effectiveMode = EffectiveConnectionMode.CONNECTED,
            query = "",
        )

        val modelIds = items.filterIsInstance<ModelSheetEntry.Item>().map { it.model.id }
        assertTrue(modelIds.contains("claude-sonnet-4-6"))
        assertTrue(modelIds.contains("gpt-5-mini"))
    }

    @Test
    fun buildModelSheetItemsFiltersCliModelsInVendorGroupedBranch() {
        val items = buildModelSheetItems(
            models = listOf(apiModel, cliModel),
            cliStatus = emptyMap(),
            effectiveMode = EffectiveConnectionMode.STANDALONE_BY_CHOICE,
            query = "",
        )

        val modelIds = items.filterIsInstance<ModelSheetEntry.Item>().map { it.model.id }
        assertEquals(listOf("gpt-5-mini"), modelIds)
    }

    @Test
    fun buildModelSheetItemsAppliesSearchQuery() {
        val items = buildModelSheetItems(
            models = listOf(apiModel, cliModel),
            cliStatus = emptyMap(),
            effectiveMode = EffectiveConnectionMode.CONNECTED,
            query = "claude",
        )

        val modelIds = items.filterIsInstance<ModelSheetEntry.Item>().map { it.model.id }
        assertEquals(listOf("claude-sonnet-4-6"), modelIds)
    }

    @Test
    fun partitionModelsByAvailabilityReturnsNullWhenNotStandaloneByChoice() {
        assertEquals(null, partitionModelsByAvailability(listOf(apiModel, cliModel), EffectiveConnectionMode.CONNECTED))
        assertEquals(null, partitionModelsByAvailability(listOf(apiModel, cliModel), EffectiveConnectionMode.DISCONNECTED))
        assertEquals(null, partitionModelsByAvailability(listOf(apiModel, cliModel), EffectiveConnectionMode.CONNECTING))
    }

    @Test
    fun partitionModelsByAvailabilitySplitsCliVsApiWhenStandaloneByChoice() {
        val groups = partitionModelsByAvailability(listOf(apiModel, cliModel), EffectiveConnectionMode.STANDALONE_BY_CHOICE)

        assertEquals(listOf(apiModel), groups?.availableNow)
        assertEquals(listOf(cliModel), groups?.requiresDesktop)
    }

    @Test
    fun partitionModelsByAvailabilityHandlesAllCliModels() {
        val groups = partitionModelsByAvailability(listOf(cliModel), EffectiveConnectionMode.STANDALONE_BY_CHOICE)

        assertTrue(groups?.availableNow?.isEmpty() == true)
        assertEquals(listOf(cliModel), groups?.requiresDesktop)
    }

    // --- filterModelsByConfiguredProviders (GlobalSettingsScreen standalone dropdown) ---

    @Test
    fun filterModelsByConfiguredProvidersKeepsOnlyConfiguredVendors() {
        val anthropicModel = ModelOption("claude-sonnet-4-6", "Claude Sonnet 4.6", vendor = "Anthropic")
        val openAiModel = ModelOption("gpt-5.4", "GPT-5.4", vendor = "OpenAI")
        val unconfiguredModel = ModelOption("gemini-pro", "Gemini Pro", vendor = "Google")

        val result = filterModelsByConfiguredProviders(
            models = listOf(anthropicModel, openAiModel, unconfiguredModel),
            configuredProviderIds = setOf("anthropic"),
        )

        assertEquals(listOf(anthropicModel), result)
    }

    @Test
    fun filterModelsByConfiguredProvidersNormalizesCasingMismatch() {
        // StandaloneChatService.listModels only capitalizes the first letter ("Openai",
        // "Openrouter"), while desktop-reported vendors use full product casing ("OpenAI",
        // "OpenRouter"). Both must match against the lowercase provider id "openai"/"openrouter".
        val desktopReported = ModelOption("gpt-5.4", "GPT-5.4", vendor = "OpenAI")
        val standaloneLiveFetched = ModelOption("gpt-5.4", "GPT-5.4", vendor = "Openai")

        assertEquals(listOf(desktopReported), filterModelsByConfiguredProviders(listOf(desktopReported), setOf("openai")))
        assertEquals(listOf(standaloneLiveFetched), filterModelsByConfiguredProviders(listOf(standaloneLiveFetched), setOf("openai")))
    }

    @Test
    fun filterModelsByConfiguredProvidersExcludesCliSourcedModels() {
        // CLI vendor tags ("Claude CLI" -> "claudecli") never match a StandaloneProviderStore id.
        val result = filterModelsByConfiguredProviders(listOf(cliModel), setOf("anthropic", "openai", "openrouter"))
        assertTrue(result.isEmpty())
    }

    @Test
    fun filterModelsByConfiguredProvidersReturnsEmptyWhenNoProvidersConfigured() {
        val result = filterModelsByConfiguredProviders(listOf(apiModel), configuredProviderIds = emptySet())
        assertTrue(result.isEmpty())
    }

    // --- hasResolvableDefaultModel (Item 8: temp/max-tokens gating truth table) ---

    @Test
    fun hasResolvableDefaultModelInStandaloneByChoiceDependsOnlyOnConfiguredProvider() {
        assertTrue(hasResolvableDefaultModel(EffectiveConnectionMode.STANDALONE_BY_CHOICE, hasModelOptions = false, hasConfiguredProvider = true))
        assertFalse(hasResolvableDefaultModel(EffectiveConnectionMode.STANDALONE_BY_CHOICE, hasModelOptions = true, hasConfiguredProvider = false))
    }

    @Test
    fun hasResolvableDefaultModelInOtherModesDependsOnlyOnModelOptions() {
        for (mode in listOf(
            EffectiveConnectionMode.CONNECTED,
            EffectiveConnectionMode.CONNECTING,
            EffectiveConnectionMode.SEARCHING,
            EffectiveConnectionMode.DISCONNECTED,
        )) {
            assertTrue(hasResolvableDefaultModel(mode, hasModelOptions = true, hasConfiguredProvider = false))
            assertFalse(hasResolvableDefaultModel(mode, hasModelOptions = false, hasConfiguredProvider = true))
        }
    }

    @Test
    fun hasResolvableDefaultModelFalseWhenNothingAvailable() {
        assertFalse(hasResolvableDefaultModel(EffectiveConnectionMode.CONNECTED, hasModelOptions = false, hasConfiguredProvider = false))
        assertFalse(hasResolvableDefaultModel(EffectiveConnectionMode.STANDALONE_BY_CHOICE, hasModelOptions = false, hasConfiguredProvider = false))
    }
}
