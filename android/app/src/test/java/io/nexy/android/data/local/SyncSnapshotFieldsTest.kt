package io.nexy.android.data.local

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Regression coverage for the "Add agent" duplicate-name bug and the project
 * rootDirectory-never-syncs bug: both were caused by [LocalDataRepository.applySyncSnapshot]
 * looking for a "config_json" wrapper key that desktop's buildSnapshot() (standalone-sync.ts)
 * never sends. These fixtures mirror desktop's actual row shapes exactly.
 */
class SyncSnapshotFieldsTest {

    @Test
    fun agentFieldsAreReadFromTheFlattenedRowRoot() {
        // Desktop spreads agent config directly onto the row (standalone-sync.ts:385-389) —
        // there is no "config" or "config_json" wrapper key.
        val row = JSONObject(
            """
            {
              "id": "agent-1",
              "name": "Release Manager",
              "icon": "🚀",
              "backend": "claude-cli",
              "cliModel": "claude-sonnet-4.6",
              "created_at": 1000,
              "updated_at": 2000
            }
            """.trimIndent()
        )

        val fields = agentFieldsFromSnapshotRow(row)

        assertEquals("Release Manager", fields.name)
        assertEquals("🚀", fields.icon)
        assertEquals("claude-cli", fields.backend)
        assertEquals("claude-sonnet-4.6", fields.cliModel)
    }

    @Test
    fun agentNameFallsBackToDefaultOnlyWhenTrulyMissing() {
        val row = JSONObject("""{ "id": "agent-2" }""")

        val fields = agentFieldsFromSnapshotRow(row)

        assertEquals("Agent", fields.name)
        assertNull(fields.backend)
        assertNull(fields.cliModel)
    }

    @Test
    fun projectFieldsAreReadFromTheNestedConfigKey() {
        // Desktop nests project config under "config" (standalone-sync.ts:377), not "config_json".
        val row = JSONObject(
            """
            {
              "id": "project-1",
              "name": "Nexy",
              "color": "blue",
              "config": {
                "rootDirectory": "C:/repo/nexy",
                "instructions": "Ship carefully"
              },
              "created_at": 1000,
              "updated_at": 2000
            }
            """.trimIndent()
        )

        val fields = projectFieldsFromSnapshotRow(row)

        assertEquals("Nexy", fields.name)
        assertEquals("blue", fields.color)
        assertEquals("C:/repo/nexy", fields.rootDirectory)
        assertEquals("Ship carefully", JSONObject(fields.configJson).optString("instructions"))
    }

    @Test
    fun projectRootDirectoryIsNullWhenConfigIsAbsent() {
        val row = JSONObject("""{ "id": "project-2", "name": "Empty", "color": "red" }""")

        val fields = projectFieldsFromSnapshotRow(row)

        assertNull(fields.rootDirectory)
        assertEquals("{}", fields.configJson)
    }
}
