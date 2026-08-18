import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('../skill-service', () => ({
  prepareSkillCapture: state.prepare,
  captureSkill: state.capture,
}))

import { startSkillSaveMcpBridge } from '../skill-save-mcp-bridge'

const bridges: Array<{ close: () => void }> = []

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.close()
  state.prepare.mockReset()
  state.capture.mockReset()
})

async function post(bridge: Awaited<ReturnType<typeof startSkillSaveMcpBridge>>, path: string, body: unknown, secret = true) {
  const port = bridge.server.env.NEXY_SKILL_BRIDGE_PORT
  const bridgeSecret = bridge.server.env.NEXY_SKILL_BRIDGE_SECRET
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Bridge-Secret': bridgeSecret } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('skill-save MCP bridge', () => {
  it('exposes only the save tool and rejects unauthenticated requests', async () => {
    const bridge = await startSkillSaveMcpBridge(vi.fn())
    bridges.push(bridge)

    expect((await post(bridge, '/tools', {}, false)).status).toBe(403)
    const response = await post(bridge, '/tools', {})
    expect(await response.json()).toMatchObject({ tools: [{ name: 'save_skill' }] })
  })

  it('always routes saving through approval before persistence', async () => {
    const approval = vi.fn().mockResolvedValue(false)
    const waiting = vi.fn()
    state.prepare.mockReturnValue({ partial: { name: 'demo', instructions: 'Do it.' }, name: 'demo', imported: false })
    const bridge = await startSkillSaveMcpBridge(approval, undefined, waiting)
    bridges.push(bridge)

    const response = await post(bridge, '/call', { toolName: 'save_skill', args: { name: 'demo', instructions: 'Do it.' } })
    expect(await response.json()).toEqual({ success: false, error: 'User declined saving the skill' })
    expect(approval).toHaveBeenCalledWith('demo', { name: 'demo', instructions: 'Do it.' })
    expect(state.capture).not.toHaveBeenCalled()
    expect(waiting).toHaveBeenNthCalledWith(1, true)
    expect(waiting).toHaveBeenLastCalledWith(false)
  })

  it('persists only after approval and reports the saved skill', async () => {
    const approval = vi.fn().mockResolvedValue(true)
    const onSaved = vi.fn()
    state.prepare.mockReturnValue({ partial: { name: 'demo', instructions: 'Do it.' }, name: 'demo', imported: false })
    state.capture.mockReturnValue({ skill: { id: 'skill-1', name: 'demo' }, created: true })
    const bridge = await startSkillSaveMcpBridge(approval, onSaved)
    bridges.push(bridge)

    const response = await post(bridge, '/call', { toolName: 'save_skill', args: { name: 'demo' } })
    expect(await response.json()).toMatchObject({ success: true, result: expect.stringContaining('Created skill "demo"') })
    expect(state.capture).toHaveBeenCalledWith({ name: 'demo' })
    expect(onSaved).toHaveBeenCalledWith({ skill: { id: 'skill-1', name: 'demo' }, created: true })
  })
})
