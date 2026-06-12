import { execSync } from 'child_process'

const cache = new Map<string, string | null>()

export function resolveCliPath(name: string): string | null {
  if (cache.has(name)) {
    console.log(`[resolveCliPath] cache hit: ${name} → ${cache.get(name)}`)
    return cache.get(name)!
  }
  console.time(`[resolveCliPath] where ${name}`)
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${name}` : `which ${name}`
    const output = execSync(cmd, { encoding: 'utf8' }).trim()
    const result = output.split('\n')[0].trim() || null
    cache.set(name, result)
    console.timeEnd(`[resolveCliPath] where ${name}`)
    return result
  } catch {
    cache.set(name, null)
    console.timeEnd(`[resolveCliPath] where ${name}`)
    return null
  }
}

export function clearCliPathCache(): void {
  cache.clear()
}
