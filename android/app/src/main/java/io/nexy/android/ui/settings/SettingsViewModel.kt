package io.nexy.android.ui.settings

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.WsRepository
import kotlinx.coroutines.flow.StateFlow

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences("nexy_prefs", Context.MODE_PRIVATE)

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState

    val savedUrl: String?
        get() = prefs.getString("last_ws_url", null)

    fun disconnect() {
        WsRepository.disconnect()
    }

    fun forgetServer() {
        WsRepository.forgetServer()
    }
}
