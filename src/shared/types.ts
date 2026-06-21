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
}

export interface ToolConfig {
  enabled: boolean
  approval: 'auto' | 'always-ask' | 'disabled'
  instructions: string
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

export interface ProjectConfig extends ProjectOrchestrationConfig {
  instructions: string
  rootDirectory: string
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
  variables: [],
  instructionMode: 'prepend',
  instructionsEnabled: true,
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
}

export interface ErrorReportCaptureResult {
  reportId: string
  screenshotPath: string | null
  createdAt: number
}

export type SelfHealBackend = 'byok' | 'claude-cli' | 'codex-cli'
export type InvestigationStatus = 'idle' | 'running' | 'done' | 'error'

export interface SelfHealInvestigationSettings {
  backend: SelfHealBackend
  model: string
  retryLimit: number
  autoApproveTools: boolean
}

export interface SelfHealInvestigationActivity {
  reportId: string
  type: 'thinking' | 'tool' | 'status'
  label: string
  toolName?: string
}

export interface SelfHealInvestigationChunk {
  reportId: string
  chunk: string
}

export interface SelfHealInvestigationResult {
  reportId: string
  status: 'done' | 'error'
  markdown: string
  confidence: string
  rootCause: string
  affectedFiles: string[]
  error?: string
  completedAt: number
}

export type SelfHealFixStatus = 'none' | 'staging' | 'staged' | 'applying' | 'applied' | 'failed'

export interface SelfHealStagedFileEntry {
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

export interface SelfHealStagedFileDiff {
  relativePath: string
  hunks: DiffHunk[]
}

export interface SelfHealFixEvent {
  reportId: string
  type: 'file-patched' | 'file-error' | 'status'
  relativePath?: string
  error?: string
  label: string
}

export interface SelfHealFixDone {
  reportId: string
  status: 'done' | 'error'
  stagedFiles: SelfHealStagedFileEntry[]
  error?: string
  completedAt: number
}

export type SelfHealVerificationCommand = 'typecheck' | 'lint' | 'test' | 'build'
export type SelfHealVerificationStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface SelfHealVerificationStep {
  command: SelfHealVerificationCommand
  status: SelfHealVerificationStepStatus
  exitCode: number | null
  log: string
  startedAt: number | null
  completedAt: number | null
}

export interface SelfHealVerificationRun {
  id: string
  reportId: string
  status: 'running' | 'success' | 'failed'
  steps: SelfHealVerificationStep[]
  startedAt: number
  completedAt: number | null
  retryCount: number
  error?: string
}

export interface SelfHealVerificationEvent {
  reportId: string
  runId: string
  command?: SelfHealVerificationCommand
  status: SelfHealVerificationStepStatus | 'running' | 'success' | 'failed'
  line?: string
  exitCode?: number | null
  label: string
}

export interface SelfHealVerificationDone {
  reportId: string
  runId: string
  status: 'success' | 'failed'
  steps: SelfHealVerificationStep[]
  retryCount: number
  error?: string
  completedAt: number
}

export type SelfHealGitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'

export interface SelfHealGitFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  status: SelfHealGitFileStatus
}

export interface SelfHealGitStatus {
  reportId?: string
  isRepo: boolean
  branch: string | null
  commitSha: string | null
  dirty: boolean
  ahead: number
  behind: number
  files: SelfHealGitFile[]
  error?: string
}

export interface SelfHealGitPrepareResult {
  reportId: string
  status: SelfHealGitStatus
  suggestedMessage: string
  files: string[]
  canCommit: boolean
  reason?: string
}

export interface SelfHealGitCommitResult {
  reportId: string
  committed: boolean
  commitSha: string | null
  status: SelfHealGitStatus
  error?: string
}

export interface SelfHealGitPushResult {
  reportId: string
  pushed: boolean
  status: SelfHealGitStatus
  error?: string
}

export interface SelfHealGitEvent {
  reportId: string
  type: 'status' | 'prepare' | 'commit' | 'push'
  label: string
  status?: SelfHealGitStatus
  commitSha?: string | null
  error?: string
}

export interface SelfHealRecoveryBackupFile {
  relativePath: string
  backupPath: string | null
}

export interface SelfHealRecoveryPreReloadState {
  branch: string | null
  commitSha: string | null
  dirty: boolean
  version: string | null
}

export interface SelfHealRecoveryRun {
  id: string
  reportId: string
  status: 'prepared' | 'reloading' | 'confirmed' | 'rollback-required' | 'rolled-back' | 'failed'
  targetCommitSha: string | null
  targetVersion: string | null
  backupManifest: SelfHealRecoveryBackupFile[]
  preReloadState: SelfHealRecoveryPreReloadState
  createdAt: number
  updatedAt: number
  confirmedAt: number | null
  rollbackAt: number | null
  error?: string
}

export interface SelfHealReloadPrepareResult {
  reportId: string
  recovery: SelfHealRecoveryRun | null
  canReload: boolean
  reason?: string
}

export interface SelfHealRecoveryEvent {
  reportId: string
  recoveryId?: string
  type: 'prepare' | 'reload' | 'confirm' | 'rollback'
  label: string
  status?: SelfHealRecoveryRun['status']
  error?: string
}

export interface SelfHealReloadStartResult {
  reportId: string
  recoveryId: string
  started: boolean
  buildId: string | null
  recovery: SelfHealRecoveryRun | null
  error?: string
}

export interface SelfHealRelaunchResult {
  reportId: string
  recoveryId: string
  scheduled: boolean
  error?: string
}

export interface SelfHealStartupConfirmationResult {
  confirmed: boolean
  recovery: SelfHealRecoveryRun | null
  error?: string
}

export interface SelfHealHistoryEntry {
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
  investigation_started_at: number | null
  investigation_completed_at: number | null
  fix_status: SelfHealFixStatus
  fix_staged_files: string
  fix_started_at: number | null
  fix_completed_at: number | null
  fix_error: string | null
  created_at: number
  updated_at: number
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

export interface AgentGeneratorMessage {
  role: 'user' | 'assistant'
  content: string
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

export type ArtifactKind =
  | 'document' | 'code' | 'ui' | 'data'
  | 'prompt' | 'agent-config' | 'plan' | 'bundle' | 'other'

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
  title: string
  kind: ArtifactKind
  description: string | null
  storageRoot: string
  currentVersionId: string | null
  status: ArtifactStatus
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
  'app:create-gist': string
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
  'conversation:set-pinned': boolean
  'conversation:update-context': boolean
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
  'error-report:delete': boolean
  'error-report:get': ErrorReportEntry | null
  'error-report:list': ErrorReportEntry[]
  // Self-heal investigation
  'self-heal:get-investigation-settings': SelfHealInvestigationSettings
  'self-heal:set-report-status': ErrorReportEntry | null
  'self-heal:set-investigation-settings': SelfHealInvestigationSettings
  'self-heal:start-investigation': { reportId: string }
  'self-heal:investigation-activity': void
  'self-heal:investigation-chunk': void
  'self-heal:investigation-done': void
  // Self-heal fix staging
  'self-heal:start-fix': { reportId: string }
  'self-heal:commit-to-workspace': { appliedFiles: string[]; backupPaths: string[] } | null
  'self-heal:revert-staged-file': boolean
  'self-heal:get-staged-diff': SelfHealStagedFileDiff | null
  'self-heal:fix-event': void
  'self-heal:fix-done': void
  // Self-heal verification
  'self-heal:start-verification': { reportId: string; runId: string }
  'self-heal:get-verification-runs': SelfHealVerificationRun[]
  'self-heal:verification-event': void
  'self-heal:verification-done': void
  // Self-heal git flow
  'self-heal:git-status': SelfHealGitStatus
  'self-heal:git-prepare-commit': SelfHealGitPrepareResult
  'self-heal:git-commit': SelfHealGitCommitResult
  'self-heal:git-push': SelfHealGitPushResult
  'self-heal:git-event': void
  // Self-heal recovery/reload
  'self-heal:prepare-reload': SelfHealReloadPrepareResult
  'self-heal:get-recovery-runs': SelfHealRecoveryRun[]
  'self-heal:start-reload': SelfHealReloadStartResult
  'self-heal:approve-relaunch': SelfHealRelaunchResult
  'self-heal:confirm-startup': SelfHealStartupConfirmationResult
  'self-heal:rollback': { rolledBack: boolean; error?: string }
  'self-heal:recovery-event': void
  'self-heal:get-history': SelfHealHistoryEntry[]
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
  'project:list': ProjectRow[]
  'project:list-agents': ProjectAgent[]
  'project:remove-agent': boolean
  'project:rename': boolean
  'project:reorder-agents': boolean
  'project:set-conversation': boolean
  'project:set-default-model': boolean
  'project:set-primary-agent': boolean
  'project:update-config': boolean
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
  'project-generator:get-model': string
  'project-generator:set-model': void
  // Agent generator
  'agent-generator:chat': { started: boolean }
  'agent-generator:token': void
  'agent-generator:spec-ready': void
  'agent-generator:done': void
  'agent-generator:get-model': string
  'agent-generator:set-model': void
  // Skill generator
  'skill-generator:chat': { started: boolean }
  'skill-generator:token': void
  'skill-generator:spec-ready': void
  'skill-generator:done': void
  'skill-generator:get-model': string
  'skill-generator:set-model': void
  // Artifact
  'artifact:list': ArtifactRow[]
  'artifact:get': ArtifactRow | null
  'artifact:list-versions': ArtifactVersion[]
  'artifact:get-version': ArtifactVersion | null
  'artifact:delete': { deleted: boolean }
  'artifact:export': { exportPath: string }
  'artifact:open-folder': { ok: boolean }
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
  | 'app:create-gist'
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
  | 'chat:stream-model'
  | 'chat:thinking-delta'
  | 'chat:thinking-end'
  | 'chat:wiki-injected'
  | 'chat:remote-message'
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
  | 'conversation:set-pinned'
  | 'conversation:update-context'
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
  | 'self-heal:get-investigation-settings'
  | 'self-heal:set-report-status'
  | 'self-heal:set-investigation-settings'
  | 'self-heal:start-investigation'
  | 'self-heal:investigation-activity'
  | 'self-heal:investigation-chunk'
  | 'self-heal:investigation-done'
  | 'self-heal:start-fix'
  | 'self-heal:commit-to-workspace'
  | 'self-heal:revert-staged-file'
  | 'self-heal:get-staged-diff'
  | 'self-heal:fix-event'
  | 'self-heal:fix-done'
  | 'self-heal:start-verification'
  | 'self-heal:get-verification-runs'
  | 'self-heal:verification-event'
  | 'self-heal:verification-done'
  | 'self-heal:git-status'
  | 'self-heal:git-prepare-commit'
  | 'self-heal:git-commit'
  | 'self-heal:git-push'
  | 'self-heal:git-event'
  | 'self-heal:prepare-reload'
  | 'self-heal:get-recovery-runs'
  | 'self-heal:start-reload'
  | 'self-heal:approve-relaunch'
  | 'self-heal:confirm-startup'
  | 'self-heal:rollback'
  | 'self-heal:recovery-event'
  | 'self-heal:get-history'
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
  | 'project:list'
  | 'project:list-agents'
  | 'project:remove-agent'
  | 'project:rename'
  | 'project:reorder-agents'
  | 'project:set-conversation'
  | 'project:set-default-model'
  | 'project:set-primary-agent'
  | 'project:update-config'
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
  | 'overlay:get-screenshot'
  | 'screen:capture'
  | 'screen:capture-window'
  | 'screen:check-permission'
  | 'screen:ocr-image'
  | 'voice:get-status'
  | 'voice:install-local'
  | 'voice:transcribe'
  | 'tool:approval-response'
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
  | 'project-generator:chat'
  | 'project-generator:token'
  | 'project-generator:spec-ready'
  | 'project-generator:done'
  | 'project-generator:get-model'
  | 'project-generator:set-model'
  | 'agent-generator:chat'
  | 'agent-generator:token'
  | 'agent-generator:spec-ready'
  | 'agent-generator:done'
  | 'agent-generator:get-model'
  | 'agent-generator:set-model'
  | 'skill-generator:chat'
  | 'skill-generator:token'
  | 'skill-generator:spec-ready'
  | 'skill-generator:done'
  | 'skill-generator:get-model'
  | 'skill-generator:set-model'
  | 'artifact:list'
  | 'artifact:get'
  | 'artifact:list-versions'
  | 'artifact:get-version'
  | 'artifact:delete'
  | 'artifact:export'
  | 'artifact:open-folder'
  | 'artifact-generator:chat'
  | 'artifact-generator:generate'
  | 'artifact-generator:get-runs'
  | 'artifact-generator:get-storage-root'
  | 'artifact-generator:set-storage-root'
  | 'artifact-generator:token'
  | 'artifact-generator:spec-ready'
  | 'artifact-generator:file-event'
  | 'artifact-generator:done'
