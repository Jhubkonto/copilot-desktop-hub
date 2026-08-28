package io.nexy.android.ui.chat

enum class MarkdownViewMode(val storedValue: String) {
    Rendered("rendered"),
    Raw("raw"),
    ;

    companion object {
        fun fromStoredValue(value: String?): MarkdownViewMode =
            entries.firstOrNull { it.storedValue == value } ?: Rendered
    }
}
