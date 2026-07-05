package io.nexy.android.data

import io.nexy.android.data.local.MessageEntity
import org.json.JSONObject

/**
 * Bridges between MessageEntity storage (normalized tokens + metadata) and provider-specific
 * payload formats. Handles versioning and graceful degradation.
 *
 * Storage format in MessageEntity:
 * - inputTokens, outputTokens: Normalized counts
 * - provider: Provider ID (e.g., "anthropic", "openai")
 * - finishReason: Standardized reason (e.g., "stop", "max_tokens")
 * - model: Model name for reference
 * - metadataJson: Raw payload blob (for round-tripping and debugging)
 *
 * The metadataJson field is a JSON object containing:
 * {
 *   "payloadVersion": "1.0",
 *   "apiVersion": "2024-11+",
 *   "provider": "anthropic",
 *   "rawUsage": { original normalized usage... },
 *   "originalFields": { any unknown fields for future-proofing }
 * }
 */

object MessagePayloadStore {

    fun encodeProviderPayload(
        provider: String?,
        rawPayload: JSONObject,
        model: String? = null,
    ): Map<String, Any?> {
        if (provider == null) {
            return mapOf(
                "inputTokens" to (0 as Any),
                "outputTokens" to (0 as Any),
                "finishReason" to (null as Any?),
            )
        }

        val normalized = ProviderConverters.normalizePayload(provider, rawPayload)
        val converter = ProviderConverters.converterFor(provider)
        val apiVersion = converter?.detectVersion(rawPayload) ?: "unknown"

        val metadata = JSONObject().apply {
            put("payloadVersion", "1.0")
            put("apiVersion", apiVersion)
            put("provider", provider)
            put("rawUsage", normalized.let { n ->
                JSONObject().apply {
                    put("inputTokens", n.inputTokens)
                    put("outputTokens", n.outputTokens)
                    put("finishReason", n.finishReason ?: JSONObject.NULL)
                    if (n.thinkingTokens != null) {
                        put("thinkingTokens", n.thinkingTokens)
                    }
                    if (n.cacheReadTokens != null) {
                        put("cacheReadTokens", n.cacheReadTokens)
                    }
                    if (n.cacheWriteTokens != null) {
                        put("cacheWriteTokens", n.cacheWriteTokens)
                    }
                }
            })
            put("originalFields", normalized.originalFields.let { fields ->
                JSONObject().apply {
                    fields.forEach { (k, v) -> put(k, v) }
                }
            })
        }

        return mapOf(
            "inputTokens" to normalized.inputTokens as Any,
            "outputTokens" to normalized.outputTokens as Any,
            "finishReason" to (normalized.finishReason as Any?),
            "provider" to (provider as Any),
            "model" to ((model ?: "") as Any),
            "metadataJson" to (metadata.toString() as Any),
        )
    }

    fun decodeProviderPayload(
        inputTokens: Int,
        outputTokens: Int,
        finishReason: String?,
        provider: String?,
        metadataJson: String?,
    ): ProviderPayloadData {
        if (provider == null || metadataJson == null) {
            return ProviderPayloadData(
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                finishReason = finishReason,
                provider = provider,
                cacheReadTokens = null,
                cacheWriteTokens = null,
                thinkingTokens = null,
                apiVersion = "unknown",
            )
        }

        return try {
            val metadata = JSONObject(metadataJson)
            val rawUsage = metadata.optJSONObject("rawUsage") ?: JSONObject()

            ProviderPayloadData(
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                finishReason = finishReason,
                provider = provider,
                cacheReadTokens = rawUsage.optInt("cacheReadTokens", 0).let {
                    if (it == 0) null else it
                },
                cacheWriteTokens = rawUsage.optInt("cacheWriteTokens", 0).let {
                    if (it == 0) null else it
                },
                thinkingTokens = rawUsage.optInt("thinkingTokens", 0).let {
                    if (it == 0) null else it
                },
                apiVersion = metadata.optString("apiVersion", "unknown"),
            )
        } catch (e: Exception) {
            // If metadata is malformed, fall back to stored values
            ProviderPayloadData(
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                finishReason = finishReason,
                provider = provider,
                cacheReadTokens = null,
                cacheWriteTokens = null,
                thinkingTokens = null,
                apiVersion = "error-decoding-metadata",
            )
        }
    }

    /**
     * Reproduces the original provider response for transmission to desktop during sync.
     * If the exact provider response isn't available, uses the normalized format.
     */
    fun reconstructProviderPayload(
        provider: String?,
        payload: ProviderPayloadData,
    ): JSONObject {
        if (provider == null) return JSONObject()

        val normalized = NormalizedUsage(
            inputTokens = payload.inputTokens,
            outputTokens = payload.outputTokens,
            finishReason = payload.finishReason,
            thinkingTokens = payload.thinkingTokens,
            cacheReadTokens = payload.cacheReadTokens,
            cacheWriteTokens = payload.cacheWriteTokens,
            version = payload.apiVersion,
        )

        return ProviderConverters.denormalizePayload(provider, normalized)
    }
}

data class ProviderPayloadData(
    val inputTokens: Int,
    val outputTokens: Int,
    val finishReason: String?,
    val provider: String?,
    val cacheReadTokens: Int?,
    val cacheWriteTokens: Int?,
    val thinkingTokens: Int?,
    val apiVersion: String,
)

fun MessageEntity.decodePayload(): ProviderPayloadData {
    return MessagePayloadStore.decodeProviderPayload(
        inputTokens = this.inputTokens,
        outputTokens = this.outputTokens,
        finishReason = this.finishReason,
        provider = this.provider,
        metadataJson = null as String?, // Not stored in MessageEntity currently
    )
}
