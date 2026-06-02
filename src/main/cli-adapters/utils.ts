import { execSync } from 'child_process'

export function resolveCliPath(name: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${name}` : `which ${name}`
    const output = execSync(cmd, { encoding: 'utf8' }).trim()
    return output.split('\n')[0].trim() || null
  } catch {
    return null
  }
}
