# Roadmap: Deferred — Deep UI Rewrites

Drafted 2026-07-18. **Status: DEFERRED (evidence-gated).**

## Summary

Three UI-heavy items are high value but too risky/large for a refactor pass, and each should be triggered by concrete evidence rather than done speculatively. This document records the item, why it's deferred, and the specific signal that should promote it to `roadmap-in-progress`.

## Items

### 1. Chat message list virtualization

`Priority: P2 · Effort: L · Risk: high`

**What:** `ChatMessages` renders every message group and every `MarkdownRenderer` (rehype-highlight) instance at once — no `react-window`/virtuoso. Long conversations mount everything.

**Why deferred:** Virtualization has real behavioural risk to scroll anchoring, streaming autoscroll (`useAutoScroll.ts`), and dynamic message heights. The completed rAF scroll-recompute fix (Phase 4) removed the measured jank vector first.

**Promotion trigger:** Post-fix React Profiler traces on a 200+ message conversation still show mount/scroll cost above budget. Only then is windowed rendering justified — and it should preserve the existing sticky-scroll and highlight behaviour, validated against `useAutoScroll` tests.

### 2. `uiSlice` full split / store re-architecture

`Priority: P3 · Effort: M · Risk: med`

**What:** `uiSlice.ts` (362 lines) is a catch-all: theme, toasts, tool-approval queue, per-conversation status arrays, model catalog, debug flags.

**Why deferred:** It works. A split is refactor-for-its-own-sake without evidence that its breadth causes real re-render or maintainability cost. (Phase 3 Item 5 tracks the scoped version.)

**Promotion trigger:** Profiler shows an unrelated `uiSlice` subscriber re-rendering on model-catalog or conversation-status churn, or a concrete bug traced to the slice's breadth.

### 3. Android bespoke-screen rewrites onto `NexyUx`

`Priority: P3 · Effort: L (per screen) · Risk: high`

**What:** The largest Android screens — `ChatScreen.kt` (86KB), `AgentConfigScreen.kt` (86KB), `HomeScreenTabs.kt` (58KB), `ProjectConfigScreen.kt` (52KB) — are substantially bespoke layout that likely re-implements list rows, section headers, and form fields the `NexyUx.kt` kit (`NexyListRow`, `NexyFormSheet`, `NexySearchField`, etc.) already provides.

**Why deferred:** Each is a multi-day rewrite with high visual-regression risk and no automated UI coverage to catch drift. Doing them in one sweep would be unreviewable.

**Promotion trigger:** Do incrementally, one screen per effort, each as its own tracked item — start when a screen needs functional changes anyway (fold the `NexyUx` adoption into that work rather than as a standalone rewrite). Phase 4 Item 4 already adopts the list primitives in `HomeScreenTabs` as the smallest first step.

## Verification

Each promoted item carries its own acceptance criteria and the standard gates (README). Items 1 and 3 additionally require a before/after profiling or visual-diff artifact attached to the PR, since the whole point is that they're evidence-gated.
