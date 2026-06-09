package io.nexy.android.ui.pairing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerConfig
import io.nexy.android.data.WsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class PairingViewModel : ViewModel() {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

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
    }

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
}
