package io.nexy.android.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/**
 * Listens for network availability changes (including WireGuard VPN bringing up a new interface)
 * and triggers an immediate reconnect attempt so the user doesn't wait through the 60-second
 * polling interval after toggling a VPN or switching Wi-Fi networks.
 */
class NetworkReconnectMonitor(context: Context) {

    private val cm = context.getSystemService(ConnectivityManager::class.java)

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            // A new network path is ready — if we have a saved server, kick off a reconnect
            // immediately instead of waiting for the next scheduled retry.
            WsRepository.onNetworkAvailable()
        }
    }

    fun start() {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching { cm.registerNetworkCallback(request, callback) }
    }

    fun stop() {
        runCatching { cm.unregisterNetworkCallback(callback) }
    }
}
