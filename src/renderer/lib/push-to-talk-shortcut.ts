export const PUSH_TO_TALK_SHORTCUT_KEY = 'nexy.voice.pushToTalkShortcut.v1'
export const PUSH_TO_TALK_SHORTCUT_CHANGED = 'nexy:push-to-talk-shortcut-changed'

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])
const MODIFIER_GROUPS = {
  Control: new Set(['ControlLeft', 'ControlRight']),
  Shift: new Set(['ShiftLeft', 'ShiftRight']),
  Alt: new Set(['AltLeft', 'AltRight']),
  Meta: new Set(['MetaLeft', 'MetaRight']),
} as const

export interface PushToTalkShortcut {
  version: 1
  modifiers: Array<keyof typeof MODIFIER_GROUPS>
  code: string
}

export function suggestedPushToTalkShortcut(): PushToTalkShortcut {
  return {
    version: 1,
    modifiers: [navigator.platform.toLowerCase().includes('mac') ? 'Meta' : 'Control', 'Shift'],
    code: 'Space',
  }
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): PushToTalkShortcut | null {
  if (MODIFIER_CODES.has(event.code)) return null
  const modifiers: PushToTalkShortcut['modifiers'] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.metaKey) modifiers.push('Meta')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  return { version: 1, modifiers, code: event.code }
}

export function validatePushToTalkShortcut(shortcut: PushToTalkShortcut): string | null {
  if (shortcut.modifiers.length === 0) return 'Add at least one modifier key.'
  if (!shortcut.code || MODIFIER_CODES.has(shortcut.code)) return 'Add a non-modifier key.'
  const key = shortcut.code.replace(/^Key/, '').toLowerCase()
  const editingKeys = new Set(['a', 'c', 'v', 'x', 'y', 'z'])
  if (shortcut.modifiers.length === 1 && (shortcut.modifiers[0] === 'Control' || shortcut.modifiers[0] === 'Meta') && editingKeys.has(key)) {
    return 'That shortcut is reserved for editing.'
  }
  if (shortcut.modifiers.includes('Control') && shortcut.modifiers.includes('Shift') && key === 'h') {
    return 'That shortcut is already used to show or hide Nexy.'
  }
  if (shortcut.modifiers.includes('Alt') && shortcut.code === 'F4') return 'That shortcut closes the application.'
  if (shortcut.modifiers.includes('Meta') && key === 'q') return 'That shortcut closes the application.'
  return null
}

export function formatPushToTalkShortcut(shortcut: PushToTalkShortcut | null): string {
  if (!shortcut) return 'Not assigned'
  const mac = navigator.platform.toLowerCase().includes('mac')
  const labels = shortcut.modifiers.map((modifier) => {
    if (!mac) return modifier === 'Control' ? 'Ctrl' : modifier
    return ({ Control: '⌃', Shift: '⇧', Alt: '⌥', Meta: '⌘' } as const)[modifier]
  })
  const code = shortcut.code === 'Space'
    ? 'Space'
    : shortcut.code.replace(/^Key/, '').replace(/^Digit/, '')
  return mac ? `${labels.join('')}${code}` : [...labels, code].join('+')
}

export function readPushToTalkShortcut(storage: Pick<Storage, 'getItem'>): PushToTalkShortcut | null {
  const raw = storage.getItem(PUSH_TO_TALK_SHORTCUT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PushToTalkShortcut>
    if (parsed.version !== 1 || !Array.isArray(parsed.modifiers) || typeof parsed.code !== 'string') return null
    const shortcut = parsed as PushToTalkShortcut
    return validatePushToTalkShortcut(shortcut) === null ? shortcut : null
  } catch {
    return null
  }
}

export function writePushToTalkShortcut(storage: Pick<Storage, 'setItem' | 'removeItem'>, shortcut: PushToTalkShortcut | null): void {
  if (shortcut) storage.setItem(PUSH_TO_TALK_SHORTCUT_KEY, JSON.stringify(shortcut))
  else storage.removeItem(PUSH_TO_TALK_SHORTCUT_KEY)
  window.dispatchEvent(new CustomEvent(PUSH_TO_TALK_SHORTCUT_CHANGED))
}

export function shortcutMatchesEvent(shortcut: PushToTalkShortcut, event: KeyboardEvent): boolean {
  if (event.code !== shortcut.code) return false
  const expected = new Set(shortcut.modifiers)
  return event.ctrlKey === expected.has('Control')
    && event.metaKey === expected.has('Meta')
    && event.altKey === expected.has('Alt')
    && event.shiftKey === expected.has('Shift')
}

export function shortcutIncludesReleasedKey(shortcut: PushToTalkShortcut, event: KeyboardEvent): boolean {
  if (event.code === shortcut.code) return true
  return shortcut.modifiers.some((modifier) => MODIFIER_GROUPS[modifier].has(event.code))
}
