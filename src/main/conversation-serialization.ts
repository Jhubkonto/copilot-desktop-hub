import type { ConversationExportV1 } from "../shared/types";
import { isRecord } from "./conversation-types";

export function parseConversationExport(value: unknown): ConversationExportV1 {
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
