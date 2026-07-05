package io.nexy.android.ui.settings

import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import java.net.URI

data class ConnectionDiagnostics(
    val profileName: String,
    val endpoint: String,
    val scheme: String,
    val connectionState: ConnectionState,
    val serverVersion: String?,
    val lastError: String?,
    val macAddress: String?,
    val broadcastAddress: String?,
    val mDnsName: String?,
    val wolEnabled: Boolean,
)

fun buildConnectionDiagnostics(
    activeProfile: PairedServerProfile?,
    connectionState: ConnectionState,
    serverVersion: String?,
    lastError: String?,
): ConnectionDiagnostics {
    val endpoint = activeProfile?.endpoint ?: "Not configured"
    val scheme = runCatching { URI(activeProfile?.endpoint.orEmpty()).scheme }.getOrNull()
        ?.takeIf { it.isNotBlank() }
        ?: "Unknown"
    return ConnectionDiagnostics(
        profileName = activeProfile?.name ?: "No active profile",
        endpoint = endpoint,
        scheme = scheme,
        connectionState = connectionState,
        serverVersion = serverVersion?.takeIf { it.isNotBlank() },
        lastError = lastError?.takeIf { it.isNotBlank() },
        macAddress = activeProfile?.macAddress,
        broadcastAddress = activeProfile?.broadcastAddress,
        mDnsName = activeProfile?.mDnsName,
        wolEnabled = activeProfile?.macAddress != null && activeProfile.broadcastAddress != null,
    )
}

fun connectionStateLabel(state: ConnectionState): String =
    io.nexy.android.ui.connection.connectionStateLabel(state)

fun connectionSchemeDetail(scheme: String): String =
    when (scheme.lowercase()) {
        "wss" -> "Secure WebSocket"
        "ws" -> "Local WebSocket"
        else -> "Unknown"
    }
