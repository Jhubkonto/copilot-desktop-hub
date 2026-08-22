package io.nexy.android.ui.projects

import io.nexy.android.data.model.ProjectSettingsConfig
import io.nexy.android.data.model.WsEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectSourceAddFlowTest {
    private val config = ProjectSettingsConfig(
        instructions = "",
        rootDirectory = "C:\\workspace",
        instructionMode = "prepend",
        orchestrationEnabled = false,
        defaultModel = null,
    )

    @Test
    fun sourcePickerFinishesOnlyAfterTheMatchingAddAcknowledgement() {
        val pending = ProjectSourceAddState.inFlight("C:\\workspace\\new-source")

        assertEquals(
            ProjectSourceAddResult.Added,
            projectSourceAddResult(
                pending,
                "project-1",
                WsEvent.ProjectSourcesUpdated(
                    "project-1",
                    "add",
                    config.copy(sources = listOf(source("C:\\workspace\\new-source"))),
                ),
            ),
        )
        assertEquals(
            ProjectSourceAddResult.Pending,
            projectSourceAddResult(
                pending,
                "project-1",
                WsEvent.ProjectSourcesUpdated("project-2", "add", config),
            ),
        )
    }

    @Test
    fun sourcePickerFinishesWhenTheReturnedHierarchyContainsTheSelectedFolder() {
        val pending = ProjectSourceAddState.inFlight("D:\\shared\\docs")
        val refreshed = config.copy(
            sources = listOf(
                source("C:\\workspace"),
                source("D:\\shared\\docs"),
            ),
        )

        assertEquals(
            ProjectSourceAddResult.Added,
            projectSourceAddResult(
                pending,
                "project-1",
                WsEvent.ProjectSourcesUpdated("project-1", "rescan", refreshed),
            ),
        )
    }

    @Test
    fun sourcePickerAcceptsTheAuthoritativeProjectConfigEcho() {
        val pending = ProjectSourceAddState.inFlight("D:\\shared\\docs")

        assertEquals(
            ProjectSourceAddResult.Added,
            projectSourceAddResult(
                pending,
                "project-1",
                WsEvent.ProjectConfig(
                    "project-1",
                    config.copy(sources = listOf(source("D:\\shared\\docs"))),
                ),
            ),
        )
    }

    @Test
    fun sourcePickerAcceptsTheAuthoritativeConfigChangedHierarchyWithoutASecondFetch() {
        val pending = ProjectSourceAddState.inFlight("D:\\shared\\docs")

        assertEquals(
            ProjectSourceAddResult.Added,
            projectSourceAddResult(
                pending,
                "project-1",
                WsEvent.ProjectConfigChanged(
                    "project-1",
                    config.copy(
                        sources = listOf(
                            source("C:\\workspace"),
                            source("D:\\shared\\docs"),
                        ),
                        repositories = listOf(repository("repo-existing", "C:\\workspace")),
                    ),
                ),
            ),
        )
    }

    @Test
    fun sourcePickerIgnoresARefreshedHierarchyThatDoesNotContainTheSelectedFolder() {
        val pending = ProjectSourceAddState.inFlight("D:\\shared\\docs")

        assertEquals(
            ProjectSourceAddResult.Pending,
            projectSourceAddResult(
                pending,
                "project-1",
                WsEvent.ProjectSourcesUpdated(
                    "project-1",
                    "rescan",
                    config.copy(sources = listOf(source("C:\\workspace"))),
                ),
            ),
        )
    }

    @Test
    fun sourcePickerStopsWaitingAndReportsAnAddError() {
        assertEquals(
            ProjectSourceAddResult.Error("Folder is unavailable"),
            projectSourceAddResult(
                ProjectSourceAddState.inFlight(),
                "project-1",
                WsEvent.ProjectSourcesError("project-1", "add", "Folder is unavailable"),
            ),
        )
    }

    @Test
    fun settingsRefreshesOnlyWhenAProjectSourceAddIsPending() {
        assertTrue(shouldRefreshProjectConfigOnResume("project-1", "project-1"))
        assertFalse(shouldRefreshProjectConfigOnResume("project-2", "project-1"))
        assertFalse(shouldRefreshProjectConfigOnResume(null, "project-1"))
    }

    private fun source(path: String) = io.nexy.android.data.model.ProjectSource(
        id = path,
        projectId = "project-1",
        label = path.substringAfterLast('\\'),
        kind = "workspace-root",
        localPath = path,
        enabled = true,
        isPrimary = path == "C:\\workspace",
    )

    private fun repository(id: String, sourcePath: String) = io.nexy.android.data.model.ProjectRepositoryBinding(
        id = id,
        projectId = "project-1",
        sourceId = sourcePath,
        label = id,
        relativePath = "",
        branch = "main",
        dirty = false,
        enabled = true,
        available = true,
    )
}
