package io.nexy.android.data

import org.junit.Assert.*
import org.junit.Test

class StandaloneModeTransitionTest {

    @Test
    fun turningStandaloneOn_reportsEntered() {
        assertEquals(
            StandaloneModeTransition.ENTERED_STANDALONE,
            standaloneModeTransition(prefer = true, wasStandalone = false),
        )
    }

    @Test
    fun turningStandaloneOff_reportsExited() {
        assertEquals(
            StandaloneModeTransition.EXITED_STANDALONE,
            standaloneModeTransition(prefer = false, wasStandalone = true),
        )
    }

    @Test
    fun stayingStandalone_reportsNone() {
        assertEquals(
            StandaloneModeTransition.NONE,
            standaloneModeTransition(prefer = true, wasStandalone = true),
        )
    }

    @Test
    fun stayingNonStandalone_reportsNone() {
        assertEquals(
            StandaloneModeTransition.NONE,
            standaloneModeTransition(prefer = false, wasStandalone = false),
        )
    }
}
