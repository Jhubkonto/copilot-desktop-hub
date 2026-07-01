import { ArrowDown, ArrowUp, ToggleLeft, ToggleRight, X } from 'lucide-react'
import type { AgentConfig, SkillConfig } from '../../../shared/types'
import type { McpTool, McpServerInfo, McpToolOverride, McpTrustTier } from './types'

interface Props {
  config: AgentConfig
  isEditing: boolean
  agentMcpTools: McpTool[]
  mcpToolOverrides: McpToolOverride[]
  globalMcpServers: McpServerInfo[]
  skills: SkillConfig[]
  attachedSkillIds: string[]
  onAttachSkill: (skillId: string) => Promise<void>
  onDetachSkill: (skillId: string) => Promise<void>
  onMoveSkill: (skillId: string, direction: -1 | 1) => Promise<void>
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
  agentMcpTools, globalMcpServers,
  skills, attachedSkillIds, onAttachSkill, onDetachSkill, onMoveSkill,
  onUpdateField, onToggleServerAssignment,
  onGetServerTierValue, onSetServerTier,
  onGetMcpOverride, onSetMcpOverride,
  onOpenMcpPanel,
}: Props) {
  const attachedSkills = attachedSkillIds.map((id) => skills.find((skill) => skill.id === id)).filter((skill): skill is SkillConfig => Boolean(skill))
  const availableSkills = skills.filter((skill) => !attachedSkillIds.includes(skill.id))

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Attached Skills</h3>
        {!isEditing ? (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 py-4 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Save this agent before attaching reusable skills.
            </p>
          </div>
        ) : (
          <>
            {attachedSkills.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 py-4 text-center">
                <p className="text-xs text-gray-400 dark:text-gray-500">No skills attached.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {attachedSkills.map((skill, index) => (
                  <div key={skill.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/60">
                    <span className="text-base leading-none">{skill.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{skill.name}</p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{skill.description || 'Reusable instructions and tool defaults'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onMoveSkill(skill.id, -1)}
                      disabled={index === 0}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={`Move ${skill.name} up`}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onMoveSkill(skill.id, 1)}
                      disabled={index === attachedSkills.length - 1}
                      className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={`Move ${skill.name} down`}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDetachSkill(skill.id)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      aria-label={`Detach ${skill.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {availableSkills.length > 0 ? (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) void onAttachSkill(e.target.value)
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Attach skill"
              >
                <option value="">Attach a skill...</option>
                {availableSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>{skill.icon} {skill.name}</option>
                ))}
              </select>
            ) : skills.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Create skills from the Skills section to attach them here.</p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500">All skills are already attached.</p>
            )}
          </>
        )}
      </div>

      {/* Built-in Tools */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Built-in Tools</h3>
        {([
          { key: 'fileEdit' as const, label: 'File Edit', icon: '🗂' },
          { key: 'terminal' as const, label: 'Terminal', icon: '💻' },
          { key: 'webFetch' as const, label: 'Web Fetch', icon: '🌐' }
        ]).map((tool) => {
          const toolConfig = config.tools[tool.key]
          const toggleEnabled = () => {
            const enabled = !toolConfig.enabled
            onUpdateField('tools', {
              ...config.tools,
              [tool.key]: {
                ...toolConfig,
                enabled,
                approval: enabled && toolConfig.approval === 'disabled' ? 'always-ask' : toolConfig.approval,
              },
            })
          }
          return (
            <div key={tool.key} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-gray-800 dark:text-gray-100">{tool.icon} {tool.label}</span>
                <button
                  type="button"
                  onClick={toggleEnabled}
                  className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
                  aria-label={`Toggle ${tool.label}`}
                >
                  {toolConfig.enabled ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5 text-gray-400" />}
                  <span>{toolConfig.enabled ? 'Enabled' : 'Disabled'}</span>
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <label className="w-16 text-[11px] text-gray-500 dark:text-gray-400 shrink-0">Approval</label>
                <select
                  value={toolConfig.approval}
                  onChange={(e) => onUpdateField('tools', {
                    ...config.tools,
                    [tool.key]: { ...toolConfig, approval: e.target.value as 'auto' | 'always-ask' | 'disabled' }
                  })}
                  className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="auto">Auto</option>
                  <option value="always-ask">Always ask</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <textarea
                value={toolConfig.instructions}
                onChange={(e) => onUpdateField('tools', {
                  ...config.tools,
                  [tool.key]: { ...toolConfig, instructions: e.target.value }
                })}
                placeholder="Instructions…"
                rows={1}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
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
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 py-3 text-center">
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
              <div key={server.id} className="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60">
                {/* Server header */}
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <div className="min-w-0 flex-1 flex items-center gap-1">
                    <span className={`text-[10px] ${statusColor}`}>
                      {server.status === 'connected' ? '●' : '○'}
                    </span>
                    <span className="text-[11px] font-medium text-gray-800 dark:text-gray-100 truncate">{server.name}</span>
                    {server.toolCount > 0 && <span className="text-[10px] text-gray-400">{server.toolCount} tools</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleServerAssignment(server.id)}
                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700 shrink-0"
                    aria-label={`${isAssigned ? 'Remove' : 'Add'} ${server.name}`}
                  >
                    {isAssigned ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5 text-gray-400" />}
                    <span>{isAssigned ? 'On' : 'Off'}</span>
                  </button>
                </div>

                {/* Trust tier */}
                {isAssigned && isEditing && (
                  <div className="px-2 pb-1.5 border-t border-gray-200 dark:border-gray-700 pt-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0 w-8">Trust</label>
                      <select
                        value={tier}
                        onChange={(e) => void onSetServerTier(server.id, e.target.value as McpTrustTier)}
                        aria-label={`Trust tier for ${server.name}`}
                        className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                      >
                        <option value="always-ask">Ask before running</option>
                        <option value="auto">Run automatically</option>
                        <option value="block">Block all tools</option>
                        <option value="custom">Custom per-tool…</option>
                      </select>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                      {tier === 'always-ask' && 'Every tool on this server prompts for approval before running.'}
                      {tier === 'auto' && 'Every tool on this server runs without a prompt.'}
                      {tier === 'block' && 'No tool on this server can run.'}
                      {tier === 'custom' && "Set approval and instructions per tool below — overrides this server's default."}
                    </p>
                  </div>
                )}

                {/* Per-tool custom config */}
                {isAssigned && isEditing && tier === 'custom' && serverTools.length > 0 && (
                  <div className="px-2 pb-1.5 pt-1 space-y-1 border-t border-gray-200 dark:border-gray-700">
                    {serverTools.map((tool) => {
                      const override = onGetMcpOverride(tool.serverId, tool.name)
                      const enabled = (override?.enabled ?? 1) === 1
                      const approval = override?.approval ?? 'always-ask'
                      const instructions = override?.instructions ?? ''
                      return (
                        <div key={`${tool.serverId}:${tool.name}`} className="rounded border border-gray-200 bg-white px-1.5 py-1 dark:border-gray-700 dark:bg-gray-900/50">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-gray-800 dark:text-gray-100 truncate">🔌 {tool.name}</div>
                              {tool.description && (
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{tool.description}</div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => void onSetMcpOverride(tool.serverId, tool.name, 'enabled', !enabled)}
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 shrink-0"
                              aria-label={`Toggle ${tool.name}`}
                            >
                              {enabled ? <ToggleRight className="h-3 w-3 text-green-500" /> : <ToggleLeft className="h-3 w-3 text-gray-400" />}
                              <span>{enabled ? 'On' : 'Off'}</span>
                            </button>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <label className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">Approval</label>
                            <select
                              value={approval}
                              onChange={(e) => void onSetMcpOverride(tool.serverId, tool.name, 'approval', e.target.value)}
                              className="w-28 rounded border border-gray-300 bg-white px-1 py-0.5 text-[10px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
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
                            rows={1}
                            className="mt-0.5 w-full rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
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
