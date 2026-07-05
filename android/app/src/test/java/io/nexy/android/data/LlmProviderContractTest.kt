package io.nexy.android.data

import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LlmProviderContractTest {
    @Test
    fun anthropicRecordedEventsNormalizeTextThinkingUsageAndFinishReason() = runTest {
        val sink = RecordingSink()
        ANTHROPIC_FIXTURE.forEach { parseAnthropicStreamEvent(JSONObject(it), sink) }

        assertEquals("Hello", sink.text)
        assertEquals("plan", sink.thinking)
        assertEquals(12, sink.inputTokens)
        assertEquals(7, sink.outputTokens)
        assertEquals("end_turn", sink.finishReason)
    }

    @Test
    fun openAiRecordedEventsNormalizeTextReasoningUsageAndFinishReason() = runTest {
        val sink = RecordingSink()
        OPENAI_FIXTURE.forEach { parseOpenAiStreamEvent(JSONObject(it), sink) }

        assertEquals("Hello", sink.text)
        assertEquals("plan", sink.thinking)
        assertEquals(11, sink.inputTokens)
        assertEquals(6, sink.outputTokens)
        assertEquals("stop", sink.finishReason)
    }

    @Test
    fun malformedAndProviderErrorEventsAreHandledDeterministically() = runTest {
        val sink = RecordingSink()
        parseOpenAiStreamEvent(JSONObject("""{"choices":[{"delta":{}}]}"""), sink)
        assertEquals("", sink.text)
        assertThrows(IOException::class.java) {
            kotlinx.coroutines.runBlocking {
                parseAnthropicStreamEvent(
                    JSONObject("""{"type":"error","error":{"message":"rate limited"}}"""),
                    sink,
                )
            }
        }
    }

    private class RecordingSink : LlmEventSink {
        override var inputTokens = 0
        override var outputTokens = 0
        override var finishReason: String? = null
        var text = ""
        var thinking = ""

        override suspend fun text(chunk: String) { text += chunk }
        override fun startThinking(blockId: String) = Unit
        override suspend fun thinking(blockId: String, chunk: String) { thinking += chunk }
        override suspend fun endThinking(blockId: String) = Unit
    }

    companion object {
        private val ANTHROPIC_FIXTURE = listOf(
            """{"type":"message_start","message":{"usage":{"input_tokens":12}}}""",
            """{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}""",
            """{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}""",
            """{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}""",
            """{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}""",
        )
        private val OPENAI_FIXTURE = listOf(
            """{"choices":[{"delta":{"reasoning_content":"plan"}}]}""",
            """{"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}""",
            """{"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":6}}""",
        )
    }
}
