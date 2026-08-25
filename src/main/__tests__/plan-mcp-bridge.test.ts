import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPlanMcpBridge } from '../plan-mcp-bridge'

const bridges: Array<{ close: () => void }> = []

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.close()
})

async function post(bridge: Awaited<ReturnType<typeof startPlanMcpBridge>>, path: string, body: unknown, secret = true) {
  return fetch(`http://127.0.0.1:${bridge.server.env.NEXY_PLAN_BRIDGE_PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Bridge-Secret': bridge.server.env.NEXY_PLAN_BRIDGE_SECRET } : {}) },
    body: JSON.stringify(body),
  })
}

describe('nexy_plan MCP bridge', () => {
  it('authenticates requests and exposes only exit_plan_mode', async () => {
    const bridge = await startPlanMcpBridge(vi.fn().mockResolvedValue(true))
    bridges.push(bridge)

    expect((await post(bridge, '/tools', {}, false)).status).toBe(403)
    expect(await (await post(bridge, '/tools', {})).json()).toMatchObject({
      tools: [{ name: 'exit_plan_mode', inputSchema: { required: ['plan'] } }],
    })
  })

  it('validates the plan, waits for approval, and retains it for a tool-only response', async () => {
    const approve = vi.fn().mockResolvedValue(true)
    const bridge = await startPlanMcpBridge(approve)
    bridges.push(bridge)

    expect(await (await post(bridge, '/call', { toolName: 'exit_plan_mode', args: {} })).json()).toMatchObject({ success: false })
    expect(await (await post(bridge, '/call', { toolName: 'exit_plan_mode', args: { plan: '  # Plan\n\n- Change it  ' } })).json()).toMatchObject({ success: true })
    expect(approve).toHaveBeenCalledWith('# Plan\n\n- Change it')
    expect(bridge.submittedPlan()).toBe('# Plan\n\n- Change it')
  })

  it('reports a declined approval without losing the submitted plan', async () => {
    const bridge = await startPlanMcpBridge(vi.fn().mockResolvedValue(false))
    bridges.push(bridge)

    expect(await (await post(bridge, '/call', { toolName: 'exit_plan_mode', args: { plan: 'Plan text' } })).json()).toMatchObject({
      success: false,
      error: expect.stringContaining('not approved'),
    })
    expect(bridge.submittedPlan()).toBe('Plan text')
  })
})
