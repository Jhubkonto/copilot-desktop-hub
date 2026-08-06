export const PROJECT_COLOR_OPTIONS = [
  { value: 'blue', hex: '#3478D4' }, { value: 'green', hex: '#3A9D58' },
  { value: 'red', hex: '#D34A4A' }, { value: 'purple', hex: '#8257C7' },
  { value: 'orange', hex: '#D37832' }, { value: 'pink', hex: '#C45185' },
  { value: 'yellow', hex: '#C59A22' }, { value: 'cyan', hex: '#278E9D' },
  { value: 'gray', hex: '#667078' },
] as const
export const PROJECT_COLOR_ALIASES: Record<string, string> = { teal: 'cyan', indigo: 'purple', grey: 'gray' }
export const PROJECT_COLOR_NAMES: Set<string> = new Set(PROJECT_COLOR_OPTIONS.map(({ value }) => value))
export const PROJECT_COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/
export function normalizeProjectColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const canonical = PROJECT_COLOR_ALIASES[trimmed.toLowerCase()] ?? trimmed.toLowerCase()
  if (PROJECT_COLOR_NAMES.has(canonical)) return canonical
  return PROJECT_COLOR_HEX_REGEX.test(trimmed) ? trimmed.toUpperCase() : null
}
export function isProjectColor(value: unknown): value is string { return normalizeProjectColor(value) !== null }
