package io.nexy.android.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProviderInfo
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ProvidersViewModel(app: Application) : AndroidViewModel(app) {

    val providers: StateFlow<List<ProviderInfo>> = WsRepository.providers

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.ProviderList -> _isLoading.value = false
                    else -> {}
                }
            }
        }
    }

    fun refresh() {
        _isLoading.value = true
        WsRepository.getProviders()
    }

    fun setKey(provider: String, key: String) {
        WsRepository.setProviderKey(provider, key)
    }

    fun removeKey(provider: String) {
        WsRepository.removeProviderKey(provider)
    }
}
