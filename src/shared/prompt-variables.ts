const VARIABLE_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g

export function extractPromptVariables(body: string): string[] {
  const variables = new Set<string>()
  for (const match of String(body ?? '').matchAll(VARIABLE_PATTERN)) {
    variables.add(match[1])
  }
  return [...variables]
}

export function resolvePromptVariables(
  body: string,
  values: Record<string, string>
): string {
  return String(body ?? '').replace(VARIABLE_PATTERN, (_match, name: string) => values[name] ?? '')
}
