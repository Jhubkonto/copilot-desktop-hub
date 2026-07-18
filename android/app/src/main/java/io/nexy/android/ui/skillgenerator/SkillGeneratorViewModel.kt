package io.nexy.android.ui.skillgenerator

import io.nexy.android.data.WsClient
import io.nexy.android.data.WsRepository
import io.nexy.android.data.model.SkillGeneratorSpec
import io.nexy.android.data.model.SkillGeneratorTools
import io.nexy.android.data.model.WsEvent
import io.nexy.android.ui.generator.GenEvent
import io.nexy.android.ui.generator.GenMessage
import io.nexy.android.ui.generator.GenPhase
import io.nexy.android.ui.generator.GeneratorViewModel
import io.nexy.android.ui.generator.mapState
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

typealias SkillGenMessage = GenMessage

typealias SkillGenPhase = GenPhase

private const val GREETING = "Let's create a new skill. Describe what you want it to do, which tools it should use, and any approval or instruction details."

data class SkillGeneratorUiState(
    val phase: SkillGenPhase = GenPhase.CHAT,
    val messages: List<SkillGenMessage> = listOf(GenMessage("assistant", GREETING)),
    val streamingText: String = "",
    val pendingSpec: SkillGeneratorSpec? = null,
    val isLoading: Boolean = false,
    val missedSpec: Boolean = false,
    val error: String? = null,
    val createdSkillName: String? = null,
    val createdSkillId: String? = null,
    val activeSessionId: String = UUID.randomUUID().toString(),
    val promptInsert: Pair<Int, String>? = null,
    val selectedModel: String? = null,
    val resolvedModel: String? = null,
)

class SkillGeneratorViewModel(
    wsClient: WsClient = WsRepository,
) : GeneratorViewModel<SkillGeneratorSpec>(wsClient, "skill-generator", "skill-spec", GREETING) {

    val uiState: StateFlow<SkillGeneratorUiState> = state.mapState { s ->
        SkillGeneratorUiState(
            phase = s.phase,
            messages = s.messages,
            streamingText = s.streamingText,
            pendingSpec = s.pendingSpec,
            isLoading = s.isLoading,
            missedSpec = s.missedSpec,
            error = s.error,
            createdSkillName = s.createdName,
            createdSkillId = s.createdId,
            activeSessionId = s.activeSessionId,
            promptInsert = s.promptInsert,
            selectedModel = s.selectedModel,
            resolvedModel = s.resolvedModel,
        )
    }

    override fun mapEvent(event: WsEvent): GenEvent<SkillGeneratorSpec>? = when (event) {
        is WsEvent.SkillGeneratorModel -> GenEvent.Model(event.sessionId, event.modelId)
        is WsEvent.SkillGeneratorToken -> GenEvent.Token(event.sessionId, event.chunk)
        is WsEvent.SkillGeneratorTurnComplete -> GenEvent.TurnComplete(event.sessionId, event.content, event.hasSpec)
        is WsEvent.SkillGeneratorSpecReady -> GenEvent.SpecReady(event.sessionId, event.spec)
        is WsEvent.SkillGeneratorCreated -> GenEvent.Created(event.sessionId, event.skillId, event.name)
        is WsEvent.SkillGeneratorError -> GenEvent.Error(event.sessionId, event.message)
        is WsEvent.SkillGeneratorCancelled -> GenEvent.Cancelled(event.sessionId)
        else -> null
    }

    fun setupManually() {
        enterSpecReview(
            SkillGeneratorSpec(
                name = "",
                icon = "🔧",
                description = "",
                instructions = "",
                tools = SkillGeneratorTools(fileEdit = false, terminal = false, webFetch = false),
            ),
        )
    }

    override fun specPayload(spec: SkillGeneratorSpec): Map<String, Any> = with(spec) {
        mapOf(
            "name" to name,
            "icon" to icon,
            "description" to description,
            "instructions" to instructions,
            "tools" to mapOf(
                "fileEdit" to tools.fileEdit,
                "terminal" to tools.terminal,
                "webFetch" to tools.webFetch,
            ),
            "toolInstructions" to toolInstructions,
            "approval" to approval,
            "mcpServers" to mcpServers,
            "tags" to tags,
            "knowledge" to knowledge.map { mapOf("title" to it.title, "content" to it.content) },
            "suggestedAgents" to suggestedAgents,
        )
    }
}
