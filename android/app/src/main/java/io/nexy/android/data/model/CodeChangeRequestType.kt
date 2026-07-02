package io.nexy.android.data.model

/**
 * Field-for-field port of CodeChangeRequestType / CODE_CHANGE_REQUEST_TYPE_LABELS
 * in src/shared/code-changes.ts. Keep both implementations in sync — see
 * CodeChangeRequestTypeFixtureTest for the guard.
 */
enum class CodeChangeRequestType {
    EDIT,
    REFACTOR,
    BUGFIX,
    FEATURE,
    INVESTIGATION,
    CUSTOM,
}

val CODE_CHANGE_REQUEST_TYPE_LABELS: Map<CodeChangeRequestType, String> = mapOf(
    CodeChangeRequestType.EDIT to "Edit",
    CodeChangeRequestType.REFACTOR to "Refactor",
    CodeChangeRequestType.BUGFIX to "Bug fix",
    CodeChangeRequestType.FEATURE to "Feature",
    CodeChangeRequestType.INVESTIGATION to "Investigation",
    CodeChangeRequestType.CUSTOM to "Custom",
)

fun codeChangeRequestTypeWireValue(requestType: CodeChangeRequestType): String = when (requestType) {
    CodeChangeRequestType.EDIT -> "edit"
    CodeChangeRequestType.REFACTOR -> "refactor"
    CodeChangeRequestType.BUGFIX -> "bugfix"
    CodeChangeRequestType.FEATURE -> "feature"
    CodeChangeRequestType.INVESTIGATION -> "investigation"
    CodeChangeRequestType.CUSTOM -> "custom"
}

fun codeChangeRequestTypeLabel(requestType: CodeChangeRequestType, customTypeLabel: String?): String {
    if (requestType == CodeChangeRequestType.CUSTOM && !customTypeLabel.isNullOrBlank()) return customTypeLabel
    return CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(requestType)
}
