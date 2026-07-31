const LEGACY_PORTABLE_OPERATIONAL_PREFIXES = [
  '[Portable tool-call summary]',
  '[Portable team-activity summary]',
] as const

/**
 * Older Nexy versions converted execution-trace rows into ordinary system
 * messages during a fork. These messages are not conversation content: they
 * can contain entire tool outputs and should not be rendered, exported, sent
 * to a model, or propagated into another fork.
 */
export function isLegacyPortableOperationalSummary(role: string, content: string): boolean {
  return role === 'system'
    && LEGACY_PORTABLE_OPERATIONAL_PREFIXES.some((prefix) => content.trimStart().startsWith(prefix))
}
