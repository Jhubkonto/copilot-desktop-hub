package io.nexy.android.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProviderInfo
import kotlinx.coroutines.flow.StateFlow

class ProvidersViewModel(app: Application) : AndroidViewModel(app) {

    val providers: StateFlow<List<ProviderInfo>> = WsRepository.providers

    fun refresh() {
        WsRepository.getProviders()
    }

    fun setKey(provider: String, key: String) {
        WsRepository.setProviderKey(provider, key)
    }

    fun removeKey(provider: String) {
        WsRepository.removeProviderKey(provider)
    }
}
