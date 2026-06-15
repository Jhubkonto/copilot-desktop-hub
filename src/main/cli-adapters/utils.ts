import { execSync } from 'child_process'
import { debugLog, debugTime, debugTimeEnd } from '../debug-mode'

const cache = new Map<string, string | null>()

export function resolveCliPath(name: string): string | null {
  if (cache.has(name)) {
    debugLog('cli', `resolveCliPath cache hit: ${name} -> ${cache.get(name)}`)
    return cache.get(name)!
  }
  const timer = `resolveCliPath where ${name}`
  debugTime(timer)
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${name}` : `which ${name}`
    const output = execSync(cmd, { encoding: 'utf8' }).trim()
    const result = output.split('\n')[0].trim() || null
    cache.set(name, result)
    debugTimeEnd(timer)
    return result
  } catch {
    cache.set(name, null)
    debugTimeEnd(timer)
    return null
  }
}

export function clearCliPathCache(): void {
  cache.clear()
}
