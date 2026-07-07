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
    object CheckingExisting : DebriefUiState()
    data class ReadyToGenerate(val conversationTitle: String, val selectedModel: String?) : DebriefUiState()
    data class Generating(val conversationTitle: String) : DebriefUiState()
    data class Loaded(val debrief: ConversationDebrief) : DebriefUiState()
    data class Error(val message: String) : DebriefUiState()
}

class DebriefViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<DebriefUiState>(DebriefUiState.CheckingExisting)
    val state: StateFlow<DebriefUiState> = _state.asStateFlow()

    private var loadedConversationId: String? = null
    private var conversationTitle: String = ""

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
                            // No debrief exists yet — let the user pick a model and confirm before generating,
                            // rather than silently auto-generating with a hidden default.
                            val current = _state.value
                            val previouslySelectedModel = (current as? DebriefUiState.ReadyToGenerate)?.selectedModel
                            _state.value = DebriefUiState.ReadyToGenerate(conversationTitle, previouslySelectedModel)
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
        conversationTitle = WsRepository.conversations.value.find { it.id == conversationId }?.title.orEmpty()
        _state.value = DebriefUiState.CheckingExisting
        WsRepository.getDebrief(conversationId)
    }

    fun setSelectedModel(modelId: String?) {
        val current = _state.value
        if (current is DebriefUiState.ReadyToGenerate) {
            _state.value = current.copy(selectedModel = modelId)
        }
    }

    fun generate() {
        val id = loadedConversationId ?: return
        val model = (_state.value as? DebriefUiState.ReadyToGenerate)?.selectedModel
        _state.value = DebriefUiState.Generating(conversationTitle)
        WsRepository.generateDebrief(id, model = model)
    }

    fun retry(conversationId: String) {
        loadedConversationId = conversationId
        _state.value = DebriefUiState.Generating(conversationTitle)
        WsRepository.generateDebrief(conversationId)
    }
}
