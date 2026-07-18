# Roadmap: Phase 4 — UI Smoothness, Animation Fluidity & Rendering Consistency

Drafted 2026-07-18. **Status: PARTIAL — scroll-jank + reduced-motion landed; motion-token unification below.**

## Summary

Phase 4 targets perceived smoothness: scroll jank, streaming re-parse cost, animation consistency, and reduced-motion accessibility. The measured scroll hotspot and the accessibility gap are **already fixed**. Remaining work standardises the two competing animation systems (CSS keyframes vs the lone `framer-motion` file) into one token set, and gives Android a parallel motion object.

## Landed already

- `ChatMessages.handleScroll` now rAF-coalesces the O(n) `getBoundingClientRect` visibility recompute (was called synchronously on every scroll event — the "lag right before reaching the bottom" vector).
- Global `@media (prefers-reduced-motion: reduce)` block in `global.css` collapses all animations/transitions (previously only `stream-fade-in` opted out, so `message-enter`, the shimmer skeleton, and spinners still animated for reduced-motion users).

## Issue → item map (remaining)

| # | Issue | Priority · Effort · Risk |
|---|---|---|
| 1 | Streaming markdown re-parses whole message per throttled tick | P2 · M · med |
| 2 | Motion tokens (durations/easings) + `useReducedMotion` hook | P3 · M · low |
| 3 | Decide framer-motion policy (used in 1 file) | P3 · S · low |
| 4 | Android `NexyMotion` spec object + list-primitive adoption | P3 · M · low |

---

## Item 1 — Streaming markdown incremental parse

**Goal:** `ChatMessages` throttles what it hands `MarkdownRenderer` (`useThrottledValue` + `CHAT_MARKDOWN_THROTTLE_MS`), but each tick still re-parses the full trailing text through ReactMarkdown + rehype-highlight. Memoize so only the trailing open block re-parses.

**Key changes:** Split committed (stable) markdown from the in-flight trailing block; `memo` the committed portion keyed by content so only the growing tail re-renders. Measure with React Profiler on a long streaming turn before/after.

**Acceptance criteria:** Profiler shows the committed-message subtree not re-rendering on each streamed tick; no visual change to streaming output (incl. incomplete code fences).

## Item 2 — Motion tokens + `useReducedMotion`

**Goal:** Durations/easings are scattered as literals across `global.css` and Tailwind arbitrary values. Centralise a small token set (`--motion-fast`/`--motion-base`/standard easing) in `tailwind.config.js`; add a `useReducedMotion()` hook for JS-driven animations to consult.

**Key changes:** Define tokens; migrate `message-enter` (200ms), `stream-fade-in` (260ms), shimmer to reference them. Expose the tokens to any JS animation path.

**Acceptance criteria:** Animations visually unchanged; a single place governs timing; reduced-motion still fully honoured.

## Item 3 — framer-motion policy

**Goal:** `framer-motion` is imported in exactly one file (`ChatWindow.tsx`) while everything else is CSS. Decide: remove it (convert that usage to CSS for consistency + bundle size) or bless it for enter/exit only. **Recommendation: remove.**

**Key changes:** Reimplement the `ChatWindow` usage as a CSS transition/keyframe honouring the reduced-motion block; drop the dependency from `package.json`.

**Acceptance criteria:** No `framer-motion` in the bundle; the affected transition looks equivalent; bundle-size delta recorded.

## Item 4 — Android `NexyMotion` + list primitives

**Goal:** Android Compose animation specs (`animateXxxAsState`) are ad hoc. Add a `NexyMotion` object in `ui/components/` (standard durations/easings) and adopt `NexySkeletonLoader`/`NexyEmptyState`/`NexyListRow` in the worst list screens (`HomeScreenTabs`).

**Key changes:** Define `NexyMotion`; migrate 2–3 list screens onto the existing `NexyUx.kt` primitives (which are under-used by the largest screens). Full bespoke-screen rewrites are out of scope — see [DEFERRED_DEEP_UI_REWRITES.md](DEFERRED_DEEP_UI_REWRITES.md).

**Acceptance criteria:** `gradlew assembleDebug` green; migrated screens visually equivalent; motion specs reference `NexyMotion`.

## Verification

Per-batch gates as in README, plus React Profiler traces for Item 1 and a bundle-size diff for Item 3.
