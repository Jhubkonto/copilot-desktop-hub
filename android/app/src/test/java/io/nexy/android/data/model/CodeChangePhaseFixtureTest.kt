package io.nexy.android.data.model

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Fixtures mirroring the behavior of deriveCodeChangePhase() in
 * src/shared/code-changes.ts, to guard against the Kotlin port drifting
 * from the TypeScript source of truth. Each case documents which TS
 * branch it exercises.
 */
class CodeChangePhaseFixtureTest {

    @Test
    fun draft_whenNoFixStatusOrInvestigation() {
        // TS: falls through every branch to `return 'draft'`
        assertEquals(
            CodeChangeRequestPhase.DRAFT,
            deriveCodeChangePhase(fixStatus = "none", status = "open", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun investigating_whenStatusIsInvestigating() {
        // TS: `report.status === 'investigating'`
        assertEquals(
            CodeChangeRequestPhase.INVESTIGATING,
            deriveCodeChangePhase(fixStatus = "none", status = "investigating", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun investigating_whenInvestigationMarkdownPresent() {
        // TS: `report.investigation_markdown` truthy
        assertEquals(
            CodeChangeRequestPhase.INVESTIGATING,
            deriveCodeChangePhase(fixStatus = "none", status = "open", hasInvestigationMarkdown = true, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun patchReady_whenStatusInvestigated() {
        // TS: `report.fix_status === 'staging' || report.status === 'investigated'`
        assertEquals(
            CodeChangeRequestPhase.PATCH_READY,
            deriveCodeChangePhase(fixStatus = "none", status = "investigated", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun patchReady_whenFixStatusStaging() {
        assertEquals(
            CodeChangeRequestPhase.PATCH_READY,
            deriveCodeChangePhase(fixStatus = "staging", status = "investigated", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun patchReady_whenFixStatusStaged() {
        // TS: `report.fix_status === 'staged'`
        assertEquals(
            CodeChangeRequestPhase.PATCH_READY,
            deriveCodeChangePhase(fixStatus = "staged", status = "investigated", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun readyToApply_whenFixStatusApplying() {
        // TS: `report.fix_status === 'applying'`
        assertEquals(
            CodeChangeRequestPhase.READY_TO_APPLY,
            deriveCodeChangePhase(fixStatus = "applying", status = "investigated", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun applied_whenFixStatusApplied() {
        // TS: `report.fix_status === 'applied'`
        assertEquals(
            CodeChangeRequestPhase.APPLIED,
            deriveCodeChangePhase(fixStatus = "applied", status = "fixed", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun verifying_whenVerificationRunning() {
        // TS: `verificationRun?.status === 'running'`
        assertEquals(
            CodeChangeRequestPhase.VERIFYING,
            deriveCodeChangePhase(fixStatus = "applied", status = "fixed", hasInvestigationMarkdown = false, verificationStatus = "running", committed = false),
        )
    }

    @Test
    fun readyToCommit_whenVerificationSuccess() {
        // TS: `verificationRun?.status === 'success'`
        assertEquals(
            CodeChangeRequestPhase.READY_TO_COMMIT,
            deriveCodeChangePhase(fixStatus = "applied", status = "fixed", hasInvestigationMarkdown = false, verificationStatus = "success", committed = false),
        )
    }

    @Test
    fun committed_whenCommittedTrue_overridesEverythingElse() {
        // TS: `if (committed) return 'committed'` — checked first
        assertEquals(
            CodeChangeRequestPhase.COMMITTED,
            deriveCodeChangePhase(fixStatus = "applied", status = "fixed", hasInvestigationMarkdown = false, verificationStatus = "success", committed = true),
        )
    }

    @Test
    fun needsAttention_whenVerificationFailed() {
        // TS: `verificationRun?.status === 'failed'`
        assertEquals(
            CodeChangeRequestPhase.NEEDS_ATTENTION,
            deriveCodeChangePhase(fixStatus = "applied", status = "fixed", hasInvestigationMarkdown = false, verificationStatus = "failed", committed = false),
        )
    }

    @Test
    fun needsAttention_whenFixStatusFailed() {
        // TS: `report.fix_status === 'failed'`
        assertEquals(
            CodeChangeRequestPhase.NEEDS_ATTENTION,
            deriveCodeChangePhase(fixStatus = "failed", status = "investigated", hasInvestigationMarkdown = false, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun needsAttention_whenStatusRejected() {
        // TS: `report.status === 'rejected'`
        assertEquals(
            CodeChangeRequestPhase.NEEDS_ATTENTION,
            deriveCodeChangePhase(fixStatus = "none", status = "rejected", hasInvestigationMarkdown = true, verificationStatus = null, committed = false),
        )
    }

    @Test
    fun ErrorReport_overload_derivesSameResultAsPrimitiveOverload() {
        val report = ErrorReport(
            id = "report-1",
            title = "Fix flaky test",
            description = "",
            status = "investigated",
            fixStatus = "staged",
            investigationRootCause = null,
            investigationMarkdown = "Root cause found.",
            createdAt = 1000L,
        )
        assertEquals(
            deriveCodeChangePhase(fixStatus = "staged", status = "investigated", hasInvestigationMarkdown = true, verificationStatus = null, committed = false),
            deriveCodeChangePhase(report, verificationStatus = null, committed = false),
        )
    }
}
