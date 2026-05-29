export const MODEL_OPTIONS = [
  'default',
  // OpenAI / GPT
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5-mini',
  'gpt-4.1',
  // Anthropic / Claude
  'claude-opus-4.8',
  'claude-opus-4.7',
  'claude-opus-4.6',
  'claude-opus-4.5',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'claude-haiku-4.5',
] as const

const MODEL_LABELS: Record<string, string> = {
  'default':           'Default',
  // OpenAI
  'gpt-5.5':           'GPT-5.5',
  'gpt-5.4':           'GPT-5.4',
  'gpt-5.3-codex':     'GPT-5.3-Codex',
  'gpt-5.2-codex':     'GPT-5.2-Codex',
  'gpt-5.2':           'GPT-5.2',
  'gpt-5-mini':        'GPT-5 mini',
  'gpt-4.1':           'GPT-4.1',
  // Anthropic
  'claude-opus-4.8':   'Claude Opus 4.8',
  'claude-opus-4.7':   'Claude Opus 4.7',
  'claude-opus-4.6':   'Claude Opus 4.6',
  'claude-opus-4.5':   'Claude Opus 4.5',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'claude-sonnet-4':   'Claude Sonnet 4',
  'claude-haiku-4.5':  'Claude Haiku 4.5',
}

// Premium request multipliers effective June 1, 2026.
// GPT-4.1 and GPT-5 mini are included models (0x) on paid plans.
// GPT-5.5 is at a promotional 7.5x rate (subject to change).
const MODEL_MULTIPLIERS: Record<string, string> = {
  'gpt-5.5':           '7.5x',
  'gpt-5.4':           '6x',
  'gpt-5.3-codex':     '6x',
  'gpt-5.2-codex':     '3x',
  'gpt-5.2':           '3x',
  'gpt-5-mini':        '0x',
  'gpt-4.1':           '0x',
  'claude-opus-4.8':   '27x',
  'claude-opus-4.7':   '27x',
  'claude-opus-4.6':   '27x',
  'claude-opus-4.5':   '15x',
  'claude-sonnet-4.6': '9x',
  'claude-sonnet-4.5': '6x',
  'claude-sonnet-4':   '6x',
  'claude-haiku-4.5':  '0.33x',
}

export function getModelLabel(model: string | null | undefined): string {
  if (!model || model === 'default') return 'Default'
  return MODEL_LABELS[model] ?? model
}

export function getModelMultiplier(model: string | null | undefined): string | null {
  if (!model || model === 'default') return null
  return MODEL_MULTIPLIERS[model] ?? null
}
