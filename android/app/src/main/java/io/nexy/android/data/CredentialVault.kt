package io.nexy.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/** Metadata that is safe to display or include in non-secret device state. */
data class CredentialMetadata(
    val id: String,
    val name: String,
    val kind: String,
    val provider: String?,
    val fingerprint: String,
    val createdAt: Long,
    val updatedAt: Long,
    val lastUsedAt: Long?,
    val revokedAt: Long?,
)

/** Secret-free project/agent permission metadata mirrored from the desktop or stored locally. */
data class CredentialBindingMetadata(
    val id: String,
    val credentialId: String,
    val projectId: String?,
    val agentId: String?,
    val capability: String,
    val approvalMode: String,
    val expiresAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
)

/**
 * Device-local credential storage.
 *
 * Secret payloads are kept in EncryptedSharedPreferences, backed by an Android
 * Keystore MasterKey. Only metadata is returned by listMetadata(). Secret
 * resolution is intentionally limited to the local provider execution path.
 */
class CredentialVault private constructor(context: Context) {
    private val preferences = encryptedPreferences(context, VAULT_PREFERENCES)
    private val legacyPreferences = encryptedPreferences(context, LEGACY_PREFERENCES)

    init {
        migrateLegacyProviderKeys()
    }

    fun listMetadata(): List<CredentialMetadata> = credentialIds()
        .mapNotNull(::readMetadata)
        .sortedBy { it.name.lowercase() }

    fun listBindings(): List<CredentialBindingMetadata> = readBindings(KEY_LOCAL_BINDINGS)

    fun createBinding(
        credentialId: String,
        projectId: String?,
        agentId: String?,
        capability: String,
        approvalMode: String = APPROVAL_AUTO,
        expiresAt: Long? = null,
    ): CredentialBindingMetadata {
        require(readMetadata(credentialId) != null) { "Credential not found" }
        validateBinding(capability, approvalMode, expiresAt)
        val now = System.currentTimeMillis()
        val binding = CredentialBindingMetadata(
            id = UUID.randomUUID().toString(),
            credentialId = credentialId,
            projectId = projectId.normalizedId(),
            agentId = agentId.normalizedId(),
            capability = capability.trim(),
            approvalMode = approvalMode,
            expiresAt = expiresAt,
            createdAt = now,
            updatedAt = now,
        )
        writeBindings(KEY_LOCAL_BINDINGS, listBindings() + binding)
        return binding
    }

    fun deleteBinding(id: String): Boolean {
        val current = listBindings()
        val next = current.filterNot { it.id == id }
        if (next.size == current.size) return false
        writeBindings(KEY_LOCAL_BINDINGS, next)
        return true
    }

    /** Applies desktop binding metadata only; no desktop credential payload is accepted. */
    fun applyRemoteMetadata(credentials: JSONArray?, bindings: JSONArray?) {
        val remoteCredentials = JSONArray()
        for (index in 0 until (credentials?.length() ?: 0)) {
            val item = credentials?.optJSONObject(index) ?: continue
            remoteCredentials.put(JSONObject()
                .put("id", item.optString("id"))
                .put("provider", item.optString("provider").takeIf { it.isNotBlank() })
                .put("revokedAt", if (item.isNull("revokedAt")) JSONObject.NULL else item.optLong("revokedAt")))
        }
        val remoteBindings = JSONArray()
        for (index in 0 until (bindings?.length() ?: 0)) {
            val item = bindings?.optJSONObject(index) ?: continue
            remoteBindings.put(JSONObject()
                .put("id", item.optString("id"))
                .put("credentialId", item.optString("credentialId"))
                .put("projectId", if (item.isNull("projectId")) JSONObject.NULL else item.optString("projectId"))
                .put("agentId", if (item.isNull("agentId")) JSONObject.NULL else item.optString("agentId"))
                .put("capability", item.optString("capability"))
                .put("approvalMode", item.optString("approvalMode", APPROVAL_AUTO))
                .put("expiresAt", if (item.isNull("expiresAt")) JSONObject.NULL else item.optLong("expiresAt")))
        }
        preferences.edit()
            .putString(KEY_REMOTE_CREDENTIALS, remoteCredentials.toString())
            .putString(KEY_REMOTE_BINDINGS, remoteBindings.toString())
            .apply()
    }

    fun createCredential(
        name: String,
        kind: String,
        provider: String?,
        value: String,
    ): CredentialMetadata {
        val normalizedName = name.trim().also { require(it.isNotEmpty()) { "Credential name is required" } }
        require(kind in SUPPORTED_KINDS) { "Unsupported credential kind: $kind" }
        require(value.isNotEmpty()) { "Credential value is required" }
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        writeRecord(
            id = id,
            name = normalizedName,
            kind = kind,
            provider = provider?.trim()?.takeIf(String::isNotEmpty),
            value = value,
            createdAt = now,
            updatedAt = now,
            lastUsedAt = null,
            revokedAt = null,
        )
        return checkNotNull(readMetadata(id))
    }

    fun updateCredential(
        id: String,
        name: String? = null,
        value: String? = null,
        revoked: Boolean? = null,
    ): CredentialMetadata {
        val existing = checkNotNull(readMetadata(id)) { "Credential not found" }
        val nextName = name?.trim()?.also { require(it.isNotEmpty()) { "Credential name is required" } } ?: existing.name
        value?.let { require(it.isNotEmpty()) { "Credential value is required" } }
        val now = System.currentTimeMillis()
        writeRecord(
            id = id,
            name = nextName,
            kind = existing.kind,
            provider = existing.provider,
            value = value ?: requireNotNull(readSecret(id)),
            createdAt = existing.createdAt,
            updatedAt = now,
            lastUsedAt = existing.lastUsedAt,
            revokedAt = when (revoked) {
                null -> existing.revokedAt
                true -> existing.revokedAt ?: now
                false -> null
            },
        )
        return checkNotNull(readMetadata(id))
    }

    fun deleteCredential(id: String): Boolean {
        if (readMetadata(id) == null) return false
        val ids = credentialIds().toMutableSet().apply { remove(id) }
        preferences.edit()
            .putStringSet(KEY_IDS, ids)
            .remove(field(id, FIELD_NAME))
            .remove(field(id, FIELD_KIND))
            .remove(field(id, FIELD_PROVIDER))
            .remove(field(id, FIELD_FINGERPRINT))
            .remove(field(id, FIELD_CREATED_AT))
            .remove(field(id, FIELD_UPDATED_AT))
            .remove(field(id, FIELD_LAST_USED_AT))
            .remove(field(id, FIELD_REVOKED_AT))
            .remove(field(id, FIELD_SECRET))
            .apply()
        return true
    }

    /** Main-process-equivalent local resolution; never used for synced metadata. */
    fun resolveCredential(id: String): String? {
        val metadata = readMetadata(id) ?: return null
        if (metadata.revokedAt != null) return null
        val secret = readSecret(id) ?: return null
        preferences.edit().putString(field(id, FIELD_LAST_USED_AT), System.currentTimeMillis().toString()).apply()
        return secret
    }

    fun upsertApiKey(provider: String, value: String) {
        require(value.trim().isNotEmpty()) { "Credential value is required" }
        val existing = listMetadata().firstOrNull { it.kind == KIND_API_KEY && it.provider == provider }
        if (existing == null) {
            createCredential("$provider API key", KIND_API_KEY, provider, value.trim())
        } else {
            updateCredential(existing.id, value = value.trim(), revoked = false)
        }
    }

    fun removeApiKey(provider: String) {
        listMetadata()
            .filter { it.kind == KIND_API_KEY && it.provider == provider }
            .forEach { deleteCredential(it.id) }
    }

    fun hasApiKey(provider: String, projectId: String? = null, agentId: String? = null): Boolean = listMetadata().any {
        it.kind == KIND_API_KEY && it.provider == provider && it.revokedAt == null && readSecret(it.id)?.isNotBlank() == true
            && isAuthorized(it.id, provider, projectId, agentId, "provider:$provider")
    }

    fun resolveApiKey(provider: String): String? = listMetadata()
        .firstOrNull { it.kind == KIND_API_KEY && it.provider == provider && it.revokedAt == null }
        ?.let { resolveCredential(it.id) }

    fun apiKeyCredentialId(provider: String, projectId: String? = null, agentId: String? = null): String? = listMetadata()
        .firstOrNull { it.kind == KIND_API_KEY && it.provider == provider && it.revokedAt == null
            && isAuthorized(it.id, provider, projectId, agentId, "provider:$provider") }
        ?.id

    private fun isAuthorized(
        credentialId: String,
        provider: String?,
        projectId: String?,
        agentId: String?,
        capability: String,
    ): Boolean {
        val local = listBindings().filter { it.credentialId == credentialId && it.capability == capability }
        val remoteCredentialIds = readRemoteCredentials().filter { it.second == provider }.map { it.first }.toSet()
        val remote = readBindings(KEY_REMOTE_BINDINGS).filter { it.credentialId in remoteCredentialIds && it.capability == capability }
        val bindings = local + remote
        if (bindings.isEmpty()) return true
        return bindings.any { binding ->
            binding.approvalMode == APPROVAL_AUTO
                && (binding.expiresAt == null || binding.expiresAt > System.currentTimeMillis())
                && (binding.projectId == null || binding.projectId == projectId)
                && (binding.agentId == null || binding.agentId == agentId)
        }
    }

    private fun readRemoteCredentials(): List<Pair<String, String?>> {
        val array = runCatching { JSONArray(preferences.getString(KEY_REMOTE_CREDENTIALS, "[]")) }.getOrDefault(JSONArray())
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            item.optString("id").takeIf { it.isNotBlank() }?.let { it to item.optString("provider").takeIf(String::isNotBlank) }
        }
    }

    private fun readBindings(key: String): List<CredentialBindingMetadata> {
        val array = runCatching { JSONArray(preferences.getString(key, "[]")) }.getOrDefault(JSONArray())
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val id = item.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            CredentialBindingMetadata(
                id = id,
                credentialId = item.optString("credentialId"),
                projectId = item.optString("projectId").takeIf(String::isNotBlank),
                agentId = item.optString("agentId").takeIf(String::isNotBlank),
                capability = item.optString("capability"),
                approvalMode = item.optString("approvalMode", APPROVAL_AUTO),
                expiresAt = item.takeUnless { it.isNull("expiresAt") }?.optLong("expiresAt"),
                createdAt = item.optLong("createdAt", 0L),
                updatedAt = item.optLong("updatedAt", 0L),
            )
        }
    }

    private fun writeBindings(key: String, bindings: List<CredentialBindingMetadata>) {
        val array = JSONArray()
        bindings.forEach { binding ->
            array.put(JSONObject()
                .put("id", binding.id)
                .put("credentialId", binding.credentialId)
                .put("projectId", binding.projectId ?: JSONObject.NULL)
                .put("agentId", binding.agentId ?: JSONObject.NULL)
                .put("capability", binding.capability)
                .put("approvalMode", binding.approvalMode)
                .put("expiresAt", binding.expiresAt ?: JSONObject.NULL)
                .put("createdAt", binding.createdAt)
                .put("updatedAt", binding.updatedAt))
        }
        preferences.edit().putString(key, array.toString()).apply()
    }

    private fun validateBinding(capability: String, approvalMode: String, expiresAt: Long?) {
        require(capability.trim().isNotEmpty()) { "Credential capability is required" }
        require(approvalMode == APPROVAL_AUTO || approvalMode == APPROVAL_ALWAYS_ASK) { "Unsupported credential approval mode" }
        require(expiresAt == null || expiresAt > System.currentTimeMillis()) { "Credential binding expiry must be in the future" }
    }

    private fun migrateLegacyProviderKeys() {
        if (preferences.getBoolean(KEY_MIGRATED_V1, false)) return
        val editor = preferences.edit()
        for (provider in LEGACY_PROVIDERS) {
            val value = legacyPreferences.getString("api_key_$provider", null)?.trim()
            if (!value.isNullOrEmpty() && !hasApiKey(provider)) {
                val now = System.currentTimeMillis()
                val id = stableProviderId(provider)
                writeRecord(
                    id = id,
                    name = "$provider API key",
                    kind = KIND_API_KEY,
                    provider = provider,
                    value = value,
                    createdAt = now,
                    updatedAt = now,
                    lastUsedAt = null,
                    revokedAt = null,
                )
                legacyPreferences.edit().remove("api_key_$provider").apply()
            }
        }
        editor.putBoolean(KEY_MIGRATED_V1, true).apply()
    }

    private fun writeRecord(
        id: String,
        name: String,
        kind: String,
        provider: String?,
        value: String,
        createdAt: Long,
        updatedAt: Long,
        lastUsedAt: Long?,
        revokedAt: Long?,
    ) {
        val ids = credentialIds().toMutableSet().apply { add(id) }
        preferences.edit()
            .putStringSet(KEY_IDS, ids)
            .putString(field(id, FIELD_NAME), name)
            .putString(field(id, FIELD_KIND), kind)
            .putString(field(id, FIELD_PROVIDER), provider)
            .putString(field(id, FIELD_FINGERPRINT), fingerprint(value))
            .putLong(field(id, FIELD_CREATED_AT), createdAt)
            .putLong(field(id, FIELD_UPDATED_AT), updatedAt)
            .putString(field(id, FIELD_LAST_USED_AT), lastUsedAt?.toString())
            .putString(field(id, FIELD_REVOKED_AT), revokedAt?.toString())
            .putString(field(id, FIELD_SECRET), value)
            .apply()
    }

    private fun readMetadata(id: String): CredentialMetadata? {
        val name = preferences.getString(field(id, FIELD_NAME), null) ?: return null
        return CredentialMetadata(
            id = id,
            name = name,
            kind = preferences.getString(field(id, FIELD_KIND), null) ?: return null,
            provider = preferences.getString(field(id, FIELD_PROVIDER), null),
            fingerprint = preferences.getString(field(id, FIELD_FINGERPRINT), "") ?: "",
            createdAt = preferences.getLong(field(id, FIELD_CREATED_AT), 0L),
            updatedAt = preferences.getLong(field(id, FIELD_UPDATED_AT), 0L),
            lastUsedAt = preferences.getString(field(id, FIELD_LAST_USED_AT), null)?.toLongOrNull(),
            revokedAt = preferences.getString(field(id, FIELD_REVOKED_AT), null)?.toLongOrNull(),
        )
    }

    private fun readSecret(id: String): String? = preferences.getString(field(id, FIELD_SECRET), null)

    private fun credentialIds(): Set<String> = preferences.getStringSet(KEY_IDS, emptySet()).orEmpty()

    private fun field(id: String, field: String): String = "credential_${id}_$field"

    companion object {
        private const val VAULT_PREFERENCES = "nexy_credential_vault"
        private const val LEGACY_PREFERENCES = "nexy_standalone_providers"
        private const val KEY_IDS = "credential_ids"
        private const val KEY_MIGRATED_V1 = "migrated_provider_keys_v1"
        private const val KEY_LOCAL_BINDINGS = "credential_bindings"
        private const val KEY_REMOTE_CREDENTIALS = "remote_credential_metadata"
        private const val KEY_REMOTE_BINDINGS = "remote_credential_bindings"
        private const val APPROVAL_AUTO = "auto"
        private const val APPROVAL_ALWAYS_ASK = "always-ask"
        private const val KIND_API_KEY = "api-key"
        private const val FIELD_NAME = "name"
        private const val FIELD_KIND = "kind"
        private const val FIELD_PROVIDER = "provider"
        private const val FIELD_FINGERPRINT = "fingerprint"
        private const val FIELD_CREATED_AT = "created_at"
        private const val FIELD_UPDATED_AT = "updated_at"
        private const val FIELD_LAST_USED_AT = "last_used_at"
        private const val FIELD_REVOKED_AT = "revoked_at"
        private const val FIELD_SECRET = "secret"
        private val SUPPORTED_KINDS = setOf("api-key", "token", "password", "secret-file", "env-bundle")
        private val LEGACY_PROVIDERS = setOf("anthropic", "openai", "openrouter")

        @Volatile private var instance: CredentialVault? = null

        fun get(context: Context): CredentialVault = instance ?: synchronized(this) {
            instance ?: CredentialVault(context.applicationContext).also { instance = it }
        }

        private fun encryptedPreferences(context: Context, name: String) = EncryptedSharedPreferences.create(
            context,
            name,
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

        private fun stableProviderId(provider: String): String = "provider-api-key-$provider"

        private fun fingerprint(value: String): String = MessageDigest
            .getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(16)
    }
}

private fun String?.normalizedId(): String? = this?.trim()?.takeIf(String::isNotEmpty)
