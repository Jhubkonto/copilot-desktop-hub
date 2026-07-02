package io.nexy.android.data.model

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Fixtures mirroring CodeChangeRequestType / CODE_CHANGE_REQUEST_TYPE_LABELS /
 * codeChangeRequestTypeLabel() in src/shared/code-changes.ts and src/shared/types.ts,
 * to guard against the Kotlin port drifting from the TypeScript source of truth.
 */
class CodeChangeRequestTypeFixtureTest {

    @Test
    fun labels_matchTypeScriptSourceOfTruth() {
        assertEquals("Edit", CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(CodeChangeRequestType.EDIT))
        assertEquals("Refactor", CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(CodeChangeRequestType.REFACTOR))
        assertEquals("Bug fix", CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(CodeChangeRequestType.BUGFIX))
        assertEquals("Feature", CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(CodeChangeRequestType.FEATURE))
        assertEquals("Investigation", CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(CodeChangeRequestType.INVESTIGATION))
        assertEquals("Custom", CODE_CHANGE_REQUEST_TYPE_LABELS.getValue(CodeChangeRequestType.CUSTOM))
    }

    @Test
    fun wireValues_matchTypeScriptUnionMembers() {
        assertEquals("edit", codeChangeRequestTypeWireValue(CodeChangeRequestType.EDIT))
        assertEquals("refactor", codeChangeRequestTypeWireValue(CodeChangeRequestType.REFACTOR))
        assertEquals("bugfix", codeChangeRequestTypeWireValue(CodeChangeRequestType.BUGFIX))
        assertEquals("feature", codeChangeRequestTypeWireValue(CodeChangeRequestType.FEATURE))
        assertEquals("investigation", codeChangeRequestTypeWireValue(CodeChangeRequestType.INVESTIGATION))
        assertEquals("custom", codeChangeRequestTypeWireValue(CodeChangeRequestType.CUSTOM))
    }

    @Test
    fun customLabel_usedOnlyWhenTypeIsCustomAndLabelPresent() {
        assertEquals(
            "Data migration",
            codeChangeRequestTypeLabel(CodeChangeRequestType.CUSTOM, "Data migration"),
        )
        assertEquals(
            "Custom",
            codeChangeRequestTypeLabel(CodeChangeRequestType.CUSTOM, null),
        )
        assertEquals(
            "Custom",
            codeChangeRequestTypeLabel(CodeChangeRequestType.CUSTOM, ""),
        )
        assertEquals(
            "Edit",
            codeChangeRequestTypeLabel(CodeChangeRequestType.EDIT, "Ignored label"),
        )
    }
}
