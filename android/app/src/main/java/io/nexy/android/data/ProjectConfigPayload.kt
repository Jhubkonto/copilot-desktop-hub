package io.nexy.android.data

import io.nexy.android.data.model.ProjectSettingsConfig

internal fun buildProjectConfigPayload(id: String, config: ProjectSettingsConfig): Map<String, Any> =
    mapOf(
        "id" to id,
        "instructions" to config.instructions,
        "rootDirectory" to config.rootDirectory.orEmpty(),
        "variables" to config.variables,
        "instructionMode" to config.instructionMode,
        "instructionsEnabled" to config.instructionsEnabled,
        "workflowMode" to config.workflowMode,
        "orchestrationEnabled" to config.orchestrationEnabled,
        "maxDelegationDepth" to config.maxDelegationDepth.coerceIn(1, 10),
        "showTeamActivity" to config.showTeamActivity,
        "inScope" to config.inScope,
        "outOfScope" to config.outOfScope,
        "milestones" to config.milestones,
        "defaultModel" to config.defaultModel.orEmpty(),
        "defaultThinkingEffort" to config.defaultThinkingEffort.orEmpty(),
    )
