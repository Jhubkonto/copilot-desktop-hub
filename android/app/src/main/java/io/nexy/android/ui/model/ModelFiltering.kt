package io.nexy.android.ui.model

import io.nexy.android.data.EffectiveConnectionMode
import io.nexy.android.data.model.CliInstallInfo
import io.nexy.android.data.model.ModelOption

fun filterModelsForMode(
    models: List<ModelOption>,
    effectiveMode: EffectiveConnectionMode,
): List<ModelOption> {
    return when (effectiveMode) {
        EffectiveConnectionMode.STANDALONE_BY_CHOICE -> {
            models.filterNot { it.isCliSourced }
        }
        else -> models
    }
}

/**
 * Limits a chat model list to the backend forced by the selected agent. A forced CLI agent must
 * never inherit a provider/global model, even briefly while the model-list request is refreshing.
 */
fun filterModelsForBackend(
    models: List<ModelOption>,
    backend: String?,
): List<ModelOption> {
    if (backend.isNullOrBlank()) return models
    return models.filter { it.backend == backend }
}

/**
 * Splits models into "available now" vs. "requires desktop connection" for the Models settings
 * screen. Returns null when the split isn't meaningful (i.e. not standalone-by-choice), signaling
 * callers to render the flat, undifferentiated list instead.
 */
data class ModelAvailabilityGroups(
    val availableNow: List<ModelOption>,
    val requiresDesktop: List<ModelOption>,
)

fun partitionModelsByAvailability(
    models: List<ModelOption>,
    effectiveMode: EffectiveConnectionMode,
): ModelAvailabilityGroups? {
    if (effectiveMode != EffectiveConnectionMode.STANDALONE_BY_CHOICE) return null
    val (requiresDesktop, availableNow) = models.partition { it.isCliSourced }
    return ModelAvailabilityGroups(availableNow, requiresDesktop)
}

/**
 * Filters a model list down to options backed by a provider the device has a local key for —
 * used by the "Default model (Standalone)" picker in GlobalSettingsScreen. Vendor tags are
 * normalized (lowercase, spaces stripped) since desktop-reported labels ("OpenAI") and
 * live-fetched standalone labels (StandaloneChatService capitalizes only the first letter,
 * yielding "Openai") disagree on casing for multi-word provider names.
 */
fun filterModelsByConfiguredProviders(
    models: List<ModelOption>,
    configuredProviderIds: Set<String>,
): List<ModelOption> {
    return models.filter { model ->
        model.vendor?.lowercase()?.replace(" ", "") in configuredProviderIds
    }
}

/**
 * Whether generation defaults (temperature, max tokens) have a default model to apply to,
 * independent of the live connection — desktop mode just needs a previously-loaded model list;
 * standalone-by-choice needs at least one configured provider key on this device.
 */
fun hasResolvableDefaultModel(
    effectiveMode: EffectiveConnectionMode,
    hasModelOptions: Boolean,
    hasConfiguredProvider: Boolean,
): Boolean {
    return when (effectiveMode) {
        EffectiveConnectionMode.STANDALONE_BY_CHOICE -> hasConfiguredProvider
        else -> hasModelOptions
    }
}

/**
 * Resolves the CLI backend ("claude-cli"/"codex-cli") a model belongs to, based on its
 * desktop-reported vendor label. Used as a fallback for surfacing CLI-specific chat mode options
 * (e.g. Claude Code mode) when a CLI model is selected directly, without a preset agent locking
 * the conversation to that backend.
 */
fun cliBackendForModel(model: ModelOption?): String? {
    if (model?.isCliSourced != true) return null
    return when (model.vendor?.trim()?.lowercase()) {
        "claude cli" -> "claude-cli"
        "codex cli" -> "codex-cli"
        "hermes agent" -> "hermes-cli"
        else -> null
    }
}

/**
 * Entries rendered by ModelPickerSheet's LazyColumn — extracted from the composable so the
 * vendor-grouped vs. flat-list branching (and the mode filter feeding both) is unit-testable
 * without a Compose test harness.
 */
sealed class ModelSheetEntry {
    data class Header(val vendor: String, val unavailable: Boolean) : ModelSheetEntry()
    data class Item(val model: ModelOption, val unavailable: Boolean) : ModelSheetEntry()
}

fun buildModelSheetItems(
    models: List<ModelOption>,
    cliStatus: Map<String, CliInstallInfo>,
    effectiveMode: EffectiveConnectionMode,
    query: String,
): List<ModelSheetEntry> {
    val vendorUnavailable: (String) -> Boolean = { vendor ->
        val cliKey = vendor.removeSuffix(" CLI").lowercase()
        val info = cliStatus[cliKey]
        info != null && !info.installed
    }

    val normalizedQuery = query.trim().lowercase()
    val filteredModels = filterModelsForMode(models, effectiveMode)

    return buildList {
        val grouped = filteredModels.filterNot { it.id == "default" }.groupBy { it.vendor ?: "" }
        val hasVendorGroups = grouped.any { it.key.isNotBlank() }
        if (hasVendorGroups) {
            grouped.forEach { (vendor, vendorModels) ->
                val groupUnavailable = vendor.isNotBlank() && vendorUnavailable(vendor)
                val filtered = if (normalizedQuery.isEmpty()) vendorModels
                               else vendorModels.filter { it.label.lowercase().contains(normalizedQuery) }
                if (filtered.isNotEmpty()) {
                    if (vendor.isNotBlank()) add(ModelSheetEntry.Header(vendor, groupUnavailable))
                    filtered.forEach { add(ModelSheetEntry.Item(it, groupUnavailable)) }
                }
            }
        } else {
            filteredModels.forEach { model ->
                if (normalizedQuery.isEmpty() || model.label.lowercase().contains(normalizedQuery)) {
                    val modelUnavailable = model.vendor != null && vendorUnavailable(model.vendor)
                    add(ModelSheetEntry.Item(model, modelUnavailable))
                }
            }
        }
    }
}
