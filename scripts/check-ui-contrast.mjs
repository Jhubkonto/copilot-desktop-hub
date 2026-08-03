import { readFile } from 'node:fs/promises'

const themePath = new URL('../design/nexy-8bit-theme.json', import.meta.url)
const theme = JSON.parse(await readFile(themePath, 'utf8'))

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

const checks = []

for (const [mode, colors] of Object.entries(theme.themes)) {
  checks.push(
    [`${mode}: text on background`, colors.text, colors.background, 4.5],
    [`${mode}: text on surface`, colors.text, colors.surface, 4.5],
    [`${mode}: text on raised surface`, colors.text, colors.raisedSurface, 4.5],
    [`${mode}: muted text on background`, colors.mutedText, colors.background, 4.5],
    [`${mode}: muted text on surface`, colors.mutedText, colors.surface, 4.5],
    [`${mode}: accent foreground`, colors.onAccent, colors.accent, 4.5],
    [`${mode}: border on background`, colors.border, colors.background, 3],
    [`${mode}: focus accent on background`, colors.accent, colors.background, 3],
  )
}

for (const [name, colors] of Object.entries(theme.semantic)) {
  checks.push([`semantic ${name}: light on dark`, colors.light, colors.dark, 4.5])
}

for (const [name, colors] of Object.entries(theme.projects)) {
  checks.push([`project ${name}: light on dark`, colors.light, colors.dark, 4.5])
}

let failed = false
for (const [label, foreground, background, minimum] of checks) {
  const ratio = contrast(foreground, background)
  const passed = ratio >= minimum
  console.log(`${passed ? 'PASS' : 'FAIL'} ${ratio.toFixed(2)}:1 (minimum ${minimum}:1) ${label}`)
  failed ||= !passed
}

if (failed) {
  process.exitCode = 1
}
