package io.nexy.android.ui.pairing

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.DiscoveredNexyService
import io.nexy.android.data.MdnsDiscovery
import io.nexy.android.data.PairedServerConfig
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.WsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class PairingViewModel(application: Application) : AndroidViewModel(application) {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val profiles: StateFlow<List<PairedServerProfile>> = WsRepository.profiles

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val mdnsDiscovery = MdnsDiscovery(application)
    val discoveredServices: StateFlow<List<DiscoveredNexyService>> = mdnsDiscovery.discovered

    // Only show errors from explicit user-initiated connect attempts, not from
    // the background auto-reconnect that fires on app launch with a saved URL.
    private var userInitiated = false
    private var qrConnectStarted = false

    init {
        viewModelScope.launch {
            WsRepository.lastError.collect { err ->
                if (userInitiated) _error.value = err
            }
        }
        viewModelScope.launch {
            WsRepository.connectionState.collect { state ->
                // A QR callback may start a connection that fails asynchronously. Allow the
                // next frame to be scanned once that attempt has fully returned to idle.
                if (state == ConnectionState.DISCONNECTED) qrConnectStarted = false
            }
        }
    }

    fun startMdnsDiscovery() = mdnsDiscovery.startDiscovery()
    fun stopMdnsDiscovery() = mdnsDiscovery.stopDiscovery()

    fun connectFromQr(rawValue: String) {
        // decodeContinuous fires on every frame — only act when idle
        if (qrConnectStarted) return
        if (WsRepository.connectionState.value != ConnectionState.DISCONNECTED) return
        userInitiated = true
        _error.value = null
        val config = PairedServerConfig.fromUrl(rawValue) ?: run {
            _error.value = "Invalid pairing URL"
            return
        }
        qrConnectStarted = true
        runCatching { WsRepository.connect(config) }
            .onFailure {
                qrConnectStarted = false
                _error.value = it.message ?: "Unable to connect"
            }
    }

    fun connectManual(wsUrl: String) {
        userInitiated = true
        _error.value = null
        val config = PairedServerConfig.fromUrl(wsUrl) ?: run {
            _error.value = "Invalid WebSocket URL"
            return
        }
        runCatching { WsRepository.connect(config) }
            .onFailure { _error.value = it.message ?: "Unable to connect" }
    }

    fun connectDiscovered(service: DiscoveredNexyService) {
        val token = service.token ?: run { _error.value = "Service token unavailable"; return }
        val wsUrl = "wss://${service.host}:${service.port}?token=$token"
        connectManual(wsUrl)
    }

    fun connectProfile(profileId: String) {
        userInitiated = true
        _error.value = null
        runCatching { WsRepository.switchProfile(profileId) }
            .onFailure { _error.value = it.message ?: "Unable to connect" }
    }

    fun deleteProfile(profileId: String) {
        WsRepository.forgetProfile(profileId)
    }

    override fun onCleared() {
        super.onCleared()
        mdnsDiscovery.stopDiscovery()
    }
}
