package io.nexy.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.net.URI

data class PairedServerConfig(
    val endpoint: String,
    val token: String,
) {
    val connectUrl: String
        get() = "$endpoint?token=$token"

    companion object {
        fun fromUrl(rawValue: String): PairedServerConfig? {
            val uri = runCatching { URI(rawValue.trim()) }.getOrNull() ?: return null
            val scheme = uri.scheme ?: return null
            val host = uri.host ?: return null
            val token = uri.rawQuery
                ?.split("&")
                ?.mapNotNull {
                    val parts = it.split("=", limit = 2)
                    if (parts.size == 2) parts[0] to parts[1] else null
                }
                ?.firstOrNull { it.first == "token" }
                ?.second
                ?.takeIf { it.isNotBlank() } ?: return null
            val port = if (uri.port >= 0) ":${uri.port}" else ""
            val path = uri.rawPath?.takeIf { it.isNotBlank() && it != "/" } ?: ""
            return PairedServerConfig(endpoint = "$scheme://$host$port$path", token = token)
        }
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
        val stored = runCatching {
            val endpoint = prefs.getString(KEY_ENDPOINT, null)
            val token = prefs.getString(KEY_TOKEN, null)
            if (!endpoint.isNullOrBlank() && !token.isNullOrBlank()) {
                PairedServerConfig(endpoint, token)
            } else {
                null
            }
        }.getOrElse {
            clear()
            null
        }
        if (stored != null) return stored

        val legacy = legacyPrefs.getString(LEGACY_KEY_LAST_WS_URL, null)
        val migrated = legacy?.let { PairedServerConfig.fromUrl(it) } ?: return null
        save(migrated)
        legacyPrefs.edit().remove(LEGACY_KEY_LAST_WS_URL).apply()
        return migrated
    }

    fun save(config: PairedServerConfig) {
        runCatching {
            prefs.edit()
            .putString(KEY_ENDPOINT, config.endpoint)
            .putString(KEY_TOKEN, config.token)
            .apply()
        }
    }

    fun clear() {
        runCatching { prefs.edit().clear().apply() }
            .onFailure { appContext.deleteSharedPreferences(PREFS_NAME) }
        legacyPrefs.edit().remove(LEGACY_KEY_LAST_WS_URL).apply()
    }

    companion object {
        private const val PREFS_NAME = "nexy_secure_pairing"
        private const val KEY_ENDPOINT = "endpoint"
        private const val KEY_TOKEN = "token"
        private const val LEGACY_PREFS_NAME = "nexy_prefs"
        private const val LEGACY_KEY_LAST_WS_URL = "last_ws_url"
    }
}
