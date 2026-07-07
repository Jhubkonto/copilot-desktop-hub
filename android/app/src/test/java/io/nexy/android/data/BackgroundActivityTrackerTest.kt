package io.nexy.android.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundActivityTrackerTest {

    @After
    fun tearDown() {
        // The tracker is a process-wide singleton; leave it clean for other tests.
        BackgroundActivityTracker.activities.value.forEach { BackgroundActivityTracker.unregister(it.id) }
    }

    @Test
    fun registerAddsAnActivity() {
        BackgroundActivityTracker.register("a", "Generating agent…", "agent-generator")
        assertEquals(listOf(BackgroundActivity("a", "Generating agent…", "agent-generator")), BackgroundActivityTracker.activities.value)
    }

    @Test
    fun registeringSameIdTwiceReplacesRatherThanDuplicates() {
        BackgroundActivityTracker.register("a", "Generating agent…", "agent-generator")
        BackgroundActivityTracker.register("a", "Still generating…", "agent-generator")
        assertEquals(1, BackgroundActivityTracker.activities.value.size)
        assertEquals("Still generating…", BackgroundActivityTracker.activities.value.single().label)
    }

    @Test
    fun unregisterRemovesTheActivity() {
        BackgroundActivityTracker.register("a", "Generating agent…", "agent-generator")
        BackgroundActivityTracker.unregister("a")
        assertTrue(BackgroundActivityTracker.activities.value.isEmpty())
    }

    @Test
    fun unregisteringUnknownIdIsANoOp() {
        BackgroundActivityTracker.register("a", "Generating agent…", "agent-generator")
        BackgroundActivityTracker.unregister("does-not-exist")
        assertEquals(1, BackgroundActivityTracker.activities.value.size)
    }

    @Test
    fun multipleActivitiesTrackedIndependently() {
        BackgroundActivityTracker.register("a", "Generating agent…", "agent-generator")
        BackgroundActivityTracker.register("b", "Generating project…", "project-generator")
        assertEquals(2, BackgroundActivityTracker.activities.value.size)
        BackgroundActivityTracker.unregister("a")
        assertEquals(listOf("b"), BackgroundActivityTracker.activities.value.map { it.id })
    }
}
