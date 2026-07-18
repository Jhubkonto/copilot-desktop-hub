package io.nexy.android.ui.agentgenerator

import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.AgentGeneratorSpec
import io.nexy.android.data.model.AgentGeneratorTools
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.generator.GenEvent
import io.nexy.android.ui.generator.GenMessage
import io.nexy.android.ui.generator.GenPhase
import io.nexy.android.ui.generator.GeneratorViewModel
import io.nexy.android.ui.generator.mapState
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

typealias AgentGenMessage = GenMessage

typealias AgentGenPhase = GenPhase

private const val GREETING = "Let's create a new agent. Describe what you want it to do, its personality, and any tools it should use."

data class AgentGeneratorUiState(
    val phase: AgentGenPhase = GenPhase.CHAT,
    val messages: List<AgentGenMessage> = listOf(GenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: AgentGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdAgentName: String? = null,
    val createdAgentId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
    val promptInsert: Pair<Int, String>? = null,
    val selectedModel: String? = null,
    val resolvedModel: String? = null,
)

class AgentGeneratorViewModel(
    wsClient: WsClient = WsRepository,
) : GeneratorViewModel<AgentGeneratorSpec>(wsClient, "agent-generator", "agent-spec", GREETING) {

    val uiState: StateFlow<AgentGeneratorUiState> = state.mapState { s ->
        AgentGeneratorUiState(
            phase = s.phase,
            messages = s.messages,
            streamingText = s.streamingText,
            pendingSpec = s.pendingSpec,
            isLoading = s.isLoading,
            missedSpec = s.missedSpec,
            error = s.error,
            createdAgentName = s.createdName,
            createdAgentId = s.createdId,
            activeSessionId = s.activeSessionId,
            promptInsert = s.promptInsert,
            selectedModel = s.selectedModel,
            resolvedModel = s.resolvedModel,
        )
    }

    override fun mapEvent(event: WsEvent): GenEvent<AgentGeneratorSpec>? = when (event) {
        is WsEvent.AgentGeneratorModel -> GenEvent.Model(event.sessionId, event.modelId)
        is WsEvent.AgentGeneratorToken -> GenEvent.Token(event.sessionId, event.chunk)
        is WsEvent.AgentGeneratorTurnComplete -> GenEvent.TurnComplete(event.sessionId, event.content, event.hasSpec)
        is WsEvent.AgentGeneratorSpecReady -> GenEvent.SpecReady(event.sessionId, event.spec)
        is WsEvent.AgentGeneratorCreated -> GenEvent.Created(event.sessionId, event.agentId, event.name)
        is WsEvent.AgentGeneratorError -> GenEvent.Error(event.sessionId, event.message)
        is WsEvent.AgentGeneratorCancelled -> GenEvent.Cancelled(event.sessionId)
        else -> null
    }

    fun setupManually() {
        enterSpecReview(
            AgentGeneratorSpec(
                name = "",
                icon = "🤖",
                systemPrompt = "",
                temperature = 0.7,
                responseFormat = "default",
                agenticMode = false,
                tools = AgentGeneratorTools(fileEdit = false, terminal = false, webFetch = false),
                rootDirectory = null,
                contextDirectories = emptyList(),
                memory = null,
            ),
        )
    }

    override fun specPayload(spec: AgentGeneratorSpec): Map<String, Any> = with(spec) {
        val payload = mutableMapOf<String, Any>(
            "name" to name,
            "icon" to icon,
            "systemPrompt" to systemPrompt,
            "temperature" to temperature,
            "responseFormat" to responseFormat,
            "agenticMode" to agenticMode,
            "tools" to mapOf(
                "fileEdit" to tools.fileEdit,
                "terminal" to tools.terminal,
                "webFetch" to tools.webFetch,
            ),
            "contextDirectories" to contextDirectories,
        )
        rootDirectory?.let { payload["rootDirectory"] = it }
        memory?.let { payload["memory"] = it }
        payload
    }
}
