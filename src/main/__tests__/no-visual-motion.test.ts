import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.kt') ? [path] : []
  })
}

function executableKotlin(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(import|\/\/)/.test(line))
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

describe('no visual motion policy', () => {
  it('rejects Android visual motion APIs in application code', () => {
    const androidRoot = resolve(process.cwd(), 'android/app/src/main/java')
    const forbidden = /\b(?:AnimatedVisibility|AnimatedContent|Crossfade|rememberInfiniteTransition|animate(?:Float|Int|Color|Scroll|Item|To)|infiniteRepeatable|animationSpec\s*=|tween\s*\(|spring\s*\()/
    const violations = sourceFiles(androidRoot).flatMap((path) => {
      const match = executableKotlin(readFileSync(path, 'utf8')).match(forbidden)
      return match ? [`${path}: ${match[0]}`] : []
    })
    expect(violations).toEqual([])
  })

  it('keeps desktop motion disabled globally and chat streaming frame-free', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles/global.css'), 'utf8')
    expect(css).toContain('animation: none !important')
    expect(css).toContain('transition: none !important')
    expect(css).toContain('scroll-behavior: auto !important')
    expect(css).not.toMatch(/@keyframes/)

    const streaming = readFileSync(resolve(process.cwd(), 'src/renderer/hooks/useStreamingQueue.ts'), 'utf8')
    expect(streaming).not.toMatch(/requestAnimationFrame|cancelAnimationFrame/)
  })
})
