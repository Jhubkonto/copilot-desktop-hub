package io.nexy.android.data

import org.json.JSONArray
import org.json.JSONObject

internal fun profilesToJson(profiles: List<PairedServerProfile>): String {
    val array = JSONArray()
    profiles.forEach { profile ->
        array.put(
            JSONObject()
                .put("id", profile.id)
                .put("endpoint", profile.endpoint)
                .put("token", profile.token)
                .put("name", profile.name)
                .put("lastUsedAt", profile.lastUsedAt)
                .put("certFingerprint", profile.certFingerprint),
        )
    }
    return array.toString()
}

internal fun profilesFromJson(raw: String): List<PairedServerProfile> {
    val array = JSONArray(raw)
    return (0 until array.length()).mapNotNull { index ->
        val obj = array.optJSONObject(index) ?: return@mapNotNull null
        val endpoint = obj.optString("endpoint").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        val token = obj.optString("token").takeIf { it.isNotBlank() } ?: return@mapNotNull null
        PairedServerProfile(
            id = obj.optString("id").takeIf { it.isNotBlank() } ?: PairedServerConfig.profileIdForEndpoint(endpoint),
            endpoint = endpoint,
            token = token,
            name = obj.optString("name").takeIf { it.isNotBlank() } ?: PairedServerConfig.displayNameForEndpoint(endpoint),
            lastUsedAt = obj.optLong("lastUsedAt", 0L),
            certFingerprint = obj.optString("certFingerprint").takeIf { it.isNotBlank() },
        )
    }.sortedByDescending { it.lastUsedAt }
}
