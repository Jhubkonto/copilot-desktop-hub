import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/app-store'
import { Button, SaveStatus, type SaveState } from '../ui/primitives'
import { NexyIcon } from '../ui/icons/NexyIcon'
import type { CapabilityTrust, ConversationCapabilityProfile, McpServerWithStatus } from '../../../shared/types'

const EMPTY_PROFILE: ConversationCapabilityProfile = { version: 1, skillIds: [], mcp: [] }

function sameProfile(a: ConversationCapabilityProfile, b: ConversationCapabilityProfile): boolean {
  const key = (profile: ConversationCapabilityProfile) => JSON.stringify({
    skillIds: [...profile.skillIds].sort(),
    mcp: [...profile.mcp].sort((x, y) => x.serverId.localeCompare(y.serverId)),
  })
  return key(a) === key(b)
}

export function CapabilitiesTab({ projectId }: { projectId: string }) {
  const addToast = useAppStore((s) => s.addToast)
  const skills = useAppStore((s) => s.skills)
  const loadSkills = useAppStore((s) => s.loadSkills)

  const [saved, setSaved] = useState<ConversationCapabilityProfile>(EMPTY_PROFILE)
  const [skillIds, setSkillIds] = useState<string[]>([])
  const [mcp, setMcp] = useState<Array<{ serverId: string; trust: CapabilityTrust }>>([])
  const [servers, setServers] = useState<McpServerWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [skillSearch, setSkillSearch] = useState('')
  const [confirmRevokeServerId, setConfirmRevokeServerId] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => { void loadSkills() }, [loadSkills])

  useEffect(() => {
    let cancelled = false
    const generation = ++requestGeneration.current
    setLoading(true)
    setSaveState('idle')
    setConfirmRevokeServerId(null)

    void Promise.all([window.api.getProjectCapabilities(projectId), window.api.listMcpServers()])
      .then(([profile, mcpServers]) => {
        // Guard against a project switch landing mid-flight; without this the previous
        // project's grants would be shown as if they belonged to the newly opened one.
        if (cancelled || generation !== requestGeneration.current) return
        setSaved(profile)
        setSkillIds(profile.skillIds)
        setMcp(profile.mcp)
        setServers(mcpServers)
      })
      .catch(() => {
        if (!cancelled && generation === requestGeneration.current) addToast('Failed to load project capabilities', 'error')
      })
      .finally(() => {
        if (!cancelled && generation === requestGeneration.current) setLoading(false)
      })

    return () => { cancelled = true }
  }, [addToast, projectId])

  const current: ConversationCapabilityProfile = useMemo(
    () => ({ version: 1, skillIds, mcp }),
    [mcp, skillIds],
  )
  const dirty = !sameProfile(current, saved)

  const knownSkillIds = useMemo(() => new Set(skills.map((skill) => skill.id)), [skills])
  const knownServerIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers])
  const orphanSkillIds = useMemo(() => skillIds.filter((id) => !knownSkillIds.has(id)), [knownSkillIds, skillIds])
  const orphanMcp = useMemo(() => mcp.filter((entry) => !knownServerIds.has(entry.serverId)), [knownServerIds, mcp])
  const hasOrphans = orphanSkillIds.length > 0 || orphanMcp.length > 0

  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase()
    if (!query) return skills
    return skills.filter((skill) => `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(query))
  }, [skillSearch, skills])

  const selectedServerIds = useMemo(() => new Set(mcp.map((entry) => entry.serverId)), [mcp])

  const toggleSkill = useCallback((id: string) => {
    setSkillIds((currentIds) => currentIds.includes(id) ? currentIds.filter((value) => value !== id) : [...currentIds, id])
  }, [])

  const removeServer = useCallback((serverId: string) => {
    setMcp((entries) => entries.filter((entry) => entry.serverId !== serverId))
    setConfirmRevokeServerId(null)
  }, [])

  const addServer = useCallback((serverId: string) => {
    setMcp((entries) => entries.some((entry) => entry.serverId === serverId)
      ? entries
      : [...entries, { serverId, trust: 'always-ask' as const }])
  }, [])

  const setServerTrust = useCallback((serverId: string, trust: CapabilityTrust) => {
    setMcp((entries) => entries.map((entry) => entry.serverId === serverId ? { ...entry, trust } : entry))
  }, [])

  const handleSave = useCallback(async () => {
    const generation = requestGeneration.current
    setSaveState('saving')
    try {
      const next = await window.api.setProjectCapabilities(projectId, current)
      if (generation !== requestGeneration.current) return
      setSaved(next)
      setSkillIds(next.skillIds)
      setMcp(next.mcp)
      setSaveState('saved')
      addToast('Project capabilities saved', 'success')
    } catch (cause) {
      if (generation !== requestGeneration.current) return
      setSaveState('error')
      addToast(cause instanceof Error ? cause.message : 'Failed to save project capabilities', 'error')
    }
  }, [addToast, current, projectId])

  const handleRevert = useCallback(() => {
    setSkillIds(saved.skillIds)
    setMcp(saved.mcp)
    setSaveState('idle')
    setConfirmRevokeServerId(null)
  }, [saved])

  if (loading) {
    return (
      <div className="rounded-nexy-sm border-2 border-dashed border-nexy-border bg-nexy-recessed px-4 py-8 text-center text-sm text-nexy-muted">
        Loading project capabilities…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Project capabilities</label>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Skills and MCP servers every chat in this project inherits. A chat or agent can add more on top, but it
          cannot loosen an approval level set here.
        </p>
      </div>

      {hasOrphans && (
        <div className="space-y-2 rounded-nexy-sm border-2 border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Unavailable entries</p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
            These were granted earlier but the skill or MCP server no longer exists. Remove them to save your changes.
          </p>
          {orphanSkillIds.map((id) => (
            <div key={`skill:${id}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-nexy-text">Skill — {id}</span>
              <Button variant="secondary" className="text-[11px]" onClick={() => toggleSkill(id)}>Remove</Button>
            </div>
          ))}
          {orphanMcp.map((entry) => (
            <div key={`mcp:${entry.serverId}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-nexy-text">MCP server — {entry.serverId}</span>
              <Button variant="secondary" className="text-[11px]" onClick={() => removeServer(entry.serverId)}>Remove</Button>
            </div>
          ))}
        </div>
      )}

      <section className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed p-3 shadow-nexy">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-nexy-text">Skills</p>
          {skills.length > 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {skillIds.filter((id) => knownSkillIds.has(id)).length}/{skills.length} active
            </span>
          )}
        </div>
        {skills.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">Import a skill to make it available to this project.</p>
        ) : (
          <>
            <label className="mb-1.5 flex items-center gap-1.5 rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised px-2 py-1">
              <NexyIcon name="search" size={12} className="shrink-0 text-nexy-muted" />
              <input
                type="search"
                value={skillSearch}
                onChange={(event) => setSkillSearch(event.target.value)}
                placeholder="Search skills"
                aria-label="Search skills"
                className="min-w-0 flex-1 bg-transparent text-xs text-nexy-text outline-none placeholder:text-nexy-muted"
              />
            </label>
            <div className="max-h-56 overflow-y-auto overscroll-contain pr-1">
              {filteredSkills.length > 0 ? filteredSkills.map((skill) => (
                <label key={skill.id} className="flex cursor-pointer items-start gap-2 rounded-nexy-sm px-2 py-1.5 hover:bg-nexy-raised">
                  <input
                    type="checkbox"
                    checked={skillIds.includes(skill.id)}
                    onChange={() => toggleSkill(skill.id)}
                    className="mt-0.5 accent-blue-600"
                  />
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

      <section className="rounded-nexy-sm border-2 border-nexy-border bg-nexy-recessed p-3 shadow-nexy">
        <p className="mb-2 text-xs font-semibold text-nexy-text">MCP servers</p>
        {servers.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">No MCP servers are configured yet.</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {servers.map((server) => {
              const entry = mcp.find((candidate) => candidate.serverId === server.id)
              return (
                <div key={server.id} className="rounded-nexy-sm px-2 py-1.5 hover:bg-nexy-raised">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedServerIds.has(server.id)}
                      onChange={() => entry ? setConfirmRevokeServerId(server.id) : addServer(server.id)}
                      aria-label={`Grant ${server.name} to this project`}
                      className="accent-blue-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-gray-700 dark:text-gray-200">{server.name}</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">{server.status} · {server.toolCount} tools</span>
                    </span>
                  </div>
                  {confirmRevokeServerId === server.id && (
                    <div className="mt-1 flex items-center gap-1.5 pl-6 text-[11px]">
                      <span className="text-gray-500 dark:text-gray-400">Revoke for every chat in this project?</span>
                      <button type="button" onClick={() => removeServer(server.id)} className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-700">
                        Revoke
                      </button>
                      <button type="button" onClick={() => setConfirmRevokeServerId(null)} className="rounded-md border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
                        Cancel
                      </button>
                    </div>
                  )}
                  {entry && (
                    <div className="mt-1 flex items-center gap-1.5 pl-6">
                      <span className="text-[10px] text-gray-400">Approval:</span>
                      <select
                        value={entry.trust}
                        onChange={(event) => setServerTrust(server.id, event.target.value as CapabilityTrust)}
                        aria-label={`Approval level for ${server.name}`}
                        className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                      >
                        <option value="always-ask">Ask every time</option>
                        <option value="auto">Auto — no prompt (needed for CLI/agent turns)</option>
                        <option value="block">Blocked</option>
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {mcp.some((entry) => entry.trust === 'always-ask') && (
          <p className="mt-1 px-2 text-[11px] text-amber-600 dark:text-amber-300">
            "Ask every time" servers can't be approved during a headless/CLI turn — set to Auto if agents in this project need them without a human present.
          </p>
        )}
      </section>

      <div className="flex items-center justify-end gap-2">
        <SaveStatus state={saveState} />
        {dirty && <Button variant="secondary" onClick={handleRevert}>Discard changes</Button>}
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!dirty || hasOrphans || saveState === 'saving'}
          title={hasOrphans ? 'Remove unavailable entries before saving' : undefined}
        >
          <NexyIcon name="check" size={14} />
          {saveState === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
