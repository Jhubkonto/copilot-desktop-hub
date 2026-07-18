# Roadmap: Phase 2 — Adoption Migrations

Drafted 2026-07-18. **Status: PARTIAL — high-value items landed; the remaining mechanical sweeps are the roadmap work below.**

## Summary

Phase 2 migrates existing call sites onto the Phase 1 primitives. The behaviour-critical extractions (build runner, provider router, CLI adapters, generator ViewModels) and the highest-duplication renderer items (6 dialogs, click-outside, pane skeleton/empty) are **already done**. What remains are large-but-mechanical sweeps that are low logic risk but high diff volume, best done in reviewable batches.

## Landed already

- Renderer: 6 delete/discard dialogs → `ConfirmDialog`; 7 click-outside sites + `DropdownPanel` → `useClickOutside`; 10 panes → `PaneSkeleton`/`PaneEmptyState`; danger class strings → `Button variant="dangerSolid"`.
- Main: `build-runner.ts` consumed by `build-handlers.ts` + `android-handlers.ts` (incl. `mapBuildRecord`); one provider streaming router (`streamProviderMessage`) consumed by `orchestrator.ts` + `agent-turn-runner.ts`; CLI adapters on the shared line-buffer/segmentation primitives.
- Android: all 5 generator ViewModels on `GeneratorViewModel<Spec>`.

## Issue → item map (remaining)

| # | Issue | Priority · Effort · Risk |
|---|---|---|
| 1 | `emitToAll` sweep across the ~137 dual-emit call sites | P2 · L · low |
| 2 | `mapRow` sweep across the ~30 `rowTo*` mappers | P2 · L · low |
| 3 | 11 hand-rolled modals → `ModalShell` | P2 · M · med |
| 4 | Pane header + search-input primitive adoption (remaining panes) | P3 · S · low |
| 5 | Android generator `*Screen.kt` shared scaffold | P3 · M · med |

---

## Item 1 — `emitToAll` sweep

**Goal:** Replace the 137 line-adjacent `webContents.send(x)` + `broadcastToMobile({event:x})` pairs with `emitToAll(x, data, win)` from `src/main/emit-utils.ts`.

**Key changes:** Sweep file-by-file (greppable: `broadcastToMobile({ event:`). Representative files: `orchestrator.ts`, `artifacts.ts`, `agents.ts`, `automated-workflow-executor.ts`, `debrief-handlers.ts`. Leave `broadcastToMobile`-only calls (mobile-specific events) untouched.

**Acceptance criteria:** No behaviour change; grep for the adjacent-pair pattern returns zero; existing broadcast tests pass.

## Item 2 — `mapRow` sweep

**Goal:** Retire the ~30 hand-written `rowTo*` mappers in favour of `mapRow<T>(row, { booleans, jsonFallbacks })` (`src/main/db-row-mapper.ts`).

**Key changes:** Convert one module at a time, keeping the exported mapper's name/signature so call sites don't change. Targets: `agents.ts:90`, `artifacts.ts:120/133/150`, `scheduler-engine.ts:31/57`, `rating-handlers.ts:141`, `error-report-handlers.ts:25`, `skills.ts:52`, `prompt-handlers.ts:58/116`, `remote-edit/*`, `wiki-handlers.ts:10`, `project-audit.ts:137/161`, `conversation-export.ts:84`, `automated-workflow-runs.ts:79/116/134`. Watch for mappers doing bespoke transforms (e.g. `agents.ts` `rowToConfig` normalises tool config) — those keep their custom body and only adopt `mapRow` for the plain fields.

**Acceptance criteria:** Each converted module's tests pass; snake→camel output byte-identical to before (add a characterization test per table if none exists).

## Item 3 — Hand-rolled modals → `ModalShell`

**Goal:** The 6 generator modals + `AgentPanel`, `ProjectPanel`, `SkillPanel`, `OnboardingModal`, `CreateProjectPanel`, `RevisePlanControl` currently hand-roll `fixed inset-0` chrome and skip the shared focus trap. Migrate to `ModalShell` (`src/renderer/components/ui/primitives.tsx`).

**Key changes:** Wrap each in `ModalShell` with `title`/`footer`/`onClose`; delete the bespoke backdrop + escape-key handling; verify `useFocusTrap` doesn't conflict with any internal `useAutoScroll` focus management in the generator modals.

**Acceptance criteria:** Each modal traps focus, closes on Escape + backdrop, renders correctly in light/dark. Manual visual pass required.

## Item 4 — Pane header/search adoption

**Goal:** Adopt `PaneHeader`/`PaneHeaderButton`/`PaneSearchInput` in the panes still using inline header + search markup (the skeleton/empty primitives are already adopted).

**Key changes:** `AgentsPane`, `ChatsPane`, `SkillsPane`, `ArtifactsPane`, `ProjectsPane`, `RatingsPane` — replace the inline header row and search `<input>` block. `ChatsPane` uses a slightly different inline search style; reconcile to `PaneSearchInput` or document the intentional difference.

**Acceptance criteria:** Panes render identically; search/`useDeferredValue` behaviour unchanged.

## Item 5 — Android generator screen scaffold

**Goal:** The five `*GeneratorScreen.kt` (25–28KB each) are structurally parallel. Extract a `GeneratorScreenScaffold` composable (chat transcript + spec-review + done states) parameterised by a per-feature spec editor slot.

**Key changes:** Build the scaffold in `ui/generator/`; migrate two screens (agent + skill) as the proof, leave the rest tracked here. Depends on the completed `GeneratorViewModel<Spec>` base exposing a uniform `uiState`.

**Acceptance criteria:** Migrated screens behave identically; `gradlew assembleDebug` + generator VM tests green.

## Verification

Per-batch: `npm run typecheck` / `lint` / `test`; `gradlew testDebugUnitTest` + `assembleDebug` for Android items; `nexy-app-check` smoke after the modal and pane batches.
