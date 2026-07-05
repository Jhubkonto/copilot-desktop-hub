package io.nexy.android.data

import org.json.JSONException
import org.json.JSONObject

/**
 * Versioned converter for provider-specific payloads (usage, thinking blocks, finish reasons).
 *
 * Problem: Different provider APIs evolve independently. A message sent to Anthropic v2024-06 may
 * have different usage shape than Anthropic v2025-01. If we store the raw payload, upgrading the
 * app (or the paired desktop's provider SDK) could silently lose or corrupt data.
 *
 * Solution: Each provider has a converter that:
 * 1. Normalizes raw API responses into stable app-internal format
 * 2. Versioning: tracks which API version produced the data
 * 3. Roundtripping: can reproduce the original data during sync
 * 4. Graceful degradation: unknown fields don't cause crashes
 *
 * Flow:
 * - On message completion: raw provider response → converter.normalize(payload) → store (version, normalized)
 * - On load: stored (version, normalized) → converter.denormalize(version, normalized) → use
 * - On sync: stored (version, normalized) → broadcast raw JSON (sufficient for other devices)
 */

interface ProviderPayloadConverter {
    val providerId: String

    /**
     * Convert raw provider API response to normalized internal format.
     * Must be idempotent and handle missing/unknown fields.
     */
    fun normalize(rawPayload: JSONObject): NormalizedUsage

    /**
     * Restore data from normalized internal format. Used when loading from room.
     * Must round-trip: denormalize(normalize(x)) ≈ x (modulo unknowns)
     */
    fun denormalize(normalized: NormalizedUsage): JSONObject

    /**
     * Detect the API version from raw payload. Used to pick the right converter version.
     * If unable to detect, return null and use default assumption.
     */
    fun detectVersion(rawPayload: JSONObject): String?
}

data class NormalizedUsage(
    val inputTokens: Int = 0,
    val outputTokens: Int = 0,
    val finishReason: String? = null,
    val thinkingTokens: Int? = null,
    val cacheReadTokens: Int? = null,
    val cacheWriteTokens: Int? = null,
    val version: String = "1.0",
    val originalFields: Map<String, Any> = emptyMap(),
)

class AnthropicPayloadConverter : ProviderPayloadConverter {
    override val providerId = "anthropic"

    override fun normalize(rawPayload: JSONObject): NormalizedUsage {
        return try {
            val usage = rawPayload.optJSONObject("usage") ?: return NormalizedUsage()
            val version = detectVersion(rawPayload) ?: "2024-06"

            val inputTokens = usage.optInt("input_tokens", 0)
            val outputTokens = usage.optInt("output_tokens", 0)
            val cacheReadTokensRaw = usage.optInt("cache_read_input_tokens", 0)
            val cacheReadTokens = if (cacheReadTokensRaw == 0) null else cacheReadTokensRaw
            val cacheWriteTokensRaw = usage.optInt("cache_creation_input_tokens", 0)
            val cacheWriteTokens = if (cacheWriteTokensRaw == 0) null else cacheWriteTokensRaw

            val stopReason = rawPayload.optString("stop_reason").takeIf(String::isNotBlank)

            NormalizedUsage(
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                finishReason = stopReason,
                cacheReadTokens = cacheReadTokens,
                cacheWriteTokens = cacheWriteTokens,
                version = version,
                originalFields = mapOf(
                    "usage" to (usage.toString()),
                    "stop_reason" to (stopReason ?: "unknown"),
                ),
            )
        } catch (e: JSONException) {
            NormalizedUsage()
        }
    }

    override fun denormalize(normalized: NormalizedUsage): JSONObject {
        val result = JSONObject()
        val usage = JSONObject()

        usage.put("input_tokens", normalized.inputTokens)
        usage.put("output_tokens", normalized.outputTokens)

        if (normalized.cacheReadTokens != null) {
            usage.put("cache_read_input_tokens", normalized.cacheReadTokens)
        }
        if (normalized.cacheWriteTokens != null) {
            usage.put("cache_creation_input_tokens", normalized.cacheWriteTokens)
        }

        result.put("usage", usage)
        if (normalized.finishReason != null) {
            result.put("stop_reason", normalized.finishReason)
        }

        return result
    }

    override fun detectVersion(rawPayload: JSONObject): String? {
        val usage = rawPayload.optJSONObject("usage") ?: return null
        // Anthropic added cache_* fields in 2024-11. Older APIs won't have them.
        return if (usage.has("cache_read_input_tokens")) "2024-11+" else "2024-06"
    }
}

class OpenAiPayloadConverter : ProviderPayloadConverter {
    override val providerId = "openai"

    override fun normalize(rawPayload: JSONObject): NormalizedUsage {
        return try {
            val usage = rawPayload.optJSONObject("usage") ?: return NormalizedUsage()
            val version = detectVersion(rawPayload) ?: "2024-12"

            val promptTokens = usage.optInt("prompt_tokens", 0)
            val completionTokens = usage.optInt("completion_tokens", 0)
            val reasoningTokensRaw = usage.optInt("reasoning_tokens", 0)
            val reasoningTokens = if (reasoningTokensRaw == 0) null else reasoningTokensRaw
            val promptCacheReadTokensRaw = usage.optInt("prompt_cache_read_tokens", 0)
            val promptCacheReadTokens = if (promptCacheReadTokensRaw == 0) null else promptCacheReadTokensRaw
            val promptCacheWriteTokensRaw = usage.optInt("prompt_cache_write_tokens", 0)
            val promptCacheWriteTokens = if (promptCacheWriteTokensRaw == 0) null else promptCacheWriteTokensRaw

            val choices = rawPayload.optJSONArray("choices") ?: return NormalizedUsage()
            val finishReason = choices.optJSONObject(0)?.optString("finish_reason")
                ?.takeIf(String::isNotBlank)

            NormalizedUsage(
                inputTokens = promptTokens,
                outputTokens = completionTokens,
                finishReason = finishReason,
                thinkingTokens = reasoningTokens,
                cacheReadTokens = promptCacheReadTokens,
                cacheWriteTokens = promptCacheWriteTokens,
                version = version,
                originalFields = mapOf(
                    "usage" to (usage.toString()),
                    "finish_reason" to (finishReason ?: "unknown"),
                ),
            )
        } catch (e: JSONException) {
            NormalizedUsage()
        }
    }

    override fun denormalize(normalized: NormalizedUsage): JSONObject {
        val result = JSONObject()
        val usage = JSONObject()

        usage.put("prompt_tokens", normalized.inputTokens)
        usage.put("completion_tokens", normalized.outputTokens)

        if (normalized.thinkingTokens != null) {
            usage.put("reasoning_tokens", normalized.thinkingTokens)
        }
        if (normalized.cacheReadTokens != null) {
            usage.put("prompt_cache_read_tokens", normalized.cacheReadTokens)
        }
        if (normalized.cacheWriteTokens != null) {
            usage.put("prompt_cache_write_tokens", normalized.cacheWriteTokens)
        }

        result.put("usage", usage)

        val choices = org.json.JSONArray()
        val choice = JSONObject()
        if (normalized.finishReason != null) {
            choice.put("finish_reason", normalized.finishReason)
        }
        choices.put(choice)
        result.put("choices", choices)

        return result
    }

    override fun detectVersion(rawPayload: JSONObject): String? {
        val usage = rawPayload.optJSONObject("usage") ?: return null
        // OpenAI added reasoning_tokens in late 2024 (o1 models).
        return if (usage.has("reasoning_tokens")) "2025-01+" else "2024-12"
    }
}

class OpenRouterPayloadConverter : ProviderPayloadConverter {
    override val providerId = "openrouter"

    private val openAiConverter = OpenAiPayloadConverter()

    // OpenRouter wraps OpenAI-compatible endpoints, but adds their own `native_tokens_used` field
    override fun normalize(rawPayload: JSONObject): NormalizedUsage {
        val usage = rawPayload.optJSONObject("usage") ?: return NormalizedUsage()
        val nativeTokens = usage.optJSONObject("native_tokens_used")

        return if (nativeTokens != null) {
            val normalized = openAiConverter.normalize(rawPayload)
            // If native_tokens is present, trust it over the wrapped usage
            normalized.copy(
                inputTokens = nativeTokens.optInt("prompt_tokens", normalized.inputTokens),
                outputTokens = nativeTokens.optInt("completion_tokens", normalized.outputTokens),
                version = "openrouter-native",
            )
        } else {
            openAiConverter.normalize(rawPayload).copy(version = "openrouter-wrapped")
        }
    }

    override fun denormalize(normalized: NormalizedUsage): JSONObject {
        return openAiConverter.denormalize(normalized)
    }

    override fun detectVersion(rawPayload: JSONObject): String? {
        val usage = rawPayload.optJSONObject("usage") ?: return null
        return if (usage.has("native_tokens_used")) "openrouter-native" else "openrouter-wrapped"
    }
}

object ProviderConverters {
    private val converters = mapOf(
        "anthropic" to AnthropicPayloadConverter(),
        "openai" to OpenAiPayloadConverter(),
        "openrouter" to OpenRouterPayloadConverter(),
    )

    fun converterFor(providerId: String): ProviderPayloadConverter? = converters[providerId]

    fun normalizePayload(providerId: String, rawPayload: JSONObject): NormalizedUsage {
        return converterFor(providerId)?.normalize(rawPayload) ?: NormalizedUsage()
    }

    fun denormalizePayload(providerId: String, normalized: NormalizedUsage): JSONObject {
        return converterFor(providerId)?.denormalize(normalized) ?: JSONObject()
    }

    fun allConverters(): List<ProviderPayloadConverter> = converters.values.toList()
}
