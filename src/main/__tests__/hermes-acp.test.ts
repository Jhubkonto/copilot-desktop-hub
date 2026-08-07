import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSpawn, mockResolve, mockListProfiles } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockResolve: vi.fn(() => 'C:\\hermes.exe'),
  mockListProfiles: vi.fn(() => [{ name: 'default', isDefault: true }, { name: 'coder' }]),
}))
vi.mock('child_process', async (importOriginal) => ({ ...(await importOriginal<typeof import('child_process')>()), spawn: mockSpawn }))
vi.mock('../cli-adapters/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cli-adapters/utils')>()),
  resolveCliPath: mockResolve,
}))
vi.mock('../cli-detection', () => ({ listHermesProfiles: mockListProfiles }))

import { HermesAcpAdapter } from '../cli-adapters/hermes-acp'

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroyed: boolean }; killed: boolean; kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: vi.fn(), end: vi.fn(), destroyed: false }
  proc.killed = false
  proc.kill = vi.fn()
  return proc
}

function sendResponse(proc: ReturnType<typeof makeProc>, id: number, result: unknown) {
  proc.stdout.emit('data', `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

describe('Hermes ACP adapter', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('initializes, creates a profile-bound session, streams text and reuses it', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new HermesAcpAdapter()
    const chunks: string[] = []
    const events: unknown[] = []
    const request = adapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }], cwd: 'C:\\workspace', model: 'default', conversationId: 'c1', hermesProfile: 'coder',
    }, (chunk) => chunks.push(chunk), (event) => events.push(event))

    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(1))
    expect(JSON.parse(proc.stdin.write.mock.calls[0][0])).toMatchObject({ method: 'initialize', params: { protocolVersion: 1 } })
    sendResponse(proc, 1, { protocolVersion: 1, agentCapabilities: {} })
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(2))
    expect(JSON.parse(proc.stdin.write.mock.calls[1][0])).toMatchObject({ method: 'session/new', params: { cwd: 'C:\\workspace' } })
    sendResponse(proc, 2, { sessionId: 's1' })
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(3))
    proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Hi' } } } }) + '\n')
    sendResponse(proc, 3, { stopReason: 'end_turn' })
    await expect(request).resolves.toBe('Hi')
    expect(chunks).toEqual(['Hi'])
    expect(JSON.parse(proc.stdin.write.mock.calls[0][0])).toMatchObject({ method: 'initialize' })
    expect(mockSpawn).toHaveBeenCalledWith('C:\\hermes.exe', ['--profile', 'coder', 'acp'], expect.objectContaining({ shell: false }))

    const second = adapter.send({} as never, {
      messages: [{ role: 'user', content: 'again' }], cwd: 'C:\\workspace', model: 'default', conversationId: 'c1', hermesProfile: 'coder',
    }, () => {}, (event) => events.push(event))
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(4))
    proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'Again' } } } }) + '\n')
    sendResponse(proc, 4, { stopReason: 'end_turn' })
    await expect(second).resolves.toBe('Again')
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('falls back to default (no --profile) and warns when the stored profile is gone', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new HermesAcpAdapter()
    const events: unknown[] = []
    const request = adapter.send({} as never, {
      messages: [{ role: 'user', content: 'hello' }], cwd: 'C:\\workspace', model: 'default', conversationId: 'c3', hermesProfile: 'ghost',
    }, () => {}, (event) => events.push(event))

    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(1))
    sendResponse(proc, 1, { protocolVersion: 1 })
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(2))
    sendResponse(proc, 2, { sessionId: 's3' })
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(3))
    sendResponse(proc, 3, { stopReason: 'end_turn' })
    await request
    expect(mockSpawn).toHaveBeenCalledWith('C:\\hermes.exe', ['acp'], expect.objectContaining({ shell: false }))
    expect(events).toContainEqual({ type: 'activity', label: 'Hermes profile "ghost" not found — using default' })
  })

  it('answers ACP permission requests through Nexy and cancels on abort', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new HermesAcpAdapter()
    const approved = vi.fn(async () => true)
    const abort = new AbortController()
    const request = adapter.send({} as never, {
      messages: [{ role: 'user', content: 'run it' }], cwd: 'C:\\workspace', model: 'default', conversationId: 'c2', requestPermission: approved,
    }, () => {}, undefined, abort.signal)
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(1))
    sendResponse(proc, 1, { protocolVersion: 1 })
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(2))
    sendResponse(proc, 2, { sessionId: 's2' })
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(3))
    proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'session/request_permission', params: { toolCall: { toolCallId: 't1', title: 'terminal', rawInput: { command: 'echo hi' } }, options: [{ optionId: 'allow-once', kind: 'allow_once' }] } }) + '\n')
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalledTimes(4))
    expect(approved).toHaveBeenCalledWith('terminal', { command: 'echo hi' })
    expect(JSON.parse(proc.stdin.write.mock.calls[3][0])).toMatchObject({ id: 9, result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } })
    abort.abort()
    await vi.waitFor(() => expect(proc.stdin.write.mock.calls.some(([line]) => line.includes('session/cancel'))).toBe(true))
    proc.emit('close', null, 'SIGTERM')
    await expect(request).rejects.toThrow()
  })
})
