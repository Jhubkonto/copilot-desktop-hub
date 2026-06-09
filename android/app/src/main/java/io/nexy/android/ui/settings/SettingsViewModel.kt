package io.nexy.android.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import kotlinx.coroutines.flow.StateFlow

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState

    val savedEndpoint: String?
        get() = WsRepository.pairedServer()?.endpoint

    fun disconnect() {
        WsRepository.disconnect()
    }

    fun forgetServer() {
        WsRepository.forgetServer()
    }
}
