package io.nexy.android.ui.debrief

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class DebriefUiState {
    object Loading : DebriefUiState()
    data class Loaded(val debrief: ConversationDebrief) : DebriefUiState()
    data class Error(val message: String) : DebriefUiState()
}

class DebriefViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<DebriefUiState>(DebriefUiState.Loading)
    val state: StateFlow<DebriefUiState> = _state.asStateFlow()

    private var loadedConversationId: String? = null

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.DebriefReady -> {
                        if (event.debrief.conversationId == loadedConversationId) {
                            _state.value = DebriefUiState.Loaded(event.debrief)
                        }
                    }
                    is WsEvent.DebriefLoaded -> {
                        if (event.debrief != null && event.debrief.conversationId == loadedConversationId) {
                            _state.value = DebriefUiState.Loaded(event.debrief)
                        } else if (event.debrief == null && loadedConversationId != null) {
                            // No debrief exists — generate one
                            WsRepository.generateDebrief(loadedConversationId!!)
                        }
                    }
                    is WsEvent.DebriefError -> _state.value = DebriefUiState.Error(event.message)
                    else -> {}
                }
            }
        }
    }

    fun load(conversationId: String) {
        loadedConversationId = conversationId
        _state.value = DebriefUiState.Loading
        WsRepository.getDebrief(conversationId)
    }

    fun retry(conversationId: String) {
        loadedConversationId = conversationId
        _state.value = DebriefUiState.Loading
        WsRepository.generateDebrief(conversationId)
    }
}
