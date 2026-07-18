# Roadmap: Phase 1 — Shared Primitives & Helpers

Drafted 2026-07-18. **Status: COMPLETE (landed in the refactor pass).**

## Summary

Phase 1 built the additive, zero-behaviour-change primitives that Phase 2 adoption depends on. It is recorded here for completeness and so the acceptance criteria are auditable; no further work is required unless a listed primitive needs extension.

## Issue → item map

| # | Item | Status |
|---|---|---|
| 1 | Renderer `ConfirmDialog` primitive | Done |
| 2 | Renderer `useClickOutside` hook | Done |
| 3 | Renderer `section-pane/pane-primitives.tsx` | Done |
| 4 | Delete dead `PhaseBar` + duplicate `useToasts`/`Toast` | Done |
| 5 | Consolidate `hasIpcError` → `isApiError` | Done |
| 6 | Main `emit-utils.ts` `emitToAll` | Done |
| 7 | Main `db-row-mapper.ts` `mapRow` | Done |
| 8 | Provider HTTP consolidation (`http-client`, `providers/streaming.ts`) | Done |
| 9 | CLI-adapter primitives in `cli-adapters/utils.ts` | Done |
| 10 | Android generic `GeneratorViewModel<Spec>` base | Done |

## What was built

**Renderer** — `Priority: P1 · Effort: M · Risk: low`
- `src/renderer/components/ui/ConfirmDialog.tsx` — composed from `ModalShell` + `Button variant="dangerSolid"`; props `title`/`heading`/`confirmLabel`/`busy`/`irreversible`. Test: `src/renderer/__tests__/confirm-dialog.test.tsx`.
- `src/renderer/hooks/useClickOutside.ts` — single/array refs, `active` gate, callback-in-ref.
- `src/renderer/components/section-pane/pane-primitives.tsx` — `PaneHeader`, `PaneHeaderButton`, `PaneSearchInput`, `PaneSkeleton`, `PaneEmptyState`.
- Added `dangerSolid` to `Button` variants (`primitives.tsx`); deleted `PhaseBar` and `Toast.tsx`'s local `useToasts`/`Toast` (store `uiSlice` is the single source).

**Main** — `Priority: P1 · Effort: M · Risk: low`
- `src/main/emit-utils.ts` `emitToAll(event, data, win?)`; `src/main/db-row-mapper.ts` `mapRow<T>` + `snakeToCamel` (tests in `__tests__/db-row-mapper.test.ts`).
- `src/main/http-client.ts` gained `httpsRequestUrl` + `providerHttpError`; `src/main/providers/streaming.ts` `runStreamingRequest`/`rejectHttpError`; Anthropic moved onto `parseSseStream`; Azure folded into OpenAI via a `ChatEndpoint` config.
- `src/main/cli-adapters/utils.ts` gained `stripAnsi`, `createLineBuffer`, `createOpenBlockTracker` (tests in `__tests__/cli-adapter-utils.test.ts`).

**Android** — `Priority: P1 · Effort: M · Risk: low`
- `android/.../ui/generator/GeneratorViewModel.kt` — generic base owning the CHAT/SPEC_REVIEW/DONE state machine, session guarding, streaming accumulation; per-feature adapters supply `mapEvent`/`specPayload`. Gated by the existing `GeneratorViewModelParityTest.kt`.

## Acceptance criteria (all met)

- `npm run typecheck` / `npm run lint` clean (2 pre-existing warnings only).
- New unit tests pass: `confirm-dialog`, `db-row-mapper`, `cli-adapter-utils`.
- `gradlew testDebugUnitTest` green, including `GeneratorViewModelParityTest`.
