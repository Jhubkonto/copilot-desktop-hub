/**
 * Generic SQLite-row → domain-object mapper.
 *
 * Rows use snake_case columns; TypeScript objects use camelCase (see CLAUDE.md).
 * This centralises the hand-written `rowTo*` idioms:
 *   - `foo_bar`       → `fooBar`  (value passed through, `undefined` → `null`)
 *   - `foo_bar_json`  → `fooBar`  (JSON.parse'd, with an optional per-key fallback)
 *   - boolean columns → `Boolean(value)` for keys listed in `options.booleans`
 *
 * Computed/joined fields stay in the caller: `{ ...mapRow<T>(row, opts), extra }`.
 */

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

export interface MapRowOptions {
  /** camelCase output keys whose values should be coerced with Boolean() (SQLite stores 0/1). */
  booleans?: string[]
  /**
   * Fallbacks for `*_json` columns, keyed by camelCase output key (without the Json suffix).
   * Used when the column is NULL/empty or fails to parse. Keys not listed default to `null`.
   */
  jsonFallbacks?: Record<string, unknown>
  /** Column names (snake_case) to skip entirely, e.g. ones needing bespoke handling. */
  exclude?: string[]
}

export function mapRow<T>(row: Record<string, unknown>, options: MapRowOptions = {}): T {
  const { booleans = [], jsonFallbacks = {}, exclude = [] } = options
  const out: Record<string, unknown> = {}

  for (const [column, value] of Object.entries(row)) {
    if (exclude.includes(column)) continue

    if (column.endsWith('_json')) {
      const key = snakeToCamel(column.slice(0, -'_json'.length))
      const fallback = key in jsonFallbacks ? jsonFallbacks[key] : null
      if (typeof value === 'string' && value.length > 0) {
        try {
          out[key] = JSON.parse(value)
        } catch {
          out[key] = fallback
        }
      } else {
        out[key] = fallback
      }
      continue
    }

    const key = snakeToCamel(column)
    if (booleans.includes(key)) {
      out[key] = Boolean(value)
    } else {
      out[key] = value ?? null
    }
  }

  return out as T
}
