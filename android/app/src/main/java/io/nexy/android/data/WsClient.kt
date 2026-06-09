package io.nexy.android.data

import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.SharedFlow

interface WsClient {
    val events: SharedFlow<WsEvent>
    fun send(command: String, data: Map<String, Any> = emptyMap())
}
