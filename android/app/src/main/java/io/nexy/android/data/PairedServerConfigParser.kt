package io.nexy.android.data

import java.net.URI

fun parsePairedServerConfig(rawValue: String): PairedServerConfig? {
    val uri = runCatching { URI(rawValue.trim()) }.getOrNull() ?: return null
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
