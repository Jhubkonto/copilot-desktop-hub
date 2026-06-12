import type {
  ConversationExportAttachment,
  ConversationExportContextRef,
  ConversationExportMessage,
  ConversationExportV1,
} from "../shared/types";

export function slugFileName(value: string): string {
  return value
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    || "conversation";
}

export function formatTimestamp(timestamp: number): string {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "unknown";
}

export function roleLabel(role: string): string {
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

export function buildMarkdownTranscript(exported: ConversationExportV1): string {
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

export function buildContextBundle(exported: ConversationExportV1): string {
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
