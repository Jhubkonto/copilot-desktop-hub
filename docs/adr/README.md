# Architecture Decision Records (ADRs)

This folder holds **Architecture Decision Records** — short documents that capture a significant
architectural decision, the context that forced it, the options considered, and the consequences we
accepted. An ADR is not API documentation and not a how-to guide; it explains *why* the code is
shaped the way it is, so that a future reader (or a future us) does not re-litigate a settled
decision without knowing what it cost.

## Conventions

- One decision per file, named `NNNN-short-kebab-title.md` (zero-padded, monotonically increasing).
- Numbers are never reused, even if an ADR is later superseded. A superseded ADR stays in the repo
  with a link forward to the record that replaced it.
- Prefer describing forces and trade-offs over restating the implementation. Point at the source
  files instead of pasting large code blocks that will drift.
- Status is one of: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-android-content-synchronisation-strategy.md) | Android content synchronisation strategy | Accepted |

## Related living documents

These describe *current behaviour* rather than the decision behind it, and are the right place to
look for the present-day contract:

- [`docs/android-standalone.md`](../android-standalone.md) — user-facing standalone-mode behaviour.
- [`docs/android-standalone-contract.md`](../android-standalone-contract.md) — the versioned data
  and capability contract between Android and desktop.
- [`docs/MOBILE_WEBSOCKET.md`](../MOBILE_WEBSOCKET.md) — the WebSocket transport.
