export const MODEL_OPTIONS = [
  'default',
  // OpenAI / GPT
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.4-mini',
  'gpt-5-mini',
  'gpt-4.1',
  // Anthropic / Claude
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'claude-opus-4.7',
  'claude-sonnet-4',
] as const

const MODEL_LABELS: Record<string, string> = {
  'default':          'Default',
  'gpt-5.4':          'GPT-5.4',
  'gpt-5.3-codex':    'GPT-5.3-Codex',
  'gpt-5.2-codex':    'GPT-5.2-Codex',
  'gpt-5.2':          'GPT-5.2',
  'gpt-5.4-mini':     'GPT-5.4 mini',
  'gpt-5-mini':       'GPT-5 mini',
  'gpt-4.1':          'GPT-4.1',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'claude-haiku-4.5':  'Claude Haiku 4.5',
  'claude-opus-4.7':   'Claude Opus 4.7',
  'claude-sonnet-4':   'Claude Sonnet 4',
}

const MODEL_MULTIPLIERS: Record<string, string> = {
  'gpt-5.4':          '1x',
  'gpt-5.3-codex':    '1x',
  'gpt-5.2-codex':    '1x',
  'gpt-5.2':          '1x',
  'gpt-5.4-mini':     '0.33x',
  'gpt-5-mini':       '0x',
  'gpt-4.1':          '0x',
  'claude-sonnet-4.6': '1x',
  'claude-sonnet-4.5': '1x',
  'claude-haiku-4.5':  '0.33x',
  'claude-opus-4.7':   '7.5x',
  'claude-sonnet-4':   '1x',
}

export function getModelLabel(model: string | null | undefined): string {
  if (!model || model === 'default') return 'Default'
  return MODEL_LABELS[model] ?? model
}

export function getModelMultiplier(model: string | null | undefined): string | null {
  if (!model || model === 'default') return null
  return MODEL_MULTIPLIERS[model] ?? null
}
