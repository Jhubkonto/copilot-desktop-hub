package io.nexy.android.ui.chat

import org.json.JSONObject

internal data class CapabilitySelection(
    val skillIds: Set<String>,
    val mcpTrustByServer: Map<String, String>,
)

internal val capabilityTrustOptions = listOf(
    "always-ask" to "Ask every time",
    "auto" to "Auto — no prompt",
    "block" to "Blocked",
)

internal fun parseCapabilitySelection(profile: JSONObject): CapabilitySelection {
    val skillIds = profile.optJSONArray("skillIds")
        ?.let { array -> (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }.toSet() }
        ?: emptySet()
    val mcpTrustByServer = profile.optJSONArray("mcp")
        ?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val entry = array.optJSONObject(index) ?: return@mapNotNull null
                val serverId = entry.optString("serverId").takeIf(String::isNotBlank) ?: return@mapNotNull null
                val trust = entry.optString("trust").takeIf { value -> capabilityTrustOptions.any { it.first == value } }
                    ?: "always-ask"
                serverId to trust
            }.toMap()
        }
        ?: emptyMap()
    return CapabilitySelection(skillIds, mcpTrustByServer)
}

internal fun capabilitySelectionForScope(profileJson: String, preflightJson: String, scope: String): CapabilitySelection {
    val fallback = runCatching { JSONObject(profileJson) }.getOrDefault(JSONObject())
    val preflight = runCatching { JSONObject(preflightJson) }.getOrDefault(JSONObject())
    val scopedProfile = preflight.optJSONObject("scopeProfiles")?.optJSONObject(scope)
    return parseCapabilitySelection(scopedProfile ?: if (scope == "chat") fallback else JSONObject())
}
