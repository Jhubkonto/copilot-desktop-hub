# Hermes ACP usage contract

Nexy treats ACP `session/update` messages with `sessionUpdate: "usage_update"` as authoritative
only when they include explicit numeric `inputTokens`/`outputTokens` fields (snake_case aliases
are accepted for wire compatibility). The optional USD cost is read from `cost.amount` when
`cost.currency` is `USD`.

The legacy `used` field is intentionally ignored because ACP does not define it as input tokens;
it may represent a context budget or another provider-specific total. Until Hermes emits the
explicit fields, Nexy displays its local estimate before sending and does not fabricate a
provider-reported usage total afterward.
