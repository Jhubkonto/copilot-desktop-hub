package io.nexy.android.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SkillPackageParserTest {
    @Test
    fun `parses portable skill package files without a desktop path`() {
        val skill = parseSkillConfig(
            JSONObject(
                """
                {
                  "id": "skill-1",
                  "name": "portable-skill",
                  "description": "Use for package parsing.",
                  "instructions": "Read the guide.",
                  "contentHash": "abc123",
                  "packageFiles": [
                    {
                      "relativePath": "SKILL.md",
                      "encoding": "utf8",
                      "content": "entry",
                      "sizeBytes": 5
                    },
                    {
                      "relativePath": "assets/pixel.bin",
                      "encoding": "base64",
                      "content": "AAEC/w==",
                      "sizeBytes": 4
                    }
                  ]
                }
                """.trimIndent(),
            ),
        )

        assertEquals(null, skill.packagePath)
        assertEquals("abc123", skill.contentHash)
        assertEquals(listOf("SKILL.md", "assets/pixel.bin"), skill.packageFiles.map { it.relativePath })
        assertEquals(listOf("utf8", "base64"), skill.packageFiles.map { it.encoding })
    }
}
