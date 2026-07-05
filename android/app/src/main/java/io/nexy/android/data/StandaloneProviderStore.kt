package io.nexy.android.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.nexy.android.data.model.ProviderInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class StandaloneProviderConfig(
    val provider: String,
    val apiKey: String,
    val baseUrl: String,
    val defaultModel: String,
)

class StandaloneProviderStore private constructor(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "nexy_standalone_providers",
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _providers = MutableStateFlow(providerInfos())
    val providers: StateFlow<List<ProviderInfo>> = _providers

    fun setKey(provider: String, key: String) {
        require(provider in SUPPORTED_PROVIDERS) { "Unsupported standalone provider: $provider" }
        preferences.edit().putString(keyName(provider), key.trim()).apply()
        _providers.value = providerInfos()
    }

    fun removeKey(provider: String) {
        preferences.edit().remove(keyName(provider)).apply()
        _providers.value = providerInfos()
    }

    fun hasKey(provider: String): Boolean = !preferences.getString(keyName(provider), null).isNullOrBlank()

    fun setDefault(provider: String, model: String) {
        require(provider in SUPPORTED_PROVIDERS)
        preferences.edit()
            .putString(KEY_DEFAULT_PROVIDER, provider)
            .putString(KEY_DEFAULT_MODEL, model.trim())
            .apply()
    }

    fun setBaseUrl(provider: String, baseUrl: String) {
        require(provider in SUPPORTED_PROVIDERS)
        preferences.edit().putString(baseUrlName(provider), baseUrl.trim().trimEnd('/')).apply()
    }

    fun resolve(modelOverride: String?): StandaloneProviderConfig? {
        val explicitModel = modelOverride?.takeIf { it.isNotBlank() && it != "default" }
        val preferred = when {
            explicitModel?.startsWith("claude-") == true -> "anthropic"
            explicitModel?.contains("/") == true && hasKey("openrouter") -> "openrouter"
            explicitModel?.startsWith("gpt-") == true || explicitModel?.startsWith("o") == true -> "openai"
            else -> preferences.getString(KEY_DEFAULT_PROVIDER, null)
        }
        val provider = sequenceOf(preferred, "anthropic", "openai", "openrouter")
            .filterNotNull()
            .distinct()
            .firstOrNull(::hasKey)
            ?: return null
        val key = preferences.getString(keyName(provider), null) ?: return null
        val model = explicitModel
            ?: preferences.getString(KEY_DEFAULT_MODEL, null)?.takeIf(String::isNotBlank)
            ?: DEFAULT_MODELS.getValue(provider)
        val baseUrl = preferences.getString(baseUrlName(provider), null)?.takeIf(String::isNotBlank)
            ?: DEFAULT_BASE_URLS.getValue(provider)
        return StandaloneProviderConfig(provider, key, baseUrl, model)
    }

    fun configured(): List<StandaloneProviderConfig> = SUPPORTED_PROVIDERS.mapNotNull { provider ->
        val key = preferences.getString(keyName(provider), null)?.takeIf(String::isNotBlank)
            ?: return@mapNotNull null
        StandaloneProviderConfig(
            provider = provider,
            apiKey = key,
            baseUrl = preferences.getString(baseUrlName(provider), null)?.takeIf(String::isNotBlank)
                ?: DEFAULT_BASE_URLS.getValue(provider),
            defaultModel = DEFAULT_MODELS.getValue(provider),
        )
    }

    private fun providerInfos(): List<ProviderInfo> = listOf(
        ProviderInfo("anthropic", "Anthropic", hasKey("anthropic")),
        ProviderInfo("openai", "OpenAI", hasKey("openai")),
        ProviderInfo("openrouter", "OpenRouter", hasKey("openrouter")),
    )

    private fun keyName(provider: String) = "api_key_$provider"
    private fun baseUrlName(provider: String) = "base_url_$provider"

    companion object {
        private val SUPPORTED_PROVIDERS = setOf("anthropic", "openai", "openrouter")
        private val DEFAULT_MODELS = mapOf(
            "anthropic" to "claude-sonnet-4-6",
            "openai" to "gpt-5.4",
            "openrouter" to "openai/gpt-5.4",
        )
        private val DEFAULT_BASE_URLS = mapOf(
            "anthropic" to "https://api.anthropic.com/v1",
            "openai" to "https://api.openai.com/v1",
            "openrouter" to "https://openrouter.ai/api/v1",
        )
        private const val KEY_DEFAULT_PROVIDER = "default_provider"
        private const val KEY_DEFAULT_MODEL = "default_model"

        @Volatile private var instance: StandaloneProviderStore? = null

        fun get(context: Context): StandaloneProviderStore =
            instance ?: synchronized(this) {
                instance ?: StandaloneProviderStore(context.applicationContext).also { instance = it }
            }
    }
}
