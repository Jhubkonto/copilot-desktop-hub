package io.nexy.android

import io.noties.prism4j.GrammarLocator
import io.noties.prism4j.Prism4j

// No-op locator: SyntaxHighlightPlugin still applies Darkula theme colors to code blocks,
// but per-token syntax highlighting is unavailable without the prism4j-bundler codegen step
// (incompatible with AGP built-in Kotlin). Upgrade path: migrate to Highlight.js via WebView,
// or use a different syntax highlight library that doesn't require annotation processing.
class GrammarLocatorDef : GrammarLocator {
    override fun grammar(prism4j: Prism4j, language: String): Prism4j.Grammar? = null
    override fun languages(): MutableSet<String> = mutableSetOf()
}
