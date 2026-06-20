package io.nexy.android.data

import io.nexy.android.data.model.ArtifactGeneratorSpec

internal fun ArtifactGeneratorSpec.toPayload(): Map<String, Any> =
    mapOf(
        "title" to title,
        "kind" to kind,
        "scope" to buildMap {
            put("type", scopeType)
            scopeProjectId?.let { put("projectId", it) }
        },
        "intendedUse" to intendedUse,
        "audience" to audience.orEmpty(),
        "outputFiles" to outputFiles.map {
            mapOf(
                "path" to it.path,
                "mediaType" to it.mediaType,
                "role" to it.role,
                "description" to it.description.orEmpty(),
            )
        },
        "acceptanceCriteria" to acceptanceCriteria,
        "exportFormats" to exportFormats,
        "sourceContext" to mapOf(
            "useProjectInstructions" to sourceContext.useProjectInstructions,
            "useProjectWiki" to sourceContext.useProjectWiki,
            "useConversationContext" to sourceContext.useConversationContext,
            "referencedFiles" to sourceContext.referencedFiles,
        ),
    )
