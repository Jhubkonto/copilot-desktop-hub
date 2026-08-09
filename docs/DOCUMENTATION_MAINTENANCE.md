# Documentation maintenance

Last reviewed: 2026-08-09.

This repository keeps implementation documentation alongside decision records and roadmaps. They
have different lifecycles: a roadmap is a planning record, not a claim that every listed phase has
shipped.

## Source of truth

| Need | Primary source | Supporting reference |
| --- | --- | --- |
| Current desktop behaviour | `src/main/`, `src/preload/`, and `src/renderer/` | `src/docs/ARCHITECTURE.md` |
| Current Android behaviour | `android/app/src/main/` | `docs/android-standalone.md` |
| Desktop/Android sync boundary | desktop WS handlers and Android repositories | `docs/android-standalone-contract.md`, ADR 0001 |
| Visual consistency rules | desktop styles/components and Android Compose theme/components | `docs/ui/8bit-baseline/README.md`, `design/nexy-8bit-theme.json` |
| Product plans and deferred work | the relevant roadmap | the `roadmap/` status folders |

When this table conflicts with implementation, update the living document or mark the plan as
superseded; do not silently rewrite an ADR or completed roadmap as though it were current product
behaviour.

## Document inventory and status

| Group | Status | Maintenance rule |
| --- | --- | --- |
| `README.md` | Living entry point | Keep supported features, commands, prerequisites, and links current. Do not leave release placeholders. |
| `src/docs/ARCHITECTURE.md`, `src/docs/MODEL_CATALOG.md` | Living technical references | Update whenever process boundaries, provider catalog ownership, or persistence/IPC conventions change. Avoid fixed migration-version claims. |
| `docs/android-standalone*.md`, `docs/MOBILE_WEBSOCKET.md`, `docs/resumable-chat-animation.md` | Living Android/peer contract | Validate against `WsRepository`, `WsEventParser`, WS handlers, Android navigation, and the matching migration before changing capability claims. |
| `docs/ui/8bit-baseline/README.md`, `design/` | Living UI baseline | Treat geometry, touch targets, and theme tokens as cross-platform acceptance criteria. |
| `docs/adr/` | Historical decisions | Append a new ADR when a decision changes; do not edit an accepted decision to hide history. |
| `roadmap/roadmap-in-progress/` | Active planning | Every open item must be explicitly implemented, blocked, or awaiting manual/device validation. The UI Unification roadmap is the active milestone. |
| `roadmap/roadmap-new/` | Proposed or deferred planning | A document here must declare `Proposed`, `Deferred`, or `Superseded` status. Promote active work before implementation begins. |
| `roadmap/roadmap-complete/` | Historical record | Keep completion evidence and links intact. |
| `roadmap/bugs/` | Issue tracking record | Move or mark an item only after its fix and verification are recorded. |

## Reconciliation results

- The README no longer contains an unresolved screenshot placeholder and now describes Code
  Changes without promising generic filesystem or shell tools in every conversation.
- The Android living documents match the present local-first architecture: Room-backed local data,
  peer synchronization, direct-provider mode, and desktop-only workspace/process operations.
- The 8-bit baseline remains the UI-unification contract. Its no-motion statement is scoped to
  chat-timeline presentation; it is not a ban on every app-wide loading or navigation indicator.
- `docs/code-changes-compatibility.md` and several round roadmaps retain implementation-history
  detail. Review them against the source before promoting them to user-facing references; README is
  the current user-facing summary.

## Review checklist

1. Check local Markdown links and remove placeholders.
2. Compare feature claims with desktop handler registration and Android navigation/repository code.
3. Keep platform capability differences explicit, especially standalone versus paired Android.
4. Preserve ADRs and completed roadmaps; update their status or add a successor instead of
   rewriting history.
5. Run `npm run check:ui-theme` after changing theme data or its generated outputs.
6. Move a roadmap when its declared status changes: proposed/deferred → `roadmap-new`, active or
   device-validation pending → `roadmap-in-progress`, complete/superseded → `roadmap-complete`.
