package io.nexy.android.ui.selfheal

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ErrorReport
import kotlinx.coroutines.flow.StateFlow

class SelfHealViewModel(app: Application) : AndroidViewModel(app) {
    val errorReports: StateFlow<List<ErrorReport>> = WsRepository.errorReports

    init {
        WsRepository.refreshReports()
    }

    fun refresh() {
        WsRepository.refreshReports()
    }
}
