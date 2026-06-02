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
  IpcReturn,
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

  it('does not expose terminal methods (removed in RF.13)', () => {
    type ApiKeys = keyof ElectronAPI
    // These keys must not exist on the API type
    expectTypeOf<'createTerminal' extends ApiKeys ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'writeTerminal' extends ApiKeys ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'disposeTerminal' extends ApiKeys ? true : false>().toEqualTypeOf<false>()
  })
})
