package io.nexy.android.ui.remoteedit

import android.app.Application
import androidx.lifecycle.viewModelScope
import io.nexy.android.data.WsClient
import io.nexy.android.data.model.WsEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RemoteEditViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun deleteReportSetsDeletingIdUntilResultArrives() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.deleteReport("report-1")
        assertEquals("report-1", vm.deletingReportId.value)

        fakeWs.emit(WsEvent.RemoteEditReportDeleted(reportId = "report-1", deleted = true, error = null))
        advanceUntilIdle()

        assertNull(vm.deletingReportId.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun deleteReportEmitsFailureMessageWhenNotDeleted() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.deleteReport("report-1")

        val results = mutableListOf<RemoteEditActionResult>()
        val job = vm.viewModelScope.launch { vm.actionResults.collect { results += it } }
        advanceUntilIdle()

        fakeWs.emit(WsEvent.RemoteEditReportDeleted(reportId = "report-1", deleted = false, error = "not found"))
        advanceUntilIdle()

        assertEquals(1, results.size)
        assertEquals(RemoteEditActionResult("report-1", false, "not found"), results.single())

        job.cancel()
        vm.viewModelScope.cancel()
    }

    @Test
    fun applyPatchTracksApplyingStateAndSurfacesResult() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.applyPatch("report-1")
        assertEquals("report-1", vm.isApplying.value)

        val results = mutableListOf<RemoteEditActionResult>()
        val job = vm.viewModelScope.launch { vm.actionResults.collect { results += it } }
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.RemoteEditApplyResult(
                reportId = "report-1",
                appliedFiles = listOf("src/App.tsx"),
                backupPaths = listOf("/backups/report-1/src/App.tsx"),
                error = null,
            ),
        )
        advanceUntilIdle()

        assertNull(vm.isApplying.value)
        assertTrue(results.single().success)

        job.cancel()
        vm.viewModelScope.cancel()
    }

    @Test
    fun applyPatchSurfacesErrorWhenApplyFails() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.applyPatch("report-1")

        val results = mutableListOf<RemoteEditActionResult>()
        val job = vm.viewModelScope.launch { vm.actionResults.collect { results += it } }
        advanceUntilIdle()

        fakeWs.emit(
            WsEvent.RemoteEditApplyResult(
                reportId = "report-1",
                appliedFiles = emptyList(),
                backupPaths = emptyList(),
                error = "disk full",
            ),
        )
        advanceUntilIdle()

        assertNull(vm.isApplying.value)
        assertEquals(RemoteEditActionResult("report-1", false, "disk full"), results.single())

        job.cancel()
        vm.viewModelScope.cancel()
    }

    @Test
    fun verificationTracksRunningStateAndRecordsRunHistory() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.startVerification("report-1")
        assertEquals("report-1", vm.verificationRunning.value)

        fakeWs.emit(
            WsEvent.RemoteEditVerificationDone(
                reportId = "report-1",
                runId = "run-1",
                status = "success",
                error = null,
            ),
        )
        advanceUntilIdle()

        assertNull(vm.verificationRunning.value)
        val runs = vm.verificationRuns.value["report-1"]
        assertEquals(1, runs?.size)
        assertEquals("success", runs?.first()?.status)

        vm.viewModelScope.cancel()
    }

    @Test
    fun pushTracksRunningStateUntilGitPushEventArrives() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.pushFix("report-1")
        assertEquals("report-1", vm.gitPushRunning.value)

        fakeWs.emit(
            WsEvent.RemoteEditGitEvent(
                reportId = "report-1",
                type = "push",
                label = "Pushed to origin/main",
                commitSha = "abc123",
                error = null,
            ),
        )
        advanceUntilIdle()

        assertNull(vm.gitPushRunning.value)

        vm.viewModelScope.cancel()
    }

    @Test
    fun rollbackTracksRunningStateAndRecordsRecoveryRun() = runTest {
        val fakeWs = FakeWsClient()
        val vm = RemoteEditViewModel(Application(), fakeWs)
        advanceUntilIdle()

        vm.requestRollback("recovery-1")
        assertEquals("recovery-1", vm.rollbackRunning.value)

        fakeWs.emit(
            WsEvent.RemoteEditRecoveryEvent(
                reportId = "report-1",
                recoveryId = "recovery-1",
                type = "rollback",
                label = "Rolled back",
                status = "rolled-back",
                error = null,
            ),
        )
        advanceUntilIdle()

        assertNull(vm.rollbackRunning.value)
        val runs = vm.recoveryRuns.value["report-1"]
        assertEquals("rolled-back", runs?.first()?.status)

        vm.viewModelScope.cancel()
    }

    private class FakeWsClient : WsClient {
        private val mutableEvents = MutableSharedFlow<WsEvent>(extraBufferCapacity = 16)
        override val events: SharedFlow<WsEvent> = mutableEvents
        val sentCommands = mutableListOf<Pair<String, Map<String, Any>>>()

        override fun send(command: String, data: Map<String, Any>) {
            sentCommands += command to data
        }

        suspend fun emit(event: WsEvent) {
            mutableEvents.emit(event)
        }
    }
}
