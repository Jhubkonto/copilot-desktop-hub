import type { CliBackend, CliModeOverride } from '../shared/types'
import type { SlashCommandDef } from './slash-commands'

/**
 * Backend-specific slash commands, surfaced in the composer menu only when the corresponding
 * CLI backend is what answers the current chat. Mode commands are executed locally by setting
 * the conversation's cli_mode_override (the same mechanism as the ChatModePicker's mode
 * section) — they are two front-ends to one setting, not a prompt pass-through.
 */
export const PROVIDER_SLASH_COMMANDS: Record<CliBackend, SlashCommandDef[]> = {
  'claude-cli': [
    { name: '/plan', usage: '/plan', description: 'Plan mode: Claude analyses without editing files', source: 'claude-cli' },
    { name: '/accept-edits', usage: '/accept-edits', description: 'Auto-accept Claude\'s file edits for this chat', source: 'claude-cli' },
    { name: '/bypass-permissions', usage: '/bypass-permissions', description: 'Skip all permission prompts for this chat (use with care)', source: 'claude-cli' },
    { name: '/mode-default', usage: '/mode-default', description: 'Clear the CLI mode override for this chat', source: 'claude-cli' },
    { name: '/init', usage: '/init', description: 'Ask Claude CLI to generate a CLAUDE.md for this workspace', source: 'claude-cli' },
  ],
  'codex-cli': [
    { name: '/sandbox-read-only', usage: '/sandbox-read-only', description: 'Codex sandbox: read-only, no file writes', source: 'codex-cli' },
    { name: '/sandbox-workspace', usage: '/sandbox-workspace', description: 'Codex sandbox: writes allowed inside the workspace', source: 'codex-cli' },
    { name: '/sandbox-full', usage: '/sandbox-full', description: 'Codex sandbox: full access (use with care)', source: 'codex-cli' },
    { name: '/mode-default', usage: '/mode-default', description: 'Clear the CLI mode override for this chat', source: 'codex-cli' },
  ],
  // Hermes runs as a one-shot spawnSync with no mode/sandbox flags — nothing to surface.
  'hermes-cli': [],
}

/** Maps a mode slash command to the CliModeOverride it sets (null = clear). */
export const MODE_COMMAND_TO_OVERRIDE: Record<string, { backend: CliBackend; mode: CliModeOverride | null }> = {
  '/plan': { backend: 'claude-cli', mode: 'plan' },
  '/accept-edits': { backend: 'claude-cli', mode: 'acceptEdits' },
  '/bypass-permissions': { backend: 'claude-cli', mode: 'bypassPermissions' },
  '/sandbox-read-only': { backend: 'codex-cli', mode: 'read-only' },
  '/sandbox-workspace': { backend: 'codex-cli', mode: 'workspace-write' },
  '/sandbox-full': { backend: 'codex-cli', mode: 'danger-full-access' },
}

export function getProviderSlashCommands(backend: CliBackend | null): SlashCommandDef[] {
  if (!backend) return []
  return PROVIDER_SLASH_COMMANDS[backend] ?? []
}

/** Human label for a command source, used as the menu's section headers. */
export function slashCommandSourceLabel(source: SlashCommandDef['source']): string {
  switch (source) {
    case 'agent': return 'Agent'
    case 'claude-cli': return 'Claude CLI'
    case 'codex-cli': return 'Codex CLI'
    case 'hermes-cli': return 'Hermes'
    default: return 'Nexy'
  }
}
