/**
 * Compile-time type-safety tests for the preload API.
 * These assertions verify that typed IPC helpers enforce correct return types
 * so that changes to IpcReturnMap are caught immediately.
 */
import { describe, it, expectTypeOf } from 'vitest'
import type { ElectronAPI } from '../../preload/index'
import type {
  AuthStatus,
  ConversationRow,
  MessageRow,
  AgentConfig,
  KnowledgeFile,
  McpServerWithStatus,
  McpServerStatus,
  McpTool,
  McpToolOverrideRow,
  McpCallResult,
  BuiltinToolDefinition,
  ToolExecuteResult,
  DirectoryEntry,
  ContextFileResult,
  ProviderInfo,
  ProviderTestResult,
  ProjectRow,
  ProjectAgent,
  DeleteAgentPreflight,
  DeleteAgentResult,
  ErrorReportCaptureResult,
  ErrorReportEntry,
  ErrorLogEntry,
  IpcReturn,
  SelfHealInvestigationActivity,
  SelfHealInvestigationChunk,
  SelfHealInvestigationResult,
  SelfHealInvestigationSettings,
  SelfHealVerificationDone,
  SelfHealVerificationEvent,
  SelfHealVerificationRun,
  SelfHealGitCommitResult,
  SelfHealGitEvent,
  SelfHealGitPrepareResult,
  SelfHealGitPushResult,
  SelfHealGitStatus,
  SelfHealRecoveryEvent,
  SelfHealRelaunchResult,
  SelfHealRecoveryRun,
  SelfHealReloadStartResult,
  SelfHealReloadPrepareResult,
  SelfHealStartupConfirmationResult,
  WikiEntry,
  WikiExtractionResult,
} from '../../shared/types'

describe('preload IPC return types', () => {
  it('auth methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['authStatus']>>().toEqualTypeOf<Promise<AuthStatus>>()
    expectTypeOf<ReturnType<ElectronAPI['authLoginByok']>>().toEqualTypeOf<Promise<IpcReturn<'auth:login-byok'>>>()
    expectTypeOf<ReturnType<ElectronAPI['authLogout']>>().toEqualTypeOf<Promise<void>>()
  })

  it('conversation methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listConversations']>>().toEqualTypeOf<Promise<ConversationRow[]>>()
    expectTypeOf<ReturnType<ElectronAPI['getMessages']>>().toEqualTypeOf<Promise<MessageRow[]>>()
    expectTypeOf<ReturnType<ElectronAPI['searchConversations']>>().toEqualTypeOf<Promise<ConversationRow[]>>()
    expectTypeOf<ReturnType<ElectronAPI['updateConversationContext']>>().toEqualTypeOf<Promise<boolean>>()
  })

  it('agent methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listAgents']>>().toEqualTypeOf<Promise<AgentConfig[]>>()
    expectTypeOf<ReturnType<ElectronAPI['getAgent']>>().toEqualTypeOf<Promise<AgentConfig | null>>()
    expectTypeOf<ReturnType<ElectronAPI['deleteAgentPreflight']>>().toEqualTypeOf<Promise<DeleteAgentPreflight>>()
    expectTypeOf<ReturnType<ElectronAPI['deleteAgent']>>().toEqualTypeOf<Promise<DeleteAgentResult>>()
    expectTypeOf<ReturnType<ElectronAPI['listKnowledgeFiles']>>().toEqualTypeOf<Promise<KnowledgeFile[]>>()
  })

  it('MCP methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listMcpServers']>>().toEqualTypeOf<Promise<McpServerWithStatus[]>>()
    expectTypeOf<ReturnType<ElectronAPI['getMcpServerStatus']>>().toEqualTypeOf<Promise<McpServerStatus>>()
    expectTypeOf<ReturnType<ElectronAPI['listMcpTools']>>().toEqualTypeOf<Promise<McpTool[]>>()
    expectTypeOf<ReturnType<ElectronAPI['getMcpToolOverrides']>>().toEqualTypeOf<Promise<McpToolOverrideRow[]>>()
    expectTypeOf<ReturnType<ElectronAPI['callMcpTool']>>().toEqualTypeOf<Promise<McpCallResult>>()
  })

  it('tool methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listTools']>>().toEqualTypeOf<Promise<BuiltinToolDefinition[]>>()
    expectTypeOf<ReturnType<ElectronAPI['executeTool']>>().toEqualTypeOf<Promise<ToolExecuteResult>>()
  })

  it('file/directory methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listDirectory']>>().toEqualTypeOf<Promise<DirectoryEntry[]>>()
    expectTypeOf<ReturnType<ElectronAPI['readContextFile']>>().toEqualTypeOf<Promise<ContextFileResult>>()
  })

  it('provider methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listProviders']>>().toEqualTypeOf<Promise<ProviderInfo[]>>()
    expectTypeOf<ReturnType<ElectronAPI['testProviderKey']>>().toEqualTypeOf<Promise<ProviderTestResult>>()
  })

  it('project methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listProjects']>>().toEqualTypeOf<Promise<ProjectRow[]>>()
    expectTypeOf<ReturnType<ElectronAPI['listProjectAgents']>>().toEqualTypeOf<Promise<ProjectAgent[]>>()
  })

  it('wiki methods return typed results', () => {
    expectTypeOf<ReturnType<ElectronAPI['listWikiEntries']>>().toEqualTypeOf<Promise<WikiEntry[]>>()
    expectTypeOf<ReturnType<ElectronAPI['extractWikiLearnings']>>().toEqualTypeOf<Promise<WikiExtractionResult>>()
  })

  it('screen capture and auto-clipboard APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['captureScreen']>>().toEqualTypeOf<Promise<IpcReturn<'screen:capture'>>>()
    expectTypeOf<ReturnType<ElectronAPI['onAutoClipboardFocus']>>().toEqualTypeOf<() => void>()
  })

  it('error log APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['getRecentErrors']>>().toEqualTypeOf<Promise<ErrorLogEntry[]>>()
    expectTypeOf<ReturnType<ElectronAPI['getErrorLogPath']>>().toEqualTypeOf<Promise<string | null>>()
    expectTypeOf<ReturnType<ElectronAPI['clearErrors']>>().toEqualTypeOf<Promise<boolean>>()
    expectTypeOf<ReturnType<ElectronAPI['onErrorLogEntry']>>().toEqualTypeOf<() => void>()
  })

  it('error report APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['captureErrorReport']>>().toEqualTypeOf<Promise<ErrorReportCaptureResult>>()
    expectTypeOf<ReturnType<ElectronAPI['getErrorReport']>>().toEqualTypeOf<Promise<ErrorReportEntry | null>>()
    expectTypeOf<ReturnType<ElectronAPI['listErrorReports']>>().toEqualTypeOf<Promise<ErrorReportEntry[]>>()
  })

  it('self-heal investigation APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['getInvestigationSettings']>>().toEqualTypeOf<Promise<SelfHealInvestigationSettings>>()
    expectTypeOf<ReturnType<ElectronAPI['setInvestigationSettings']>>().toEqualTypeOf<Promise<SelfHealInvestigationSettings>>()
    expectTypeOf<ReturnType<ElectronAPI['setSelfHealReportStatus']>>().toEqualTypeOf<Promise<ErrorReportEntry | null>>()
    expectTypeOf<ReturnType<ElectronAPI['startInvestigation']>>().toEqualTypeOf<Promise<{ reportId: string }>>()
    expectTypeOf<Parameters<ElectronAPI['onInvestigationActivity']>[0]>().toEqualTypeOf<(activity: SelfHealInvestigationActivity) => void>()
    expectTypeOf<Parameters<ElectronAPI['onInvestigationChunk']>[0]>().toEqualTypeOf<(chunk: SelfHealInvestigationChunk) => void>()
    expectTypeOf<Parameters<ElectronAPI['onInvestigationDone']>[0]>().toEqualTypeOf<(result: SelfHealInvestigationResult) => void>()
  })

  it('self-heal verification APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['startVerification']>>().toEqualTypeOf<Promise<{ reportId: string; runId: string }>>()
    expectTypeOf<ReturnType<ElectronAPI['getVerificationRuns']>>().toEqualTypeOf<Promise<SelfHealVerificationRun[]>>()
    expectTypeOf<Parameters<ElectronAPI['onVerificationEvent']>[0]>().toEqualTypeOf<(event: SelfHealVerificationEvent) => void>()
    expectTypeOf<Parameters<ElectronAPI['onVerificationDone']>[0]>().toEqualTypeOf<(result: SelfHealVerificationDone) => void>()
  })

  it('self-heal git APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['getSelfHealGitStatus']>>().toEqualTypeOf<Promise<SelfHealGitStatus>>()
    expectTypeOf<ReturnType<ElectronAPI['prepareSelfHealCommit']>>().toEqualTypeOf<Promise<SelfHealGitPrepareResult>>()
    expectTypeOf<ReturnType<ElectronAPI['commitSelfHealFix']>>().toEqualTypeOf<Promise<SelfHealGitCommitResult>>()
    expectTypeOf<ReturnType<ElectronAPI['pushSelfHealFix']>>().toEqualTypeOf<Promise<SelfHealGitPushResult>>()
    expectTypeOf<Parameters<ElectronAPI['onSelfHealGitEvent']>[0]>().toEqualTypeOf<(event: SelfHealGitEvent) => void>()
  })

  it('self-heal recovery APIs are typed', () => {
    expectTypeOf<ReturnType<ElectronAPI['prepareSelfHealReload']>>().toEqualTypeOf<Promise<SelfHealReloadPrepareResult>>()
    expectTypeOf<ReturnType<ElectronAPI['getSelfHealRecoveryRuns']>>().toEqualTypeOf<Promise<SelfHealRecoveryRun[]>>()
    expectTypeOf<ReturnType<ElectronAPI['startSelfHealReload']>>().toEqualTypeOf<Promise<SelfHealReloadStartResult>>()
    expectTypeOf<ReturnType<ElectronAPI['approveSelfHealRelaunch']>>().toEqualTypeOf<Promise<SelfHealRelaunchResult>>()
    expectTypeOf<ReturnType<ElectronAPI['confirmSelfHealStartup']>>().toEqualTypeOf<Promise<SelfHealStartupConfirmationResult>>()
    expectTypeOf<Parameters<ElectronAPI['onSelfHealRecoveryEvent']>[0]>().toEqualTypeOf<(event: SelfHealRecoveryEvent) => void>()
  })

  it('does not expose terminal methods (removed in RF.13)', () => {
    type ApiKeys = keyof ElectronAPI
    // These keys must not exist on the API type
    expectTypeOf<'createTerminal' extends ApiKeys ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'writeTerminal' extends ApiKeys ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'disposeTerminal' extends ApiKeys ? true : false>().toEqualTypeOf<false>()
  })
})
