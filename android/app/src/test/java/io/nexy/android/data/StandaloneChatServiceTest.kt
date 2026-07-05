package io.nexy.android.data

import io.nexy.android.data.model.HistoryMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StandaloneChatServiceTest {
    @Test
    fun contextTruncationKeepsNewestCompleteMessagesDeterministically() {
        val history = listOf(
            HistoryMessage("1", "user", "a".repeat(40), 1),
            HistoryMessage("2", "assistant", "b".repeat(40), 2),
            HistoryMessage("3", "user", "c".repeat(40), 3),
        )

        val retained = StandaloneChatService.truncateHistory(history, maximumCharacters = 80)

        assertEquals(listOf("2", "3"), retained.map { it.id })
        assertEquals(80, retained.sumOf { it.content.length })
    }

    @Test
    fun contextTruncationDoesNotAlterHistoryWithinBudget() {
        val history = listOf(HistoryMessage("1", "user", "hello", 1))

        assertTrue(StandaloneChatService.truncateHistory(history, 100) === history)
    }

    @Test
    fun estimatesKnownStandardProviderPricingAndLeavesUnknownRoutesUnpriced() {
        assertEquals(
            0.0175,
            StandaloneChatService.estimateCostUsd("openai", "gpt-5.4", 1_000, 1_000),
            0.000001,
        )
        assertEquals(
            0.0,
            StandaloneChatService.estimateCostUsd("openrouter", "openai/gpt-5.4", 1_000, 1_000),
            0.0,
        )
    }
}
