export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'team-activity' | 'tool-call'
  content: string
  model?: string | null
  isEdited?: boolean
  previousContent?: string | null
  timestamp: number
  attachments?: Attachment[]
}

export interface Attachment {
  id: string
  name: string
  path: string
  size: number
}

export interface Conversation {
  id: string
  agentId: string | null
  title: string
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

export interface DebriefSection {
  summary: string
  commandsAndTools: string[]
  reproductionGuide: string
  mentalModel: string
}

export interface Debrief {
  id: string
  conversationId: string
  projectId: string | null
  summary: string
  commandsTools: string[]
  reproductionGuide: string
  mentalModel: string
  generatedAt: number
  createdAt: number
}

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

export interface QuizQuestion {
  id: string
  question: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  explanation: string
  category: 'command' | 'concept' | 'sequence' | 'approach'
}

export interface QuizResult {
  questionId: string
  selectedIndex: number
  correct: boolean
}

export interface DebriefArtifactResult {
  debrief: Debrief
  artifactId: string
  versionId: string
}

export type BackgroundActivityKind =
  | 'project-generator'
  | 'agent-generator'
  | 'skill-generator'
  | 'scheduler-generator'
  | 'manual-workflow-generator'
  | 'debrief-generation'
  | 'quiz-generation'
  | 'chat'
  | 'build'
  | 'remote-edit'
  | 'orchestration'

export interface BackgroundActivity {
  id: string
  kind: BackgroundActivityKind
  label: string
  detail?: string
  projectId?: string
  conversationId?: string
  startedAt: number
}

export interface QuizArtifactResult {
  questions: QuizQuestion[]
  artifactId: string
  versionId: string
}

export interface ToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

/**
 * Thinking/reasoning support per provider.
 * true = full extended-thinking support
 * 'o-series-only' = only for o-series / reasoning models
 * false = not supported (thinking effort param is ignored or unsupported)
 */
export const PROVIDER_THINKING_SUPPORT: Record<string, boolean | 'o-series-only'> = {
  anthropic: true,
  openai: 'o-series-only',
  azure: 'o-series-only',
  openrouter: false,
  groq: false,
  mistral: false,
  gemini: false,
  xai: false,
}

export interface AgentConfig {
  id: string
  name: string
  icon: string
  systemPrompt: string
  /** @deprecated Agents no longer own a model. The model is a user/global concern. */
  model?: string
  temperature: number
  maxTokens: number
  contextDirectories: string[]
  contextFiles: string[]
  mcpServers: string[]
  agenticMode: boolean
  tools: { fileEdit: ToolConfig; terminal: ToolConfig; webFetch: ToolConfig }
  responseFormat: 'concise' | 'detailed' | 'code-only' | 'default'
  isDefault?: boolean
  rootDirectory?: string
  contextRules?: {
    ignoredGlobs: string[]
    autoInjectWorkspace: boolean
    autoInjectGit: boolean
  }
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
  backend?: 'claude-cli' | 'codex-cli' | 'gh-copilot'
  /** Model to use when backend is a CLI (e.g. 'claude-sonnet-4-6' or 'gpt-4.1'). */
  cliModel?: string
  /** How much reasoning effort the model should spend. undefined/'disabled' = provider default. */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max' | 'disabled'
  /** When true, all tool executions are approved automatically. No approval prompts are shown. Use only for fully trusted agents. */
  fullAutoApprove?: boolean
}

export interface SkillBuiltinToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

export interface SkillMcpToolOverride {
  serverId: string
  toolName: string
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
}

export interface SkillMcpServerTrust {
  serverId: string
  trust: 'auto' | 'always-ask' | 'block'
}

export interface SkillConfig {
  id: string
  name: string
  icon: string
  description: string
  instructions: string
  tools: { fileEdit: SkillBuiltinToolConfig; terminal: SkillBuiltinToolConfig; webFetch: SkillBuiltinToolConfig }
  mcpServers: string[]
  mcpServerTrust: SkillMcpServerTrust[]
  mcpToolOverrides: SkillMcpToolOverride[]
  knowledge: { title: string; content: string }[]
  tags: string[]
  created_at?: number
  updated_at?: number
}

export interface CliInstallStatus {
  installed: boolean
  path: string | null
  version: string | null
}

export interface ProjectOrchestrationConfig {
  workflowMode: 'single-agent' | 'manual-delegation' | 'orchestrated'
  orchestrationEnabled: boolean
  maxDelegationDepth: number
  showTeamActivity: boolean
}

export interface ScopeRule {
  id: string
  description: string
  pathGlob?: string
}

export interface Milestone {
  id: string
  title: string
  description?: string
  status: 'active' | 'upcoming' | 'completed'
  completedAt?: number
}

export interface ProjectVariable {
  key: string
  value: string
}

export interface ProjectWorkspaceMetadata {
  rootDirectory: string
  exists: boolean
  isLikelyCodingWorkspace: boolean
  codingMarkers: string[]
  isGitRepo: boolean
  repoRoot: string | null
  branch: string | null
  dirty: boolean
  scannedAt: number
}

export type ProjectEditSource = 'chat-tool' | 'remote-edit' | 'self-heal' | 'manual-apply' | 'code-changes'
export type ProjectTouchedFileStatus = 'modified' | 'created' | 'deleted'

export type CodeChangeRequestType = 'edit' | 'refactor' | 'bugfix' | 'feature' | 'investigation' | 'custom'
export type CodeChangeRequestOrigin = 'chat' | 'android' | 'manual' | 'build-failure' | 'legacy-bug-report'
export type CodeChangeRequestPhase =
  | 'draft'
  | 'investigating'
  | 'patch-ready'
  | 'ready-to-apply'
  | 'applied'
  | 'verifying'
  | 'ready-to-commit'
  | 'committed'
  | 'needs-attention'

export interface CodeChangesWorkspaceBinding {
  rootDirectory: string
  isGitRepo: boolean
  repoRoot: string | null
  branch: string | null
  dirty: boolean
  isConnected: boolean
  lastValidatedAt: number | null
}

export interface CodeChangeRequest {
  id: string
  title: string
  description: string
  requestType: CodeChangeRequestType
  customTypeLabel: string | null
  workspaceRoot: string | null
  projectId: string | null
  origin: CodeChangeRequestOrigin
  status: ErrorReportStatus
  createdAt: number
  updatedAt: number
  legacyReport: ErrorReportEntry
}

export interface ProjectEditSession {
  id: string
  projectId: string | null
  conversationId: string | null
  agentId: string | null
  title: string
  source: ProjectEditSource
  createdAt: number
  updatedAt: number
  fileCount: number
}

export interface ProjectTouchedFile {
  sessionId: string
  relativePath: string
  status: ProjectTouchedFileStatus
  lastOperation: 'write' | 'create' | 'delete' | 'apply'
  firstTouchedAt: number
  lastTouchedAt: number
  diffAvailable: boolean
}

export interface ProjectConfig extends ProjectOrchestrationConfig {
  instructions: string
  rootDirectory: string
  codingWorkspace: boolean
  workspaceInfo: ProjectWorkspaceMetadata | null
  variables: ProjectVariable[]
  instructionMode: 'prepend' | 'append' | 'replace' | 'standalone'
  instructionsEnabled: boolean
  inScope: ScopeRule[]
  outOfScope: ScopeRule[]
  milestones: Milestone[]
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  instructions: '',
  rootDirectory: '',
  codingWorkspace: false,
  workspaceInfo: null,
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
  workflowMode: 'single-agent',
  orchestrationEnabled: false,
  maxDelegationDepth: 5,
  showTeamActivity: true,
  inScope: [],
  outOfScope: [],
  milestones: [],
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  imageResponses?: 'allow' | 'omit'
  enabled: boolean
}

export interface SendMessageOptions {
  attachments?: Attachment[]
  regenerate?: boolean
  agentId?: string
  model?: string
}

export interface AppSettings {
  theme: 'light' | 'dark'
  globalHotkey: string
  autoStart: boolean
  autoUpdate: boolean
}

export interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
}

export interface ToolApprovalRequest {
  requestId: string
  tool: string
  args: Record<string, unknown>
  description: string
}

export type ErrorLogSource = 'main' | 'renderer' | 'unhandled'
export type ErrorLogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface ErrorLogEntry {
  id: string
  source: ErrorLogSource
  level: ErrorLogLevel
  message: string
  stack: string | null
  timestamp: number
}

export type ErrorReportStatus = 'open' | 'investigating' | 'investigated' | 'fixed' | 'rejected'

export interface ErrorReportCaptureInput {
  title: string
  description?: string
  includeScreenshot?: boolean
  includeLog?: boolean
  screenshotDataUrl?: string | null
  requestType?: CodeChangeRequestType
  customTypeLabel?: string | null
  origin?: CodeChangeRequestOrigin
  workspaceRoot?: string | null
  projectId?: string | null
  conversationId?: string | null
}

export interface ErrorReportCaptureResult {
  reportId: string
  screenshotPath: string | null
  createdAt: number
}

export type RemoteEditBackend = 'byok' | 'claude-cli' | 'codex-cli'
export type InvestigationStatus = 'idle' | 'running' | 'done' | 'error'

export interface RemoteEditInvestigationSettings {
  backend: RemoteEditBackend
  model: string
  retryLimit: number
  autoApproveTools: boolean
}

export interface RemoteEditInvestigationActivity {
  reportId: string
  type: 'thinking' | 'tool' | 'status'
  label: string
  toolName?: string
}

export interface RemoteEditInvestigationChunk {
  reportId: string
  chunk: string
}

export interface RemoteEditActiveInvestigation {
  running: boolean
  activity: RemoteEditInvestigationActivity[]
  output: string
}

export interface RemoteEditInvestigationResult {
  reportId: string
  status: 'done' | 'error'
  markdown: string
  confidence: string
  rootCause: string
  affectedFiles: string[]
  error?: string
  completedAt: number
}

export type RemoteEditFixStatus = 'none' | 'staging' | 'staged' | 'applying' | 'applied' | 'failed'

export interface RemoteEditStagedFileEntry {
  relativePath: string
  stagingPath: string
  backupPath: string | null
  diffLineCount: number
  reviewed: boolean
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed'
  lineNumber: { before: number | null; after: number | null }
  content: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface RemoteEditStagedFileDiff {
  relativePath: string
  hunks: DiffHunk[]
}

export interface RemoteEditFixEvent {
  reportId: string
  type: 'file-patched' | 'file-error' | 'status'
  relativePath?: string
  error?: string
  label: string
}

export interface RemoteEditFixDone {
  reportId: string
  status: 'done' | 'error'
  stagedFiles: RemoteEditStagedFileEntry[]
  error?: string
  completedAt: number
}

export type RemoteEditVerificationCommand = 'typecheck' | 'lint' | 'test' | 'build'
export type RemoteEditVerificationStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface RemoteEditVerificationStep {
  command: RemoteEditVerificationCommand
  status: RemoteEditVerificationStepStatus
  exitCode: number | null
  log: string
  startedAt: number | null
  completedAt: number | null
}

export interface RemoteEditVerificationRun {
  id: string
  reportId: string
  status: 'running' | 'success' | 'failed'
  steps: RemoteEditVerificationStep[]
  startedAt: number
  completedAt: number | null
  retryCount: number
  error?: string
}

export interface RemoteEditVerificationEvent {
  reportId: string
  runId: string
  command?: RemoteEditVerificationCommand
  status: RemoteEditVerificationStepStatus | 'running' | 'success' | 'failed'
  line?: string
  exitCode?: number | null
  label: string
}

export interface RemoteEditVerificationDone {
  reportId: string
  runId: string
  status: 'success' | 'failed'
  steps: RemoteEditVerificationStep[]
  retryCount: number
  error?: string
  completedAt: number
}

export type RemoteEditGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'

export interface RemoteEditGitFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  status: RemoteEditGitFileStatus
}

export interface RemoteEditGitStatus {
  reportId?: string
  isRepo: boolean
  branch: string | null
  commitSha: string | null
  dirty: boolean
  ahead: number
  behind: number
  files: RemoteEditGitFile[]
  error?: string
}

export interface RemoteEditGitPrepareResult {
  reportId: string
  status: RemoteEditGitStatus
  suggestedMessage: string
  files: string[]
  canCommit: boolean
  reason?: string
  authRequired?: boolean
  authHelp?: string
}

export interface RemoteEditGitCommitResult {
  reportId: string
  committed: boolean
  commitSha: string | null
  status: RemoteEditGitStatus
  error?: string
  authRequired?: boolean
  authHelp?: string
}

export interface RemoteEditGitPushResult {
  reportId: string
  pushed: boolean
  status: RemoteEditGitStatus
  error?: string
  authRequired?: boolean
  authHelp?: string
}

export interface RemoteEditGitEvent {
  reportId: string
  type: 'status' | 'prepare' | 'commit' | 'push'
  label: string
  status?: RemoteEditGitStatus
  commitSha?: string | null
  error?: string
  authRequired?: boolean
  authHelp?: string
}

export interface RemoteEditRecoveryBackupFile {
  relativePath: string
  backupPath: string | null
}

export interface RemoteEditRecoveryPreReloadState {
  branch: string | null
  commitSha: string | null
  dirty: boolean
  version: string | null
}

export interface RemoteEditRecoveryRun {
  id: string
  reportId: string
  status: 'prepared' | 'reloading' | 'confirmed' | 'rollback-required' | 'rolled-back' | 'failed'
  targetCommitSha: string | null
  targetVersion: string | null
  backupManifest: RemoteEditRecoveryBackupFile[]
  preReloadState: RemoteEditRecoveryPreReloadState
  createdAt: number
  updatedAt: number
  confirmedAt: number | null
  rollbackAt: number | null
  error?: string
}

export interface RemoteEditReloadPrepareResult {
  reportId: string
  recovery: RemoteEditRecoveryRun | null
  canReload: boolean
  reason?: string
}

export interface RemoteEditRecoveryEvent {
  reportId: string
  recoveryId?: string
  type: 'prepare' | 'reload' | 'confirm' | 'rollback'
  label: string
  status?: RemoteEditRecoveryRun['status']
  error?: string
}

export interface RemoteEditReloadStartResult {
  reportId: string
  recoveryId: string
  started: boolean
  buildId: string | null
  recovery: RemoteEditRecoveryRun | null
  error?: string
}

export interface RemoteEditRelaunchResult {
  reportId: string
  recoveryId: string
  scheduled: boolean
  error?: string
}

export interface RemoteEditStartupConfirmationResult {
  confirmed: boolean
  recovery: RemoteEditRecoveryRun | null
  error?: string
}

export interface RemoteEditHistoryEntry {
  id: string
  reportId: string
  reportTitle: string
  investigationModel: string | null
  investigationBackend: string | null
  investigationRounds: number
  fixAppliedAt: number | null
  verificationPassed: boolean
  verificationFailedStep: string | null
  committed: boolean
  commitSha: string | null
  pushed: boolean
  reloaded: boolean
  rolledBack: boolean
  status: string
  createdAt: number
  updatedAt: number
}

export interface ErrorReportEntry {
  id: string
  title: string
  description: string
  screenshot_path: string | null
  log_snapshot: string | null
  status: ErrorReportStatus
  app_version: string | null
  platform: string | null
  os_version: string | null
  investigation_markdown: string | null
  investigation_confidence: string | null
  investigation_root_cause: string | null
  investigation_affected_files: string
  investigation_revision_notes: string | null
  investigation_started_at: number | null
  investigation_completed_at: number | null
  fix_status: RemoteEditFixStatus
  fix_staged_files: string
  fix_started_at: number | null
  fix_completed_at: number | null
  fix_error: string | null
  created_at: number
  updated_at: number
  request_type?: CodeChangeRequestType | null
  request_origin?: CodeChangeRequestOrigin | null
  workspace_root?: string | null
  project_id?: string | null
  custom_type_label?: string | null
  conversation_id?: string | null
}

// ---------------------------------------------------------------------------
// Project Generator
// ---------------------------------------------------------------------------

export interface ProjectGeneratorAgentSpec {
  role: string
  description: string
  existingAgentId?: string
  newAgent?: {
    name: string
    icon: string
    systemPrompt: string
    temperature: number
    responseFormat: 'default' | 'concise' | 'detailed' | 'code-only'
    tools?: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  }
  isLeader: boolean
}

export interface ProjectGeneratorSpec {
  name: string
  color: string
  instructions: string
  rootDirectory?: string
  instructionMode?: 'prepend' | 'append' | 'replace' | 'standalone'
  variables: { key: string; value: string }[]
  inScope: { description: string; pathGlob?: string }[]
  outOfScope: { description: string; pathGlob?: string }[]
  milestones: { title: string; description?: string; status: 'active' | 'upcoming' }[]
  orchestrationEnabled: boolean
  defaultModel?: string
  agents: ProjectGeneratorAgentSpec[]
}

export interface ProjectGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentGeneratorSpec {
  name: string
  icon: string
  systemPrompt: string
  temperature: number
  responseFormat: 'default' | 'concise' | 'detailed' | 'code-only'
  agenticMode: boolean
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  rootDirectory?: string
  contextDirectories: string[]
  memory?: string
  customCommands?: { name: string; description: string; prompt: string }[]
}

export interface WsUrlProfile {
  id: string
  label: string
  url: string
  active: boolean
}

export interface AgentGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
  images?: { dataUrl: string; name: string }[]
}

export interface SkillGeneratorSpec {
  name: string
  icon: string
  description: string
  instructions: string
  tools: { fileEdit: boolean; terminal: boolean; webFetch: boolean }
  toolInstructions?: Partial<Record<'fileEdit' | 'terminal' | 'webFetch', string>>
  approval?: Partial<Record<'fileEdit' | 'terminal' | 'webFetch', 'auto' | 'always-ask' | 'disabled'>>
  mcpServers?: string[]
  tags?: string[]
  knowledge?: { title: string; content: string }[]
  suggestedAgents?: string[]
}

export interface SkillGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ScheduleGeneratorSpec {
  name: string
  prompt: string
  scheduleType: ScheduleType
  localTime: string
  weekday?: number
  monthDay?: number
  timezone: string
  agentId?: string
  projectId?: string
  notificationPref: 'always' | 'failures_only' | 'off'
}

export interface ScheduleGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ManualWorkflowStep {
  id: string
  title: string
  summary: string
  agentId?: string
  agentName?: string
  prompt: string
  expectedOutput: string
  dependsOnStepIds?: string[]
}

export interface ManualWorkflowSpec {
  title: string
  goalSummary: string
  assumptions: string[]
  steps: ManualWorkflowStep[]
}

export interface ManualWorkflowGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export type ManualWorkflowStepStatus = 'not_started' | 'started' | 'done'
export type ManualWorkflowRunStatus = 'active' | 'completed'

/** A persisted step. `id` stays the generator's own step key (e.g. "step-1") so
 *  existing dependsOnStepIds matching logic needs no changes; `dbId` is the
 *  actual manual_workflow_run_steps primary key, used only for status mutations. */
export interface ManualWorkflowRunStep extends ManualWorkflowStep {
  dbId: string
  runId: string
  stepIndex: number
  status: ManualWorkflowStepStatus
  startedAt: number | null
  completedAt: number | null
}

export interface ManualWorkflowRunSummary {
  id: string
  projectId: string
  title: string
  goalSummary: string
  model: string | null
  status: ManualWorkflowRunStatus
  stepCounts: { total: number; notStarted: number; started: number; done: number }
  createdAt: number
  updatedAt: number
}

export interface ManualWorkflowRunDetail extends ManualWorkflowRunSummary {
  assumptions: string[]
  steps: ManualWorkflowRunStep[]
}

export type ArtifactKind =
  | 'document' | 'code' | 'ui' | 'data'
  | 'prompt' | 'agent-config' | 'plan' | 'bundle' | 'other'
  | 'debrief' | 'quiz'

export type ArtifactStatus = 'draft' | 'generating' | 'ready' | 'exported' | 'archived' | 'failed'

export type ArtifactExportFormat = 'markdown' | 'html' | 'json' | 'zip' | 'raw-files'

export interface ArtifactSpec {
  title: string
  kind: ArtifactKind
  scope: { type: 'global' | 'project'; projectId?: string }
  intendedUse: string
  audience?: string
  outputFiles: {
    path: string
    mediaType: string
    role: 'primary' | 'supporting' | 'preview' | 'source'
    description?: string
  }[]
  sourceContext: {
    useProjectInstructions: boolean
    useProjectWiki: boolean
    useConversationContext: boolean
    referencedFiles: string[]
  }
  acceptanceCriteria: string[]
  exportFormats: ArtifactExportFormat[]
}

export interface ArtifactFile {
  id: string
  versionId: string
  relativePath: string
  absolutePath: string
  mediaType: string
  role: string
  sizeBytes: number | null
  checksum: string | null
}

export interface ArtifactVersion {
  id: string
  artifactId: string
  versionNumber: number
  title: string
  notes: string | null
  specJson: string | null
  manifestJson: string
  sourceConversationId: string | null
  sourceMessageId: string | null
  createdByAgentIds: string | null
  createdAt: number
  files?: ArtifactFile[]
}

export interface ArtifactRow {
  id: string
  projectId: string | null
  conversationId: string | null
  title: string
  kind: ArtifactKind
  description: string | null
  storageRoot: string
  currentVersionId: string | null
  status: ArtifactStatus
  errorMessage: string | null
  createdAt: number
  updatedAt: number
  currentVersion?: ArtifactVersion
}

export interface ArtifactGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ArtifactGeneratorRun {
  id: string
  artifactId: string | null
  title: string
  status: string
  specJson: string | null
  createdAt: number
  updatedAt: number
}

export interface ArtifactPromotionRequest {
  conversationId: string
  messageId: string
  title: string
  kind: Extract<ArtifactKind, 'document' | 'prompt' | 'plan' | 'code' | 'other'>
  scope: { type: 'global' | 'project'; projectId?: string }
  filePath: string
}

export interface ArtifactPromotionResult {
  artifactId: string
  versionId: string
  title: string
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type AuthMode = 'byok' | 'none'

export interface AuthStatus {
  authenticated: boolean
  mode: AuthMode
  user: null
  cliInstalled?: boolean
  clis?: {
    claude: boolean
    codex: boolean
  }
}

// ---------------------------------------------------------------------------
// Database row shapes (snake_case — returned directly from SQLite handlers)
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string
  agent_id: string | null
  project_id: string | null
  title: string
  model: string | null
  pinned: number
  created_at: number
  updated_at: number
  completed_at: number | null
  thinking_effort_override: 'low' | 'medium' | 'high' | 'max' | 'disabled' | null
  full_auto_approve_override: number | null
}

export interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  is_edited: number
  previous_content: string | null
  timestamp: number
  tool_calls: string | null
  attachments: string | null
  context_snapshot: string | null
  thinking_blocks: string | null
}

export interface ConversationExportAttachment {
  id?: string
  name?: string
  path?: string
  size?: number
  type?: string
  [key: string]: unknown
}

export interface ConversationExportContextRef {
  key?: string
  token?: string
  value?: string
  label?: string
  [key: string]: unknown
}

export interface ConversationExportToolCall {
  id?: string
  name?: string
  server?: string
  args?: unknown
  result?: unknown
  success?: boolean
  summary: string
  [key: string]: unknown
}

export interface ConversationExportProject {
  id: string
  name: string
  color: string
  default_model: string | null
  created_at: number
  updated_at: number
}

export interface ConversationExportAgent {
  id: string
  name: string | null
  icon: string | null
  backend: string | null
  cli_model: string | null
  is_default: boolean
  created_at: number
  updated_at: number
}

export interface ConversationExportMessage {
  id: string
  role: string
  content: string
  model: string | null
  timestamp: number
  is_edited: boolean
  previous_content: string | null
  attachments: ConversationExportAttachment[]
  context_refs: ConversationExportContextRef[]
  context_snapshot: unknown
  tool_call: ConversationExportToolCall | null
}

export interface ConversationExportV1 {
  schema: 'nexy.conversation.v1'
  exported_at: number
  conversation: ConversationRow
  project: ConversationExportProject | null
  agent: ConversationExportAgent | null
  messages: ConversationExportMessage[]
}

export type ConversationExportPackFormat = 'json' | 'markdown' | 'context-bundle'

export interface ConversationExportPackOptions {
  format: ConversationExportPackFormat
}

export interface ConversationExportPack {
  format: ConversationExportPackFormat
  conversation_id: string
  file_name: string
  mime_type: string
  content: string
}

export interface ConversationImportOptions {
  targetConversationId?: string | null
}

export interface ConversationImportResult {
  conversation: ConversationRow
  message_count: number
  imported_into_existing: boolean
}

export interface ConversationForkOptions {
  model?: string | null
  agentId?: string | null
  cutoffTimestamp?: number | null
}

export interface ConversationForkResult {
  conversation: ConversationRow
  message_count: number
  rewritten_message_count: number
  compressed_message_count: number
}

export interface StructuredConversationSummary {
  goals: string[]
  decisions: string[]
  constraints: string[]
  filesTouched: string[]
  commandsRun: string[]
  openQuestions: string[]
  nextActions: string[]
  recentContextNotes: string[]
}

export interface ConversationCompressionPreview {
  conversation_id: string
  has_summary: boolean
  summarized_message_count: number
  retained_message_count: number
  omitted_message_count: number
  estimated_tokens_before: number
  target_budget: number
  strategy: string | null
  updated_at: number | null
  sections: StructuredConversationSummary | null
}

export interface ConversationCompressionDraft {
  conversation_id: string
  summarized_message_count: number
  retained_message_count: number
  omitted_message_count: number
  estimated_tokens_before: number
  target_budget: number
  strategy: string
  sections: StructuredConversationSummary
}

export interface ConversationCompressionSaveInput {
  conversationId: string
  summarizedMessageCount: number
  retainedMessageCount: number
  estimatedTokensBefore: number
  targetBudget: number
  strategy: string
  sections: StructuredConversationSummary
}

export interface ContextInspectorRefSnapshot {
  token: string
  key: string
  estimatedTokens: number
}

export interface ContextInspectorAttachmentSnapshot {
  name: string
  size: number
  estimatedTokens: number
}

/** Live composer/draft breakdown for the focused desktop window, relayed to the Android companion. */
export interface ContextInspectorSnapshot {
  conversationId: string | null
  model: string
  systemPrompt: string
  systemPromptTokens: number
  contextRefs: ContextInspectorRefSnapshot[]
  attachments: ContextInspectorAttachmentSnapshot[]
  imageCount: number
  historyMessageCount: number
  currentInputTokens: number
  totalTokens: number
  maxTokens: number
}

export interface KnowledgeFile {
  id: string
  agent_id: string
  file_path: string
  inject_mode: string
  sort_order: number
  created_at: number
  updated_at: number
}

export interface WikiEntry {
  id: string
  project_id: string
  title: string
  body: string
  tags: string[]
  source_conversation_id: string | null
  source_message_id: string | null
  superseded_by: string | null
  created_at: number
  updated_at: number
}

export interface WikiCandidate {
  title: string
  body: string
  tags: string[]
  matchingEntryId: string | null
  matchingEntryTitle: string | null
  supersededEntryId: string | null
  supersededEntryTitle: string | null
}

export interface WikiExtractionResult {
  candidates: WikiCandidate[]
}

// ---------------------------------------------------------------------------
// Build orchestrator
// ---------------------------------------------------------------------------

export type BuildCommandName = 'typecheck' | 'test' | 'build' | 'package'
export type BuildStatus = 'running' | 'success' | 'failed' | 'cancelled'

export interface WorkspaceInfo {
  path: string
  branch: string | null
  commitSha: string | null
  dirty: boolean
  version: string | null
  isGitRepo: boolean
}

export interface BuildRecord {
  id: string
  workspacePath: string
  commitSha: string | null
  branch: string | null
  version: string | null
  versionCode: number | null
  platform: string
  command: BuildCommandName | AndroidBuildCommandName
  status: BuildStatus
  exitCode: number | null
  artifactPaths: string[]
  artifactChecksums: Record<string, string>
  logTail: string
  startedAt: number
  finishedAt: number | null
  mobileInitiated: boolean
}

export interface PreflightCheck {
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface PreflightResult {
  checks: PreflightCheck[]
}

export interface LocalUpdateFeed {
  feedPath: string
  feedUrl: string
  port: number
  running: boolean
}

export interface PublishedEntry {
  version: string
  publishedAt: number
  installerName: string
  installerSize: number
  platform: string
  isBackup: boolean
}

// ---------------------------------------------------------------------------
// Android build and distribution
// ---------------------------------------------------------------------------

export type AndroidBuildCommandName =
  | 'test'
  | 'assembleDebug'
  | 'assembleRelease'
  | 'bundleRelease'

export interface AndroidWorkspaceInfo {
  path: string
  branch: string | null
  commitSha: string | null
  dirty: boolean
  versionCode: number | null
  versionName: string | null
  isGitRepo: boolean
}

export interface AndroidSigningConfig {
  keystorePath: string
  keystorePassword: string
  keyAlias: string
  keyPassword: string
}

export interface AdbDevice {
  serial: string
  state: 'device' | 'offline' | 'unauthorized' | 'unknown'
  model: string | null
  product: string | null
}

export interface AndroidUpdateManifest {
  versionCode: number
  versionName: string
  commitSha: string | null
  changelog: string
  checksum: string
  artifactUrl: string
  publishedAt: number
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export type ScheduleType = 'one-time' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type ScheduledRunStatus = 'pending' | 'running' | 'approval_required' | 'success' | 'failed' | 'skipped'
export type ScheduledRunTrigger = 'scheduled' | 'manual'
export type SchedulerNotificationPref = 'always' | 'failures_only' | 'off'

export interface ScheduledTaskToolPolicy {
  preApproved: string[]
  alwaysAsk: string[]
  neverAllow: string[]
}

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  enabled: boolean
  agentId: string | null
  projectId: string | null
  model: string | null
  conversationId: string | null
  scheduleType: ScheduleType
  localTime: string
  weekday: number | null
  monthDay: number | null
  timezone: string
  toolPolicy: ScheduledTaskToolPolicy
  notificationPref: SchedulerNotificationPref
  nextRunAt: number | null
  lastRunAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ScheduledRun {
  id: string
  taskId: string
  scheduledAt: number | null
  startedAt: number | null
  finishedAt: number | null
  status: ScheduledRunStatus
  error: string | null
  conversationId: string | null
  messageId: string | null
  triggerSource: ScheduledRunTrigger
  createdAt: number
}

export interface ScheduledTaskCreateInput {
  name: string
  prompt: string
  enabled?: boolean
  agentId?: string | null
  projectId?: string | null
  model?: string | null
  scheduleType: ScheduleType
  localTime: string
  weekday?: number | null
  monthDay?: number | null
  timezone: string
  toolPolicy?: Partial<ScheduledTaskToolPolicy>
  notificationPref?: SchedulerNotificationPref
}

export interface ScheduledTaskUpdateInput {
  name?: string
  prompt?: string
  agentId?: string | null
  projectId?: string | null
  model?: string | null
  scheduleType?: ScheduleType
  localTime?: string
  weekday?: number | null
  monthDay?: number | null
  timezone?: string
  toolPolicy?: Partial<ScheduledTaskToolPolicy>
  notificationPref?: SchedulerNotificationPref
}

// ---------------------------------------------------------------------------
// Prompt library
// ---------------------------------------------------------------------------

export type PromptScope = 'global' | 'project'

export interface PromptLibraryEntry {
  id: string
  title: string
  body: string
  description: string
  category: string
  tags: string[]
  variables: string[]
  scope: PromptScope
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface PromptLibraryInput {
  title: string
  body: string
  description?: string
  category?: string
  tags?: string[]
  scope?: PromptScope
  project_id?: string | null
}

export interface PromptLibraryUpdate {
  title?: string
  body?: string
  description?: string
  category?: string
  tags?: string[]
  scope?: PromptScope
  project_id?: string | null
}

export interface PromptVersionDiff {
  titleChanged: boolean
  descriptionChanged: boolean
  categoryChanged: boolean
  tagsChanged: boolean
  scopeChanged: boolean
  addedLines: string[]
  removedLines: string[]
}

export interface PromptLibraryVersion {
  id: string
  prompt_id: string
  version: number
  title: string
  body: string
  description: string
  category: string
  tags: string[]
  variables: string[]
  scope: PromptScope
  project_id: string | null
  source: string
  created_at: number
  diff: PromptVersionDiff
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string
  name: string
  color: string
  default_model: string | null
  config: ProjectConfig
  created_at: number
  updated_at: number
}

export interface ProjectAgent {
  agentId: string
  agentName: string
  agentIcon: string
  isPrimary: boolean
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Agent operations
// ---------------------------------------------------------------------------

export interface AffectedProject {
  id: string
  name: string
  is_primary: number
}

export interface DeleteAgentPreflight {
  affectedProjects: AffectedProject[]
  affectedConvCount: number
}

export interface DeleteAgentResult {
  success: boolean
  reason?: string
  affectedProjects?: AffectedProject[]
  affectedConvCount?: number
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverId: string
  serverName: string
}

export interface McpServerWithStatus extends McpServerConfig {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  toolCount: number
}

export interface McpServerStatus {
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  error?: string
  tools: McpTool[]
}

export interface McpToolOverrideRow {
  agent_id: string
  server_id: string
  tool_name: string
  enabled: number
  approval: string
  instructions: string
}

export interface McpCallResult {
  success: boolean
  result?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Shape returned by `tool:list` (built-in tool catalogue). */
export interface BuiltinToolDefinition {
  name: string
  description: string
  args: { name: string; type: string; required: boolean }[]
}

export interface ToolExecuteResult {
  success: boolean
  result?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Files / directories
// ---------------------------------------------------------------------------

export interface DirectoryEntry {
  name: string
  relativePath: string
  type: 'file' | 'dir'
}

export interface ContextFileResult {
  path: string
  content: string
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  name: string
  label: string
  apiKeySettingKey: string
  models: string[]
  configured: boolean
}

export interface ProviderTestResult {
  valid: boolean
  error?: string
}

export interface AvailableModelEntry { id: string; label: string }
export interface AvailableModelGroup {
  sourceKey: string
  sourceLabel: string
  sourceType: 'cli' | 'provider'
  models: AvailableModelEntry[]
}

export interface CatalogModel {
  id: string
  name: string
  vendor: string
  capabilities: string[]
  contextWindow?: number
  /** Premium request multiplier returned by the /models API (e.g. 0, 0.33, 1, 3). */
  multiplier?: number
}

// ---------------------------------------------------------------------------
// IPC return-type map — every invoke channel mapped to its concrete return type
// ---------------------------------------------------------------------------

export type IpcReturnMap = {
  // Agent
  'agent:add-knowledge-file': KnowledgeFile | null
  'agent:create': AgentConfig
  'agent:delete': DeleteAgentResult
  'agent:delete-preflight': DeleteAgentPreflight
  'agent:duplicate': AgentConfig | null
  'agent:export': boolean
  'agent:get': AgentConfig | null
  'agent:get-mcp-tool-overrides': McpToolOverrideRow[]
  'agent:get-mcp-server-trust': { server_id: string; trust: string }[]
  'agent:import': AgentConfig | null
  'agent:list': AgentConfig[]
  'agent:list-knowledge-files': KnowledgeFile[]
  'agent:remove-knowledge-file': boolean
  'agent:set-mcp-tool-override': boolean
  'agent:set-mcp-server-trust': boolean
  'agent:update': AgentConfig
  'agent:update-knowledge-inject-mode': boolean
  // Skill
  'skill:attach-to-agent': boolean
  'skill:create': SkillConfig
  'skill:delete': boolean
  'skill:duplicate': SkillConfig | null
  'skill:export': boolean
  'skill:get': SkillConfig | null
  'skill:get-agent-links': { skill_id: string; sort_order: number }[]
  'skill:get-agent-usage': { skill_id: string; agent_count: number }[]
  'skill:import': SkillConfig | null
  'skill:list': SkillConfig[]
  'skill:reorder-for-agent': boolean
  'skill:update': SkillConfig
  // App
  'app:check-updates': void
  'app:download-update': void
  'app:get-setting': string | null
  'app:get-settings': Record<string, string>
  'app:get-theme': string
  'app:get-runtime-info': { isPackaged: boolean }
  'app:get-version': string
  'app:install-update': void
  'app:save-text-file': string | null
  'app:set-auto-start': boolean
  'app:set-setting': boolean
  'app:set-theme': boolean
  // Auth
  'auth:login-byok': { success: boolean }
  'auth:logout': void
  'auth:status': AuthStatus
  // Chat
  'chat:new': void
  'chat:get-active-turn': import('./chat-turn-types').ActiveChatTurnSnapshot | null
  'chat:send-message': void
  'chat:stop-generation': void
  'chat:stream-error': void
  'chat:stream-response': void
  'chat:cli-tool-start': void
  'chat:cli-tool-end': void
  'chat:cli-cost': void
  'chat:tool-call-event': void
  'chat:team-activity': void
  'chat:team-step-stream': void
  'chat:activity': void
  'chat:activity-global': void
  'chat:turn-event': void
  'android:log': void
  'chat:stream-model': void
  'chat:thinking-delta': void
  'chat:thinking-end': void
  'chat:wiki-injected': { count: number }
  'chat:remote-message': void
  // CLI
  'cli:check': CliInstallStatus
  'cli:status': CliInstallStatus
  'cli:detect-all': Record<string, CliInstallStatus>
  'cli:get-models': { id: string; label: string }[]
  // Context
  'context:git': string
  'context:git-diff': string
  'context:read-file': ContextFileResult
  'context:workspace-summary': string
  'context:request-inspector-snapshot': void
  'context:inspector-snapshot-reply': void
  // Conversation
  'conversation:create': ConversationRow
  'conversation:compression-preview': ConversationCompressionPreview
  'conversation:prepare-compression-summary': ConversationCompressionDraft
  'conversation:save-compression-summary': ConversationCompressionPreview
  'conversation:delete': boolean
  'conversation:export-json': ConversationExportV1
  'conversation:export-pack': ConversationExportPack
  'conversation:fork': ConversationForkResult
  'conversation:import-json': ConversationImportResult | null
  'conversation:get-messages': MessageRow[]
  'conversation:insert-message': MessageRow
  'conversation:list': ConversationRow[]
  'conversation:rename': boolean
  'conversation:search': ConversationRow[]
  'conversation:set-model': boolean
  'conversation:set-mode': boolean
  'conversation:set-pinned': boolean
  'conversation:update-context': boolean
  'conversation:generate-debrief': DebriefArtifactResult
  'conversation:start-debrief-generation': { artifactId: string }
  'conversation:get-debrief': DebriefArtifactResult | null
  'conversation:mark-complete': boolean
  'conversation:mark-incomplete': boolean
  'conversation:generate-quiz': QuizArtifactResult
  'conversation:start-quiz-generation': { artifactId: string }
  'conversation:get-quiz': QuizArtifactResult | null
  // Activity
  'activity:list': BackgroundActivity[]
  'activity:changed': void
  // Debug
  'debug:set-enabled': boolean
  'debug:log': void
  // Errors
  'errors:clear': boolean
  'errors:get-log-path': string | null
  'errors:get-recent': ErrorLogEntry[]
  'errors:get-renderer-console': ErrorLogEntry[]
  'errors:new': void
  // Error reports
  'error-report:capture': ErrorReportCaptureResult
  'error-report:delete': boolean | ApiError
  'error-report:get': ErrorReportEntry | null
  'error-report:list': ErrorReportEntry[]
  'error-report:find-active-for-conversation': ErrorReportEntry | null
  // Self-heal investigation
  'remote-edit:get-investigation-settings': RemoteEditInvestigationSettings
  'remote-edit:set-report-status': ErrorReportEntry | null
  'remote-edit:set-investigation-settings': RemoteEditInvestigationSettings
  'remote-edit:start-investigation': { reportId: string }
  'remote-edit:investigation-activity': void
  'remote-edit:investigation-chunk': void
  'remote-edit:investigation-done': void
  'remote-edit:get-active-investigation': RemoteEditActiveInvestigation
  'remote-edit:get-active-code-changes': Record<string, number>
  'remote-edit:active-code-changes-changed': void
  // Self-heal fix staging
  'remote-edit:start-fix': { reportId: string }
  'remote-edit:commit-to-workspace': { appliedFiles: string[]; backupPaths: string[] } | null
  'remote-edit:revert-staged-file': boolean
  'remote-edit:get-staged-diff': RemoteEditStagedFileDiff | null
  'remote-edit:fix-event': void
  'remote-edit:fix-done': void
  // Self-heal verification
  'remote-edit:start-verification': { reportId: string; runId: string }
  'remote-edit:get-verification-runs': RemoteEditVerificationRun[]
  'remote-edit:verification-event': void
  'remote-edit:verification-done': void
  // Self-heal git flow
  'remote-edit:git-status': RemoteEditGitStatus
  'remote-edit:git-prepare-commit': RemoteEditGitPrepareResult
  'remote-edit:git-commit': RemoteEditGitCommitResult
  'remote-edit:git-push': RemoteEditGitPushResult
  'remote-edit:git-event': void
  // Self-heal recovery/reload
  'remote-edit:prepare-reload': RemoteEditReloadPrepareResult
  'remote-edit:get-recovery-runs': RemoteEditRecoveryRun[]
  'remote-edit:start-reload': RemoteEditReloadStartResult
  'remote-edit:approve-relaunch': RemoteEditRelaunchResult
  'remote-edit:confirm-startup': RemoteEditStartupConfirmationResult
  'remote-edit:rollback': { rolledBack: boolean; error?: string }
  'remote-edit:recovery-event': void
  'remote-edit:get-history': RemoteEditHistoryEntry[]
  // Deeplink (push-only)
  'deeplink:open-agent': void
  'deeplink:open-chat': void
  // File
  'file:add-recent-dir': string[]
  'file:get-cwd': string
  'file:get-recent-dirs': string[]
  'file:open-dialog': Attachment[]
  'file:open-directory-dialog': string[]
  'file:set-cwd': boolean
  // FS
  'fs:list-directory': DirectoryEntry[]
  'fs:read-file': string
  'fs:write-file': boolean
  // MCP
  'mcp:add-server': McpServerConfig
  'mcp:call-tool': McpCallResult
  'mcp:get-server-status': McpServerStatus
  'mcp:list-servers': McpServerWithStatus[]
  'mcp:list-tools': McpTool[]
  'mcp:list-tools-for-agent': McpTool[]
  'mcp:remove-server': boolean
  'mcp:restart-server': boolean
  'mcp:server-status-changed': void
  'mcp:update-server': McpServerConfig | null
  // Model
  'model:list-catalog': CatalogModel[]
  'model:catalog-updated': { models: CatalogModel[]; changeSummary?: string }
  'model:list-available': AvailableModelGroup[]
  // Message
  'message:delete': void
  'message:delete-after': void
  // Project
  'project:add-agent': boolean
  'project:create': ProjectRow
  'project:delete': boolean
  'project:duplicate': ProjectRow | null
  'project:export': boolean
  'project:get-config': ProjectConfig
  'project:inspect-workspace': ProjectWorkspaceMetadata | null
  'project:list': ProjectRow[]
  'project:list-agents': ProjectAgent[]
  'project:remove-agent': boolean
  'project:rename': boolean
  'project:reorder-agents': boolean
  'project:set-conversation': boolean
  'project:set-default-model': boolean
  'project:set-primary-agent': boolean
  'project:update-config': boolean
  'project-audit:list-sessions': ProjectEditSession[]
  'project-audit:list-files': ProjectTouchedFile[]
  'project-audit:get-diff': RemoteEditStagedFileDiff | null
  'manual-workflow-generator:chat': { started: boolean }
  'manual-workflow-generator:token': void
  'manual-workflow-generator:spec-ready': void
  'manual-workflow-generator:done': { hasSpec: boolean }
  'manual-workflow-generator:error': { message: string }
  'manual-workflow-generator:get-model': string
  'manual-workflow-generator:set-model': void
  'manual-workflow-runs:save-spec': ManualWorkflowRunDetail
  'manual-workflow-runs:list': ManualWorkflowRunSummary[]
  'manual-workflow-runs:get': ManualWorkflowRunDetail | null
  'manual-workflow-runs:update-step-status': ManualWorkflowRunDetail | null
  'manual-workflow-runs:discard': boolean
  'manual-workflow-runs:changed': void
  // Scheduler
  'scheduler:list': ScheduledTask[]
  'scheduler:get': ScheduledTask | null
  'scheduler:create': { task: ScheduledTask; warnings: string[] }
  'scheduler:update': { task: ScheduledTask; warnings: string[] }
  'scheduler:delete': boolean
  'scheduler:set-enabled': ScheduledTask
  'scheduler:run-now': ScheduledRun
  'scheduler:list-runs': ScheduledRun[]
  'scheduler:task-updated': void
  'scheduler:task-deleted': void
  'scheduler:run-updated': void
  // Prompt library
  'prompt:create': PromptLibraryEntry
  'prompt:delete': boolean
  'prompt:list-versions': PromptLibraryVersion[]
  'prompt:list': PromptLibraryEntry[]
  'prompt:rollback': PromptLibraryEntry
  'prompt:update': PromptLibraryEntry
  // Build orchestrator
  'build:get-workspace-info': WorkspaceInfo
  'build:set-workspace-path': WorkspaceInfo
  'build:start-command': { buildId: string }
  'build:cancel-command': boolean
  'build:get-records': BuildRecord[]
  'build:run-preflight': PreflightResult
  'build:launch-dev': { launched: boolean; error?: string }
  'build:log-chunk': void
  'build:command-done': void
  'build:get-feed-info': LocalUpdateFeed | null
  'build:set-feed-path': LocalUpdateFeed
  'build:publish-update': { published: boolean; version?: string; error?: string }
  'build:list-published': PublishedEntry[]
  'build:rollback-update': { launched: boolean; error?: string }
  // Android build and distribution
  'android:get-workspace-info': AndroidWorkspaceInfo
  'android:set-workspace-path': AndroidWorkspaceInfo
  'android:start-command': { buildId: string }
  'android:cancel-command': boolean
  'android:get-records': BuildRecord[]
  'android:get-signing-config': AndroidSigningConfig | null
  'android:set-signing-config': boolean
  'android:validate-signing-config': { valid: boolean; checks: PreflightCheck[] }
  'android:list-adb-devices': AdbDevice[]
  'android:install-apk': { success: boolean; error?: string }
  'android:publish-update': { published: boolean; manifest?: AndroidUpdateManifest; error?: string }
  'android:get-update-manifest': AndroidUpdateManifest | null
  'android:get-publish-history': AndroidUpdateManifest[]
  'android:restore-version': { restored: boolean; manifest?: AndroidUpdateManifest; error?: string }
  'android:save-fcm-service-account': { saved: boolean; error?: string }
  'android:get-fcm-config-status': { configured: boolean; projectId?: string }
  'android:log-chunk': void
  'android:command-done': void
  // WebSocket mobile companion
  'ws:start': { port: number; token: string; qrDataUrl: string | null; pairingUrl?: string | null; secure?: boolean }
  'ws:stop': boolean
  'ws:status': { enabled: boolean; port: number | null; token: string | null; localIp: string; connectedClients: number; qrDataUrl: string | null; pairingUrl?: string | null; externalUrl?: string | null; secure?: boolean }
  'ws:regenerate-token': { token: string; qrDataUrl: string | null; pairingUrl?: string | null; secure?: boolean }
  'ws:wakelock-enabled': boolean
  'ws:set-wakelock-enabled': boolean
  'ws:auto-start-enabled': boolean
  'ws:set-auto-start-enabled': boolean
  'ws:client-count': number
  // Wiki
  'wiki:create-entry': WikiEntry
  'wiki:delete-entry': boolean
  'wiki:extract-learnings': WikiExtractionResult
  'wiki:list-entries': WikiEntry[]
  'wiki:update-entry': WikiEntry
  // Provider
  'provider:get-azure-endpoint': string
  'provider:has-key': boolean
  'provider:list': ProviderInfo[]
  'provider:remove-key': boolean
  'provider:set-azure-endpoint': boolean
  'provider:set-key': boolean
  'provider:test-key': ProviderTestResult
  'provider:key-handoff-confirm': boolean
  'provider:key-handoff-request': void
  'provider:key-handoff-sent': void
  // Screen / Clipboard
  'clipboard:auto-focus': void
  'clipboard:read-content': { type: 'image'; dataUrl: string } | { type: 'text'; text: string } | null
  'clipboard:read-image': { dataUrl: string } | null
  'overlay:get-screenshot': string
  'screen:capture': { dataUrl: string; windowLabel?: string } | { error: string }
  'screen:capture-window': { dataUrl: string } | { error: string }
  'screen:check-permission': 'granted' | 'denied' | 'prompt'
  'screen:ocr-image': { text: string } | { error: string }
  'voice:get-status': { executablePath: string; modelPath: string; ready: boolean }
  'voice:install-local': { installed: boolean; executablePath: string; modelPath: string } | { error: string }
  'voice:transcribe': { text: string } | { error: string }
  // Tool
  'tool:approval-response': boolean
  'tool:auto-approved': void
  'tool:execute': ToolExecuteResult
  'tool:get-preferences': Record<string, string>
  'tool:list': BuiltinToolDefinition[]
  'tool:request-approval': void
  'tool:approval-resolved': void
  'tool:set-preference': boolean
  // Project generator
  'project-generator:chat': { started: boolean }
  'project-generator:token': void
  'project-generator:spec-ready': void
  'project-generator:done': void
  'project-generator:error': { message: string }
  'project-generator:get-model': string
  'project-generator:set-model': void
  // Agent generator
  'agent-generator:chat': { started: boolean }
  'agent-generator:token': void
  'agent-generator:spec-ready': void
  'agent-generator:done': void
  'agent-generator:error': { message: string }
  'agent-generator:get-model': string
  'agent-generator:set-model': void
  // Skill generator
  'skill-generator:chat': { started: boolean }
  'skill-generator:token': void
  'skill-generator:spec-ready': void
  'skill-generator:done': void
  'skill-generator:error': { message: string }
  'skill-generator:get-model': string
  'skill-generator:set-model': void
  // Scheduler generator
  'scheduler-generator:chat': { started: boolean }
  'scheduler-generator:token': void
  'scheduler-generator:spec-ready': void
  'scheduler-generator:done': void
  'scheduler-generator:error': { message: string }
  'scheduler-generator:get-model': string
  'scheduler-generator:set-model': void
  // Artifact
  'artifact:list': ArtifactRow[]
  'artifact:get': ArtifactRow | null
  'artifact:list-versions': ArtifactVersion[]
  'artifact:get-version': ArtifactVersion | null
  'artifact:delete': { deleted: boolean }
  'artifact:move-to-project': { ok: boolean }
  'artifact:promote-message': ArtifactPromotionResult
  'artifact:export': { exportPath: string }
  'artifact:open-folder': { ok: boolean }
  'artifact:get-file-content': { content: string }
  'artifact-generator:chat': { started: boolean }
  'artifact-generator:generate': { started: boolean }
  'artifact-generator:get-runs': ArtifactGeneratorRun[]
  'artifact-generator:get-storage-root': { path: string }
  'artifact-generator:set-storage-root': { ok: boolean }
  'artifact-generator:token': void
  'artifact-generator:spec-ready': void
  'artifact-generator:file-event': void
  'artifact-generator:done': { hasSpec: boolean }
  // Updater (push-only)
  'updater:download-progress': void
  'updater:error': void
  'updater:no-update': void
  'updater:update-available': void
  'updater:update-downloaded': void
  // Window
  'window:close': void
  'window:edit-action': void
  'window:is-maximized': boolean
  'window:maximize': void
  'window:maximize-change': void
  'window:minimize': void
  'window:zoom': void
}

/** Resolves the concrete return type for a given IPC channel. */
export type ApiError = { error: string }
export function isApiError(result: unknown): result is ApiError {
  return typeof result === 'object' && result !== null && 'error' in result && typeof (result as Record<string, unknown>).error === 'string'
}
export type IpcReturn<C extends IpcChannels> = C extends keyof IpcReturnMap ? IpcReturnMap[C] : never

export type IpcChannels =
  | 'agent:add-knowledge-file'
  | 'agent:create'
  | 'agent:delete'
  | 'agent:delete-preflight'
  | 'agent:duplicate'
  | 'agent:export'
  | 'agent:get'
  | 'agent:get-mcp-tool-overrides'
  | 'agent:get-mcp-server-trust'
  | 'agent:import'
  | 'agent:list'
  | 'agent:list-knowledge-files'
  | 'agent:remove-knowledge-file'
  | 'agent:set-mcp-tool-override'
  | 'agent:set-mcp-server-trust'
  | 'agent:update'
  | 'agent:update-knowledge-inject-mode'
  | 'skill:attach-to-agent'
  | 'skill:create'
  | 'skill:delete'
  | 'skill:duplicate'
  | 'skill:export'
  | 'skill:get'
  | 'skill:get-agent-links'
  | 'skill:get-agent-usage'
  | 'skill:import'
  | 'skill:list'
  | 'skill:reorder-for-agent'
  | 'skill:update'
  | 'app:check-updates'
  | 'app:download-update'
  | 'app:get-setting'
  | 'app:get-settings'
  | 'app:get-theme'
  | 'app:get-runtime-info'
  | 'app:get-version'
  | 'app:install-update'
  | 'app:save-text-file'
  | 'app:set-auto-start'
  | 'app:set-setting'
  | 'app:set-theme'
  | 'auth:login-byok'
  | 'auth:logout'
  | 'auth:status'
  | 'chat:new'
  | 'chat:send-message'
  | 'chat:stop-generation'
  | 'chat:stream-error'
  | 'chat:stream-response'
  | 'chat:cli-tool-start'
  | 'chat:cli-tool-end'
  | 'chat:cli-cost'
  | 'chat:tool-call-event'
  | 'chat:team-activity'
  | 'chat:team-step-stream'
  | 'chat:activity'
  | 'chat:activity-global'
  | 'chat:turn-event'
  | 'android:log'
  | 'chat:stream-model'
  | 'chat:thinking-delta'
  | 'chat:thinking-end'
  | 'chat:wiki-injected'
  | 'chat:remote-message'
  | 'chat:get-active-turn'
  | 'clipboard:auto-focus'
  | 'clipboard:read-content'
  | 'clipboard:read-image'
  | 'cli:check'
  | 'cli:status'
  | 'cli:detect-all'
  | 'cli:get-models'
  | 'context:git'
  | 'context:git-diff'
  | 'context:read-file'
  | 'context:workspace-summary'
  | 'context:request-inspector-snapshot'
  | 'context:inspector-snapshot-reply'
  | 'conversation:create'
  | 'conversation:compression-preview'
  | 'conversation:prepare-compression-summary'
  | 'conversation:save-compression-summary'
  | 'conversation:delete'
  | 'conversation:export-json'
  | 'conversation:export-pack'
  | 'conversation:fork'
  | 'conversation:import-json'
  | 'conversation:get-messages'
  | 'conversation:insert-message'
  | 'conversation:list'
  | 'conversation:rename'
  | 'conversation:search'
  | 'conversation:set-model'
  | 'conversation:set-mode'
  | 'conversation:set-pinned'
  | 'conversation:update-context'
  | 'conversation:generate-debrief'
  | 'conversation:start-debrief-generation'
  | 'conversation:get-debrief'
  | 'conversation:mark-complete'
  | 'conversation:mark-incomplete'
  | 'conversation:completed'
  | 'conversation:incompleted'
  | 'conversation:generate-quiz'
  | 'conversation:start-quiz-generation'
  | 'conversation:get-quiz'
  | 'activity:list'
  | 'activity:changed'
  | 'artifact:updated'
  | 'debug:set-enabled'
  | 'debug:log'
  | 'errors:clear'
  | 'errors:get-log-path'
  | 'errors:get-recent'
  | 'errors:get-renderer-console'
  | 'errors:new'
  | 'error-report:capture'
  | 'error-report:delete'
  | 'error-report:get'
  | 'error-report:list'
  | 'error-report:find-active-for-conversation'
  | 'remote-edit:get-investigation-settings'
  | 'remote-edit:set-report-status'
  | 'remote-edit:set-investigation-settings'
  | 'remote-edit:start-investigation'
  | 'remote-edit:investigation-activity'
  | 'remote-edit:investigation-chunk'
  | 'remote-edit:investigation-done'
  | 'remote-edit:get-active-investigation'
  | 'remote-edit:get-active-code-changes'
  | 'remote-edit:active-code-changes-changed'
  | 'remote-edit:start-fix'
  | 'remote-edit:commit-to-workspace'
  | 'remote-edit:revert-staged-file'
  | 'remote-edit:get-staged-diff'
  | 'remote-edit:fix-event'
  | 'remote-edit:fix-done'
  | 'remote-edit:start-verification'
  | 'remote-edit:get-verification-runs'
  | 'remote-edit:verification-event'
  | 'remote-edit:verification-done'
  | 'remote-edit:git-status'
  | 'remote-edit:git-prepare-commit'
  | 'remote-edit:git-commit'
  | 'remote-edit:git-push'
  | 'remote-edit:git-event'
  | 'remote-edit:prepare-reload'
  | 'remote-edit:get-recovery-runs'
  | 'remote-edit:start-reload'
  | 'remote-edit:approve-relaunch'
  | 'remote-edit:confirm-startup'
  | 'remote-edit:rollback'
  | 'remote-edit:recovery-event'
  | 'remote-edit:get-history'
  | 'deeplink:open-agent'
  | 'deeplink:open-chat'
  | 'file:add-recent-dir'
  | 'file:get-cwd'
  | 'file:get-recent-dirs'
  | 'file:open-dialog'
  | 'file:open-directory-dialog'
  | 'file:set-cwd'
  | 'fs:list-directory'
  | 'fs:read-file'
  | 'fs:write-file'
  | 'mcp:add-server'
  | 'mcp:call-tool'
  | 'mcp:get-server-status'
  | 'mcp:list-servers'
  | 'mcp:list-tools'
  | 'mcp:list-tools-for-agent'
  | 'mcp:remove-server'
  | 'mcp:restart-server'
  | 'mcp:server-status-changed'
  | 'mcp:update-server'
  | 'model:list-catalog'
  | 'model:catalog-updated'
  | 'model:list-available'
  | 'message:delete'
  | 'message:delete-after'
  | 'project:add-agent'
  | 'project:create'
  | 'project:delete'
  | 'project:duplicate'
  | 'project:export'
  | 'project:get-config'
  | 'project:inspect-workspace'
  | 'project:list'
  | 'project:list-agents'
  | 'project:remove-agent'
  | 'project:rename'
  | 'project:reorder-agents'
  | 'project:set-conversation'
  | 'project:set-default-model'
  | 'project:set-primary-agent'
  | 'project:update-config'
  | 'project-audit:list-sessions'
  | 'project-audit:list-files'
  | 'project-audit:get-diff'
  | 'manual-workflow-generator:chat'
  | 'manual-workflow-generator:token'
  | 'manual-workflow-generator:spec-ready'
  | 'manual-workflow-generator:done'
  | 'manual-workflow-generator:error'
  | 'manual-workflow-generator:get-model'
  | 'manual-workflow-generator:set-model'
  | 'manual-workflow-runs:save-spec'
  | 'manual-workflow-runs:list'
  | 'manual-workflow-runs:get'
  | 'manual-workflow-runs:update-step-status'
  | 'manual-workflow-runs:discard'
  | 'manual-workflow-runs:changed'
  | 'scheduler:list'
  | 'scheduler:get'
  | 'scheduler:create'
  | 'scheduler:update'
  | 'scheduler:delete'
  | 'scheduler:set-enabled'
  | 'scheduler:run-now'
  | 'scheduler:list-runs'
  | 'scheduler:task-updated'
  | 'scheduler:task-deleted'
  | 'scheduler:run-updated'
  | 'prompt:create'
  | 'prompt:delete'
  | 'prompt:list-versions'
  | 'prompt:list'
  | 'prompt:rollback'
  | 'prompt:update'
  | 'provider:get-azure-endpoint'
  | 'provider:has-key'
  | 'provider:list'
  | 'provider:remove-key'
  | 'provider:set-azure-endpoint'
  | 'provider:set-key'
  | 'provider:test-key'
  | 'provider:key-handoff-confirm'
  | 'provider:key-handoff-request'
  | 'provider:key-handoff-sent'
  | 'overlay:get-screenshot'
  | 'screen:capture'
  | 'screen:capture-window'
  | 'screen:check-permission'
  | 'screen:ocr-image'
  | 'voice:get-status'
  | 'voice:install-local'
  | 'voice:transcribe'
  | 'tool:approval-response'
  | 'tool:auto-approved'
  | 'tool:execute'
  | 'tool:get-preferences'
  | 'tool:list'
  | 'tool:request-approval'
  | 'tool:approval-resolved'
  | 'tool:set-preference'
  | 'updater:download-progress'
  | 'updater:error'
  | 'updater:no-update'
  | 'updater:update-available'
  | 'updater:update-downloaded'
  | 'window:close'
  | 'window:edit-action'
  | 'window:is-maximized'
  | 'window:maximize'
  | 'window:maximize-change'
  | 'window:minimize'
  | 'window:zoom'
  | 'wiki:create-entry'
  | 'wiki:delete-entry'
  | 'wiki:extract-learnings'
  | 'wiki:list-entries'
  | 'wiki:update-entry'
  | 'build:get-workspace-info'
  | 'build:set-workspace-path'
  | 'build:start-command'
  | 'build:cancel-command'
  | 'build:get-records'
  | 'build:run-preflight'
  | 'build:launch-dev'
  | 'build:log-chunk'
  | 'build:command-done'
  | 'build:get-feed-info'
  | 'build:set-feed-path'
  | 'build:publish-update'
  | 'build:list-published'
  | 'build:rollback-update'
  | 'android:get-workspace-info'
  | 'android:set-workspace-path'
  | 'android:start-command'
  | 'android:cancel-command'
  | 'android:get-records'
  | 'android:get-signing-config'
  | 'android:set-signing-config'
  | 'android:validate-signing-config'
  | 'android:list-adb-devices'
  | 'android:install-apk'
  | 'android:publish-update'
  | 'android:get-update-manifest'
  | 'android:get-publish-history'
  | 'android:restore-version'
  | 'android:save-fcm-service-account'
  | 'android:get-fcm-config-status'
  | 'android:log-chunk'
  | 'android:command-done'
  | 'ws:start'
  | 'ws:stop'
  | 'ws:status'
  | 'ws:regenerate-token'
  | 'ws:wakelock-enabled'
  | 'ws:set-wakelock-enabled'
  | 'ws:auto-start-enabled'
  | 'ws:set-auto-start-enabled'
  | 'ws:client-count'
  | 'project-generator:chat'
  | 'project-generator:token'
  | 'project-generator:spec-ready'
  | 'project-generator:done'
  | 'project-generator:error'
  | 'project-generator:get-model'
  | 'project-generator:set-model'
  | 'agent-generator:chat'
  | 'agent-generator:token'
  | 'agent-generator:spec-ready'
  | 'agent-generator:done'
  | 'agent-generator:error'
  | 'agent-generator:get-model'
  | 'agent-generator:set-model'
  | 'skill-generator:chat'
  | 'skill-generator:token'
  | 'skill-generator:spec-ready'
  | 'skill-generator:done'
  | 'skill-generator:error'
  | 'skill-generator:get-model'
  | 'skill-generator:set-model'
  | 'scheduler-generator:chat'
  | 'scheduler-generator:token'
  | 'scheduler-generator:spec-ready'
  | 'scheduler-generator:done'
  | 'scheduler-generator:error'
  | 'scheduler-generator:get-model'
  | 'scheduler-generator:set-model'
  | 'artifact:list'
  | 'artifact:get'
  | 'artifact:list-versions'
  | 'artifact:get-version'
  | 'artifact:delete'
  | 'artifact:export'
  | 'artifact:open-folder'
  | 'artifact:promote-message'
  | 'artifact:get-file-content'
  | 'artifact-generator:chat'
  | 'artifact-generator:generate'
  | 'artifact-generator:get-runs'
  | 'artifact-generator:get-storage-root'
  | 'artifact-generator:set-storage-root'
  | 'artifact:move-to-project'
  | 'artifact-generator:token'
  | 'artifact-generator:spec-ready'
  | 'artifact-generator:file-event'
  | 'artifact-generator:done'
