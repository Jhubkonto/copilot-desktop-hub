package io.nexy.android.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import io.nexy.android.data.ConnectionState
import io.nexy.android.data.PairedServerProfile
import io.nexy.android.data.WsRepository
import kotlinx.coroutines.flow.StateFlow

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    val connectionState: StateFlow<ConnectionState> = WsRepository.connectionState
    val profiles: StateFlow<List<PairedServerProfile>> = WsRepository.profiles
    val activeProfileId: StateFlow<String?> = WsRepository.activeProfileId

    val savedEndpoint: String?
        get() = WsRepository.pairedServer()?.endpoint

    fun switchProfile(profileId: String) {
        WsRepository.switchProfile(profileId)
    }

    fun disconnect() {
        WsRepository.disconnect()
    }

    fun forgetServer(): Boolean {
        WsRepository.forgetServer()
        return WsRepository.hasPairedServer()
    }
}
