package io.nexy.android.data

import java.net.URI
import org.json.JSONObject

fun parsePairedServerConfig(rawValue: String): PairedServerConfig? {
    val trimmed = rawValue.trim()
    // v1: JSON payload with a "urls" array — desktop emits this when Tailscale is detected.
    if (trimmed.startsWith("{")) {
        return parseV1PairingPayload(trimmed)
    }
    // v0: bare wss:// URL (single endpoint, no fallbacks).
    return parseWssUrl(trimmed)
}

private fun parseV1PairingPayload(json: String): PairedServerConfig? {
    val obj = runCatching { JSONObject(json) }.getOrNull() ?: return null
    val urlsArr = runCatching { obj.getJSONArray("urls") }.getOrNull() ?: return null
    if (urlsArr.length() == 0) return null

    val urls = (0 until urlsArr.length()).mapNotNull { urlsArr.optString(it).takeIf { s -> s.isNotBlank() } }
    val primary = parseWssUrl(urls.first()) ?: return null
    val fallbacks = urls.drop(1).mapNotNull { url ->
        parseWssUrl(url)?.endpoint
    }
    return primary.copy(fallbackEndpoints = fallbacks)
}

private fun parseWssUrl(rawUrl: String): PairedServerConfig? {
    val uri = runCatching { URI(rawUrl.trim()) }.getOrNull() ?: return null
    val scheme = uri.scheme ?: return null
    val host = uri.host ?: return null
    val params = uri.rawQuery
        ?.split("&")
        ?.mapNotNull {
            val parts = it.split("=", limit = 2)
            if (parts.size == 2) parts[0] to parts[1] else null
        }
        ?.toMap().orEmpty()
    val token = params["token"]?.takeIf { it.isNotBlank() } ?: return null
    val certFP = params["certFP"]?.takeIf { it.isNotBlank() }
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    val path = uri.rawPath?.takeIf { it.isNotBlank() && it != "/" } ?: ""
    return PairedServerConfig(endpoint = "$scheme://$host$port$path", token = token, certFingerprint = certFP)
}
