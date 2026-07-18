# Roadmap: Deferred — WS Protocol Codegen & Connection-Layer Decomposition

Drafted 2026-07-18. **Status: DEFERRED (future project).**

## Summary

The single largest cross-platform drift liability is the hand-maintained WebSocket contract between desktop and Android. This document scopes the three coupled pieces of that problem as a future project, with prerequisites and a staged migration outline. None of it should be attempted as part of an ordinary refactor pass — each piece is an architecture decision with app-wide blast radius. The acute bugs in this area (duplicated reconnect listener, silent command drop) were already fixed on the singleton in the completed pass.

## The three coupled problems

1. **Manual type duplication.** `android/.../data/model/WsEvent.kt` is a 1113-line sealed hierarchy of **319 variants** mirroring every `WsPushEvent` the desktop emits, hand-decoded by the 147KB `WsEventParser.kt`. `ui/chat/ChatTurnReducer.kt` mirrors `src/shared/chat-turn-types.ts`; domain models + command-name string literals mirror `src/shared/types.ts`. Adding one desktop event is a 3–4-point manual change with no compile-time link between the sides.
2. **No WS command registry.** `ws-handlers.ts` (3627 lines) re-exposes nearly the entire IPC surface as WS commands with ~357 hand-written try/catch sites and no `safeHandle` equivalent (Phase 3 Item 2 adds a wrapper as a stopgap).
3. **`WsRepository` monolith.** A 133KB global Kotlin `object` referenced from 56 UI sites, with connection/reconnect, message decode, local-command fallback, and state all in one place. No DI framework exists in the app.

## Why deferred

- **Codegen** needs a schema source of truth (the TS types aren't one today), a generator toolchain, and CI wiring; a regression touches the whole Android app. High value long-term, but a standalone project.
- **`WsRepository` decomposition/DI** is an architecture decision (introducing DI where none exists), not a mechanical refactor.
- **`ws-handlers` full rewrite** only makes sense alongside a shared command registry, which is downstream of the codegen.

## Prerequisites

- Phase 3 Item 2 (`registerWsCommand` wrapper) landed — gives a uniform error envelope the generated handlers can target.
- A decision on the schema source of truth: annotate the existing `src/shared/*.ts` unions vs introduce a neutral schema (JSON Schema / protobuf / a small DSL). Recommendation: derive from the TS types via a build step so TS stays the single authority.

## Staged migration outline

1. **Schema extraction.** Emit a machine-readable descriptor of `WsPushEvent`/`WsCommand`/chat-turn types from `src/shared/` at build time. No runtime change yet.
2. **Kotlin codegen.** Generate `WsEvent` + parser + command constants from the descriptor. Land it *behind* the existing hand-written parser and assert byte-for-byte equivalence using the current parser fixture tests (`RatingEventParserTest`, `StandaloneSyncParserTest`, `ChatTurnReducerTest`, `GeneratorViewModelParityTest`) as the conformance suite.
3. **Cutover.** Delete the hand-written `WsEvent.kt`/`WsEventParser.kt` once the generated versions pass the full fixture suite; wire codegen into CI so a desktop event change fails the Android build until regenerated.
4. **Command registry.** Generate a `ws-handlers` dispatch table from the same descriptor + the `registerWsCommand` wrapper; convert handlers module-by-module.
5. **Connection-layer extraction (independent track).** Pull connection/reconnect/handshake out of `WsRepository` into a `WsConnection` class behind the `WsClient` interface; introduce lightweight DI (manual service locator or a small library) so ViewModels depend on the interface, not the global `object`. The completed close-policy/send-queue fixes give a clean seam to extract along.

## Acceptance criteria

- A new desktop `WsPushEvent` requires only a TS change; regenerating produces the Kotlin variant + parser; forgetting to regenerate fails CI.
- The full parser/reducer/parity fixture suite passes against generated code.
- `WsRepository`'s global-object footprint shrinks; ViewModels resolve `WsClient` via DI.

## Verification

`gradlew testDebugUnitTest` (fixture conformance is the gate) + `assembleDebug`; desktop `npm test`; connected-mode end-to-end smoke via `nexy-app-check` after cutover.
