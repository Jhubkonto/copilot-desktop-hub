package io.nexy.android.ui.debrief

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ConversationDebrief
import io.nexy.android.data.model.DebriefStory
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

/** Which of the two debrief presentations is on screen — mirrors desktop's
 *  DebriefArtifactCard `view` state ('structured' | 'story'). */
enum class DebriefView { STRUCTURED, STORY }

/** Narrative "Story mode" retelling of the loaded debrief. Mirrors desktop's
 *  DebriefArtifactCard story/storyLoading/storyError/storyTone/storyBeatCount state, kept
 *  separate from DebriefUiState since the structured debrief and its story are fetched and can
 *  fail independently while the user flips between the two tabs. */
data class StoryState(
    val story: DebriefStory? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val tone: String = "adventure",
    val beatCount: Int = 5,
)

class DebriefViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<DebriefUiState>(DebriefUiState.CheckingExisting)
    val state: StateFlow<DebriefUiState> = _state.asStateFlow()

    private val _view = MutableStateFlow(DebriefView.STRUCTURED)
    val view: StateFlow<DebriefView> = _view.asStateFlow()

    private val _storyState = MutableStateFlow(StoryState())
    val storyState: StateFlow<StoryState> = _storyState.asStateFlow()

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
                        } else if (event.debrief == null && loadedConversationId != null && event.conversationId == loadedConversationId) {
                            // No debrief exists yet — let the user pick a model and confirm before generating,
                            // rather than silently auto-generating with a hidden default.
                            val current = _state.value
                            val previouslySelectedModel = (current as? DebriefUiState.ReadyToGenerate)?.selectedModel
                            _state.value = DebriefUiState.ReadyToGenerate(conversationTitle, previouslySelectedModel)
                        }
                    }
                    is WsEvent.DebriefError -> _state.value = DebriefUiState.Error(event.message)
                    is WsEvent.DebriefStoryReady -> {
                        if (event.conversationId == loadedConversationId) {
                            _storyState.value = _storyState.value.copy(story = event.story, loading = false, error = null)
                        }
                    }
                    is WsEvent.DebriefStoryError -> {
                        _storyState.value = _storyState.value.copy(loading = false, error = event.message)
                    }
                    else -> {}
                }
            }
        }
    }

    fun load(conversationId: String) {
        loadedConversationId = conversationId
        conversationTitle = WsRepository.conversations.value.find { it.id == conversationId }?.title.orEmpty()
        _state.value = DebriefUiState.CheckingExisting
        _view.value = DebriefView.STRUCTURED
        _storyState.value = StoryState()
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

    fun setView(newView: DebriefView) {
        _view.value = newView
    }

    fun setStoryTone(tone: String) {
        _storyState.value = _storyState.value.copy(tone = tone)
    }

    fun setStoryBeatCount(count: Int) {
        _storyState.value = _storyState.value.copy(beatCount = count)
    }

    fun fetchStory(forceRegenerate: Boolean = false) {
        val id = loadedConversationId ?: return
        val model = (_state.value as? DebriefUiState.ReadyToGenerate)?.selectedModel
        val current = _storyState.value
        _storyState.value = current.copy(loading = true, error = null)
        WsRepository.generateDebriefStory(
            conversationId = id,
            model = model,
            forceRegenerate = forceRegenerate,
            tone = current.tone,
            beatCount = current.beatCount,
        )
    }
}
