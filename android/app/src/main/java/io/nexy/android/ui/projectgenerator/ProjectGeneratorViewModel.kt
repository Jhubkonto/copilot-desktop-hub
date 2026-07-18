package io.nexy.android.ui.projectgenerator

import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.ProjectGeneratorSpec
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.generator.GenEvent
import io.nexy.android.ui.generator.GenMessage
import io.nexy.android.ui.generator.GenPhase
import io.nexy.android.ui.generator.GeneratorViewModel
import io.nexy.android.ui.generator.mapState
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

typealias ProjectGenMessage = GenMessage

typealias ProjectGenPhase = GenPhase

private const val GREETING = "Let's create a new project. Tell me what you're building or working on, and I'll help configure the perfect setup."

data class ProjectGeneratorUiState(
    val phase: ProjectGenPhase = GenPhase.CHAT,
    val messages: List<ProjectGenMessage> = listOf(GenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: ProjectGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdProjectName: String? = null,
    val createdProjectId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
    val promptInsert: Pair<Int, String>? = null,
    val selectedModel: String? = null,
    val resolvedModel: String? = null,
)

class ProjectGeneratorViewModel(
    wsClient: WsClient = WsRepository,
) : GeneratorViewModel<ProjectGeneratorSpec>(wsClient, "project-generator", "project-spec", GREETING) {

    val uiState: StateFlow<ProjectGeneratorUiState> = state.mapState { s ->
        ProjectGeneratorUiState(
            phase = s.phase,
            messages = s.messages,
            streamingText = s.streamingText,
            pendingSpec = s.pendingSpec,
            isLoading = s.isLoading,
            missedSpec = s.missedSpec,
            error = s.error,
            createdProjectName = s.createdName,
            createdProjectId = s.createdId,
            activeSessionId = s.activeSessionId,
            promptInsert = s.promptInsert,
            selectedModel = s.selectedModel,
            resolvedModel = s.resolvedModel,
        )
    }

    override fun mapEvent(event: WsEvent): GenEvent<ProjectGeneratorSpec>? = when (event) {
        is WsEvent.ProjectGeneratorModel -> GenEvent.Model(event.sessionId, event.modelId)
        is WsEvent.ProjectGeneratorToken -> GenEvent.Token(event.sessionId, event.chunk)
        is WsEvent.ProjectGeneratorTurnComplete -> GenEvent.TurnComplete(event.sessionId, event.content, event.hasSpec)
        is WsEvent.ProjectGeneratorSpecReady -> GenEvent.SpecReady(event.sessionId, event.spec)
        is WsEvent.ProjectGeneratorCreated -> GenEvent.Created(event.sessionId, event.projectId, event.name)
        is WsEvent.ProjectGeneratorError -> GenEvent.Error(event.sessionId, event.message)
        is WsEvent.ProjectGeneratorCancelled -> GenEvent.Cancelled(event.sessionId)
        else -> null
    }

    fun setupManually() {
        enterSpecReview(
            ProjectGeneratorSpec(
                name = "",
                color = "#6366f1",
                instructions = "",
                rootDirectory = null,
                instructionMode = "prepend",
                variables = emptyList(),
                inScope = emptyList(),
                outOfScope = emptyList(),
                milestones = emptyList(),
                orchestrationEnabled = false,
                defaultModel = null,
                agents = emptyList(),
            ),
        )
    }

    override fun specPayload(spec: ProjectGeneratorSpec): Map<String, Any> = with(spec) {
        val agentsList = agents.map { agent ->
            val map = mutableMapOf<String, Any>(
                "role" to agent.role,
                "description" to agent.description,
                "isLeader" to agent.isLeader,
            )
            agent.existingAgentId?.let { map["existingAgentId"] = it }
            if (agent.existingAgentId == null) {
                val newAgent = agent.newAgent
                map["newAgent"] = mapOf(
                    "name" to (newAgent?.name ?: agent.role),
                    "icon" to (newAgent?.icon ?: ""),
                    "systemPrompt" to (newAgent?.systemPrompt ?: ""),
                    "temperature" to (newAgent?.temperature ?: 0.7),
                    "responseFormat" to (newAgent?.responseFormat ?: "default"),
                    "tools" to mapOf(
                        "fileEdit" to (newAgent?.tools?.fileEdit ?: false),
                        "terminal" to (newAgent?.tools?.terminal ?: false),
                        "webFetch" to (newAgent?.tools?.webFetch ?: false),
                    ),
                )
            }
            map
        }
        val payload = mutableMapOf<String, Any>(
            "name" to name,
            "color" to color,
            "instructions" to instructions,
            "variables" to variables,
            "inScope" to inScope,
            "outOfScope" to outOfScope,
            "milestones" to milestones,
            "orchestrationEnabled" to orchestrationEnabled,
            "agents" to agentsList,
        )
        rootDirectory?.let { payload["rootDirectory"] = it }
        instructionMode?.let { payload["instructionMode"] = it }
        defaultModel?.let { payload["defaultModel"] = it }
        payload
    }
}
