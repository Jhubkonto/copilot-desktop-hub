import { exec, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { WebContents } from 'electron'
import type Database from 'better-sqlite3'
import type {
  AgentGeneratorSpec,
  ArtifactExportFormat,
  BuildCommandName,
  SkillConfig,
  SkillGeneratorSpec,
} from '../shared/types'
import { getDatabase } from './database'
import { requestApproval } from './tools'
import { broadcastToMobile } from './ws-server'
import { parseProjectConfig, getProjectRootDirectory } from './project-handlers'
import { listProjectSources } from './project-sources'
import { listDirectoryEntries } from './file-handlers'
import { discoverReposInWorkspace } from './code-change/repo-discovery'
import { getChangedFiles, getFileDiff, listBranches, commitChanges, createBranch } from './code-change/git-manager'
import { buildConversationExport } from './conversation-export'
import { exportArtifactVersion } from './artifact-export'
import { readArtifactVersionFile } from './artifacts'
import { listProjectAuditSessions, listProjectAuditFiles, getProjectAuditDiff } from './project-audit'
import { runBuildProcess, cancelBuildProcess, mapBuildRecord } from './build-runner'
import { getAutomatedWorkflowRun, getAutomatedWorkflowTemplate, listAutomatedWorkflowRuns, listAutomatedWorkflowTemplates, runAutomatedWorkflowTemplateAgain } from './automated-workflow-runs'
import { retryAutomatedWorkflowStep, startAutomatedWorkflowRun } from './automated-workflow-executor'
import { createAgentFromSpec } from './agent-generator'
import { getAgentConfig } from './agents'
import { createSkillConfig, getSkillConfig, listSkillConfigs, updateSkillConfig, deleteSkillConfig } from './skills'
import { dbListTasks, dbGetTask, dbCreateTask, dbUpdateTask, dbDeleteTask, dbListRuns, schedulerEngine } from './scheduler-engine'
import type { ScheduledTaskCreateInput, ScheduledTaskUpdateInput } from '../shared/types'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)
const MAX_FILE_BYTES = 1_000_000
const MAX_COMMAND_OUTPUT = 2_000_000
const buildProcesses = new Map<string, import('node:child_process').ChildProcess>()

type ToolDefinition = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  pack: string
  mutating?: boolean
}

const stringProperty = (description: string) => ({ type: 'string', description })
const numberProperty = (description: string) => ({ type: 'number', description })

function schema(properties: Record<string, unknown>, required: string[] = []): ToolDefinition['inputSchema'] {
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

export const PROJECT_MCP_TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'search_project_wiki', pack: 'wiki', description: 'Search the selected project wiki.', inputSchema: schema({ query: stringProperty('Keywords or question') }, ['query']) },
  { name: 'list_recent_wiki_entries', pack: 'wiki', description: 'List recently updated active wiki entries.', inputSchema: schema({ limit: numberProperty('Maximum entries, default 8') }) },
  { name: 'propose_wiki_entry', pack: 'wiki', mutating: true, description: 'Propose a project wiki entry; the user must approve it before saving.', inputSchema: schema({ title: stringProperty('Entry title'), body: stringProperty('Markdown body'), tags: { type: 'array', items: { type: 'string' } } }, ['title', 'body']) },

  { name: 'get_project_context', pack: 'workspace', description: 'Return selected project metadata, configuration, sources, repositories, and primary workspace path.', inputSchema: schema({}) },
  { name: 'list_project_sources', pack: 'workspace', description: 'List the selected project sources and discovered repositories.', inputSchema: schema({}) },
  { name: 'list_project_files', pack: 'workspace', description: 'List files and directories inside the selected project workspace.', inputSchema: schema({ path: stringProperty('Optional workspace-relative directory'), maxDepth: numberProperty('Maximum depth, default 4') }) },
  { name: 'read_project_file', pack: 'workspace', description: 'Read a UTF-8 text file inside the selected project workspace.', inputSchema: schema({ path: stringProperty('Workspace-relative file path') }, ['path']) },
  { name: 'search_project_files', pack: 'workspace', description: 'Search text files inside the selected project workspace.', inputSchema: schema({ query: stringProperty('Text to search for'), path: stringProperty('Optional workspace-relative directory'), maxResults: numberProperty('Maximum matches, default 50') }, ['query']) },
  { name: 'write_project_file', pack: 'workspace', mutating: true, description: 'Write a UTF-8 file inside the selected project workspace after user approval.', inputSchema: schema({ path: stringProperty('Workspace-relative file path'), content: stringProperty('Complete file content') }, ['path', 'content']) },
  { name: 'run_project_command', pack: 'workspace', mutating: true, description: 'Run an approved shell command with its working directory constrained to the selected project.', inputSchema: schema({ command: stringProperty('Command to run'), cwd: stringProperty('Optional workspace-relative working directory'), timeoutMs: numberProperty('Timeout, capped at 120000 ms') }, ['command']) },

  { name: 'list_repositories', pack: 'git', description: 'Discover Git repositories inside the selected project workspace.', inputSchema: schema({}) },
  { name: 'git_status', pack: 'git', description: 'Return branch, commit, and changed files for a selected repository.', inputSchema: schema({ repo: stringProperty('Optional repository path relative to the project') }) },
  { name: 'git_diff', pack: 'git', description: 'Return a full-context diff for a repository or one file.', inputSchema: schema({ repo: stringProperty('Optional repository path'), path: stringProperty('Optional repository-relative file path') }) },
  { name: 'list_branches', pack: 'git', description: 'List local and remote branches for a repository.', inputSchema: schema({ repo: stringProperty('Optional repository path') }) },
  { name: 'git_log', pack: 'git', description: 'List recent commits for a repository.', inputSchema: schema({ repo: stringProperty('Optional repository path'), limit: numberProperty('Maximum commits, default 20') }) },
  { name: 'git_commit', pack: 'git', mutating: true, description: 'Commit selected repository changes after user approval.', inputSchema: schema({ repo: stringProperty('Optional repository path'), message: stringProperty('Commit message'), files: { type: 'array', items: { type: 'string' } } }, ['message']) },
  { name: 'git_create_branch', pack: 'git', mutating: true, description: 'Create and check out a branch after user approval.', inputSchema: schema({ repo: stringProperty('Optional repository path'), branch: stringProperty('New branch name'), fromRef: stringProperty('Optional starting ref') }, ['branch']) },

  { name: 'list_artifacts', pack: 'artifacts', description: 'List artifacts belonging to the selected project.', inputSchema: schema({}) },
  { name: 'get_artifact', pack: 'artifacts', description: 'Get one selected-project artifact and its current version.', inputSchema: schema({ artifactId: stringProperty('Artifact id') }, ['artifactId']) },
  { name: 'list_artifact_versions', pack: 'artifacts', description: 'List versions for a selected-project artifact.', inputSchema: schema({ artifactId: stringProperty('Artifact id') }, ['artifactId']) },
  { name: 'read_artifact_file', pack: 'artifacts', description: 'Read a file from a selected-project artifact version.', inputSchema: schema({ versionId: stringProperty('Artifact version id'), path: stringProperty('Version-relative file path') }, ['versionId', 'path']) },
  { name: 'export_artifact', pack: 'artifacts', mutating: true, description: 'Export an artifact version into the selected project workspace after approval.', inputSchema: schema({ versionId: stringProperty('Artifact version id'), format: { type: 'string', enum: ['raw-files', 'markdown', 'json'] }, destination: stringProperty('Optional workspace-relative destination') }, ['versionId']) },

  { name: 'search_conversations', pack: 'conversations', description: 'Search conversations belonging to the selected project.', inputSchema: schema({ query: stringProperty('Search text'), limit: numberProperty('Maximum results, default 50') }) },
  { name: 'get_conversation_messages', pack: 'conversations', description: 'Read messages from a selected-project conversation.', inputSchema: schema({ conversationId: stringProperty('Conversation id'), limit: numberProperty('Maximum messages, default 200') }, ['conversationId']) },
  { name: 'export_conversation', pack: 'conversations', description: 'Export a selected-project conversation as Nexy JSON.', inputSchema: schema({ conversationId: stringProperty('Conversation id') }, ['conversationId']) },

  { name: 'list_audit_sessions', pack: 'audit', description: 'List project edit audit sessions.', inputSchema: schema({}) },
  { name: 'list_touched_files', pack: 'audit', description: 'List files touched by an audit session.', inputSchema: schema({ sessionId: stringProperty('Audit session id') }, ['sessionId']) },
  { name: 'get_file_diff', pack: 'audit', description: 'Read an audit diff for a selected-project file.', inputSchema: schema({ sessionId: stringProperty('Audit session id'), path: stringProperty('Workspace-relative file path'), fileId: stringProperty('Optional touched-file id') }, ['sessionId', 'path']) },

  { name: 'run_preflight', pack: 'build', description: 'Run local project build preflight checks.', inputSchema: schema({}) },
  { name: 'start_build', pack: 'build', mutating: true, description: 'Start a standard project build command after approval.', inputSchema: schema({ command: { type: 'string', enum: ['typecheck', 'test', 'build', 'package'] } }, ['command']) },
  { name: 'get_build_status', pack: 'build', description: 'Get one build record.', inputSchema: schema({ buildId: stringProperty('Build id') }, ['buildId']) },
  { name: 'get_build_records', pack: 'build', description: 'List build records for the selected project workspace.', inputSchema: schema({ limit: numberProperty('Maximum records, default 20') }) },
  { name: 'cancel_build', pack: 'build', mutating: true, description: 'Cancel a running build after user approval.', inputSchema: schema({ buildId: stringProperty('Build id') }, ['buildId']) },

  { name: 'list_workflows', pack: 'workflows', description: 'List saved workflow templates and runs for the selected project.', inputSchema: schema({}) },
  { name: 'get_workflow', pack: 'workflows', description: 'Get a saved workflow template.', inputSchema: schema({ templateId: stringProperty('Workflow template id') }, ['templateId']) },
  { name: 'start_workflow', pack: 'workflows', mutating: true, description: 'Start a pending workflow or create a run from a template after approval.', inputSchema: schema({ runId: stringProperty('Pending run id'), templateId: stringProperty('Template id to run again') }) },
  { name: 'get_workflow_run', pack: 'workflows', description: 'Get a workflow run detail.', inputSchema: schema({ runId: stringProperty('Workflow run id') }, ['runId']) },
  { name: 'retry_workflow', pack: 'workflows', mutating: true, description: 'Retry a failed workflow step after user approval.', inputSchema: schema({ runId: stringProperty('Workflow run id'), stepId: stringProperty('Optional failed step database id') }, ['runId']) },

  { name: 'list_agents', pack: 'agents', description: 'List Nexy agents available to the selected project.', inputSchema: schema({}) },
  { name: 'get_agent', pack: 'agents', description: 'Get one Nexy agent configuration.', inputSchema: schema({ agentId: stringProperty('Agent id') }, ['agentId']) },
  { name: 'create_agent', pack: 'agents', mutating: true, description: 'Create and attach an agent to the selected project after approval.', inputSchema: schema({ spec: { type: 'object', description: 'AgentGeneratorSpec JSON' } }, ['spec']) },
  { name: 'update_agent', pack: 'agents', mutating: true, description: 'Update an agent after user approval.', inputSchema: schema({ agentId: stringProperty('Agent id'), config: { type: 'object' } }, ['agentId', 'config']) },
  { name: 'delete_agent', pack: 'agents', mutating: true, description: 'Delete an agent after user approval.', inputSchema: schema({ agentId: stringProperty('Agent id') }, ['agentId']) },

  { name: 'list_skills', pack: 'skills', description: 'List Nexy skills.', inputSchema: schema({}) },
  { name: 'get_skill', pack: 'skills', description: 'Get one Nexy skill package configuration.', inputSchema: schema({ skillId: stringProperty('Skill id') }, ['skillId']) },
  { name: 'create_skill', pack: 'skills', mutating: true, description: 'Create a skill package after approval.', inputSchema: schema({ spec: { type: 'object', description: 'SkillGeneratorSpec JSON' } }, ['spec']) },
  { name: 'update_skill', pack: 'skills', mutating: true, description: 'Update a skill package after approval.', inputSchema: schema({ skillId: stringProperty('Skill id'), config: { type: 'object' } }, ['skillId', 'config']) },
  { name: 'delete_skill', pack: 'skills', mutating: true, description: 'Delete a skill package after approval.', inputSchema: schema({ skillId: stringProperty('Skill id') }, ['skillId']) },

  { name: 'list_schedules', pack: 'automation', description: 'List scheduled tasks.', inputSchema: schema({}) },
  { name: 'get_schedule', pack: 'automation', description: 'Get one scheduled task.', inputSchema: schema({ taskId: stringProperty('Scheduled task id') }, ['taskId']) },
  { name: 'create_schedule', pack: 'automation', mutating: true, description: 'Create a scheduled task after approval.', inputSchema: schema({ input: { type: 'object' } }, ['input']) },
  { name: 'update_schedule', pack: 'automation', mutating: true, description: 'Update a scheduled task after approval.', inputSchema: schema({ taskId: stringProperty('Scheduled task id'), input: { type: 'object' } }, ['taskId', 'input']) },
  { name: 'delete_schedule', pack: 'automation', mutating: true, description: 'Delete a scheduled task after approval.', inputSchema: schema({ taskId: stringProperty('Scheduled task id') }, ['taskId']) },
  { name: 'run_schedule_now', pack: 'automation', mutating: true, description: 'Trigger a scheduled task immediately after approval.', inputSchema: schema({ taskId: stringProperty('Scheduled task id') }, ['taskId']) },
  { name: 'list_schedule_runs', pack: 'automation', description: 'List runs for a scheduled task.', inputSchema: schema({ taskId: stringProperty('Scheduled task id'), limit: numberProperty('Maximum runs, default 50') }, ['taskId']) },
]

function textResult(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function projectRoot(projectId: string): string {
  const root = getProjectRootDirectory(projectId)
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) throw new Error('The selected project has no accessible workspace')
  return path.resolve(root)
}

function inside(root: string, candidate: string): string {
  const resolved = path.resolve(root, candidate)
  const relative = path.relative(root, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path must stay inside the selected project workspace')
  return resolved
}

function relativeInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dbProjectExists(db: Database.Database, projectId: string): void {
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('Project not found')
}

function repoRoot(root: string, value: unknown): string {
  const relative = relativeInput(value)
  const candidate = relative ? inside(root, relative) : root
  const metadata = (() => { try { return statSync(path.join(candidate, '.git')) } catch { return null } })()
  if (metadata || existsSync(path.join(candidate, '.git'))) return candidate
  throw new Error('Repository not found inside the selected project')
}

async function approve(webContents: WebContents, toolName: string, args: Record<string, unknown>, description: string): Promise<void> {
  if (webContents.isDestroyed()) throw new Error('Nexy window is closed — cannot request approval')
  if (!await requestApproval(webContents, toolName, args, description, { noRemember: true })) throw new Error('User declined the requested operation')
}

function projectArtifact(db: Database.Database, projectId: string, artifactId: string): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ? AND project_id = ?').get(artifactId, projectId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Artifact not found in the selected project')
  return row
}

function versionProject(db: Database.Database, projectId: string, versionId: string): Record<string, unknown> {
  const row = db.prepare(`SELECT v.*, a.project_id FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id WHERE v.id = ? AND a.project_id = ?`).get(versionId, projectId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Artifact version not found in the selected project')
  return row
}

function conversationProject(db: Database.Database, projectId: string, conversationId: string): void {
  if (!db.prepare('SELECT 1 FROM conversations WHERE id = ? AND project_id = ?').get(conversationId, projectId)) throw new Error('Conversation not found in the selected project')
}

function auditProject(db: Database.Database, projectId: string, sessionId: string): void {
  if (!db.prepare('SELECT 1 FROM project_edit_sessions WHERE id = ? AND project_id = ?').get(sessionId, projectId)) throw new Error('Audit session not found in the selected project')
}

async function runPreflight(root: string): Promise<{ checks: Array<{ label: string; status: 'ok' | 'warn' | 'fail'; detail: string }> }> {
  const checks: Array<{ label: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = []
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: root, timeout: 5000 })
    checks.push({ label: 'Git working tree', status: stdout.trim() ? 'warn' : 'ok', detail: stdout.trim() ? `${stdout.trim().split('\n').length} changed file(s)` : 'Clean' })
  } catch { checks.push({ label: 'Git working tree', status: 'warn', detail: 'Git status unavailable' }) }
  const packageJson = path.join(root, 'package.json')
  if (existsSync(packageJson)) checks.push({ label: 'package.json', status: 'ok', detail: 'Present' })
  else checks.push({ label: 'package.json', status: 'warn', detail: 'Not present; project may use another toolchain' })
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'poetry.lock'].find((name) => existsSync(path.join(root, name)))
  checks.push({ label: 'Dependency lockfile', status: lock ? 'ok' : 'warn', detail: lock ?? 'No recognized lockfile found' })
  return { checks }
}

async function startProjectBuild(projectId: string, command: BuildCommandName): Promise<{ buildId: string }> {
  const root = projectRoot(projectId)
  const commands: Record<BuildCommandName, string> = { typecheck: 'npx tsc --noEmit -p tsconfig.typecheck.json', test: 'npx vitest run', build: 'npm run build', package: 'npm run package' }
  const id = randomUUID()
  const db = getDatabase()
  const git = await execFileAsync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, timeout: 5000 }).then((r) => r.stdout.trim()).catch(() => null)
  const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 5000 }).then((r) => r.stdout.trim()).catch(() => null)
  const now = Date.now()
  db.prepare(`INSERT INTO build_records (id, workspace_path, commit_sha, branch, version, platform, command, status, started_at) VALUES (?, ?, ?, ?, NULL, ?, ?, 'running', ?)`).run(id, root, git, branch, process.platform, command, now)
  runBuildProcess({ db, buildId: id, spawnCmd: commands[command], spawnArgs: [], cwd: root, logEvent: 'build:log-chunk', doneEvent: 'build:command-done', registry: buildProcesses })
  return { buildId: id }
}

export async function callProjectMcpTool(projectId: string, webContents: WebContents, toolName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = getDatabase()
  dbProjectExists(db, projectId)
  const root = projectRoot(projectId)

  if (toolName === 'search_project_wiki' || toolName === 'list_recent_wiki_entries' || toolName === 'propose_wiki_entry') {
    const { getRelevantWikiEntries, formatWikiSection } = await import('./wiki-context')
    const { listRecentWikiEntries, proposeWikiChange, applyWikiChangeProposal } = await import('./wiki-handlers')
    if (toolName === 'search_project_wiki') {
      const entries = getRelevantWikiEntries(db, projectId, String(args.query ?? ''))
      return textResult(entries.length ? formatWikiSection(entries) : 'No relevant wiki entries found for this query.')
    }
    if (toolName === 'list_recent_wiki_entries') return textResult(listRecentWikiEntries(db, projectId, Number(args.limit ?? 8)))
    const proposal = proposeWikiChange(db, projectId, String(args.title ?? ''), String(args.body ?? ''), args.tags)
    await approve(webContents, toolName, args, `Save wiki proposal "${proposal.title}" (${proposal.action})`)
    const entry = applyWikiChangeProposal(db, proposal)
    broadcastToMobile({
      event: proposal.action === 'create' ? 'wiki:entry-created' : 'wiki:entry-updated',
      data: { entry: {
        ...entry,
        projectId: entry.project_id,
        sourceConversationId: entry.source_conversation_id,
        sourceMessageId: entry.source_message_id,
        supersededBy: entry.superseded_by,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      } },
    })
    return textResult({ saved: true, entry })
  }

  if (toolName === 'get_project_context') {
    const row = db.prepare('SELECT id, name, color, default_model, config_json, created_at, updated_at FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>
    return textResult({ ...row, config: parseProjectConfig(String(row.config_json ?? '')), ...listProjectSources(db, projectId), rootDirectory: root })
  }
  if (toolName === 'list_project_sources') return textResult(listProjectSources(db, projectId))
  if (toolName === 'list_project_files') {
    const target = inside(root, relativeInput(args.path))
    const depth = Math.max(1, Math.min(8, Number(args.maxDepth ?? 4)))
    return textResult({ path: target, entries: listDirectoryEntries(target, depth, '') })
  }
  if (toolName === 'read_project_file') {
    const target = inside(root, relativeInput(args.path))
    const stat = statSync(target)
    if (!stat.isFile()) throw new Error('Path is not a file')
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte read limit`)
    return textResult({ path: relativeInput(args.path), content: await fs.readFile(target, 'utf8') })
  }
  if (toolName === 'search_project_files') {
    const query = String(args.query ?? '')
    if (!query) throw new Error('Search query is required')
    const base = inside(root, relativeInput(args.path))
    const entries = listDirectoryEntries(base, Math.max(1, Math.min(8, Number(args.maxDepth ?? 6))), '')
    const results: Array<{ path: string; line: number; text: string }> = []
    const needle = query.toLowerCase()
    for (const entry of entries.filter((item) => item.type === 'file')) {
      if (results.length >= Math.min(200, Math.max(1, Number(args.maxResults ?? 50)))) break
      const target = path.join(base, ...entry.relativePath.split('/'))
      try {
        if (statSync(target).size > MAX_FILE_BYTES) continue
        const content = readFileSync(target, 'utf8')
        if (content.includes('\0')) continue
        content.split(/\r?\n/).forEach((line, index) => {
          if (results.length < Number(args.maxResults ?? 50) && line.toLowerCase().includes(needle)) results.push({ path: path.relative(root, target).replace(/\\/g, '/'), line: index + 1, text: line.slice(0, 500) })
        })
      } catch { /* unreadable/binary files are skipped */ }
    }
    return textResult(results)
  }
  if (toolName === 'write_project_file') {
    const target = inside(root, relativeInput(args.path))
    const content = String(args.content ?? '')
    if (Buffer.byteLength(content, 'utf8') > 5_000_000) throw new Error('File write is limited to 5 MB')
    await approve(webContents, toolName, args, `Write project file ${path.relative(root, target)}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
    return textResult({ written: true, path: path.relative(root, target).replace(/\\/g, '/') })
  }
  if (toolName === 'run_project_command') {
    const cwd = inside(root, relativeInput(args.cwd))
    const command = String(args.command ?? '').trim()
    if (!command) throw new Error('Command is required')
    const timeout = Math.min(120_000, Math.max(1_000, Number(args.timeoutMs ?? 60_000)))
    await approve(webContents, toolName, args, `Run project command in ${path.relative(root, cwd) || '.'}: ${command}`)
    try {
      const result = await execAsync(command, { cwd, timeout, maxBuffer: MAX_COMMAND_OUTPUT, windowsHide: true })
      return textResult({ exitCode: 0, stdout: result.stdout, stderr: result.stderr })
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string }
      return textResult({ exitCode: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? failure.message ?? String(error), failed: true })
    }
  }

  if (toolName === 'list_repositories') return textResult(await discoverReposInWorkspace(root))
  if (['git_status', 'git_diff', 'list_branches', 'git_log', 'git_commit', 'git_create_branch'].includes(toolName)) {
    const repository = repoRoot(root, args.repo)
    if (toolName === 'git_status') {
      const branch = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repository }).then((r) => r.stdout.trim()).catch(() => null)
      const sha = await execFileAsync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: repository }).then((r) => r.stdout.trim()).catch(() => null)
      return textResult({ repository, branch, commit: sha, changedFiles: await getChangedFiles(repository) })
    }
    if (toolName === 'git_diff') return textResult(args.path ? await getFileDiff(repository, relativeInput(args.path)) : (await execFileAsync('git', ['diff', '--unified=100000', 'HEAD'], { cwd: repository, maxBuffer: 64 * 1024 * 1024 })).stdout)
    if (toolName === 'list_branches') return textResult(await listBranches(repository))
    if (toolName === 'git_log') {
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 20)))
      return textResult((await execFileAsync('git', ['log', `-${limit}`, '--date=iso-strict', '--format=%H%x09%ad%x09%an%x09%s'], { cwd: repository, maxBuffer: 4 * 1024 * 1024 })).stdout.trim().split('\n').filter(Boolean).map((line) => { const [sha, date, author, ...subject] = line.split('\t'); return { sha, date, author, subject: subject.join('\t') } }))
    }
    await approve(webContents, toolName, args, toolName === 'git_commit' ? `Commit changes in ${path.relative(root, repository) || '.'}: ${String(args.message ?? '')}` : `Create Git branch ${String(args.branch ?? '')}`)
    if (toolName === 'git_commit') return textResult(await commitChanges(repository, String(args.message ?? ''), Array.isArray(args.files) ? args.files.map(String) : undefined))
    return textResult(await createBranch(repository, String(args.branch ?? ''), typeof args.fromRef === 'string' ? args.fromRef : undefined))
  }

  if (toolName === 'list_artifacts') {
    const rows = db.prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Record<string, unknown>[]
    return textResult(rows)
  }
  if (toolName === 'get_artifact') return textResult(projectArtifact(db, projectId, String(args.artifactId)))
  if (toolName === 'list_artifact_versions') {
    projectArtifact(db, projectId, String(args.artifactId))
    return textResult(db.prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC').all(String(args.artifactId)))
  }
  if (toolName === 'read_artifact_file') {
    const version = versionProject(db, projectId, String(args.versionId))
    const file = db.prepare('SELECT relative_path, media_type, absolute_path, size_bytes FROM artifact_files WHERE version_id = ? AND relative_path = ?').get(String(args.versionId), String(args.path)) as Record<string, unknown> | undefined
    if (!file) throw new Error('Artifact file not found')
    if (Number(file.size_bytes ?? 0) > MAX_FILE_BYTES) throw new Error('Artifact file exceeds read limit')
    const content = readArtifactVersionFile(String(version.id), String(args.path))
    if (content !== null) return textResult({ path: file.relative_path, mediaType: file.media_type, content })
    throw new Error('Artifact file is not readable as UTF-8 text')
  }
  if (toolName === 'export_artifact') {
    const versionId = String(args.versionId)
    versionProject(db, projectId, versionId)
    const destination = inside(root, relativeInput(args.destination) || `exports/artifact-${versionId.slice(0, 8)}`)
    const format = (args.format === 'markdown' || args.format === 'json' || args.format === 'raw-files' ? args.format : 'raw-files') as ArtifactExportFormat
    await approve(webContents, toolName, args, `Export artifact version ${versionId} to ${path.relative(root, destination)}`)
    return textResult({ exported: await exportArtifactVersion(versionId, format, destination), format })
  }

  if (toolName === 'search_conversations') {
    const query = `%${String(args.query ?? '')}%`
    const limit = Math.min(200, Math.max(1, Number(args.limit ?? 50)))
    return textResult(db.prepare(`SELECT DISTINCT c.id, c.title, c.agent_id, c.project_id, c.created_at, c.updated_at FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id WHERE c.project_id = ? AND (c.title LIKE ? OR m.content LIKE ?) ORDER BY c.updated_at DESC LIMIT ?`).all(projectId, query, query, limit))
  }
  if (toolName === 'get_conversation_messages') {
    const id = String(args.conversationId); conversationProject(db, projectId, id)
    return textResult(db.prepare('SELECT id, role, content, timestamp, model FROM messages WHERE conversation_id = ? ORDER BY timeline_order ASC, timestamp ASC, id ASC LIMIT ?').all(id, Math.min(1000, Math.max(1, Number(args.limit ?? 200)))))
  }
  if (toolName === 'export_conversation') { const id = String(args.conversationId); conversationProject(db, projectId, id); return textResult(buildConversationExport(db, id)) }

  if (toolName === 'list_audit_sessions') return textResult(listProjectAuditSessions(projectId))
  if (toolName === 'list_touched_files') { const id = String(args.sessionId); auditProject(db, projectId, id); return textResult(listProjectAuditFiles(id)) }
  if (toolName === 'get_file_diff') { const id = String(args.sessionId); auditProject(db, projectId, id); return textResult(getProjectAuditDiff(id, String(args.path), typeof args.fileId === 'string' ? args.fileId : null)) }

  if (toolName === 'run_preflight') return textResult(await runPreflight(root))
  if (toolName === 'start_build') { const command = String(args.command) as BuildCommandName; if (!['typecheck', 'test', 'build', 'package'].includes(command)) throw new Error('Unsupported build command'); await approve(webContents, toolName, args, `Start ${command} build for the selected project`); return textResult(await startProjectBuild(projectId, command)) }
  if (toolName === 'get_build_status' || toolName === 'get_build_records') {
    const records = db.prepare('SELECT * FROM build_records WHERE workspace_path = ? ORDER BY started_at DESC LIMIT ?').all(root, toolName === 'get_build_status' ? 1000 : Math.min(100, Math.max(1, Number(args.limit ?? 20)))) as Record<string, unknown>[]
    const scoped = records.filter((row) => path.resolve(String(row.workspace_path)) === root)
    if (toolName === 'get_build_status') return textResult(scoped.map(mapBuildRecord).find((record) => record.id === String(args.buildId)) ?? null)
    return textResult(scoped.map(mapBuildRecord))
  }
  if (toolName === 'cancel_build') { await approve(webContents, toolName, args, `Cancel build ${String(args.buildId)}`); return textResult({ cancelled: cancelBuildProcess({ db, buildId: String(args.buildId), registry: buildProcesses }) }) }

  if (toolName === 'list_workflows') return textResult({ templates: listAutomatedWorkflowTemplates(projectId), runs: listAutomatedWorkflowRuns(projectId) })
  if (toolName === 'get_workflow') return textResult(getAutomatedWorkflowTemplate(String(args.templateId)))
  if (toolName === 'get_workflow_run') { const run = getAutomatedWorkflowRun(String(args.runId)); if (run?.projectId !== projectId) throw new Error('Workflow run not found in the selected project'); return textResult(run) }
  if (toolName === 'start_workflow') {
    await approve(webContents, toolName, args, 'Start the selected automated workflow')
    if (typeof args.templateId === 'string' && args.templateId) { const template = getAutomatedWorkflowTemplate(args.templateId); if (template?.projectId !== projectId) throw new Error('Workflow template not found in the selected project'); const run = runAutomatedWorkflowTemplateAgain(args.templateId); return textResult(await startAutomatedWorkflowRun(run.id)) }
    const run = getAutomatedWorkflowRun(String(args.runId)); if (run?.projectId !== projectId) throw new Error('Workflow run not found in the selected project'); return textResult(await startAutomatedWorkflowRun(String(args.runId)))
  }
  if (toolName === 'retry_workflow') {
    const run = getAutomatedWorkflowRun(String(args.runId)); if (!run || run.projectId !== projectId) throw new Error('Workflow run not found in the selected project')
    const step = typeof args.stepId === 'string' && args.stepId ? args.stepId : run.steps.find((candidate) => candidate.status === 'failed')?.dbId
    if (!step) throw new Error('No failed workflow step to retry')
    await approve(webContents, toolName, args, `Retry workflow step ${step}`)
    return textResult(await retryAutomatedWorkflowStep(run.id, step))
  }

  if (toolName === 'list_agents') {
    const rows = db.prepare('SELECT id, config_json, is_default, created_at, updated_at FROM agents ORDER BY created_at ASC').all() as Array<{ id: string; config_json: string; is_default: number; created_at: number; updated_at: number }>
    return textResult(rows.map((row) => ({ ...getAgentConfig(row.id), id: row.id, isDefault: row.is_default === 1, createdAt: row.created_at, updatedAt: row.updated_at })))
  }
  if (toolName === 'get_agent') return textResult(getAgentConfig(String(args.agentId)))
  if (toolName === 'create_agent') {
    const spec = (args.spec ?? {}) as AgentGeneratorSpec
    await approve(webContents, toolName, args, `Create agent ${String(spec.name ?? 'New Agent')}`)
    const created = await createAgentFromSpec({ name: String(spec.name ?? 'New Agent'), icon: String(spec.icon ?? '🤖'), systemPrompt: String(spec.systemPrompt ?? ''), temperature: Number(spec.temperature ?? 0.7), responseFormat: spec.responseFormat ?? 'default', agenticMode: spec.agenticMode === true, tools: { fileEdit: spec.tools?.fileEdit === true, terminal: spec.tools?.terminal === true, webFetch: spec.tools?.webFetch === true }, rootDirectory: spec.rootDirectory, contextDirectories: Array.isArray(spec.contextDirectories) ? spec.contextDirectories : [], memory: spec.memory, customCommands: Array.isArray(spec.customCommands) ? spec.customCommands : [] })
    db.prepare('INSERT OR IGNORE INTO project_agents (project_id, agent_id, is_primary, sort_order, added_at) VALUES (?, ?, 0, 0, ?)').run(projectId, created.agentId, Date.now())
    return textResult(created)
  }
  if (toolName === 'update_agent') {
    const id = String(args.agentId); if (!getAgentConfig(id)) throw new Error('Agent not found')
    await approve(webContents, toolName, args, `Update agent ${id}`)
    const config = args.config as Record<string, unknown>
    db.prepare('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(config), Date.now(), id)
    return textResult(getAgentConfig(id))
  }
  if (toolName === 'delete_agent') {
    const id = String(args.agentId); if (!getAgentConfig(id)) throw new Error('Agent not found')
    await approve(webContents, toolName, args, `Delete agent ${id}`)
    db.prepare('UPDATE conversations SET agent_id = NULL WHERE agent_id = ?').run(id); db.prepare('DELETE FROM agents WHERE id = ?').run(id)
    return textResult({ deleted: true, agentId: id })
  }

  if (toolName === 'list_skills') return textResult(listSkillConfigs())
  if (toolName === 'get_skill') return textResult(getSkillConfig(String(args.skillId)))
  if (toolName === 'create_skill') {
    const spec = (args.spec ?? {}) as SkillGeneratorSpec
    await approve(webContents, toolName, args, `Create skill ${String(spec.name ?? 'New Skill')}`)
    return textResult(createSkillConfig({ name: spec.name, icon: spec.icon, description: spec.description, instructions: spec.instructions, tools: {
      fileEdit: { enabled: spec.tools?.fileEdit === true, approval: 'always-ask', instructions: '' },
      terminal: { enabled: spec.tools?.terminal === true, approval: 'always-ask', instructions: '' },
      webFetch: { enabled: spec.tools?.webFetch === true, approval: 'always-ask', instructions: '' },
    }, tags: spec.tags ?? [], knowledge: spec.knowledge ?? [], mcpServers: spec.mcpServers ?? [] }))
  }
  if (toolName === 'update_skill') { const id = String(args.skillId); if (!getSkillConfig(id)) throw new Error('Skill not found'); await approve(webContents, toolName, args, `Update skill ${id}`); return textResult(updateSkillConfig(id, args.config as Partial<SkillConfig>)) }
  if (toolName === 'delete_skill') { const id = String(args.skillId); await approve(webContents, toolName, args, `Delete skill ${id}`); return textResult({ deleted: deleteSkillConfig(id), skillId: id }) }

  if (toolName === 'list_schedules') return textResult(dbListTasks())
  if (toolName === 'get_schedule') return textResult(dbGetTask(String(args.taskId)))
  if (toolName === 'create_schedule') { await approve(webContents, toolName, args, 'Create scheduled task'); const task = dbCreateTask(args.input as ScheduledTaskCreateInput); if (task.enabled) schedulerEngine.scheduleTask(task); return textResult(task) }
  if (toolName === 'update_schedule') { await approve(webContents, toolName, args, `Update scheduled task ${String(args.taskId)}`); const task = dbUpdateTask(String(args.taskId), args.input as ScheduledTaskUpdateInput); if (!task) throw new Error('Scheduled task not found'); if (task.enabled) schedulerEngine.scheduleTask(task); else schedulerEngine.unscheduleTask(task.id); return textResult(task) }
  if (toolName === 'delete_schedule') { await approve(webContents, toolName, args, `Delete scheduled task ${String(args.taskId)}`); schedulerEngine.unscheduleTask(String(args.taskId)); return textResult({ deleted: dbDeleteTask(String(args.taskId)) }) }
  if (toolName === 'run_schedule_now') { await approve(webContents, toolName, args, `Run scheduled task ${String(args.taskId)} now`); return textResult(await schedulerEngine.triggerRun(String(args.taskId), 'manual')) }
  if (toolName === 'list_schedule_runs') return textResult(dbListRuns(String(args.taskId), Math.min(200, Math.max(1, Number(args.limit ?? 50)))))

  throw new Error(`Unknown project MCP tool: ${toolName}`)
}
