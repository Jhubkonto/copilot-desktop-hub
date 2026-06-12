import { ToggleLeft, ToggleRight } from 'lucide-react'
import type { AgentConfig } from '../../../shared/types'
import type { McpTool, McpServerInfo, McpToolOverride, McpTrustTier } from './types'

interface Props {
  config: AgentConfig
  isEditing: boolean
  agentMcpTools: McpTool[]
  mcpToolOverrides: McpToolOverride[]
  globalMcpServers: McpServerInfo[]
  onUpdateField: <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => void
  onToggleServerAssignment: (serverId: string) => void
  onGetServerTierValue: (serverId: string) => McpTrustTier
  onSetServerTier: (serverId: string, tier: McpTrustTier) => Promise<void>
  onGetMcpOverride: (serverId: string, toolName: string) => McpToolOverride | undefined
  onSetMcpOverride: (serverId: string, toolName: string, field: 'enabled' | 'approval' | 'instructions', value: string | boolean) => Promise<void>
  onOpenMcpPanel: () => void
}

export function SkillsTab({
  config, isEditing,
  agentMcpTools, mcpToolOverrides, globalMcpServers,
  onUpdateField, onToggleServerAssignment,
  onGetServerTierValue, onSetServerTier,
  onGetMcpOverride, onSetMcpOverride,
  onOpenMcpPanel,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Built-in Tools */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Built-in Tools</h3>
        {([
          { key: 'fileEdit' as const, label: 'File Edit', icon: '🗂' },
          { key: 'terminal' as const, label: 'Terminal', icon: '💻' },
          { key: 'webFetch' as const, label: 'Web Fetch', icon: '🌐' }
        ]).map((tool) => {
          const toolConfig = config.tools[tool.key]
          return (
            <div key={tool.key} className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{tool.icon} {tool.label}</div>
                <button
                  type="button"
                  onClick={() => onUpdateField('tools', {
                    ...config.tools,
                    [tool.key]: { ...toolConfig, enabled: !toolConfig.enabled }
                  })}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                  aria-label={`Toggle ${tool.label}`}
                >
                  {toolConfig.enabled ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                  <span>{toolConfig.enabled ? 'Enabled' : 'Disabled'}</span>
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Approval</label>
                <select
                  value={toolConfig.approval}
                  onChange={(e) => onUpdateField('tools', {
                    ...config.tools,
                    [tool.key]: { ...toolConfig, approval: e.target.value as 'auto' | 'always-ask' | 'disabled' }
                  })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="auto">Auto</option>
                  <option value="always-ask">Always ask</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Instructions</label>
                <textarea
                  value={toolConfig.instructions}
                  onChange={(e) => onUpdateField('tools', {
                    ...config.tools,
                    [tool.key]: { ...toolConfig, instructions: e.target.value }
                  })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* MCP Servers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">MCP Servers</h3>
          <button type="button" onClick={onOpenMcpPanel} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Manage
          </button>
        </div>
        {globalMcpServers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 py-4 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
              No MCP servers configured. Add Playwright to enable browser automation.
            </p>
            <button
              type="button"
              onClick={onOpenMcpPanel}
              className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Add MCP Server
            </button>
          </div>
        ) : (
          globalMcpServers.map((server) => {
            const isAssigned = config.mcpServers.includes(server.id)
            const statusColor = server.status === 'connected'
              ? 'text-green-500'
              : server.status === 'error'
                ? 'text-red-400'
                : 'text-gray-400'
            const serverTools = agentMcpTools.filter((t) => t.serverId === server.id)
            const tier = onGetServerTierValue(server.id)
            return (
              <div key={server.id} className="rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60">
                {/* Server header */}
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs ${statusColor}`}>
                        {server.status === 'connected' ? '●' : '○'}
                      </span>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{server.name}</span>
                      {server.toolCount > 0 && <span className="text-xs text-gray-400">{server.toolCount} tools</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleServerAssignment(server.id)}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 shrink-0"
                    aria-label={`${isAssigned ? 'Remove' : 'Add'} ${server.name}`}
                  >
                    {isAssigned ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                    <span>{isAssigned ? 'On' : 'Off'}</span>
                  </button>
                </div>

                {/* Trust tier */}
                {isAssigned && isEditing && (
                  <div className="px-3 pb-2 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 pt-2">
                    <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Trust</label>
                    <select
                      value={tier}
                      onChange={(e) => void onSetServerTier(server.id, e.target.value as McpTrustTier)}
                      aria-label={`Trust tier for ${server.name}`}
                      className="flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    >
                      <option value="always-ask">Ask before running</option>
                      <option value="auto">Run automatically</option>
                      <option value="block">Block all tools</option>
                      <option value="custom">Custom per-tool…</option>
                    </select>
                  </div>
                )}

                {/* Per-tool custom config */}
                {isAssigned && isEditing && tier === 'custom' && serverTools.length > 0 && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-200 dark:border-gray-700">
                    {serverTools.map((tool) => {
                      const override = onGetMcpOverride(tool.serverId, tool.name)
                      const enabled = (override?.enabled ?? 1) === 1
                      const approval = override?.approval ?? 'always-ask'
                      const instructions = override?.instructions ?? ''
                      return (
                        <div key={`${tool.serverId}:${tool.name}`} className="space-y-2 rounded-lg border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-900/50">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-medium text-gray-800 dark:text-gray-100">🔌 {tool.name}</div>
                              {tool.description && (
                                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{tool.description}</div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => void onSetMcpOverride(tool.serverId, tool.name, 'enabled', !enabled)}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 shrink-0"
                              aria-label={`Toggle ${tool.name}`}
                            >
                              {enabled ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5 text-gray-400" />}
                              <span>{enabled ? 'On' : 'Off'}</span>
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0">Approval</label>
                            <select
                              value={approval}
                              onChange={(e) => void onSetMcpOverride(tool.serverId, tool.name, 'approval', e.target.value)}
                              className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                            >
                              <option value="auto">Auto</option>
                              <option value="always-ask">Always ask</option>
                              <option value="disabled">Disabled</option>
                            </select>
                          </div>
                          <textarea
                            value={instructions}
                            onChange={(e) => void onSetMcpOverride(tool.serverId, tool.name, 'instructions', e.target.value)}
                            placeholder="Optional instructions for this tool…"
                            rows={2}
                            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
