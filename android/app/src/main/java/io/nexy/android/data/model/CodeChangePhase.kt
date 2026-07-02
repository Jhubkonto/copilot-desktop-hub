package io.nexy.android.data.model

enum class CodeChangeRequestPhase {
    DRAFT,
    INVESTIGATING,
    PATCH_READY,
    READY_TO_APPLY,
    APPLIED,
    VERIFYING,
    READY_TO_COMMIT,
    COMMITTED,
    NEEDS_ATTENTION,
}

val CODE_CHANGE_PHASE_LABELS: Map<CodeChangeRequestPhase, String> = mapOf(
    CodeChangeRequestPhase.DRAFT to "Draft",
    CodeChangeRequestPhase.INVESTIGATING to "Planning",
    CodeChangeRequestPhase.PATCH_READY to "Patch ready",
    CodeChangeRequestPhase.READY_TO_APPLY to "Ready to apply",
    CodeChangeRequestPhase.APPLIED to "Applied",
    CodeChangeRequestPhase.VERIFYING to "Verifying",
    CodeChangeRequestPhase.READY_TO_COMMIT to "Ready to commit",
    CodeChangeRequestPhase.COMMITTED to "Committed",
    CodeChangeRequestPhase.NEEDS_ATTENTION to "Needs attention",
)

val CODE_CHANGE_PHASE_GUIDANCE: Map<CodeChangeRequestPhase, String> = mapOf(
    CodeChangeRequestPhase.DRAFT to "Plan the files and approach for this change.",
    CodeChangeRequestPhase.INVESTIGATING to "Review the plan before generating a patch.",
    CodeChangeRequestPhase.PATCH_READY to "Review every staged file before applying changes.",
    CodeChangeRequestPhase.READY_TO_APPLY to "Apply the reviewed patch to the connected workspace.",
    CodeChangeRequestPhase.APPLIED to "Run verification against the changed workspace.",
    CodeChangeRequestPhase.VERIFYING to "Verification is running against the connected workspace.",
    CodeChangeRequestPhase.READY_TO_COMMIT to "Review the repository state and create a commit.",
    CodeChangeRequestPhase.COMMITTED to "The change has been committed and can be pushed when needed.",
    CodeChangeRequestPhase.NEEDS_ATTENTION to "Review the failure details, revise the request, and retry.",
)

/**
 * Field-for-field port of deriveCodeChangePhase() in src/shared/code-changes.ts.
 * `hasInvestigationMarkdown` corresponds to the TS check `report.investigation_markdown`
 * being truthy — Android's ErrorReport calls that field `investigationMarkdown`.
 * Keep both implementations in sync — see CodeChangePhaseFixtureTest for the guard.
 */
fun deriveCodeChangePhase(
    fixStatus: String,
    status: String,
    hasInvestigationMarkdown: Boolean,
    verificationStatus: String?,
    committed: Boolean,
): CodeChangeRequestPhase {
    if (committed) return CodeChangeRequestPhase.COMMITTED
    if (verificationStatus == "success") return CodeChangeRequestPhase.READY_TO_COMMIT
    if (verificationStatus == "failed" || fixStatus == "failed" || status == "rejected") {
        return CodeChangeRequestPhase.NEEDS_ATTENTION
    }
    if (verificationStatus == "running") return CodeChangeRequestPhase.VERIFYING
    if (fixStatus == "applied") return CodeChangeRequestPhase.APPLIED
    if (fixStatus == "applying") return CodeChangeRequestPhase.READY_TO_APPLY
    if (fixStatus == "staged") return CodeChangeRequestPhase.PATCH_READY
    if (fixStatus == "staging" || status == "investigated") return CodeChangeRequestPhase.PATCH_READY
    if (status == "investigating" || hasInvestigationMarkdown) return CodeChangeRequestPhase.INVESTIGATING
    return CodeChangeRequestPhase.DRAFT
}

fun deriveCodeChangePhase(
    report: ErrorReport,
    verificationStatus: String? = null,
    committed: Boolean = false,
): CodeChangeRequestPhase = deriveCodeChangePhase(
    fixStatus = report.fixStatus,
    status = report.status,
    hasInvestigationMarkdown = !report.investigationMarkdown.isNullOrBlank(),
    verificationStatus = verificationStatus,
    committed = committed,
)
