import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, CircleAlert, Loader2, Search, ShieldCheck, X } from 'lucide-react'
import type { CapabilityPreflight, CapabilityTrust, McpServerWithStatus, SkillConfig } from '../../shared/types'
import { DropdownPanel } from './DropdownPanel'

type Props = {
  conversationId: string | null
  modelId?: string | null
  skills: SkillConfig[]
  projectId?: string | null
  projectName?: string | null
  agentId?: string | null
  agentName?: string | null
  onEnsureConversation?: () => Promise<string | null>
  onOpenMcp?: () => void
  onOpenSkills?: () => void
}

const statusLabel: Record<CapabilityPreflight['items'][number]['status'], string> = {
  ready: 'Ready',
  missing: 'Needs setup',
  invalid: 'Needs attention',
  disconnected: 'Disconnected',
  unsupported: 'Model unsupported',
}

export function CapabilityPopover({ conversationId, modelId, skills, projectId, projectName, agentId, agentName, onEnsureConversation, onOpenMcp, onOpenSkills }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [selectedMcp, setSelectedMcp] = useState<Array<{ serverId: string; trust: CapabilityTrust }>>([])
  const [servers, setServers] = useState<McpServerWithStatus[]>([])
  const [preflight, setPreflight] = useState<CapabilityPreflight | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null)
  const [scope, setScope] = useState<'chat' | 'project' | 'agent'>('chat')
  const [skillSearch, setSkillSearch] = useState('')
  const activeConversationId = conversationId ?? pendingConversationId

  const refresh = useCallback(async () => {
    if (!activeConversationId) return
    setError(null)
    try {
      const [profile, nextPreflight, nextServers] = await Promise.all([
        window.api.getConversationCapabilities(activeConversationId),
        window.api.resolveCapabilities(activeConversationId, modelId),
        window.api.listMcpServers(),
      ])
      setSelectedSkillIds(profile.skillIds)
      setSelectedMcp(profile.mcp)
      setPreflight(nextPreflight)
      setServers(nextServers)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load capabilities')
    }
  }, [activeConversationId, modelId])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    return window.api.onMcpServerStatusChanged(() => { void refresh() })
  }, [open, refresh])

  const activeProfile = preflight?.profile
  const activeCount = (activeProfile?.skillIds.length ?? selectedSkillIds.length) + (activeProfile?.mcp.length ?? selectedMcp.length)
  const selectedServerIds = useMemo(() => new Set(selectedMcp.map((entry) => entry.serverId)), [selectedMcp])
  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase()
    if (!query) return skills
    return skills.filter((skill) => `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(query))
  }, [skillSearch, skills])

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  const toggleServer = (serverId: string) => {
    setSelectedMcp((current) => current.some((entry) => entry.serverId === serverId)
      ? current.filter((entry) => entry.serverId !== serverId)
      : [...current, { serverId, trust: 'always-ask' }])
  }

  const save = async () => {
    if (!activeConversationId) return
    setBusy(true)
    setError(null)
    try {
      const profile = { version: 1 as const, skillIds: selectedSkillIds, mcp: selectedMcp }
      if (scope === 'chat') {
        await window.api.setConversationCapabilities(activeConversationId, profile)
      } else {
        await window.api.activateCapabilities(activeConversationId, { ...profile, scope, targetId: scope === 'project' ? projectId : agentId })
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update capabilities')
    } finally {
      setBusy(false)
    }
  }

  const openMcpSetup = () => {
    setOpen(false)
    onOpenMcp?.()
  }

  const toggleOpen = async () => {
    if (!open && !conversationId && !pendingConversationId && onEnsureConversation) {
      const createdId = await onEnsureConversation()
      if (createdId) setPendingConversationId(createdId)
    }
    setOpen((value) => !value)
  }

  return (
    <DropdownPanel
      open={open && Boolean(activeConversationId)}
      onClose={() => setOpen(false)}
      align="right"
      width="w-96 max-w-[calc(100vw-1rem)]"
      className="max-h-[80vh]"
      trigger={
        <button
          type="button"
          onClick={() => void toggleOpen()}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors ${
            open
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
          }`}
          aria-expanded={open}
          aria-label={`Chat capabilities${activeCount > 0 ? `, ${activeCount} active` : ''}`}
          title="Use skills and MCP tools in this chat without creating an agent"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {activeCount > 0 && <span>{activeCount}</span>}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
        </button>
      }
    >
      {activeConversationId && (
        <div className="flex max-h-[80vh] flex-col overflow-y-auto p-3 text-left">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Use capabilities in this chat</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">This does not create or modify an agent.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close capabilities">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Use this setup</div>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="radio" name="capability-scope" checked={scope === 'chat'} onChange={() => setScope('chat')} className="mt-0.5 accent-blue-600" />
                  <span><span className="block text-xs font-medium text-gray-700 dark:text-gray-200">This chat <span className="font-normal text-blue-600">(recommended)</span></span><span className="block text-[11px] text-gray-500 dark:text-gray-400">One-off use; no agent changes.</span></span>
                </label>
                {projectId && <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="radio" name="capability-scope" checked={scope === 'project'} onChange={() => setScope('project')} className="mt-0.5 accent-blue-600" />
                  <span><span className="block text-xs font-medium text-gray-700 dark:text-gray-200">This project{projectName ? ` · ${projectName}` : ''}</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Available to future chats in this project.</span></span>
                </label>}
                {agentId && <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="radio" name="capability-scope" checked={scope === 'agent'} onChange={() => setScope('agent')} className="mt-0.5 accent-blue-600" />
                  <span><span className="block text-xs font-medium text-gray-700 dark:text-gray-200">This agent{agentName ? ` · ${agentName}` : ''}</span><span className="block text-[11px] text-gray-500 dark:text-gray-400">Reusable defaults for chats using this agent.</span></span>
                </label>}
              </div>
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Skills</div>
                {skills.length > 0 && <span className="text-[10px] text-gray-400 dark:text-gray-500">{selectedSkillIds.length}/{skills.length} active</span>}
              </div>
              {skills.length === 0 ? (
                <div className="flex items-center justify-between gap-2"><p className="text-xs text-gray-500 dark:text-gray-400">Import a skill to make it available here.</p>{onOpenSkills && <button type="button" onClick={onOpenSkills} className="shrink-0 text-[11px] font-medium text-blue-600 hover:underline">Open Skills</button>}</div>
              ) : (
                <>
                  <label className="mb-1.5 flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
                    <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                    <input
                      type="search"
                      value={skillSearch}
                      onChange={(event) => setSkillSearch(event.target.value)}
                      placeholder="Search skills"
                      aria-label="Search skills"
                      className="min-w-0 flex-1 bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100"
                    />
                  </label>
                  <div className="max-h-48 overflow-y-auto overscroll-contain pr-1">
                    {filteredSkills.length > 0 ? filteredSkills.map((skill) => (
                      <label key={skill.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                        <input type="checkbox" checked={selectedSkillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} className="mt-0.5 accent-blue-600" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">{skill.icon} {skill.name}</span>
                          <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{skill.description || 'Reusable task instructions'}</span>
                        </span>
                      </label>
                    )) : <p className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400">No skills match “{skillSearch}”.</p>}
                  </div>
                </>
              )}
            </section>

            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">MCP tools</div>
              {servers.length === 0 ? (
                <div className="flex items-center justify-between gap-2"><p className="text-xs text-gray-500 dark:text-gray-400">No MCP servers configured yet.</p>{onOpenMcp && <button type="button" onClick={openMcpSetup} className="shrink-0 text-[11px] font-medium text-blue-600 hover:underline">Open MCP setup</button>}</div>
              ) : <div className="max-h-40 overflow-y-auto overscroll-contain pr-1">{servers.map((server) => (
                <label key={server.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="checkbox" checked={selectedServerIds.has(server.id)} onChange={() => toggleServer(server.id)} className="accent-blue-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">{server.name}</span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">{server.status} · {server.toolCount} tools</span>
                  </span>
                  {server.status === 'connected' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                </label>
              ))}</div>}
              {selectedMcp.length > 0 && <p className="mt-1 px-2 text-[11px] text-amber-600 dark:text-amber-300">New MCP access asks before each use.</p>}
              {onOpenMcp && servers.length > 0 && <button type="button" onClick={openMcpSetup} className="mt-1 px-2 text-[11px] font-medium text-blue-600 hover:underline">Manage or add MCP capabilities</button>}
            </section>

            {preflight && preflight.items.length > 0 && (
              <section className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Readiness</div>
                {preflight.items.map((item) => (
                  <div key={`${item.kind}:${item.id}`} className="flex items-start gap-2 py-1 text-[11px]">
                    {item.status === 'ready' ? <Check className="mt-0.5 h-3 w-3 text-emerald-500" /> : <CircleAlert className="mt-0.5 h-3 w-3 text-amber-500" />}
                    <span className="min-w-0"><b>{item.label}</b> — {statusLabel[item.status]}. {item.detail} <span className="text-gray-400">({item.provenance})</span></span>
                  </div>
                ))}
                {onOpenMcp && preflight.items.some((item) => item.kind === 'mcp' && item.status !== 'ready') && <button type="button" onClick={openMcpSetup} className="mt-1 px-2 text-[11px] font-medium text-blue-600 hover:underline">Fix MCP setup</button>}
              </section>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button type="button" onClick={() => void save()} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? 'Saving…' : scope === 'chat' ? 'Use in this chat' : scope === 'project' ? 'Add to project' : 'Attach to agent'}
          </button>
        </div>
      )}
    </DropdownPanel>
  )
}
