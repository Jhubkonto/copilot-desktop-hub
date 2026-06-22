package io.nexy.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.net.URI
import java.security.MessageDigest

data class PairedServerConfig(
    val endpoint: String,
    val token: String,
    val certFingerprint: String? = null,
    // Additional endpoints to try in parallel when connecting (e.g. Tailscale IP).
    // Populated from v1 QR payloads; not persisted — they are transient connection hints.
    val fallbackEndpoints: List<String> = emptyList(),
) {
    val id: String
        get() = profileIdForEndpoint(endpoint)

    val displayName: String
        get() = displayNameForEndpoint(endpoint)

    val connectUrl: String
        get() = buildString {
            append("$endpoint?token=$token")
            if (!certFingerprint.isNullOrBlank()) append("&certFP=$certFingerprint")
        }

    fun fallbackConnectUrls(): List<String> = fallbackEndpoints.map { ep ->
        buildString {
            append("$ep?token=$token")
            if (!certFingerprint.isNullOrBlank()) append("&certFP=$certFingerprint")
        }
    }

    companion object {
        fun profileIdForEndpoint(endpoint: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(endpoint.trim().lowercase().toByteArray())
            return digest.take(12).joinToString("") { "%02x".format(it) }
        }

        fun displayNameForEndpoint(endpoint: String): String {
            val uri = runCatching { URI(endpoint) }.getOrNull()
            val host = uri?.host?.takeIf { it.isNotBlank() } ?: return endpoint
            val port = uri.port.takeIf { it >= 0 }?.let { ":$it" }.orEmpty()
            return "$host$port"
        }

        fun fromUrl(rawValue: String): PairedServerConfig? = parsePairedServerConfig(rawValue)
    }
}

data class PairedServerProfile(
    val id: String,
    val endpoint: String,
    val token: String,
    val name: String,
    val lastUsedAt: Long,
    val certFingerprint: String? = null,
    val macAddress: String? = null,
    val broadcastAddress: String? = null,
    val mDnsName: String? = null,
) {
    val connectUrl: String
        get() = buildString {
            append("$endpoint?token=$token")
            if (!certFingerprint.isNullOrBlank()) append("&certFP=$certFingerprint")
        }

    fun toConfig(): PairedServerConfig = PairedServerConfig(endpoint, token, certFingerprint)

    companion object {
        fun fromConfig(config: PairedServerConfig, now: Long = System.currentTimeMillis()): PairedServerProfile =
            PairedServerProfile(
                id = config.id,
                endpoint = config.endpoint,
                token = config.token,
                name = config.displayName,
                lastUsedAt = now,
                certFingerprint = config.certFingerprint,
            )
    }
}

class PairedServerStore(context: Context) {
    private val appContext = context.applicationContext
    private val legacyPrefs = context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
    private val prefs by lazy {
        EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun load(): PairedServerConfig? {
        val active = activeProfile()?.toConfig()
        if (active != null) return active

        val legacy = legacyPrefs.getString(LEGACY_KEY_LAST_WS_URL, null)
        val migrated = legacy?.let { PairedServerConfig.fromUrl(it) } ?: return null
        save(migrated)
        legacyPrefs.edit().remove(LEGACY_KEY_LAST_WS_URL).apply()
        return migrated
    }

    fun profiles(): List<PairedServerProfile> =
        runCatching { readProfiles() }.getOrElse {
            clear()
            emptyList()
        }

    fun activeProfileId(): String? = runCatching { prefs.getString(KEY_ACTIVE_PROFILE_ID, null) }.getOrNull()

    fun activeProfile(): PairedServerProfile? {
        val profiles = profiles()
        val activeId = activeProfileId()
        return profiles.firstOrNull { it.id == activeId } ?: profiles.firstOrNull()
    }

    fun save(config: PairedServerConfig) {
        runCatching {
            val existing = readProfiles().firstOrNull { it.id == config.id }
            val nextProfile = PairedServerProfile(
                id = config.id,
                endpoint = config.endpoint,
                token = config.token,
                name = existing?.name ?: config.displayName,
                lastUsedAt = System.currentTimeMillis(),
                // Prefer the new fingerprint, fall back to whatever was stored so we
                // never silently wipe a fingerprint that the new config omits.
                certFingerprint = config.certFingerprint ?: existing?.certFingerprint,
                // Preserve WoL / mDNS fields — they come in via the "connected" event,
                // not via the pairing URL, so they would be lost if we recreated fresh.
                macAddress = existing?.macAddress,
                broadcastAddress = existing?.broadcastAddress,
                mDnsName = existing?.mDnsName,
            )
            val nextProfiles = (readProfiles().filterNot { it.id == nextProfile.id } + nextProfile)
                .sortedByDescending { it.lastUsedAt }
            prefs.edit()
                .putString(KEY_PROFILES, profilesToJson(nextProfiles))
                .putString(KEY_ACTIVE_PROFILE_ID, nextProfile.id)
                .putString(KEY_ENDPOINT, config.endpoint)
                .putString(KEY_TOKEN, config.token)
                .apply()
        }
    }

    fun setActive(profileId: String): PairedServerConfig? {
        val profile = profiles().firstOrNull { it.id == profileId } ?: return null
        val updated = profile.copy(lastUsedAt = System.currentTimeMillis())
        val nextProfiles = (profiles().filterNot { it.id == profileId } + updated)
            .sortedByDescending { it.lastUsedAt }
        runCatching {
            prefs.edit()
                .putString(KEY_PROFILES, profilesToJson(nextProfiles))
                .putString(KEY_ACTIVE_PROFILE_ID, profileId)
                .putString(KEY_ENDPOINT, updated.endpoint)
                .putString(KEY_TOKEN, updated.token)
                .apply()
        }
        return updated.toConfig()
    }

    fun removeActive(): PairedServerConfig? {
        val activeId = activeProfile()?.id ?: return null
        return removeProfile(activeId)
    }

    fun removeProfile(profileId: String): PairedServerConfig? {
        val currentProfiles = profiles()
        val activeId = activeProfile()?.id
        val remaining = currentProfiles.filterNot { it.id == profileId }
        if (remaining.size == currentProfiles.size) {
            return activeProfile()?.toConfig()
        }
        val nextActive = if (activeId == profileId) {
            remaining.firstOrNull()
        } else {
            currentProfiles.firstOrNull { it.id == activeId }
        }
        runCatching {
            val editor = prefs.edit()
                .putString(KEY_PROFILES, profilesToJson(remaining))
            if (nextActive != null) {
                editor
                    .putString(KEY_ACTIVE_PROFILE_ID, nextActive.id)
                    .putString(KEY_ENDPOINT, nextActive.endpoint)
                    .putString(KEY_TOKEN, nextActive.token)
            } else {
                editor
                    .remove(KEY_ACTIVE_PROFILE_ID)
                    .remove(KEY_ENDPOINT)
                    .remove(KEY_TOKEN)
            }
            editor.apply()
        }
        return nextActive?.toConfig()
    }

    fun updateActiveProfileWolInfo(macAddress: String?, broadcastAddress: String?) {
        val activeId = activeProfile()?.id ?: return
        val updated = profiles().map { profile ->
            if (profile.id == activeId) profile.copy(macAddress = macAddress, broadcastAddress = broadcastAddress)
            else profile
        }
        runCatching {
            prefs.edit().putString(KEY_PROFILES, profilesToJson(updated)).apply()
        }
    }

    fun updateActiveProfileMdnsName(mDnsName: String?) {
        val activeId = activeProfile()?.id ?: return
        val updated = profiles().map { profile ->
            if (profile.id == activeId) profile.copy(mDnsName = mDnsName) else profile
        }
        runCatching {
            prefs.edit().putString(KEY_PROFILES, profilesToJson(updated)).apply()
        }
    }

    fun clear() {
        runCatching { prefs.edit().clear().apply() }
            .onFailure { appContext.deleteSharedPreferences(PREFS_NAME) }
        legacyPrefs.edit().remove(LEGACY_KEY_LAST_WS_URL).apply()
    }

    private fun readProfiles(): List<PairedServerProfile> {
        val profilesJson = prefs.getString(KEY_PROFILES, null)
        if (!profilesJson.isNullOrBlank()) return profilesFromJson(profilesJson)

        val endpoint = prefs.getString(KEY_ENDPOINT, null)
        val token = prefs.getString(KEY_TOKEN, null)
        if (endpoint.isNullOrBlank() || token.isNullOrBlank()) return emptyList()
        val migrated = PairedServerProfile.fromConfig(PairedServerConfig(endpoint, token))
        prefs.edit()
            .putString(KEY_PROFILES, profilesToJson(listOf(migrated)))
            .putString(KEY_ACTIVE_PROFILE_ID, migrated.id)
            .apply()
        return listOf(migrated)
    }

    companion object {
        private const val PREFS_NAME = "nexy_secure_pairing"
        private const val KEY_PROFILES = "profiles"
        private const val KEY_ACTIVE_PROFILE_ID = "active_profile_id"
        private const val KEY_ENDPOINT = "endpoint"
        private const val KEY_TOKEN = "token"
        private const val LEGACY_PREFS_NAME = "nexy_prefs"
        private const val LEGACY_KEY_LAST_WS_URL = "last_ws_url"
    }
}
