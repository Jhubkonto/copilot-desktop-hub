package io.nexy.android.ui.skills

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsRepository
import io.nexy.android.data.jsonObjectToMap
import io.nexy.android.data.model.McpServerInfo
import io.nexy.android.data.model.SkillConfig
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class SkillsUiState(
    val skills: List<SkillConfig> = emptyList(),
    val mcpServers: List<McpServerInfo> = emptyList(),
    val usageBySkillId: Map<String, Int> = emptyMap(),
    val selectedSkill: SkillConfig? = null,
    val isEditing: Boolean = false,
    val showCreateSheet: Boolean = false,
    val editName: String = "",
    val editIcon: String = "",
    val editDescription: String = "",
    val editInstructions: String = "",
    val editTags: String = "",
    val editFileEditEnabled: Boolean = false,
    val editFileEditApproval: String = "always-ask",
    val editFileEditInstructions: String = "",
    val editTerminalEnabled: Boolean = false,
    val editTerminalApproval: String = "always-ask",
    val editTerminalInstructions: String = "",
    val editWebFetchEnabled: Boolean = false,
    val editWebFetchApproval: String = "always-ask",
    val editWebFetchInstructions: String = "",
    val editMcpServerIds: List<String> = emptyList(),
    val editMcpServerTrust: Map<String, String> = emptyMap(),
    val editMcpToolOverrides: String = "",
    val editKnowledge: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val exportJson: String? = null,
    val showImportSheet: Boolean = false,
    val importJson: String = "",
)

class SkillsViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(SkillsUiState())
    val state: StateFlow<SkillsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            WsRepository.skills.collect { skills ->
                val selectedId = _state.value.selectedSkill?.id
                _state.value = _state.value.copy(
                    skills = skills,
                    selectedSkill = skills.firstOrNull { it.id == selectedId } ?: _state.value.selectedSkill,
                )
            }
        }
        viewModelScope.launch {
            WsRepository.skillAgentUsage.collect { usage ->
                _state.value = _state.value.copy(usageBySkillId = usage)
            }
        }
        viewModelScope.launch {
            WsRepository.mcpServers.collect { servers ->
                _state.value = _state.value.copy(mcpServers = servers)
            }
        }
        viewModelScope.launch {
            WsRepository.events.collect { event ->
                when (event) {
                    is WsEvent.SkillList -> _state.value = _state.value.copy(isLoading = false)
                    is WsEvent.SkillCreated -> _state.value = _state.value.copy(showCreateSheet = false, showImportSheet = false, importJson = "", isLoading = false)
                    is WsEvent.SkillUpdated -> _state.value = _state.value.copy(selectedSkill = event.skill, isEditing = false, isLoading = false)
                    is WsEvent.SkillDeleted -> _state.value = _state.value.copy(selectedSkill = null, isEditing = false, isLoading = false)
                    is WsEvent.SkillDuplicated -> _state.value = _state.value.copy(isLoading = false)
                    is WsEvent.SkillAgentUsageList -> _state.value = _state.value.copy(isLoading = false)
                    is WsEvent.SkillExported -> _state.value = _state.value.copy(
                        exportJson = event.skill?.let { skillToJson(it) },
                        isLoading = false,
                        error = if (event.skill == null) "Skill export failed." else null,
                    )
                    else -> {}
                }
            }
        }
    }

    fun load() {
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.listSkills()
        WsRepository.getSkillAgentUsage()
        WsRepository.getMcpServers()
    }

    fun selectSkill(skill: SkillConfig) {
        _state.value = _state.value.copy(
            selectedSkill = skill,
            isEditing = false,
            editName = skill.name,
            editIcon = skill.icon,
            editDescription = skill.description,
            editInstructions = skill.instructions,
            editTags = skill.tags.joinToString(", "),
            editFileEditEnabled = skill.tools.fileEdit.enabled,
            editFileEditApproval = skill.tools.fileEdit.approval,
            editFileEditInstructions = skill.tools.fileEdit.instructions,
            editTerminalEnabled = skill.tools.terminal.enabled,
            editTerminalApproval = skill.tools.terminal.approval,
            editTerminalInstructions = skill.tools.terminal.instructions,
            editWebFetchEnabled = skill.tools.webFetch.enabled,
            editWebFetchApproval = skill.tools.webFetch.approval,
            editWebFetchInstructions = skill.tools.webFetch.instructions,
            editMcpServerIds = skill.mcpServers,
            editMcpServerTrust = skill.mcpServerTrust.associate { it.serverId to it.trust },
            editMcpToolOverrides = formatMcpToolOverrides(skill.mcpToolOverrides.map {
                McpToolOverrideDraft(it.serverId, it.toolName, it.enabled, it.approval, it.instructions)
            }),
            editKnowledge = formatKnowledge(skill.knowledge.map { it.title to it.content }),
        )
    }

    fun clearSelection() {
        _state.value = _state.value.copy(selectedSkill = null, isEditing = false)
    }

    fun showCreate() {
        _state.value = _state.value.copy(
            showCreateSheet = true,
            editName = "",
            editIcon = "*",
            editDescription = "",
            editInstructions = "",
            editTags = "",
            editFileEditEnabled = false,
            editFileEditApproval = "always-ask",
            editFileEditInstructions = "",
            editTerminalEnabled = false,
            editTerminalApproval = "always-ask",
            editTerminalInstructions = "",
            editWebFetchEnabled = false,
            editWebFetchApproval = "always-ask",
            editWebFetchInstructions = "",
            editMcpServerIds = emptyList(),
            editMcpServerTrust = emptyMap(),
            editMcpToolOverrides = "",
            editKnowledge = "",
        )
    }

    fun dismissCreate() {
        _state.value = _state.value.copy(showCreateSheet = false)
    }

    fun startEdit() {
        val skill = _state.value.selectedSkill ?: return
        _state.value = _state.value.copy(
            isEditing = true,
            editName = skill.name,
            editIcon = skill.icon,
            editDescription = skill.description,
            editInstructions = skill.instructions,
            editTags = skill.tags.joinToString(", "),
            editFileEditEnabled = skill.tools.fileEdit.enabled,
            editFileEditApproval = skill.tools.fileEdit.approval,
            editFileEditInstructions = skill.tools.fileEdit.instructions,
            editTerminalEnabled = skill.tools.terminal.enabled,
            editTerminalApproval = skill.tools.terminal.approval,
            editTerminalInstructions = skill.tools.terminal.instructions,
            editWebFetchEnabled = skill.tools.webFetch.enabled,
            editWebFetchApproval = skill.tools.webFetch.approval,
            editWebFetchInstructions = skill.tools.webFetch.instructions,
            editMcpServerIds = skill.mcpServers,
            editMcpServerTrust = skill.mcpServerTrust.associate { it.serverId to it.trust },
            editMcpToolOverrides = formatMcpToolOverrides(skill.mcpToolOverrides.map {
                McpToolOverrideDraft(it.serverId, it.toolName, it.enabled, it.approval, it.instructions)
            }),
            editKnowledge = formatKnowledge(skill.knowledge.map { it.title to it.content }),
        )
    }

    fun cancelEdit() {
        _state.value = _state.value.copy(isEditing = false)
    }

    fun createSkill() {
        val name = _state.value.editName.trim()
        val instructions = _state.value.editInstructions
        if (name.isBlank()) {
            _state.value = _state.value.copy(error = "Name is required.")
            return
        }
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.createSkill(
            name = name,
            icon = _state.value.editIcon.ifBlank { "*" },
            description = _state.value.editDescription,
            instructions = instructions,
            tags = parseTags(_state.value.editTags),
            tools = buildToolsPayload(),
            mcpServers = _state.value.editMcpServerIds,
            mcpServerTrust = buildMcpServerTrustPayload(),
            mcpToolOverrides = parseMcpToolOverrides(_state.value.editMcpToolOverrides),
            knowledge = parseKnowledge(_state.value.editKnowledge),
        )
    }

    fun saveEdit() {
        val id = _state.value.selectedSkill?.id ?: return
        val name = _state.value.editName.trim()
        if (name.isBlank()) {
            _state.value = _state.value.copy(error = "Name is required.")
            return
        }
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.updateSkill(
            id = id,
            name = name,
            icon = _state.value.editIcon.ifBlank { "*" },
            description = _state.value.editDescription,
            instructions = _state.value.editInstructions,
            tags = parseTags(_state.value.editTags),
            tools = buildToolsPayload(),
            mcpServers = _state.value.editMcpServerIds,
            mcpServerTrust = buildMcpServerTrustPayload(),
            mcpToolOverrides = parseMcpToolOverrides(_state.value.editMcpToolOverrides),
            knowledge = parseKnowledge(_state.value.editKnowledge),
        )
    }

    fun deleteSkill(id: String) {
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.deleteSkill(id)
    }

    fun duplicateSkill(id: String) {
        _state.value = _state.value.copy(isLoading = true)
        WsRepository.duplicateSkill(id)
    }

    fun exportSkill(id: String) {
        _state.value = _state.value.copy(isLoading = true, exportJson = null)
        WsRepository.exportSkill(id)
    }

    fun clearExportJson() {
        _state.value = _state.value.copy(exportJson = null)
    }

    fun showImport() {
        _state.value = _state.value.copy(showImportSheet = true, importJson = "")
    }

    fun dismissImport() {
        _state.value = _state.value.copy(showImportSheet = false, importJson = "")
    }

    fun importSkill() {
        val raw = _state.value.importJson.trim()
        if (raw.isBlank()) {
            _state.value = _state.value.copy(error = "Paste a skill JSON object first.")
            return
        }
        val parsed = runCatching { JSONObject(raw) }.getOrElse {
            _state.value = _state.value.copy(error = "Skill JSON is not valid.")
            return
        }
        _state.value = _state.value.copy(isLoading = true, showImportSheet = false)
        WsRepository.importSkill(jsonObjectToMap(parsed))
    }

    fun setEditName(value: String) { _state.value = _state.value.copy(editName = value) }
    fun setEditIcon(value: String) { _state.value = _state.value.copy(editIcon = value.take(8)) }
    fun setEditDescription(value: String) { _state.value = _state.value.copy(editDescription = value) }
    fun setEditInstructions(value: String) { _state.value = _state.value.copy(editInstructions = value) }
    fun setEditTags(value: String) { _state.value = _state.value.copy(editTags = value) }
    fun setEditFileEditEnabled(value: Boolean) { _state.value = _state.value.copy(editFileEditEnabled = value) }
    fun setEditFileEditApproval(value: String) { _state.value = _state.value.copy(editFileEditApproval = value) }
    fun setEditFileEditInstructions(value: String) { _state.value = _state.value.copy(editFileEditInstructions = value) }
    fun setEditTerminalEnabled(value: Boolean) { _state.value = _state.value.copy(editTerminalEnabled = value) }
    fun setEditTerminalApproval(value: String) { _state.value = _state.value.copy(editTerminalApproval = value) }
    fun setEditTerminalInstructions(value: String) { _state.value = _state.value.copy(editTerminalInstructions = value) }
    fun setEditWebFetchEnabled(value: Boolean) { _state.value = _state.value.copy(editWebFetchEnabled = value) }
    fun setEditWebFetchApproval(value: String) { _state.value = _state.value.copy(editWebFetchApproval = value) }
    fun setEditWebFetchInstructions(value: String) { _state.value = _state.value.copy(editWebFetchInstructions = value) }
    fun setEditKnowledge(value: String) { _state.value = _state.value.copy(editKnowledge = value) }
    fun setEditMcpToolOverrides(value: String) { _state.value = _state.value.copy(editMcpToolOverrides = value) }
    fun toggleMcpServer(id: String, enabled: Boolean) {
        val ids = _state.value.editMcpServerIds
        _state.value = _state.value.copy(
            editMcpServerIds = if (enabled) (ids + id).distinct() else ids.filter { it != id },
            editMcpServerTrust = if (enabled) _state.value.editMcpServerTrust else _state.value.editMcpServerTrust - id,
        )
    }
    fun cycleMcpServerTrust(id: String) {
        val current = _state.value.editMcpServerTrust[id] ?: "always-ask"
        _state.value = _state.value.copy(
            editMcpServerTrust = _state.value.editMcpServerTrust + (id to nextTrust(current)),
        )
    }
    fun setImportJson(value: String) { _state.value = _state.value.copy(importJson = value) }
    fun dismissError() { _state.value = _state.value.copy(error = null) }

    private fun parseTags(raw: String): List<String> =
        raw.split(",").map { it.trim() }.filter { it.isNotBlank() }

    private fun buildToolsPayload(): Map<String, Any> {
        val s = _state.value
        fun tool(enabled: Boolean, approval: String, instructions: String): Map<String, Any> =
            mapOf("enabled" to enabled, "approval" to approval, "instructions" to instructions)
        return mapOf(
            "fileEdit" to tool(s.editFileEditEnabled, s.editFileEditApproval, s.editFileEditInstructions),
            "terminal" to tool(s.editTerminalEnabled, s.editTerminalApproval, s.editTerminalInstructions),
            "webFetch" to tool(s.editWebFetchEnabled, s.editWebFetchApproval, s.editWebFetchInstructions),
        )
    }

    private fun parseKnowledge(raw: String): List<Map<String, String>> =
        raw.lines().mapNotNull { line ->
            val trimmed = line.trim()
            if (trimmed.isBlank()) return@mapNotNull null
            val index = trimmed.indexOf(':')
            if (index <= 0) return@mapNotNull mapOf("title" to trimmed, "content" to "")
            mapOf(
                "title" to trimmed.substring(0, index).trim(),
                "content" to trimmed.substring(index + 1).trim(),
            )
        }

    private fun formatKnowledge(items: List<Pair<String, String>>): String =
        items.joinToString("\n") { (title, content) ->
            if (content.isBlank()) title else "$title: $content"
        }

    private fun buildMcpServerTrustPayload(): List<Map<String, String>> {
        val state = _state.value
        return state.editMcpServerIds.map { id ->
            mapOf("serverId" to id, "trust" to (state.editMcpServerTrust[id] ?: "always-ask"))
        }
    }

    private data class McpToolOverrideDraft(
        val serverId: String,
        val toolName: String,
        val enabled: Boolean,
        val approval: String,
        val instructions: String,
    )

    private fun parseMcpToolOverrides(raw: String): List<Map<String, Any>> =
        raw.lines().mapNotNull { line ->
            val trimmed = line.trim()
            if (trimmed.isBlank()) return@mapNotNull null
            val parts = trimmed.split("|", limit = 4).map { it.trim() }
            val path = parts.getOrNull(0) ?: return@mapNotNull null
            val slash = path.indexOf('/')
            if (slash <= 0 || slash == path.lastIndex) return@mapNotNull null
            val enabledText = parts.getOrNull(1)?.lowercase()
            val approval = normaliseApproval(parts.getOrNull(2))
            mapOf(
                "serverId" to path.substring(0, slash).trim(),
                "toolName" to path.substring(slash + 1).trim(),
                "enabled" to (enabledText != "disabled" && enabledText != "false" && enabledText != "off"),
                "approval" to approval,
                "instructions" to (parts.getOrNull(3) ?: ""),
            )
        }

    private fun formatMcpToolOverrides(items: List<McpToolOverrideDraft>): String =
        items.joinToString("\n") { item ->
            listOf(
                "${item.serverId}/${item.toolName}",
                if (item.enabled) "enabled" else "disabled",
                item.approval,
                item.instructions,
            ).joinToString(" | ")
        }

    private fun normaliseApproval(value: String?): String =
        when (value) {
            "auto", "disabled" -> value
            else -> "always-ask"
        }

    private fun nextTrust(value: String): String =
        when (value) {
            "always-ask" -> "auto"
            "auto" -> "block"
            else -> "always-ask"
        }

    private fun skillToJson(skill: SkillConfig): String {
        val tools = JSONObject()
            .put("fileEdit", toolToJson(skill.tools.fileEdit.enabled, skill.tools.fileEdit.approval, skill.tools.fileEdit.instructions))
            .put("terminal", toolToJson(skill.tools.terminal.enabled, skill.tools.terminal.approval, skill.tools.terminal.instructions))
            .put("webFetch", toolToJson(skill.tools.webFetch.enabled, skill.tools.webFetch.approval, skill.tools.webFetch.instructions))
        val knowledge = JSONArray()
        skill.knowledge.forEach { item ->
            knowledge.put(JSONObject().put("title", item.title).put("content", item.content))
        }
        return JSONObject()
            .put("id", skill.id)
            .put("name", skill.name)
            .put("icon", skill.icon)
            .put("description", skill.description)
            .put("instructions", skill.instructions)
            .put("tags", JSONArray(skill.tags))
            .put("tools", tools)
            .put("mcpServers", JSONArray(skill.mcpServers))
            .put("mcpServerTrust", JSONArray(skill.mcpServerTrust.map {
                JSONObject().put("serverId", it.serverId).put("trust", it.trust)
            }))
            .put("mcpToolOverrides", JSONArray(skill.mcpToolOverrides.map {
                JSONObject()
                    .put("serverId", it.serverId)
                    .put("toolName", it.toolName)
                    .put("enabled", it.enabled)
                    .put("approval", it.approval)
                    .put("instructions", it.instructions)
            }))
            .put("knowledge", knowledge)
            .toString(2)
    }

    private fun toolToJson(enabled: Boolean, approval: String, instructions: String): JSONObject =
        JSONObject()
            .put("enabled", enabled)
            .put("approval", approval)
            .put("instructions", instructions)
}
