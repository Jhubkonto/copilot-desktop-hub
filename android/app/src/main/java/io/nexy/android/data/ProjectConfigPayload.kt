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
        "capabilityProfile" to mapOf(
            "version" to 1,
            "skillIds" to config.capabilityProfile.skillIds,
            "mcp" to config.capabilityProfile.mcp.map { grant ->
                mapOf("serverId" to grant.serverId, "trust" to grant.trust)
            },
            "builtInTools" to config.capabilityProfile.builtInTools.mapValues { (_, policy) ->
                mapOf("enabled" to policy.enabled, "approval" to policy.approval)
            },
        ),
    )
