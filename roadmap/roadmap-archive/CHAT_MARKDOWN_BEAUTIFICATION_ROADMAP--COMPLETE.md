# Chat Markdown Beautification & Cross-Platform Alignment — Implementation Roadmap

## Context

Chat messages on both platforms render markdown, but the two implementations have drifted apart in capability and neither is fully polished:

- **Desktop** (`react-markdown` + `remark-gfm` + `rehype-highlight`) is fairly mature — it has a styled code block with a copy button, GFM tables, themed inline code — but has rough edges: no styling for task-list checkboxes, loose heading rhythm for a chat-bubble context, no image handling, and spacing rules split across two competing systems (Tailwind `prose-*` modifiers vs. raw CSS in `global.css`).
- **Android** (Markwon rendering into a raw `TextView`) is significantly behind: no custom theme wiring (headings/lists/blockquotes/links all use unstyled Markwon defaults), missing GFM features (strikethrough, task lists), and — critically — **syntax highlighting is completely broken**. `android/app/src/main/java/io/nexy/android/GrammarLocatorDef.kt` is a documented no-op (`grammar()` returns `null`, `languages()` returns an empty set) because Prism4j's codegen step is incompatible with AGP's built-in Kotlin. Code blocks get a themed background but zero per-token coloring. The file's own comment already names the fix: migrate to WebView + Highlight.js.

**Goal:** bring Android up to feature/visual parity with desktop's markdown quality — same design language (palette, spacing rhythm, code-block chrome, feature set) — while keeping each platform's implementation idiomatic (Tailwind/`prose` for React, a Markwon theme + a WebView code-block island for Android).

**Decisions already made (do not re-litigate):**
1. Fix Android's broken syntax highlighting via a **WebView + Highlight.js** island scoped to fenced code blocks only, reusing desktop's exact Catppuccin Mocha theme/hex values. Desktop resolves `highlight.js` to **11.11.1** (per `package-lock.json`) — match that version on Android.
2. Alignment target is "shared visual language, native idioms" — not pixel-perfect, but clearly the same design system. Square corners, no horizontal-scroll tables, etc. on Android are acceptable native-idiom divergences.
3. Code blocks stay **intentionally dark-only** (Catppuccin Mocha) on both platforms regardless of app light/dark theme — deliberate editor-style chrome, not a bug to "fix" later.

---

## Architectural Decisions

| Question | Decision |
|---|---|
| Android code-block rendering approach | Nested WebView **per fenced code block only**, not the whole message. Rest of the message stays native Markwon/`TextView` (keeps text selection, accessibility, and the existing fast streaming path intact). |
| How is the message split so code blocks can go to a different renderer? | New pure-Kotlin `splitCodeBlocks()` scans the raw markdown for fences and returns alternating `Text`/`Code` segments *before* Markwon ever sees the string. Only `Text` segments are handed to `markwon.setMarkdown()`. |
| Behavior while a message is still streaming | Code segments render as plain monospace Compose `Text` (no WebView creation mid-stream — expensive and jank-prone). Swap to the real `CodeBlockWebView` only once `isStreaming` flips false, mirroring the existing Markwon-vs-raw-text swap already in `ChatScreenBubbles.kt`. |
| Copy-to-clipboard from the WebView | JS bridge (`@JavascriptInterface`) calls back into Kotlin, which uses native `ClipboardManager` — not `navigator.clipboard`, which is unreliable across WebView versions. |
| Shared palette source of truth | No JSON/build-pipeline token system — too much machinery for ~20 static hex values that never change. `global.css`'s Catppuccin Mocha block becomes the documented canonical copy source; Android's `theme.css` is a direct, commented port. |
| Do code blocks adapt to app light/dark theme? | No — same hardcoded Catppuccin Mocha on both platforms, always. Only the *rest* of the markdown (headings, links, blockquotes, tables, inline code) is theme-aware. |

---

## Phase 0 — Desktop Polish (Foundation, No Android Dependency)

**Goal:** Polish desktop's already-mature markdown rendering. Ships independently and is valuable even if Android work stalls. No risk, no new dependencies.

### `src/renderer/components/MarkdownRenderer.tsx`

- Add a code comment above `CodeBlockWrapper` documenting that dark-only Catppuccin Mocha styling is intentional (editor-style chrome), so it isn't "fixed" by accident later.
- **Task list checkboxes**: `remark-gfm` renders `- [ ] x` as `<input type="checkbox" disabled>` inside `<li class="task-list-item">`, currently unstyled. Add `li`/`input` component overrides: `list-none` + flex layout for task-list items, styled checkbox (rounded, `text-blue-500` accent to match link color).
- **Strikethrough**: add `prose-del:text-gray-500 dark:prose-del:text-gray-400` to the wrapper className for explicit, legible muted styling.
- **Heading rhythm**: tighten for chat-bubble context — `prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold`, step down sizes (`prose-h1:text-base prose-h2:text-[0.95rem] prose-h3:text-sm prose-h4:text-sm`), `first:prose-headings:mt-0`.
- **Table density**: reduce `th`/`td` padding to `!px-2.5 !py-1.5`; add `divide-y divide-gray-100 dark:divide-gray-800` on the table wrapper (zebra striping alone reads weak on short tables).
- **Image handling**: no `img` override exists today. Add one — `rounded-lg`, bordered (`!border !border-gray-200 dark:!border-gray-700`), `max-w-full`, `loading="lazy"` — consistent with attachment rounding already used in `MessageBubble.tsx`.
- **Copy button polish**: replace the literal "✓ Copied" text in `CopyButton` with `lucide-react` `Copy`/`Check` icons, matching the icon-first `ActionButton` pattern already in `MessageBubble.tsx`.

### `src/renderer/styles/global.css`

- Move the hand-tuned `p`/`ul`/`ol` margin rules (currently ~lines 145–154) into the Tailwind modifier string in `MarkdownRenderer.tsx` (`prose-p:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5`) so spacing rhythm lives in one place instead of two competing systems. Leave the `:first-child`/`:last-child` margin reset as-is (structural, not rhythm tuning).
- Add a comment block above the Catppuccin Mocha `.hljs*` theme (~line 156) documenting each hex value's token name/semantic role (e.g. `#cba6f7 — mauve — keyword/selector-tag`). This becomes the canonical copy-from-here source when porting to Android's `theme.css` in Phase 3.

Blockquotes are already reasonably polished (left border, subtle background, non-italic) — leave unchanged.

### Tests — extend `src/renderer/__tests__/markdown.test.tsx`

- Strikethrough (`~~x~~` → `<del>` present)
- Task list checkboxes (`- [ ] a` / `- [x] b` → two checkboxes, one checked, both disabled)
- Blockquotes render (`<blockquote>` present)
- Heading tags render (`# H1` / `## H2` → `h1`/`h2` present)
- Images render with `alt` attribute
- Skip asserting computed dark-mode CSS in jsdom (Tailwind JIT classes aren't resolved there) — just assert dark-mode-conditional elements render without throwing.

### Phase 0 Checklist

- [x] Add "intentionally dark-only" comment above `CodeBlockWrapper`
- [x] Style task-list checkboxes (`li`/`input` overrides)
- [x] Style strikethrough (`prose-del:*`)
- [x] Tighten heading rhythm (`prose-headings:*`, `prose-h1..h4:*`)
- [x] Reduce table cell padding + add row dividers
- [x] Add `img` override (rounded, bordered, lazy-loaded)
- [x] Swap copy-button text for `lucide-react` `Copy`/`Check` icons
- [x] Consolidate `p`/`ul`/`ol` margin rules into `MarkdownRenderer.tsx` Tailwind modifiers, remove from `global.css`
- [x] Add Catppuccin Mocha palette reference comment above hljs theme in `global.css`
- [x] Add strikethrough test to `markdown.test.tsx`
- [x] Add task-list checkbox test to `markdown.test.tsx`
- [x] Add blockquote render test to `markdown.test.tsx`
- [x] Add heading tag test to `markdown.test.tsx`
- [x] Add image render test to `markdown.test.tsx`

### Phase 0 Protocol Gate
```bash
npx vitest run src/renderer/__tests__/markdown.test.tsx
npm run test
npm run typecheck
npm run lint
npm run build
```
Manual check: `npm run dev`, open a chat, send/inspect a message containing headings, a task list, strikethrough, a table, an image, and a multi-language code block in both light and dark app theme.

---

## Phase 1 — Android Theme Wiring (No WebView Risk Yet)

**Goal:** Bring Markwon's native rendering (everything except fenced code blocks) up to visual parity with desktop's theme-aware styling. Ships independently; immediately visible improvement.

### `android/gradle/libs.versions.toml` + `android/app/build.gradle.kts`

Add two missing Markwon extension plugins (matching the existing `markwon` version already pinned):
```toml
markwon-ext-strikethrough = { group = "io.noties.markwon", name = "ext-strikethrough", version.ref = "markwon" }
markwon-ext-tasklist = { group = "io.noties.markwon", name = "ext-tasklist", version.ref = "markwon" }
```
```kotlin
implementation(libs.markwon.ext.strikethrough)
implementation(libs.markwon.ext.tasklist)
```

### `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt` (~lines 901–915)

Replace the bare `Markwon.builder(context)` with a theme-aware builder:
- Read `MaterialTheme.colorScheme` at the point `markwon` is `remember`'d; **re-key the `remember{}` on `colorScheme`** (not just `context`) so a live light/dark toggle rebuilds Markwon with fresh colors instead of leaving stale colors baked into cached spans.
- Add `.usePlugin(StrikethroughPlugin.create())` and `.usePlugin(TaskListPlugin.create(context))`, tinting the task checkbox via `taskListColor`/`taskListDrawable` with `colorScheme.primary` to echo desktop's blue accent.
- Add a `configureTheme(MarkwonTheme.Builder)` override: `linkColor`, `codeTextColor`/`codeBackgroundColor` (inline code only — from `colorScheme.onSurfaceVariant`/`surfaceVariant`, theme-aware like desktop's inline-code pill), `blockQuoteColor`, `blockMargin`, `bulletWidth`.
- Customize `TablePlugin` with a `TableTheme.Builder()`: border color, cell padding, header/zebra row backgrounds sourced from `colorScheme` tokens, approximating desktop's table look. Note: Markwon tables don't support rounded corners or scroll-on-overflow — accept square corners as the native-idiom divergence; do not attempt horizontal-scroll wrapping unless it becomes a real user complaint (out of scope for this pass).
- **Do not** theme the fenced-code-block chrome via `colorScheme` — that stays hardcoded Catppuccin Mocha per Phase 3, regardless of app theme.

### Tests

- No new JVM-testable surface here (Markwon theme wiring needs `SpannableStringBuilder`/`TextView`, not practically unit-testable without introducing Robolectric — explicitly deferred, see Phase 4 testing notes). Verify via manual run instead.

### Phase 1 Checklist

- [x] Add `markwon-ext-strikethrough` + `markwon-ext-tasklist` to `libs.versions.toml`
- [x] Add both new dependencies to `build.gradle.kts`
- [x] Re-key Markwon `remember{}` on `colorScheme` in `ChatScreen.kt`
- [x] Wire `StrikethroughPlugin.create()` into the builder
- [x] Wire `TaskListPlugin.create(...)` into the builder, tinted with `colorScheme.primary` (checked/unchecked/outline colors)
- [x] Add `configureTheme()` override (link/code/blockquote colors) sourced from `MaterialTheme.colorScheme`
- [x] Add `TableTheme` customization (`TableTheme.emptyBuilder()`) to `TablePlugin.create(...)`
- [x] Confirm inline code stays theme-aware while fenced code blocks are untouched by this phase

Note: used `TableTheme.emptyBuilder()` (the actual public factory) rather than a direct `TableTheme.Builder()` constructor, and `io.noties.markwon.utils.Dip.create(context).toPx(dp)` for dp→px conversion (Markwon's own internal utility, same one `TableTheme.buildWithDefaults` uses). `blockMargin`/`bulletWidth` builder methods were dropped from the original sketch — not present on `MarkwonTheme.Builder` in this Markwon version; the four wired properties (`linkColor`, `codeTextColor`, `codeBackgroundColor`, `blockQuoteColor`) cover the intended theme-awareness goal.

### Phase 1 Protocol Gate
```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lintDebug
.\gradlew.bat assembleDebug
```
Manual check: run the app on an emulator/device, toggle light/dark theme live, confirm headings/links/blockquotes/tables/strikethrough/task-list checkboxes update colors immediately without stale spans; confirm existing code-block appearance is unchanged.

---

## Phase 2 — Message Segmentation (Pure Logic, Fully Unit-Testable)

**Goal:** Build and test the code/text splitting logic in isolation, wired in with a placeholder renderer for code segments, before introducing any WebView risk.

### New File: `android/app/src/main/java/io/nexy/android/ui/chat/MarkdownCodeSplitter.kt`

```kotlin
sealed class MessageSegment {
    data class Text(val markdown: String) : MessageSegment()
    data class Code(val language: String?, val code: String) : MessageSegment()
}
fun splitCodeBlocks(markdown: String): List<MessageSegment>
```
Scans the raw markdown for fenced code blocks (triple-backtick fences) and returns alternating `Text`/`Code` segments. `Text` segments still go through Markwon normally afterward (headings/lists/tables/blockquotes spanning multiple text segments before/after a fence still work, since fences are always block-level). Decide and document the behavior for an **unterminated/streaming-partial fence** (a fence opened but not yet closed) — treat it as still part of a `Text` segment so streaming doesn't flicker a half-formed code block.

### `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreenBubbles.kt` (`MessageBubble`, ~lines 345–369)

Replace the single `AndroidView` with a `Column` iterating `splitCodeBlocks(msg.text)`, keyed by index to preserve view-instance identity across recomposition (same lesson as the existing streaming-transition fix in commit `88b07d6`):
- `Text` segments → existing `AndroidView`/Markwon `TextView` factory/update pattern, unchanged.
- `Code` segments → **placeholder for this phase**: plain monospace Compose `Text` inside a `Surface`/`Box` with the Catppuccin `base` background as a Compose `Color` constant (temporary stand-in for `CodeBlockWebView`, replaced in Phase 3). This matches the current streaming-fallback look, so there's no visual regression if Phase 3 is delayed.
- Streaming behavior unchanged: while `msg.isStreaming`, code segments always render as plain text regardless of phase.

### New File: `android/app/src/test/java/io/nexy/android/ui/chat/MarkdownCodeSplitterTest.kt`

Follow the existing `ChatThinkingParserTest.kt` conventions in the same test tree (pure-Kotlin, no Android framework dependency). Cover:
- Fence detection with and without a language tag
- Language extraction from the opening fence (```` ```kotlin ````)
- Multiple code blocks in one message
- Text-only messages (no fences) → single `Text` segment
- Unterminated/streaming-partial fence → treated as `Text` (per the documented decision above)
- Inline single-backtick code vs. triple-backtick block fence disambiguation

### Phase 2 Checklist

- [x] Create `MarkdownCodeSplitter.kt` with `MessageSegment` sealed class and `splitCodeBlocks()`
- [x] Decide and document unterminated-fence behavior (kept as `Text`, documented in the KDoc)
- [x] Update `MessageBubble` in `ChatScreenBubbles.kt` to iterate segments via a keyed `Column`
- [x] Add placeholder Compose `Text` renderer for `Code` segments (Catppuccin `base` background, monospace)
- [x] Preserve existing streaming plain-text behavior for code segments
- [x] Create `MarkdownCodeSplitterTest.kt` covering all cases listed above (8 tests: text-only, language/no-language fences, multiple blocks, unterminated fence, inline backticks, empty code block, empty message)

### Phase 2 Protocol Gate
```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lintDebug
.\gradlew.bat assembleDebug
```
Manual check: run the app, send a message containing multiple code blocks interleaved with text/headings/lists, confirm segmentation renders correctly with the placeholder styling and no regression in streaming behavior.

---

## Phase 3 — WebView + Highlight.js Code-Block Island (Highest Risk — Do Last)

**Goal:** Replace the Phase 2 placeholder with real, theme-matched, per-token syntax highlighting via a WebView island, closing the syntax-highlighting gap named in `GrammarLocatorDef.kt`.

### New assets: `android/app/src/main/assets/codeblock/`

- `highlight.min.js` — vendor highlight.js **11.11.1** (match desktop's resolved version), using a "common languages" bundle (bash, python, javascript, typescript, json, yaml, sql, java, kotlin, c, cpp, csharp, go, rust, html, css, diff) rather than the full ~1MB all-languages bundle.
- `theme.css` — direct port of `global.css`'s Catppuccin Mocha `.hljs*` rules (identical hex values) plus the header-bar/copy-button chrome translated from `CodeBlockWrapper`'s Tailwind classes into plain CSS (`.code-header`, `.code-header .lang`, `.code-body`, etc.). Add a header comment: `/* Ported from src/renderer/styles/global.css — keep hex values identical. */`

### New File: `android/app/src/main/java/io/nexy/android/ui/chat/CodeBlockWebView.kt`

- Composable wrapping `AndroidView(factory = { WebView(...) })`.
- Load content via `loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)` (not `loadData`) so relative asset references to `theme.css`/`highlight.min.js` resolve, and so injected HTML stays small (just `<link>`/`<script src>` tags plus the escaped code body).
- `key(code, language)` at the call site (or an equivalent guard in `update`) so `loadDataWithBaseURL` only re-runs when code content actually changes — not on every unrelated parent recomposition (e.g. a sibling message's streaming tick).
- Height handling: WebView does not auto-size in Compose. After `hljs.highlightAll()` runs, JS reports `document.body.scrollHeight` back through the bridge; Kotlin converts to dp and sets `Modifier.height(...)`. Show a small fixed-height skeleton until the first height report arrives, to avoid a layout jump.
- HTML generation (`buildCodeBlockHtml(language, code)`, same file or a small helper): escape `<`, `&`, `"` in the code body before interpolating, so code containing e.g. `</script>` can't structurally break the page.

### New Class: `CodeBlockBridge` (JS-to-Kotlin bridge, in `CodeBlockWebView.kt` or its own file)

```kotlin
class CodeBlockBridge(private val context: Context, private val onHeight: (Int) -> Unit) {
    @JavascriptInterface
    fun onCopy(text: String) { /* ClipboardManager.setPrimaryClip, main-thread hop */ }
    @JavascriptInterface
    fun reportHeight(px: Int) { /* main-thread hop before touching Compose state */ }
}
```
**Critical gotcha**: `@JavascriptInterface` methods run on a non-UI thread by default. Both `onCopy`'s clipboard/feedback work and `reportHeight`'s `mutableStateOf` write **must** be dispatched to the main thread (`Handler(Looper.getMainLooper()).post {}` or `withContext(Dispatchers.Main)`) before touching Compose state or views, or the app will crash with "only the original thread that created a view hierarchy can touch its views."

### `android/app/proguard-rules.pro`

Uncomment the existing (already-present, currently commented-out) `@JavascriptInterface`-keep template at lines 8–11 and point it at `CodeBlockBridge`'s fully-qualified class name, so release builds don't strip/rename the bridge methods — this is a real "works in debug, silently breaks in release" bug class if skipped.

### Wire-up

Replace the Phase 2 placeholder `Code` segment renderer in `ChatScreenBubbles.kt` with `CodeBlockWebView(language, code)`, gated on `!msg.isStreaming` (streaming still shows the Phase 2 plain-text fallback).

### Tests — new file `android/app/src/test/java/io/nexy/android/ui/chat/CodeBlockHtmlTest.kt`

WebView itself cannot be meaningfully unit-tested in a plain JVM test (no real engine available; Robolectric's WebView shadow is a no-op that won't execute JS). Scope tests to what's pure-JVM-testable:
- `buildCodeBlockHtml()` correctly HTML-escapes `<`, `&`, `"` in the code body
- `buildCodeBlockHtml()` includes correct `<link>`/`<script>` asset references and the expected `language-*` class
- (Optional, lower priority) one `androidTest` instrumented smoke test asserting the `reportHeight` bridge callback fires with a non-zero value within a timeout on a real device/emulator — nice-to-have, not blocking.
- Do **not** add Robolectric for a Markwon-theme smoke test in this pass — new test infra for a single feature; defer unless the team wants Robolectric more broadly for other reasons.

### Phase 3 Checklist

- [x] Vendor `highlight.min.js` (11.11.1, common-languages bundle) into `android/app/src/main/assets/codeblock/`
- [x] Port `theme.css` from `global.css`'s Catppuccin Mocha rules + code-block chrome CSS into `android/app/src/main/assets/codeblock/theme.css`, with sync-source comment
- [x] Create `CodeBlockWebView.kt` composable with `AndroidView`/`WebView`, `loadDataWithBaseURL`, and `remember(code, language)` guard
- [x] Implement height-reporting flow (JS `scrollHeight` → bridge → `Modifier.height`) with skeleton state until first report
- [x] Implement `buildCodeBlockHtml()` with proper HTML-escaping (in its own file, `CodeBlockHtml.kt`, for pure-JVM testability)
- [x] Create `CodeBlockBridge` with `onCopy` (native `ClipboardManager`) and `reportHeight`, both hopping to main thread via `Handler(Looper.getMainLooper())`
- [x] Add the `@JavascriptInterface` keep-rule in `proguard-rules.pro` for `CodeBlockBridge`
- [x] Replace Phase 2 placeholder with `CodeBlockWebView` for settled (non-streaming) messages
- [x] Create `CodeBlockHtmlTest.kt` covering HTML-escaping and asset reference correctness (9 tests)
- [ ] (Optional) instrumented `androidTest` smoke test for height-reporting — not done, still optional/deferred per the roadmap

Notes:
- `highlight.min.js` was built locally with esbuild from the exact `highlight.js@11.11.1` package already vendored in the desktop app's `node_modules` (a transitive dependency of `rehype-highlight`) — guarantees an exact version match with zero external fetches. Bundled languages: bash/sh, python/py, javascript/js, typescript/ts, json, yaml/yml, markdown/md, sql, java, kotlin/kt, c, cpp, csharp/cs, go, rust/rs, xml/html, css, diff, plaintext. Output verified via a Node `vm` sandbox to confirm `hljs.highlight()` produces the expected `hljs-*` classes before shipping it as an asset.
- `CodeBlockBridge` is a private top-level class in `CodeBlockWebView.kt`; its Proguard rule targets `io.nexy.android.ui.chat.CodeBlockBridge` directly (Kotlin top-level classes aren't nested under a file-name outer class the way Java nested classes are).
- Verified the release build (`assembleRelease`) succeeds, but this project currently has `isMinifyEnabled = false` for the release build type, so R8/Proguard doesn't actually run yet — the keep-rule is correctly in place for whenever minification is turned on, matching the pre-existing (previously commented-out) template that anticipated this same scenario, but doesn't have a minified build to validate against today.

### Phase 3 Protocol Gate
```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lintDebug
.\gradlew.bat assembleDebug
# Release-build check specifically for the Proguard keep-rule:
.\gradlew.bat assembleRelease
```
Manual check: run on an emulator/device, send/receive messages with code blocks across several languages (Python, JS/TS, JSON, bash, and one language with no highlight.js grammar to confirm graceful fallback to unstyled `<pre>`), confirm:
- Per-token syntax coloring matches desktop's Catppuccin Mocha palette side-by-side
- Copy button works and confirms via native clipboard
- No jank/crash while a code fence is streaming in, then finalizes into the WebView island once streaming ends
- No layout jump/flicker when the WebView height resolves
- A release build (`assembleRelease`) still has working copy/highlight (validates the Proguard rule)

---

## Files Created / Modified Summary

| File | Status | Phase |
|---|---|---|
| `src/renderer/components/MarkdownRenderer.tsx` | Modify | 0 |
| `src/renderer/styles/global.css` | Modify | 0 |
| `src/renderer/__tests__/markdown.test.tsx` | Modify | 0 |
| `android/gradle/libs.versions.toml` | Modify | 1 |
| `android/app/build.gradle.kts` | Modify | 1 |
| `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt` | Modify | 1 |
| `android/app/src/main/java/io/nexy/android/ui/chat/MarkdownCodeSplitter.kt` | **Create** | 2 |
| `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreenBubbles.kt` | Modify | 2, 3 |
| `android/app/src/test/java/io/nexy/android/ui/chat/MarkdownCodeSplitterTest.kt` | **Create** | 2 |
| `android/app/src/main/assets/codeblock/highlight.min.js` | **Create** | 3 |
| `android/app/src/main/assets/codeblock/theme.css` | **Create** | 3 |
| `android/app/src/main/java/io/nexy/android/ui/chat/CodeBlockWebView.kt` | **Create** | 3 |
| `android/app/proguard-rules.pro` | Modify | 3 |
| `android/app/src/test/java/io/nexy/android/ui/chat/CodeBlockHtmlTest.kt` | **Create** | 3 |

---

## Key Reusable Utilities / Reference Points (do not rewrite these)

- `MarkdownRenderer.tsx` `CodeBlockWrapper`, `CopyButton`, `extractLang` — existing desktop code-block chrome, the visual reference Android's WebView island must match
- `global.css` Catppuccin Mocha `.hljs*` block (~lines 156–253) — canonical palette source for Android's `theme.css` port
- `ActionButton` icon-first pattern — `MessageBubble.tsx` — reference for the copy-button icon swap
- `ChatThinkingParserTest.kt` (`android/app/src/test/`) — existing pure-Kotlin streamed-text parser test, structural template for `MarkdownCodeSplitterTest.kt`
- Existing streaming/settled swap logic in `ChatScreenBubbles.kt` (fixed in commit `88b07d6`) — the precedent for "reuse the same view instance, swap rendering mode on `isStreaming` transition" that Phases 2–3 extend
- `proguard-rules.pro` lines 8–11 — pre-existing (commented) WebView JS-interface keep-rule template, already anticipated in this codebase
