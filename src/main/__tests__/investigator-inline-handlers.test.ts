import { describe, expect, it, vi, beforeEach } from 'vitest'
import { promisify } from 'util'

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}))

vi.mock('child_process', () => {
  const fn = (...args: unknown[]) => execFileMock(...args)
  Object.defineProperty(fn, promisify.custom, {
    value: (cmd: string, cmdArgs: string[], opts: unknown) =>
      new Promise((resolve, reject) => {
        execFileMock(cmd, cmdArgs, opts, (err: unknown, stdout: string, stderr: string) => {
          if (err) reject(err)
          else resolve({ stdout, stderr })
        })
      }),
  })
  return { execFile: fn }
})

vi.mock('../database', () => ({ getDatabase: vi.fn() }))
vi.mock('../providers', () => ({ getProviderForAgent: vi.fn(), getApiKey: vi.fn(), sendProviderWithTools: vi.fn() }))
vi.mock('../ws-server', () => ({ broadcastToMobile: vi.fn() }))

import { buildInlineHandlers } from '../self-heal/investigator'

describe('investigator grep inline handler', () => {
  beforeEach(() => {
    execFileMock.mockReset()
  })

  it('returns a failed tool result (not a thrown error) when ripgrep is not installed', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      const err = Object.assign(new Error('spawn rg ENOENT'), { code: 'ENOENT' })
      callback(err, '', '')
    })
    const handlers = buildInlineHandlers(process.cwd())
    const grep = handlers.get('grep')!
    const result = await grep({ query: 'foo' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('grep failed')
  })

  it('treats ripgrep exit code 1 (no matches) as a successful empty result', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      const err = Object.assign(new Error('exit 1'), { code: 1 })
      callback(err, '', '')
    })
    const handlers = buildInlineHandlers(process.cwd())
    const grep = handlers.get('grep')!
    const result = await grep({ query: 'nonexistent-string' })
    expect(result.success).toBe(true)
    expect(result.result).toBe('(no matches)')
  })

  it('read_file returns a failed tool result (not a thrown error) for a path outside the workspace', async () => {
    const handlers = buildInlineHandlers(process.cwd())
    const readFile = handlers.get('read_file')!
    const result = await readFile({ path: '../../outside.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('read_file failed')
  })

  it('list_directory returns a failed tool result (not a thrown error) for a path outside the workspace', async () => {
    const handlers = buildInlineHandlers(process.cwd())
    const listDirectory = handlers.get('list_directory')!
    const result = await listDirectory({ path: '../../outside' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('list_directory failed')
  })

  it('records a confirmed path when read_file succeeds, but not when it fails', async () => {
    const confirmedPaths = new Set<string>()
    const handlers = buildInlineHandlers(process.cwd(), confirmedPaths)
    const readFile = handlers.get('read_file')!

    await readFile({ path: 'package.json' })
    expect(confirmedPaths.has('package.json')).toBe(true)

    await readFile({ path: 'definitely-not-a-real-file.ts' })
    expect(confirmedPaths.has('definitely-not-a-real-file.ts')).toBe(false)
  })

  it('records confirmed paths from grep match lines', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(null, `${process.cwd()}\\package.json:3:  "name": "nexy",\n`, '')
    })
    const confirmedPaths = new Set<string>()
    const handlers = buildInlineHandlers(process.cwd(), confirmedPaths)
    const grep = handlers.get('grep')!
    await grep({ query: 'name' })
    expect(confirmedPaths.has('package.json')).toBe(true)
  })
})
