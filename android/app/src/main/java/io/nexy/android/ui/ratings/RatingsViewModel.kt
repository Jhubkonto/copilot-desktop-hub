package io.nexy.android.ui.ratings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ConversationRatingListItem
import io.nexy.android.data.model.ConversationRatingStats
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class RatingsUiState {
    object Loading : RatingsUiState()
    data class Loaded(val ratings: List<ConversationRatingListItem>, val stats: ConversationRatingStats?) : RatingsUiState()
    data class Error(val message: String) : RatingsUiState()
}

class RatingsViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<RatingsUiState>(RatingsUiState.Loading)
    val state: StateFlow<RatingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.RatingListLoaded -> {
                        val stats = (_state.value as? RatingsUiState.Loaded)?.stats
                        _state.value = RatingsUiState.Loaded(event.ratings, stats)
                    }
                    is WsEvent.RatingStatsLoaded -> {
                        val ratings = (_state.value as? RatingsUiState.Loaded)?.ratings ?: emptyList()
                        _state.value = RatingsUiState.Loaded(ratings, event.stats)
                    }
                    // A rating submitted/deleted elsewhere (e.g. ConversationActionsSheet) should be
                    // reflected here too, mirroring the desktop RatingsPane's onConversationRated refetch.
                    is WsEvent.RatingUpdated -> refresh()
                    is WsEvent.RatingError -> _state.value = RatingsUiState.Error(event.message)
                    else -> {}
                }
            }
        }
        refresh()
    }

    fun refresh() {
        WsRepository.listConversationRatings()
        WsRepository.getConversationRatingStats()
    }
}
