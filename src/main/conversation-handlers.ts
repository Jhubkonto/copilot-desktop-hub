import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { BrowserWindow, dialog } from "electron";
import { readFileSync } from "fs";
import { getDatabase } from "./database";
import { getCliModels } from "./cli-detection";
import {
  buildStructuredSummary,
  estimateMessageTokens,
  estimateTokens,
  renderStructuredSummary,
  resolveContextWindow,
} from "./context-compression";
import { safeHandle } from "./safe-handle";
import type {
  ConversationExportAgent,
  ConversationExportAttachment,
  ConversationExportContextRef,
  ConversationExportMessage,
  ConversationExportPack,
  ConversationExportPackOptions,
  ConversationExportProject,
  ConversationExportToolCall,
  ConversationExportV1,
  ConversationCompressionDraft,
  ConversationCompressionPreview,
  ConversationCompressionSaveInput,
  ConversationForkOptions,
  ConversationForkResult,
  ConversationImportOptions,
  ConversationImportResult,
  ConversationRow,
  StructuredConversationSummary,
} from "../shared/types";

type MessageExportRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  is_edited: number;
  previous_content: string | null;
  timestamp: number;
  attachments: string | null;
  context_snapshot: string | null;
};

type ImportedMessageInput = {
  role: string;
  content: string;
  model: string | null;
  isEdited: number;
  previousContent: string | null;
  attachmentsJson: string | null;
  contextSnapshotJson: string | null;
  timestamp: number;
};

type ForkMessageInput = {
  role: string;
  content: string;
  model: string | null;
  isEdited: number;
  previousContent: string | null;
  attachmentsJson: string | null;
  contextSnapshotJson: string;
  timestamp: number;
  rewritten: boolean;
};

type CompressionPlan = {
  messages: ForkMessageInput[];
  compressedCount: number;
};

type AgentBackend = "claude-cli" | "codex-cli" | "gh-copilot";

type AgentBackendConfig = {
  backend: AgentBackend | null;
  cliModel: string | null;
};

type ConversationSummaryRow = {
  summary_json: string;
  source_message_count: number;
  retained_message_count: number;
  estimated_tokens_before: number;
  target_budget: number;
  strategy: string;
  updated_at: number;
};

type CompressionSourceMessage = {
  role: string;
  content: string;
  timestamp: number;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayFromJson<T>(value: string | null | undefined): T[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function extractContextRefs(snapshot: unknown): ConversationExportContextRef[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const refs = (snapshot as { contextRefs?: unknown }).contextRefs;
  return Array.isArray(refs) ? (refs as ConversationExportContextRef[]) : [];
}

function summarizeToolCall(content: string): ConversationExportToolCall | null {
  const parsed = parseJson<Record<string, unknown> | null>(content, null);
  if (!parsed) {
    return { summary: content.slice(0, 500) };
  }

  const name = typeof parsed.name === "string"
    ? parsed.name
    : typeof parsed.toolName === "string"
      ? parsed.toolName
      : typeof parsed.tool === "string"
        ? parsed.tool
        : undefined;
  const server = typeof parsed.server === "string"
    ? parsed.server
    : typeof parsed.serverName === "string"
      ? parsed.serverName
      : undefined;
  const result = parsed.result ?? parsed.content ?? parsed.error;
  const resultText = typeof result === "string" ? result : result == null ? "" : JSON.stringify(result);

  return {
    ...parsed,
    id: typeof parsed.id === "string" ? parsed.id : undefined,
    name,
    server,
    args: parsed.args ?? parsed.input,
    result,
    success: typeof parsed.success === "boolean" ? parsed.success : undefined,
    summary: [server, name].filter(Boolean).join("/") || resultText.slice(0, 120) || "tool call",
  };
}

function getProjectExport(db: Database.Database, projectId: string | null): ConversationExportProject | null {
  if (!projectId) return null;
  const row = db
    .prepare("SELECT id, name, color, default_model, created_at, updated_at FROM projects WHERE id = ?")
    .get(projectId) as ConversationExportProject | undefined;
  return row ?? null;
}

function getAgentExport(db: Database.Database, agentId: string | null): ConversationExportAgent | null {
  if (!agentId) return null;
  const row = db
    .prepare("SELECT id, config_json, is_default, created_at, updated_at FROM agents WHERE id = ?")
    .get(agentId) as { id: string; config_json: string; is_default: number; created_at: number; updated_at: number } | undefined;
  if (!row) return null;

  const config = parseJson<Record<string, unknown>>(row.config_json, {});
  return {
    id: row.id,
    name: typeof config.name === "string" ? config.name : null,
    icon: typeof config.icon === "string" ? config.icon : null,
    backend: typeof config.backend === "string" ? config.backend : null,
    cli_model: typeof config.cliModel === "string" ? config.cliModel : null,
    is_default: row.is_default === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapExportMessage(row: MessageExportRow): ConversationExportMessage {
  const contextSnapshot = parseJson<unknown>(row.context_snapshot, null);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model,
    timestamp: row.timestamp,
    is_edited: row.is_edited === 1,
    previous_content: row.previous_content,
    attachments: arrayFromJson<ConversationExportAttachment>(row.attachments),
    context_refs: extractContextRefs(contextSnapshot),
    context_snapshot: contextSnapshot,
    tool_call: row.role === "tool-call" ? summarizeToolCall(row.content) : null,
  };
}

function slugFileName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    || "conversation";
}

function formatTimestamp(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "unknown";
}

function roleLabel(role: string): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  if (role === "tool-call") return "Tool call";
  if (role === "team-activity") return "Team activity";
  return role;
}

function describeAttachment(attachment: ConversationExportAttachment): string {
  const name = typeof attachment.name === "string" && attachment.name.trim() ? attachment.name : "attachment";
  const size = typeof attachment.size === "number" ? `, ${attachment.size} bytes` : "";
  const type = typeof attachment.type === "string" ? `, ${attachment.type}` : "";
  return `${name}${size}${type}`;
}

function describeContextRef(ref: ConversationExportContextRef): string {
  const token = typeof ref.token === "string" ? ref.token : typeof ref.key === "string" ? ref.key : "context";
  const value = typeof ref.value === "string" ? ref.value : typeof ref.label === "string" ? ref.label : "";
  return value ? `${token}: ${value}` : token;
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}\n...[truncated ${value.length - limit} chars]`;
}

function appendMessageMetadata(lines: string[], message: ConversationExportMessage): void {
  if (message.attachments.length > 0) {
    lines.push("", "Attachments:");
    for (const attachment of message.attachments) {
      lines.push(`- ${describeAttachment(attachment)}`);
    }
  }
  if (message.context_refs.length > 0) {
    lines.push("", "Context refs:");
    for (const ref of message.context_refs) {
      lines.push(`- ${describeContextRef(ref)}`);
    }
  }
  if (message.tool_call) {
    lines.push("", `Tool summary: ${message.tool_call.summary}`);
  }
}

function buildMarkdownTranscript(exported: ConversationExportV1): string {
  const lines = [
    `# ${exported.conversation.title || "Conversation Export"}`,
    "",
    `Exported: ${formatTimestamp(exported.exported_at)}`,
    `Conversation ID: ${exported.conversation.id}`,
    `Project: ${exported.project?.name ?? "None"}`,
    `Agent: ${exported.agent?.name ?? "None"}`,
    `Model: ${exported.conversation.model ?? "Default"}`,
    "",
  ];

  for (const message of exported.messages) {
    const model = message.model ? ` (${message.model})` : "";
    lines.push(`## ${roleLabel(message.role)}${model}`, "", message.content || "_No content_");
    appendMessageMetadata(lines, message);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function buildContextBundle(exported: ConversationExportV1): string {
  const lines = [
    `# Nexy Context Bundle: ${exported.conversation.title || "Conversation"}`,
    "",
    `Source conversation: ${exported.conversation.id}`,
    `Exported: ${formatTimestamp(exported.exported_at)}`,
    `Project: ${exported.project?.name ?? "None"}`,
    `Agent: ${exported.agent?.name ?? "None"}`,
    `Backend: ${exported.agent?.backend ?? "provider/default"}`,
    `Model: ${exported.conversation.model ?? exported.agent?.cli_model ?? exported.project?.default_model ?? "Default"}`,
    "",
    "## Portable Context",
    "",
  ];

  for (const message of exported.messages) {
    const model = message.model ? `, model=${message.model}` : "";
    lines.push(`### ${roleLabel(message.role)} @ ${formatTimestamp(message.timestamp)}${model}`, "");
    lines.push(truncateText(message.content || "_No content_", 3000));
    appendMessageMetadata(lines, message);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseConversationExport(value: unknown): ConversationExportV1 {
  if (!isRecord(value) || value.schema !== "nexy.conversation.v1") {
    throw new Error("Unsupported conversation export format");
  }
  if (!isRecord(value.conversation)) {
    throw new Error("Conversation export is missing conversation metadata");
  }
  if (!Array.isArray(value.messages)) {
    throw new Error("Conversation export is missing messages");
  }
  return value as unknown as ConversationExportV1;
}

function parseCompressionSections(value: string): ConversationCompressionPreview["sections"] {
  const parsed = parseJson<unknown>(value, null);
  if (!isRecord(parsed)) return null;
  const getList = (key: string): string[] => {
    const item = parsed[key];
    return Array.isArray(item) ? item.filter((value): value is string => typeof value === "string") : [];
  };
  return {
    goals: getList("goals"),
    decisions: getList("decisions"),
    constraints: getList("constraints"),
    filesTouched: getList("filesTouched"),
    commandsRun: getList("commandsRun"),
    openQuestions: getList("openQuestions"),
    nextActions: getList("nextActions"),
    recentContextNotes: getList("recentContextNotes"),
  };
}

function emptyCompressionSections(): StructuredConversationSummary {
  return {
    goals: [],
    decisions: [],
    constraints: [],
    filesTouched: [],
    commandsRun: [],
    openQuestions: [],
    nextActions: [],
    recentContextNotes: [],
  };
}

function normalizeCompressionSections(value: StructuredConversationSummary): StructuredConversationSummary {
  const cleanList = (items: string[]): string[] => (
    Array.isArray(items)
      ? items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 24)
      : []
  );
  return {
    goals: cleanList(value.goals),
    decisions: cleanList(value.decisions),
    constraints: cleanList(value.constraints),
    filesTouched: cleanList(value.filesTouched),
    commandsRun: cleanList(value.commandsRun),
    openQuestions: cleanList(value.openQuestions),
    nextActions: cleanList(value.nextActions),
    recentContextNotes: cleanList(value.recentContextNotes),
  };
}

function getCompressionSourceMessages(db: Database.Database, conversationId: string): CompressionSourceMessage[] {
  return db
    .prepare(
      `SELECT role, content, timestamp
       FROM messages
       WHERE conversation_id = ? AND role != 'system'
       ORDER BY timestamp ASC`,
    )
    .all(conversationId) as CompressionSourceMessage[];
}

function getConversationCompressionModel(db: Database.Database, conversationId: string): string | null {
  const row = db
    .prepare(
      `SELECT c.model AS conversation_model, p.default_model AS project_model
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = ?`,
    )
    .get(conversationId) as { conversation_model: string | null; project_model: string | null } | undefined;
  return row?.conversation_model ?? row?.project_model ?? null;
}

export function prepareConversationCompressionSummary(
  db: Database.Database,
  conversationId: string,
): ConversationCompressionDraft {
  const messages = getCompressionSourceMessages(db, conversationId);
  if (messages.length === 0) {
    return {
      conversation_id: conversationId,
      summarized_message_count: 0,
      retained_message_count: 0,
      omitted_message_count: 0,
      estimated_tokens_before: 0,
      target_budget: 0,
      strategy: "manual-structured-summary-plus-recent-turns",
      sections: emptyCompressionSections(),
    };
  }

  const model = getConversationCompressionModel(db, conversationId);
  const contextWindow = resolveContextWindow(db, model) ?? 32_768;
  const targetBudget = Math.min(12_000, Math.max(4_000, Math.floor(contextWindow * 0.55)));
  const estimatedTokensBefore = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const retainedCount = messages.length <= 4 ? 1 : Math.min(8, Math.max(4, Math.ceil(messages.length * 0.25)));
  const summarizedCount = Math.max(0, messages.length - retainedCount);
  const summarizedMessages = summarizedCount > 0 ? messages.slice(0, summarizedCount) : messages;
  const sections = buildStructuredSummary(summarizedMessages);
  if (sections.recentContextNotes.length === 0 && summarizedMessages.length > 0) {
    sections.recentContextNotes.push(summarizeForCompression(
      summarizedMessages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        model: null,
        isEdited: 0,
        previousContent: null,
        attachmentsJson: null,
        contextSnapshotJson: "{}",
        rewritten: false,
      })),
      Math.max(2_000, Math.floor(targetBudget * 1.2)),
    ));
  }

  return {
    conversation_id: conversationId,
    summarized_message_count: summarizedCount,
    retained_message_count: messages.length - summarizedCount,
    omitted_message_count: 0,
    estimated_tokens_before: estimatedTokensBefore,
    target_budget: targetBudget,
    strategy: "manual-structured-summary-plus-recent-turns",
    sections: normalizeCompressionSections(sections),
  };
}

export function saveConversationCompressionSummary(
  db: Database.Database,
  input: ConversationCompressionSaveInput,
): ConversationCompressionPreview {
  const now = Date.now();
  const sections = normalizeCompressionSections(input.sections);
  const summaryText = renderStructuredSummary(sections);
  const summarizedCount = Math.max(0, Math.floor(input.summarizedMessageCount));
  const retainedCount = Math.max(0, Math.floor(input.retainedMessageCount));
  const estimatedTokensBefore = Math.max(0, Math.floor(input.estimatedTokensBefore));
  const targetBudget = Math.max(0, Math.floor(input.targetBudget));
  const strategy = input.strategy.trim() || "manual-structured-summary-plus-recent-turns";

  db.prepare(
    `INSERT INTO conversation_summaries
      (id, conversation_id, summary, summary_json, source_message_count, retained_message_count, estimated_tokens_before, target_budget, strategy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
      summary = excluded.summary,
      summary_json = excluded.summary_json,
      source_message_count = excluded.source_message_count,
      retained_message_count = excluded.retained_message_count,
      estimated_tokens_before = excluded.estimated_tokens_before,
      target_budget = excluded.target_budget,
      strategy = excluded.strategy,
      updated_at = excluded.updated_at`,
  ).run(
    randomUUID(),
    input.conversationId,
    summaryText,
    JSON.stringify(sections),
    summarizedCount,
    retainedCount,
    estimatedTokensBefore,
    targetBudget,
    strategy,
    now,
    now,
  );

  return getConversationCompressionPreview(db, input.conversationId);
}

export function getConversationCompressionPreview(
  db: Database.Database,
  conversationId: string,
): ConversationCompressionPreview {
  const total = (db
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND role != 'system'")
    .get(conversationId) as { count: number } | undefined)?.count ?? 0;
  const row = db
    .prepare("SELECT * FROM conversation_summaries WHERE conversation_id = ?")
    .get(conversationId) as ConversationSummaryRow | undefined;

  if (!row) {
    return {
      conversation_id: conversationId,
      has_summary: false,
      summarized_message_count: 0,
      retained_message_count: total,
      omitted_message_count: 0,
      estimated_tokens_before: 0,
      target_budget: 0,
      strategy: null,
      updated_at: null,
      sections: null,
    };
  }

  const summarized = row.source_message_count;
  const retained = row.retained_message_count;
  return {
    conversation_id: conversationId,
    has_summary: true,
    summarized_message_count: summarized,
    retained_message_count: retained,
    omitted_message_count: Math.max(0, total - summarized - retained),
    estimated_tokens_before: row.estimated_tokens_before,
    target_budget: row.target_budget,
    strategy: row.strategy,
    updated_at: row.updated_at,
    sections: parseCompressionSections(row.summary_json),
  };
}

function serializeContextSnapshot(message: ConversationExportMessage, importedIntoExisting: boolean): string | null {
  const base = isRecord(message.context_snapshot)
    ? { ...message.context_snapshot }
    : message.context_refs.length > 0
      ? { contextRefs: message.context_refs }
      : {};
  const next = {
    ...base,
    nexyImport: {
      originalMessageId: message.id,
      originalTimestamp: message.timestamp,
      importedAt: Date.now(),
      timestampShifted: importedIntoExisting,
    },
  };
  return JSON.stringify(next);
}

function normalizeImportedMessages(
  exported: ConversationExportV1,
  importedIntoExisting: boolean,
  existingMaxTimestamp: number | null,
): ImportedMessageInput[] {
  const supportedRoles = new Set(["user", "assistant", "system", "team-activity", "tool-call"]);
  const baseTimestamp = importedIntoExisting ? Math.max(Date.now(), existingMaxTimestamp ?? 0) : null;

  return exported.messages.map((message, index) => ({
    role: supportedRoles.has(message.role) ? message.role : "system",
    content: message.content,
    model: message.model ?? null,
    isEdited: message.is_edited ? 1 : 0,
    previousContent: message.previous_content ?? null,
    attachmentsJson: message.attachments.length > 0 ? JSON.stringify(message.attachments) : null,
    contextSnapshotJson: serializeContextSnapshot(message, importedIntoExisting),
    timestamp: baseTimestamp == null ? message.timestamp : baseTimestamp + index + 1,
  }));
}

function getConversationRow(db: Database.Database, conversationId: string): ConversationRow | null {
  const row = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(conversationId) as ConversationRow | undefined;
  return row ?? null;
}

function getAgentBackendConfig(db: Database.Database, agentId: string | null): AgentBackendConfig {
  if (!agentId) return { backend: null, cliModel: null };
  const row = db
    .prepare("SELECT config_json FROM agents WHERE id = ?")
    .get(agentId) as { config_json: string } | undefined;
  if (!row) {
    throw new Error("Target agent not found");
  }
  const config = parseJson<Record<string, unknown>>(row.config_json, {});
  const backend = config.backend === "claude-cli" || config.backend === "codex-cli" || config.backend === "gh-copilot"
    ? config.backend
    : null;
  return {
    backend,
    cliModel: typeof config.cliModel === "string" ? config.cliModel : null,
  };
}

function validateForkTarget(db: Database.Database, agentId: string | null, model: string | null): string | null {
  const { backend, cliModel } = getAgentBackendConfig(db, agentId);
  if (backend === "gh-copilot") {
    if (model) {
      throw new Error("GitHub Copilot CLI manages its own model; do not set a conversation model for this backend");
    }
    return null;
  }
  if (backend === "claude-cli" || backend === "codex-cli") {
    const availableModels = getCliModels(backend).map((entry) => entry.id);
    const resolvedModel = model ?? cliModel ?? availableModels[0] ?? null;
    if (resolvedModel && !availableModels.includes(resolvedModel)) {
      throw new Error(`Model ${resolvedModel} is not available for ${backend}`);
    }
    return resolvedModel;
  }
  return model;
}

function summarizeAttachments(attachmentsJson: string | null): string[] {
  const attachments = arrayFromJson<Record<string, unknown>>(attachmentsJson);
  return attachments.map((attachment) => {
    const name = typeof attachment.name === "string" ? attachment.name : "attachment";
    const size = typeof attachment.size === "number" ? `, ${attachment.size} bytes` : "";
    const type = typeof attachment.type === "string" ? `, ${attachment.type}` : "";
    return `- ${name}${size}${type}`;
  });
}

function summarizeToolCallMessage(content: string): string {
  const parsed = parseJson<Record<string, unknown> | null>(content, null);
  if (!parsed) return content;
  const toolName = typeof parsed.toolName === "string"
    ? parsed.toolName
    : typeof parsed.name === "string"
      ? parsed.name
      : "tool";
  const serverName = typeof parsed.serverName === "string"
    ? parsed.serverName
    : typeof parsed.server === "string"
      ? parsed.server
      : "unknown server";
  const args = parsed.toolArgs ?? parsed.args ?? parsed.input;
  const result = parsed.toolResult ?? parsed.result ?? parsed.content ?? parsed.error;
  const success = typeof parsed.toolSuccess === "boolean"
    ? parsed.toolSuccess
    : typeof parsed.success === "boolean"
      ? parsed.success
      : undefined;
  const lines = [
    `[Portable tool-call summary]`,
    `Tool: ${toolName}`,
    `Server/backend: ${serverName}`,
  ];
  if (success !== undefined) lines.push(`Status: ${success ? "success" : "failed"}`);
  if (args !== undefined) lines.push(`Arguments: ${typeof args === "string" ? args : JSON.stringify(args)}`);
  if (result !== undefined) lines.push(`Result: ${typeof result === "string" ? result : JSON.stringify(result)}`);
  return lines.join("\n");
}

function summarizeTeamActivity(content: string): string {
  const parsed = parseJson<{ steps?: Array<Record<string, unknown>> } | null>(content, null);
  if (!parsed?.steps?.length) return `[Portable team-activity summary]\n${content}`;
  const lines = ["[Portable team-activity summary]"];
  for (const step of parsed.steps) {
    const name = typeof step.agentName === "string" ? step.agentName : typeof step.agentId === "string" ? step.agentId : "agent";
    const task = typeof step.task === "string" ? step.task : "task";
    const status = typeof step.status === "string" ? step.status : "unknown";
    const result = typeof step.result === "string" && step.result.trim() ? ` — ${step.result.trim()}` : "";
    lines.push(`- ${name}: ${task} (${status})${result}`);
  }
  return lines.join("\n");
}

function buildForkContextSnapshot(row: MessageExportRow, now: number, sourceConversationId: string, rewrites: string[]): string {
  const contextSnapshot = parseJson<unknown>(row.context_snapshot, null);
  const next = isRecord(contextSnapshot) ? { ...contextSnapshot } : {};
  return JSON.stringify({
    ...next,
    nexyFork: {
      sourceConversationId,
      sourceMessageId: row.id,
      forkedAt: now,
      compatibilityRewrites: rewrites,
    },
  });
}

function mergeCompressionSnapshot(contextSnapshotJson: string, metadata: Record<string, unknown>): string {
  const existing = parseJson<unknown>(contextSnapshotJson, null);
  const base = isRecord(existing) ? { ...existing } : {};
  return JSON.stringify({
    ...base,
    nexyCompression: metadata,
  });
}

function summarizeForCompression(messages: ForkMessageInput[], maxChars: number): string {
  const lines: string[] = [];
  for (const message of messages) {
    const compact = message.content.replace(/\s+/g, " ").trim();
    const preview = compact.length > 360 ? `${compact.slice(0, 360).trimEnd()}...` : compact;
    lines.push(`- ${roleLabel(message.role)}: ${preview || "No content"}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  const summary = lines.join("\n");
  return summary.length > maxChars ? `${summary.slice(0, maxChars).trimEnd()}\n...[summary truncated]` : summary;
}

function maybeCompressForkMessages(
  db: Database.Database,
  messages: ForkMessageInput[],
  sourceConversationId: string,
  targetModel: string | null,
  now: number,
): CompressionPlan {
  const targetContextWindow = resolveContextWindow(db, targetModel);
  if (!targetContextWindow || messages.length <= 4) {
    return { messages, compressedCount: 0 };
  }

  const estimatedOriginalTokens = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const targetBudget = Math.floor(targetContextWindow * 0.75);
  if (estimatedOriginalTokens <= targetBudget) {
    return { messages, compressedCount: 0 };
  }

  const summaryBudget = Math.max(512, Math.floor(targetBudget * 0.25));
  const tailBudget = Math.max(1_000, targetBudget - summaryBudget);
  const retained: ForkMessageInput[] = [];
  let retainedTokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const nextTokens = estimateMessageTokens(message);
    if (retained.length >= 4 && retainedTokens + nextTokens > tailBudget) break;
    retained.unshift(message);
    retainedTokens += nextTokens;
  }

  const compressed = messages.slice(0, messages.length - retained.length);
  if (compressed.length === 0) {
    return { messages, compressedCount: 0 };
  }

  const metadata = {
    sourceConversationId,
    compressedAt: now,
    targetModel,
    targetContextWindow,
    targetBudget,
    estimatedOriginalTokens,
    compressedMessageCount: compressed.length,
    retainedMessageCount: retained.length,
    strategy: "deterministic-summary-plus-recent-turns",
  };
  const summaryContent = [
    "[Compressed continuation context]",
    `Target model: ${targetModel}`,
    `Target context window: ${targetContextWindow} tokens`,
    `Original estimate: ${estimatedOriginalTokens} tokens`,
    `Compressed older messages: ${compressed.length}`,
    `Retained recent messages: ${retained.length}`,
    "",
    "Summary of compressed messages:",
    summarizeForCompression(compressed, summaryBudget * 4),
  ].join("\n");
  const summaryMessage: ForkMessageInput = {
    role: "system",
    content: summaryContent,
    model: targetModel,
    isEdited: 0,
    previousContent: null,
    attachmentsJson: null,
    contextSnapshotJson: JSON.stringify({ nexyCompression: metadata }),
    timestamp: compressed[0]?.timestamp ?? now,
    rewritten: true,
  };
  const retainedWithMetadata = retained.map((message) => ({
    ...message,
    contextSnapshotJson: mergeCompressionSnapshot(message.contextSnapshotJson, {
      ...metadata,
      retainedFromCompression: true,
    }),
  }));

  return {
    messages: [summaryMessage, ...retainedWithMetadata],
    compressedCount: compressed.length,
  };
}

function rewriteMessageForTarget(row: MessageExportRow, now: number, sourceConversationId: string): ForkMessageInput {
  const rewrites: string[] = [];
  let role = row.role;
  let content = row.content;
  let attachmentsJson = row.attachments;

  if (row.role === "tool-call") {
    role = "system";
    content = summarizeToolCallMessage(row.content);
    rewrites.push("tool-call-to-system-summary");
  } else if (row.role === "team-activity") {
    role = "system";
    content = summarizeTeamActivity(row.content);
    rewrites.push("team-activity-to-system-summary");
  } else if (!["user", "assistant", "system"].includes(row.role)) {
    role = "system";
    content = `[Portable unsupported-role summary]\nOriginal role: ${row.role}\n\n${row.content}`;
    rewrites.push("unsupported-role-to-system-summary");
  }

  const attachmentSummaries = summarizeAttachments(row.attachments);
  if (attachmentSummaries.length > 0) {
    content = `${content}\n\n[Portable attachment metadata]\n${attachmentSummaries.join("\n")}`;
    attachmentsJson = null;
    rewrites.push("attachments-to-text-metadata");
  }

  return {
    role,
    content,
    model: row.model,
    isEdited: row.is_edited,
    previousContent: row.previous_content,
    attachmentsJson,
    contextSnapshotJson: buildForkContextSnapshot(row, now, sourceConversationId, rewrites),
    timestamp: row.timestamp,
    rewritten: rewrites.length > 0,
  };
}

export function importConversationExport(
  db: Database.Database,
  exported: ConversationExportV1,
  options: ConversationImportOptions = {},
): ConversationImportResult {
  const now = Date.now();
  const targetConversationId = options.targetConversationId ?? null;
  const existingConversation = targetConversationId ? getConversationRow(db, targetConversationId) : null;
  if (targetConversationId && !existingConversation) {
    throw new Error("Target conversation not found");
  }
  const importedIntoExisting = !!existingConversation;
  const conversationId = existingConversation?.id ?? randomUUID();
  const importedTitle = exported.conversation.title?.trim() || "Imported conversation";
  const title = importedIntoExisting
    ? existingConversation.title
    : importedTitle.startsWith("Imported: ") ? importedTitle : `Imported: ${importedTitle}`;
  const existingMaxTimestamp = importedIntoExisting
    ? (db
        .prepare("SELECT MAX(timestamp) AS maxTimestamp FROM messages WHERE conversation_id = ?")
        .get(conversationId) as { maxTimestamp: number | null } | undefined)?.maxTimestamp ?? null
    : null;
  const messages = normalizeImportedMessages(exported, importedIntoExisting, existingMaxTimestamp);

  const transaction = db.transaction(() => {
    if (!importedIntoExisting) {
      const projectId = exported.conversation.project_id
        ? (db.prepare("SELECT id FROM projects WHERE id = ?").get(exported.conversation.project_id) ? exported.conversation.project_id : null)
        : null;
      const agentId = exported.conversation.agent_id
        ? (db.prepare("SELECT id FROM agents WHERE id = ?").get(exported.conversation.agent_id) ? exported.conversation.agent_id : null)
        : null;
      db.prepare(
        "INSERT INTO conversations (id, agent_id, project_id, title, model, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        conversationId,
        agentId,
        projectId,
        title,
        exported.conversation.model ?? null,
        0,
        exported.conversation.created_at ?? now,
        now,
      );
    }

    const insertMessage = db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, model, is_edited, previous_content, attachments, context_snapshot, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const message of messages) {
      insertMessage.run(
        randomUUID(),
        conversationId,
        message.role,
        message.content,
        message.model,
        message.isEdited,
        message.previousContent,
        message.attachmentsJson,
        message.contextSnapshotJson,
        message.timestamp,
      );
    }

    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  });

  transaction();
  const conversation = getConversationRow(db, conversationId);
  if (!conversation) {
    throw new Error("Imported conversation could not be loaded");
  }
  return {
    conversation,
    message_count: messages.length,
    imported_into_existing: importedIntoExisting,
  };
}

export function buildConversationExport(db: Database.Database, conversationId: string): ConversationExportV1 {
  const conversation = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(conversationId) as ConversationRow | undefined;
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const messages = db
    .prepare(
      `SELECT id, conversation_id, role, content, model, is_edited, previous_content,
              timestamp, attachments, context_snapshot
       FROM messages
       WHERE conversation_id = ?
       ORDER BY timestamp ASC`,
    )
    .all(conversationId) as MessageExportRow[];

  return {
    schema: "nexy.conversation.v1",
    exported_at: Date.now(),
    conversation,
    project: getProjectExport(db, conversation.project_id),
    agent: getAgentExport(db, conversation.agent_id),
    messages: messages.map(mapExportMessage),
  };
}

export function buildConversationExportPack(
  db: Database.Database,
  conversationId: string,
  options: ConversationExportPackOptions,
): ConversationExportPack {
  const exported = buildConversationExport(db, conversationId);
  const format = options.format;
  const baseName = slugFileName(exported.conversation.title || "conversation");

  if (format === "json") {
    return {
      format,
      conversation_id: conversationId,
      file_name: `${baseName}.nexy-conversation.json`,
      mime_type: "application/json",
      content: `${JSON.stringify(exported, null, 2)}\n`,
    };
  }

  if (format === "markdown") {
    return {
      format,
      conversation_id: conversationId,
      file_name: `${baseName}.conversation.md`,
      mime_type: "text/markdown",
      content: buildMarkdownTranscript(exported),
    };
  }

  if (format === "context-bundle") {
    return {
      format,
      conversation_id: conversationId,
      file_name: `${baseName}.context-bundle.md`,
      mime_type: "text/markdown",
      content: buildContextBundle(exported),
    };
  }

  throw new Error("Unsupported conversation export pack format");
}

export function forkConversation(
  db: Database.Database,
  conversationId: string,
  options: ConversationForkOptions = {},
): ConversationForkResult {
  const source = getConversationRow(db, conversationId);
  if (!source) {
    throw new Error("Conversation not found");
  }

  const now = Date.now();
  const forkId = randomUUID();
  const targetAgentId = Object.prototype.hasOwnProperty.call(options, "agentId")
    ? (options.agentId ?? null)
    : source.agent_id;
  const requestedModel = Object.prototype.hasOwnProperty.call(options, "model")
    ? (options.model === "default" ? null : options.model ?? null)
    : source.model;
  const targetModel = validateForkTarget(db, targetAgentId, requestedModel);

  const rows = db
    .prepare(
      `SELECT id, conversation_id, role, content, model, is_edited, previous_content,
              timestamp, attachments, context_snapshot
       FROM messages
       WHERE conversation_id = ?
       ORDER BY timestamp ASC`,
    )
    .all(conversationId) as MessageExportRow[];
  const rewrittenForkMessages = rows.map((row) => rewriteMessageForTarget(row, now, conversationId));
  const compressionPlan = maybeCompressForkMessages(db, rewrittenForkMessages, conversationId, targetModel, now);
  const forkMessages = compressionPlan.messages;

  const transaction = db.transaction(() => {
    db.prepare(
      "INSERT INTO conversations (id, agent_id, project_id, title, model, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      forkId,
      targetAgentId,
      source.project_id,
      `Continued: ${source.title}`,
      targetModel,
      0,
      now,
      now,
    );

    const insertMessage = db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, model, is_edited, previous_content, attachments, context_snapshot, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const message of forkMessages) {
      insertMessage.run(
        randomUUID(),
        forkId,
        message.role,
        message.content,
        message.model,
        message.isEdited,
        message.previousContent,
        message.attachmentsJson,
        message.contextSnapshotJson,
        message.timestamp,
      );
    }
  });

  transaction();
  const conversation = getConversationRow(db, forkId);
  if (!conversation) {
    throw new Error("Forked conversation could not be loaded");
  }

  return {
    conversation,
    message_count: forkMessages.length,
    rewritten_message_count: rewrittenForkMessages.filter((message) => message.rewritten).length,
    compressed_message_count: compressionPlan.compressedCount,
  };
}

export function registerConversationHandlers(): void {
  const db = getDatabase();
  const ensureConversationModelColumn = () => {
    const columns = db
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "model")) {
      db.exec("ALTER TABLE conversations ADD COLUMN model TEXT");
    }
  };

  safeHandle("conversation:list", () => {
    return db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all();
  });

  safeHandle(
    "conversation:create",
    (_event, agentId?: string, projectId?: string) => {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        "INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, agentId ?? null, projectId ?? null, "New Chat", now, now);
      return {
        id,
        agent_id: agentId ?? null,
        project_id: projectId ?? null,
        title: "New Chat",
        created_at: now,
        updated_at: now,
      };
    },
  );

  safeHandle("conversation:compression-preview", (_event, conversationId: string) => {
    return getConversationCompressionPreview(db, conversationId);
  });

  safeHandle("conversation:prepare-compression-summary", (_event, conversationId: string) => {
    return prepareConversationCompressionSummary(db, conversationId);
  });

  safeHandle("conversation:save-compression-summary", (_event, input: ConversationCompressionSaveInput) => {
    return saveConversationCompressionSummary(db, input);
  });

  safeHandle("conversation:delete", (_event, id: string) => {
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return true;
  });

  safeHandle("conversation:export-json", (_event, conversationId: string) => {
    return buildConversationExport(db, conversationId);
  });

  safeHandle("conversation:export-pack", (_event, conversationId: string, options?: ConversationExportPackOptions) => {
    return buildConversationExportPack(db, conversationId, options ?? { format: "json" });
  });

  safeHandle("conversation:fork", (_event, conversationId: string, options?: ConversationForkOptions) => {
    return forkConversation(db, conversationId, options);
  });

  safeHandle("conversation:import-json", async (_event, options?: ConversationImportOptions) => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: "Import conversation",
      properties: ["openFile"],
      filters: [
        { name: "Nexy conversation", extensions: ["json"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const raw = readFileSync(result.filePaths[0], "utf-8");
    const exported = parseConversationExport(JSON.parse(raw));
    return importConversationExport(db, exported, options);
  });

  safeHandle("conversation:get-messages", (_event, conversationId: string) => {
    return db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
      )
      .all(conversationId);
  });

  safeHandle("conversation:search", (_event, query: string) => {
    if (!query.trim()) {
      return db
        .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
        .all();
    }
    const searchTerm = `%${query}%`;
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ?
         ORDER BY c.updated_at DESC`,
      )
      .all(searchTerm, searchTerm);
  });

  safeHandle("conversation:rename", (_event, id: string, title: string) => {
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
    ).run(title, Date.now(), id);
    return true;
  });

  safeHandle(
    "conversation:set-model",
    (_event, id: string, model: string | null) => {
      ensureConversationModelColumn();
      db.prepare(
        "UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?",
      ).run(model, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "conversation:set-pinned",
    (_event, id: string, pinned: boolean) => {
      db.prepare(
        "UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?",
      ).run(pinned ? 1 : 0, Date.now(), id);
      return true;
    },
  );

  safeHandle(
    "conversation:update-context",
    (
      _event,
      updates: { conversationId: string; projectId?: string | null; agentId?: string | null },
    ) => {
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];

      if (Object.prototype.hasOwnProperty.call(updates, "projectId")) {
        assignments.push("project_id = ?");
        values.push(updates.projectId ?? null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, "agentId")) {
        assignments.push("agent_id = ?");
        values.push(updates.agentId ?? null);
      }
      if (assignments.length === 0) {
        return true;
      }

      assignments.push("updated_at = ?");
      values.push(Date.now());
      values.push(updates.conversationId);
      db.prepare(
        `UPDATE conversations SET ${assignments.join(", ")} WHERE id = ?`,
      ).run(...values);
      return true;
    },
  );
}

export function registerMessageHandlers(): void {
  const db = getDatabase();

  safeHandle("message:delete", (_event, id: string) => {
    db.prepare("DELETE FROM messages WHERE id = ?").run(id);
    return true;
  });

  safeHandle(
    "message:delete-after",
    (_event, conversationId: string, timestamp: number) => {
      db.prepare(
        "DELETE FROM messages WHERE conversation_id = ? AND timestamp >= ?",
      ).run(conversationId, timestamp);
      return true;
    },
  );
}
