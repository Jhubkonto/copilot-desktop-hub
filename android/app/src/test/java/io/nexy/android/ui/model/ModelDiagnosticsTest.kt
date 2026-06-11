package io.nexy.android.ui.model

import io.nexy.android.data.model.Agent
import io.nexy.android.data.model.ModelListSource
import io.nexy.android.data.model.ModelOption
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelDiagnosticsTest {
    @Test
    fun describesCliModelSource() {
        val source = ModelListSource("cli", "Codex CLI models", "codex-cli")

        assertEquals("Codex CLI models", modelSourceTitle(source))
        assertEquals("Codex CLI is providing 3 models.", modelSourceDetail(source, 3))
    }

    @Test
    fun explainsMissingBackend() {
        val source = ModelListSource("none", "No configured model backend")

        assertEquals(
            "No CLI or API provider is configured on the paired desktop.",
            modelSourceDetail(source, 0),
        )
        assertEquals(
            "Configure Claude CLI, Codex CLI, or an API provider on desktop to choose models here.",
            emptyModelListDetail(source),
        )
    }

    @Test
    fun resolvesActiveModelLabelAndDefaultDetail() {
        val models = listOf(
            ModelOption("default", "Default model"),
            ModelOption("gpt-5-mini", "GPT-5 mini", "OpenAI"),
        )
        val agent = Agent(
            id = "agent-1",
            name = "Reviewer",
            backend = "claude-cli",
            cliModel = "claude-sonnet-4",
        )

        assertEquals("GPT-5 mini", activeModelLabel("gpt-5-mini", models))
        assertEquals("Default model", activeModelLabel(null, models))
        assertEquals(
            "Using Reviewer's default model: claude-sonnet-4.",
            activeModelDetail(null, agent, null),
        )
        assertEquals(
            "This conversation overrides the default model.",
            activeModelDetail("gpt-5-mini", agent, null),
        )
    }
}
