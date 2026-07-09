// Strips ANSI/VT100 escape sequences (SGR color codes, cursor movement, etc.) that raw CLI
// subprocess output — e.g. a "Run Command" tool result from a shell that colors its own output
// (PowerShell 7's default error coloring, for instance) — can embed directly in the string.
// Left unstripped, the ESC control byte has no glyph in most fonts and renders as a tofu/box
// character, which is meaningless in a chat bubble with no terminal to interpret it.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g

export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '')
}
