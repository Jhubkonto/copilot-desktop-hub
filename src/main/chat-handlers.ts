import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { getAgentConfig } from "./agents";
import { getDatabase } from "./database";
import type { ToolDefinition } from "./provider-types";
import {
  DEFAULT_PROVIDER_MODEL,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  getProviderForAgent,
  getApiKey,
  sendOpenAIMessage,
  sendOpenAIWithTools,
  sendAnthropicMessage,
  sendAnthropicWithTools,
  sendAzureMessage,
  sendAzureWithTools,
  getAzureEndpoint,
  abortActiveStream,
  type MessageContentPart,
  type ProviderMessage,
} from "./providers";
import { safeHandle } from "./safe-handle";
import { runOrchestration, type OrchestratorAgent } from "./orchestrator";
import { parseProjectConfig } from "./project-handlers";
import { listDirectoryEntries } from "./file-handlers";
import { getAvailableMcpTools } from "./mcp";
import { runProviderMcpToolLoop } from './tool-loop'
import { getAdapter } from './cli-adapters/registry'
import { broadcastToMobile } from './ws-server'
import { ClaudeAdapter } from './cli-adapters/claude'
import { retrieveAuthMode } from './auth'
import { getRelevantWikiEntries, formatWikiSection } from './wiki-context'
import { insertWikiEntry } from './wiki-handlers'
import { requestApproval } from './tools'

// Session-scoped cache for directory listings. Keyed by project ID.
// Entries are invalidated when the project's rootDirectory changes.
const dirListingCache = new Map<string, { rootDirectory: string; block: string }>()


/** Clears the directory listing cache — used in tests to isolate test state. */
export function clearDirListingCache(): void {
  dirListingCache.clear()
}

type ChatSendOptions = {
  attachments?: { id: string; name: string; path: string; size: number }[]
  images?: { id: string; name: string; dataUrl: string }[]
  regenerate?: boolean
  agentId?: string
  model?: string
  messageId?: string
  projectId?: string
  contextSnapshot?: string
}

export async function dispatchChatSend(
  window: BrowserWindow,
  conversationId: string,
  content: string,
  options?: ChatSendOptions,
): Promise<{ assistantMsgId: string } | null> {
  const db = getDatabase();

      const sendChunk = (chunk: string) => {
        if (!window.webContents.isDestroyed()) window.webContents.send('chat:stream-response', chunk)
        broadcastToMobile({ event: 'chat:stream-chunk', data: { conversationId, chunk } })
      }
      const sendStreamEnd = () => {
        if (!window.webContents.isDestroyed()) window.webContents.send('chat:stream-response', null)
        broadcastToMobile({ event: 'chat:stream-end', data: { conversationId } })
      }

      const attachments = options?.attachments;
      const pastedImages = options?.images ?? [];
      const regenerate = options?.regenerate === true;
      const agentId = options?.agentId;
      const modelOverride = options?.model;
      const projectId = options?.projectId;
      const contextSnapshot = options?.contextSnapshot ?? null;

      if (!regenerate) {
        // Ensure conversation exists, create if needed
        const convo = db
          .prepare("SELECT id FROM conversations WHERE id = ?")
          .get(conversationId) as { id: string } | undefined;

        if (!convo) {
          const now = Date.now();
          const title =
            content.slice(0, 80) + (content.length > 80 ? "..." : "");
          const validProjectId = projectId
            ? ((db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId) as { id: string } | undefined) ? projectId : null)
            : null;
          db.prepare(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            conversationId,
            agentId ?? null,
            validProjectId,
            title,
            now,
            now,
          );
        }

        // Save user message
        const userMsgId = options?.messageId ?? randomUUID();
        const attachmentsJson =
          attachments && attachments.length > 0
            ? JSON.stringify(attachments)
            : null;
        db.prepare(
          "INSERT INTO messages (id, conversation_id, role, content, attachments, context_snapshot, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          userMsgId,
          conversationId,
          "user",
          content,
          attachmentsJson,
          contextSnapshot,
          Date.now(),
          null,
        );

        // Update conversation title if it's the first message
        const msgCount = db
          .prepare(
            "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?",
          )
          .get(conversationId) as { count: number };
        if (msgCount.count === 1) {
          const title =
            content.slice(0, 80) + (content.length > 80 ? "..." : "");
          db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(
            title,
            conversationId,
          );
        }
      }

      // Update conversation timestamp
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(
        Date.now(),
        conversationId,
      );

      // Persist the selected model on the conversation if not already set
      const requestedModel = options?.model
      if (requestedModel && requestedModel !== "default") {
        db.prepare("UPDATE conversations SET model = ? WHERE id = ? AND (model IS NULL OR model = 'default')").run(
          requestedModel,
          conversationId,
        );
      }

      // Build augmented content with file attachments
      const IMAGE_EXTENSIONS = new Set([
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "bmp",
      ]);
      const IMAGE_MIME: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
      };
      const attachedImages: { id: string; name: string; dataUrl: string }[] = [
        ...pastedImages,
      ];
      let augmentedContent = content;
      if (attachments && attachments.length > 0) {
        let fileContext = "";
        for (const att of attachments) {
          const ext = att.name.split(".").pop()?.toLowerCase() ?? "";
          if (IMAGE_EXTENSIONS.has(ext)) {
            try {
              const buf = readFileSync(att.path);
              const mime = IMAGE_MIME[ext];
              attachedImages.push({
                id: att.id,
                name: att.name,
                dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
              });
            } catch {
              fileContext += `File: ${att.name} (could not read image)\n\n`;
            }
          } else {
            try {
              const fileContent = readFileSync(att.path, "utf-8");
              fileContext += `File: ${att.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`;
            } catch {
              fileContext += `File: ${att.name} (could not read file)\n\n`;
            }
          }
        }
        if (fileContext) augmentedContent = fileContext + content;
      }

      // Look up agent system prompt for this conversation
      const convRow = db
        .prepare("SELECT agent_id, model FROM conversations WHERE id = ?")
        .get(conversationId) as
        | { agent_id: string | null; model: string | null }
        | undefined;
      const settingsRows = db
        .prepare(
          "SELECT key, value FROM settings WHERE key IN ('default_model', 'temperature', 'max_tokens')",
        )
        .all() as Array<{ key: string; value: string }>;
      const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
      const defaultModel = settingsMap.get("default_model") || "default";
      const temperatureSetting = Number.parseFloat(
        settingsMap.get("temperature") ?? "",
      );
      const maxTokensSetting = Number.parseInt(
        settingsMap.get("max_tokens") ?? "",
        10,
      );
      const generationOptions = {
        temperature: Number.isFinite(temperatureSetting)
          ? Math.min(2, Math.max(0, temperatureSetting))
          : 0.7,
        maxTokens: Number.isFinite(maxTokensSetting)
          ? Math.min(16384, Math.max(256, maxTokensSetting))
          : 4096,
      };
      if (convRow?.agent_id) {
        const agentCfg = getAgentConfig(convRow.agent_id);
        if (agentCfg?.systemPrompt) {
          let systemPromptText = agentCfg.systemPrompt as string;

          // Replace {{scratchpad}} with actual scratchpad file content
          if (systemPromptText.includes("{{scratchpad}}")) {
            const scratchpadRow = db
              .prepare(
                "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND file_path LIKE '%-scratchpad.md' LIMIT 1",
              )
              .get(convRow.agent_id) as { file_path: string } | undefined;
            const scratchpadContent =
              scratchpadRow?.file_path && existsSync(scratchpadRow.file_path)
                ? readFileSync(scratchpadRow.file_path, "utf-8")
                : "";
            systemPromptText = systemPromptText.replace(
              /\{\{scratchpad\}\}/g,
              scratchpadContent,
            );
          }

          const memoryBlock = agentCfg.memory
            ? `\n\n## Agent Memory\n${agentCfg.memory}`
            : "";

          // Inject 'always' knowledge files (truncate if > 32 000 chars)
          const knowledgeRows = db
            .prepare(
              "SELECT file_path FROM agent_knowledge_files WHERE agent_id = ? AND inject_mode = 'always' ORDER BY sort_order ASC",
            )
            .all(convRow.agent_id) as { file_path: string }[];
          const knowledgeBlocks: string[] = [];
          for (const kf of knowledgeRows) {
            if (!existsSync(kf.file_path)) continue;
            const raw = readFileSync(kf.file_path, "utf-8");
            const fileName = basename(kf.file_path);
            if (raw.length > 32000) {
              const truncated = raw.split("\n").slice(0, 100).join("\n");
              knowledgeBlocks.push(
                `### ${fileName}\n${truncated}\n\n<!-- [Knowledge file truncated — ${Math.ceil(raw.length / 4)} tokens total] -->`,
              );
            } else {
              knowledgeBlocks.push(`### ${fileName}\n${raw}`);
            }
          }
          const knowledgeBlock =
            knowledgeBlocks.length > 0
              ? `\n\n## Knowledge Files\n${knowledgeBlocks.join("\n\n---\n\n")}`
              : "";

          const toolLines: string[] = [];
          const tc = agentCfg?.tools as {
            fileEdit?: { enabled?: boolean; instructions?: string };
            terminal?: { enabled?: boolean; instructions?: string };
            webFetch?: { enabled?: boolean; instructions?: string };
          } | null;
          if (tc?.fileEdit?.enabled && tc.fileEdit.instructions) {
            toolLines.push(`- **File Edit**: ${tc.fileEdit.instructions}`);
          }
          if (tc?.terminal?.enabled && tc.terminal.instructions) {
            toolLines.push(`- **Terminal**: ${tc.terminal.instructions}`);
          }
          if (tc?.webFetch?.enabled && tc.webFetch.instructions) {
            toolLines.push(`- **Web Fetch**: ${tc.webFetch.instructions}`);
          }
          const mcpOverrides = db
            .prepare(
              "SELECT tool_name, server_id, instructions FROM agent_mcp_tool_overrides WHERE agent_id=? AND enabled=1 AND instructions != ''",
            )
            .all(convRow.agent_id) as {
            tool_name: string;
            server_id: string;
            instructions: string;
          }[];
          for (const o of mcpOverrides) {
            toolLines.push(
              `- **${o.tool_name}** (via ${o.server_id}): ${o.instructions}`,
            );
          }
          const guidelinesBlock =
            toolLines.length > 0
              ? `\n\n## Tool Usage Guidelines\n${toolLines.join("\n")}`
              : "";

          augmentedContent = `[System Instructions]\n${systemPromptText}${memoryBlock}${knowledgeBlock}${guidelinesBlock}\n[/System Instructions]\n\n${augmentedContent}`;
        }
      }

      // ── Project context injection ─────────────────────────────────────────
      let injectedRootDirectory: string | null = null
      let wikiProjectId: string | null = null
      {
        const convProjectId =
          projectId ??
          (
            db
              .prepare("SELECT project_id FROM conversations WHERE id = ?")
              .get(conversationId) as { project_id: string | null } | undefined
          )?.project_id ??
          null;
        if (convProjectId) {
          wikiProjectId = convProjectId
          const projRow = db
            .prepare("SELECT config_json FROM projects WHERE id = ?")
            .get(convProjectId) as { config_json: string | null } | undefined;
          const projCfg = parseProjectConfig(projRow?.config_json ?? null);

          if (projCfg.instructionsEnabled && projCfg.instructions.trim()) {
            let instructions = projCfg.instructions;
            // Static user-defined variables
            for (const { key, value } of projCfg.variables) {
              instructions = instructions.replaceAll(`{{${key}}}`, value);
            }
            // Apply same substitutions to agent system prompt if already injected
            for (const { key, value } of projCfg.variables) {
              augmentedContent = augmentedContent.replaceAll(`{{${key}}}`, value);
            }

            const projectBlock = `[Project Context]\n${instructions}\n[/Project Context]`;
            switch (projCfg.instructionMode) {
              case "prepend":
                augmentedContent = `${projectBlock}\n\n${augmentedContent}`;
                break;
              case "append": {
                // Insert project block between system instructions and user content
                const splitMarker = "\n\n";
                const splitIdx = augmentedContent.indexOf(splitMarker);
                if (splitIdx !== -1) {
                  augmentedContent =
                    augmentedContent.slice(0, splitIdx) +
                    splitMarker +
                    projectBlock +
                    splitMarker +
                    augmentedContent.slice(splitIdx + splitMarker.length);
                } else {
                  augmentedContent = `${augmentedContent}\n\n${projectBlock}`;
                }
                break;
              }
              case "replace":
              case "standalone":
                // Strip agent system instructions, keep only project block + user content
                augmentedContent = `${projectBlock}\n\n${content}`;
                break;
            }
          }

          // Inject directory listing when rootDirectory is configured
          if (projCfg.rootDirectory && existsSync(projCfg.rootDirectory)) {
            injectedRootDirectory = projCfg.rootDirectory
            console.log('[chat] Injecting directory listing for:', projCfg.rootDirectory)
            const cached = dirListingCache.get(convProjectId)
            let structureBlock: string
            if (cached && cached.rootDirectory === projCfg.rootDirectory) {
              structureBlock = cached.block
            } else {
              const entries = listDirectoryEntries(projCfg.rootDirectory, 3, '')
              const lines = entries.map((e) =>
                e.type === 'dir' ? `${e.relativePath}/` : e.relativePath
              )
              structureBlock =
                `[Project File Structure]\n` +
                `The following file tree has already been retrieved from the project root directory (${projCfg.rootDirectory}). ` +
                `Use it to answer questions about the project structure — do NOT say you cannot access the file system.\n` +
                `\`\`\`\n${lines.join('\n')}\n\`\`\`\n` +
                `[/Project File Structure]`
              dirListingCache.set(convProjectId, {
                rootDirectory: projCfg.rootDirectory,
                block: structureBlock,
              })
            }
            augmentedContent = `${structureBlock}\n\n${augmentedContent}`
          } else if (projCfg.rootDirectory) {
            console.log('[chat] rootDirectory set but path not found on disk:', JSON.stringify(projCfg.rootDirectory))
          } else {
            console.log('[chat] No rootDirectory configured for project:', convProjectId)
          }

          // Scope block injection
          const inScopeRules = projCfg.inScope ?? [];
          const outOfScopeRules = projCfg.outOfScope ?? [];
          const milestonesArr = projCfg.milestones ?? [];
          const activeMilestone = milestonesArr.find(
            (m) => m.status === "active",
          );
          if (
            activeMilestone ||
            inScopeRules.length > 0 ||
            outOfScopeRules.length > 0
          ) {
            const scopeLines: string[] = [];
            if (activeMilestone) {
              const desc = activeMilestone.description
                ? ` — ${activeMilestone.description}`
                : "";
              scopeLines.push(
                `Active Milestone: ${activeMilestone.title}${desc}`,
              );
            }
            if (inScopeRules.length > 0) {
              scopeLines.push("In Scope:");
              for (const r of inScopeRules) {
                scopeLines.push(
                  `  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ""}`,
                );
              }
            }
            if (outOfScopeRules.length > 0) {
              scopeLines.push("Out of Scope (do NOT work on these):");
              for (const r of outOfScopeRules) {
                scopeLines.push(
                  `  - ${r.description}${r.pathGlob ? ` (${r.pathGlob})` : ""}`,
                );
              }
            }
            const scopeBlock = `[Project Scope]\n${scopeLines.join("\n")}\n[/Project Scope]`;
            augmentedContent = `${scopeBlock}\n\n${augmentedContent}`;
          }

          // Team awareness block — inject when project has ≥2 agents, regardless of orchestration setting.
          // The orchestrator injects its own richer manifest later; this block covers non-orchestrated chats.
          const projCfgRaw = projRow?.config_json
            ? (() => {
                try {
                  return JSON.parse(projRow.config_json) as Record<
                    string,
                    unknown
                  >;
                } catch {
                  return {};
                }
              })()
            : {};
          const orchAlreadyEnabled = projCfgRaw.orchestrationEnabled === true;
          if (!orchAlreadyEnabled) {
            const teamRows = db
              .prepare(
                "SELECT pa.agent_id, pa.is_primary, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.is_primary DESC, pa.sort_order ASC",
              )
              .all(convProjectId) as {
              agent_id: string;
              is_primary: number;
              config_json: string;
            }[];

            if (teamRows.length >= 2) {
              const projName =
                (
                  db
                    .prepare("SELECT name FROM projects WHERE id = ?")
                    .get(convProjectId) as { name: string } | undefined
                )?.name ?? "this project";
              const memberLines = teamRows.map((r) => {
                const cfg = (() => {
                  try {
                    return JSON.parse(r.config_json) as Record<string, unknown>;
                  } catch {
                    return {};
                  }
                })();
                const name = typeof cfg.name === "string" ? cfg.name : "Agent";
                const icon = typeof cfg.icon === "string" ? cfg.icon : "🤖";
                const role = r.is_primary
                  ? " (primary — currently speaking)"
                  : "";
                return `  - ${icon} ${name}${role}`;
              });
              const teamBlock =
                `[Project Team — "${projName}"]\n` +
                `This conversation is part of a project with the following agents:\n` +
                memberLines.join("\n") +
                "\n" +
                `Orchestration is currently disabled, so you cannot autonomously delegate tasks.\n` +
                `If asked about delegation or other agents, be honest: the user can switch agents manually\n` +
                `or enable orchestration in the project settings to allow automatic delegation.\n` +
                `[/Project Team]`;
              augmentedContent = `${teamBlock}\n\n${augmentedContent}`;
            }
          }
        }

        // Auto-inject relevant wiki entries on the first message
        const wikiMsgCount = db
          .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?")
          .get(conversationId) as { count: number }
        if (wikiMsgCount.count === 1 && convProjectId) {
          const wikiEntries = getRelevantWikiEntries(db, convProjectId, content)
          if (wikiEntries.length > 0) {
            const wikiBlock = formatWikiSection(wikiEntries)
            augmentedContent = `${wikiBlock}\n\n${augmentedContent}`
            if (!window.webContents.isDestroyed()) {
              window.webContents.send('chat:wiki-injected', { count: wikiEntries.length })
            }
          }
        }
      }

      let responseContent: string;

      // Determine which provider to use based on the selected or default model
      const agentCfg2 = convRow?.agent_id
        ? getAgentConfig(convRow.agent_id)
        : null;
      const agenticMode = agentCfg2?.agenticMode === true
      const conversationModel =
        typeof convRow?.model === "string" ? convRow.model : undefined;
      const selectedModel =
        modelOverride && modelOverride !== "default"
          ? modelOverride
          : conversationModel && conversationModel !== "default"
            ? conversationModel
            : defaultModel !== "default"
              ? defaultModel
              : DEFAULT_PROVIDER_MODEL;
      const { provider: providerName, model: providerModel } = getProviderForAgent(selectedModel);
      const effectiveModelName = selectedModel;
      const modelIdentityInstruction =
        `Runtime model for this conversation: ${effectiveModelName}. ` +
        "If the user asks which model or language model is running this chat, answer with this exact value.";

      // ── Wiki tools: available for all project conversations ──
      type InlineHandler = (args: Record<string, unknown>) => Promise<{ success: boolean; result?: string; error?: string }>
      const wikiInlineHandlers = new Map<string, InlineHandler>()
      const wikiToolDefs: ToolDefinition[] = []
      if (wikiProjectId) {
        wikiToolDefs.push(
          {
            type: 'function' as const,
            function: {
              name: 'search_project_wiki',
              description: 'Search the project wiki for relevant knowledge, decisions, procedures, or facts. Use this when the user asks about project-specific information that may have been documented.',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Keywords or question to search for in the project wiki' }
                },
                required: ['query']
              }
            }
          },
          {
            type: 'function' as const,
            function: {
              name: 'create_wiki_entry',
              description: 'Save a new entry to the project wiki. Use this to preserve important facts, decisions, or procedures. Always requires explicit user approval before saving.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Short descriptive title for the wiki entry' },
                  body: { type: 'string', description: 'Full content of the wiki entry in markdown' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to categorize the entry' }
                },
                required: ['title', 'body']
              }
            }
          }
        )

        const capturedProjectId = wikiProjectId
        const capturedDb = db
        const capturedWebContents = window.webContents

        wikiInlineHandlers.set('search_project_wiki', async (args) => {
          const query = typeof args.query === 'string' ? args.query : String(args.query ?? '')
          const entries = getRelevantWikiEntries(capturedDb, capturedProjectId, query)
          if (entries.length === 0) return { success: true, result: 'No relevant wiki entries found for this query.' }
          return { success: true, result: formatWikiSection(entries) }
        })

        wikiInlineHandlers.set('create_wiki_entry', async (args) => {
          if (capturedWebContents.isDestroyed()) return { success: false, error: 'Window closed — cannot request approval' }
          const approved = await requestApproval(
            capturedWebContents,
            'create_wiki_entry',
            args,
            `Save wiki entry: "${args.title}"`,
            { noRemember: true }
          )
          if (!approved) return { success: false, error: 'User declined wiki entry creation' }
          const title = typeof args.title === 'string' ? args.title : String(args.title ?? '')
          const body = typeof args.body === 'string' ? args.body : String(args.body ?? '')
          const tags = Array.isArray(args.tags) ? (args.tags as string[]).map(String) : []
          insertWikiEntry(capturedDb, capturedProjectId, title, body, tags, { conversationId })
          return { success: true, result: `Wiki entry "${title}" saved to the project wiki.` }
        })
      }

      const byokKey = getApiKey(providerName);

      // Build conversation history from DB
      const historyRows = db
        .prepare(
          "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
        )
        .all(conversationId) as { role: string; content: string }[];

      // Build messages array with history (exclude the just-saved user message for augmented content)
      const historyMessages = historyRows.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const providerHistoryMessages = historyMessages.filter(
        (m) => m.role !== "team-activity",
      ) as ProviderMessage[];

      // On regeneration, historyRows.slice(0,-1) ends with the current user message
      // (it excluded the old assistant response). Appending userContent again would send
      // two consecutive user messages and cause a 400 from the provider.
      // Strip the trailing user message from context so we can re-append it with
      // any vision-enhanced content below.
      const contextMessages: ProviderMessage[] =
        regenerate && providerHistoryMessages.length > 0
          ? providerHistoryMessages.slice(0, -1)
          : providerHistoryMessages;

      // Build the current user message content — include pasted images for vision-capable providers
      const buildVisionUserContent = (): MessageContentPart[] => {
        const parts: MessageContentPart[] = [
          { type: "text", text: augmentedContent },
        ];
        for (const img of attachedImages) {
          parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
        }
        return parts;
      };

      const userContent: ProviderMessage["content"] =
        attachedImages.length > 0 ? buildVisionUserContent() : augmentedContent;

      // ── Multi-agent orchestration ──────────────────────────────
      // Trigger when the conversation belongs to a project with orchestration
      // enabled, a primary agent, and ≥2 total agents.
      const orchProjectId =
        (projectId ?? convRow)
          ? (db
              .prepare("SELECT project_id FROM conversations WHERE id = ?")
              .get(conversationId) as { project_id: string | null } | undefined)
          : undefined;
      const orchProjId =
        projectId ??
        (orchProjectId as { project_id?: string | null } | undefined)
          ?.project_id ??
        null;

      if (orchProjId) {
        const projRow = db
          .prepare("SELECT name, config_json FROM projects WHERE id = ?")
          .get(orchProjId) as
          | { name: string; config_json: string | null }
          | undefined;
        const projConfig = projRow?.config_json
          ? (() => {
              try {
                return JSON.parse(projRow.config_json) as Record<
                  string,
                  unknown
                >;
              } catch {
                return {};
              }
            })()
          : {};
        const orchEnabled = projConfig.orchestrationEnabled === true;

        if (orchEnabled) {
          const agentRows = db
            .prepare(
              "SELECT pa.agent_id, pa.is_primary, pa.sort_order, a.config_json FROM project_agents pa JOIN agents a ON pa.agent_id = a.id WHERE pa.project_id = ? ORDER BY pa.sort_order ASC",
            )
            .all(orchProjId) as {
            agent_id: string;
            is_primary: number;
            sort_order: number;
            config_json: string;
          }[];

          const primaryRow = agentRows.find((r) => r.is_primary === 1);

          if (primaryRow && agentRows.length >= 2) {
            const teamAgents: OrchestratorAgent[] = agentRows.map((r) => {
              const cfg = (() => {
                try {
                  return JSON.parse(r.config_json) as Record<string, unknown>;
                } catch {
                  return {};
                }
              })();
              return {
                agentId: r.agent_id,
                agentName: typeof cfg.name === "string" ? cfg.name : "Agent",
                agentIcon: typeof cfg.icon === "string" ? cfg.icon : "🤖",
                isPrimary: r.is_primary === 1,
                sortOrder: r.sort_order,
              };
            });

            const maxDepth =
              typeof projConfig.maxDelegationDepth === "number"
                ? projConfig.maxDelegationDepth
                : 5;
            const showActivity = projConfig.showTeamActivity !== false;

            const { finalContent, teamActivity } = await runOrchestration(
              {
                projectId: orchProjId,
                projectName: projRow?.name ?? "Project",
                leaderAgentId: primaryRow.agent_id,
                teamAgents,
                conversationId,
                window,
                selectedModel: selectedModel ?? "default",
                generationOptions,
                maxDelegationDepth: maxDepth,
                showActivity,
              },
              userContent,
              contextMessages,
            );

            // Persist team-activity block if there were delegation steps
            if (showActivity && teamActivity.length > 0) {
              const activityMsgId = randomUUID();
              db.prepare(
                "INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)",
              ).run(
                activityMsgId,
                conversationId,
                "team-activity",
                JSON.stringify({ steps: teamActivity }),
                null,
                Date.now() - 1,
                selectedModel ?? null,
              );
            }

            // Audit log: write each delegation step to agent_delegations
            if (teamActivity.length > 0) {
              const insertDelegation = db.prepare(
                "INSERT INTO agent_delegations (id, conversation_id, leader_agent_id, specialist_agent_id, task, result, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
              );
              for (const step of teamActivity) {
                insertDelegation.run(
                  step.stepId,
                  conversationId,
                  primaryRow.agent_id,
                  step.agentId,
                  step.task,
                  step.result ?? null,
                  step.status === 'error' ? 'error' : 'done',
                  step.durationMs ?? null,
                  Date.now()
                );
              }
            }

            responseContent = finalContent;
            const assistantMsgId = randomUUID();
            db.prepare(
              "INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ).run(
              assistantMsgId,
              conversationId,
              "assistant",
              responseContent,
              null,
              Date.now(),
              selectedModel ?? null,
            );
            return { assistantMsgId };
          }
        }
      }
      // ── End orchestration ─────────────────────────────────────────────────

      const agentBackend = typeof agentCfg2?.backend === 'string' ? agentCfg2.backend : undefined
      // Fall back to Claude CLI when no agent backend is set, no BYOK key is configured, and CLI is available
      const effectiveBackend = agentBackend ?? (retrieveAuthMode() === 'none' && ClaudeAdapter.isAvailable() ? 'claude-cli' : undefined)
      if (effectiveBackend) {
        const adapter = getAdapter(effectiveBackend)
        if (adapter?.isAvailable()) {
          const cliSystemPrompt =
            typeof agentCfg2?.systemPrompt === 'string' && agentCfg2.systemPrompt.trim().length > 0
              ? `${agentCfg2.systemPrompt}\n\n${modelIdentityInstruction}`
              : modelIdentityInstruction

          try {
            if (!window.webContents.isDestroyed()) {
              window.webContents.send('chat:stream-model', effectiveBackend)
            }

            // Accumulate tool calls for CA.12 persistence
            type PendingTool = { name: string; input: Record<string, unknown>; startTime: number }
            const pendingTools = new Map<string, PendingTool>()
            const completedToolCalls: Array<PendingTool & { id: string; content: string; isError: boolean }> = []

            responseContent = await adapter.send(window, {
              systemPrompt: cliSystemPrompt,
              messages: [...contextMessages, { role: 'user' as const, content: augmentedContent }],
              images: attachedImages.length > 0 ? attachedImages : undefined,
              cwd: process.cwd(),
              model: (typeof agentCfg2?.cliModel === 'string' ? agentCfg2.cliModel : '') as string,
              conversationId,
            }, sendChunk, (event) => {
              if (window.webContents.isDestroyed()) return
              if (event.type === 'tool_start') {
                pendingTools.set(event.id, { name: event.name, input: event.input, startTime: Date.now() })
                window.webContents.send('chat:cli-tool-start', { id: event.id, name: event.name, input: event.input })
              } else if (event.type === 'tool_end') {
                const pending = pendingTools.get(event.id)
                if (pending) {
                  completedToolCalls.push({ id: event.id, ...pending, content: event.content, isError: event.isError })
                  pendingTools.delete(event.id)
                }
                window.webContents.send('chat:cli-tool-end', { id: event.id, content: event.content, isError: event.isError })
              } else if (event.type === 'cost') {
                window.webContents.send('chat:cli-cost', {
                  totalCostUsd: event.totalCostUsd,
                  inputTokens: event.inputTokens,
                  outputTokens: event.outputTokens,
                })
              }
            })

            // Persist completed tool calls so they survive conversation reload
            for (const tc of completedToolCalls) {
              db.prepare(
                "INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)"
              ).run(
                randomUUID(),
                conversationId,
                'tool-call',
                JSON.stringify({
                  __type: 'tool-call',
                  toolName: tc.name,
                  serverName: effectiveBackend,
                  toolArgs: tc.input,
                  toolResult: tc.content,
                  toolSuccess: !tc.isError,
                }),
                null,
                tc.startTime,
                effectiveBackend,
              )
            }

            const assistantMsgId = randomUUID()
            db.prepare(
              "INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(
              assistantMsgId,
              conversationId,
              'assistant',
              responseContent,
              null,
              Date.now(),
              agentBackend,
            )

            sendStreamEnd()

            return { assistantMsgId }
          } catch (err) {
            console.error(`[cli-adapter] ${agentBackend} failed:`, err)
          }
        }
      }

      let capturedStreamModel: string | null = null
      const handleStreamModel = (m: string) => {
        capturedStreamModel = m
        if (!window.webContents.isDestroyed()) {
          window.webContents.send('chat:stream-model', m)
        }
      }

      try {
        const agentSystemPrompt =
          typeof agentCfg2?.systemPrompt === "string"
            ? agentCfg2.systemPrompt
            : undefined;
        const rootDirNote = injectedRootDirectory
          ? `\n\nThe user's project root directory (${injectedRootDirectory}) has been scanned and its file tree is provided in the user message within [Project File Structure] tags. Treat it as real file system data — do NOT say you cannot access the file system.`
          : "";
        const systemPrompt = agentSystemPrompt
          ? `${agentSystemPrompt}${rootDirNote}\n\n${modelIdentityInstruction}`
          : `You are an AI programming assistant.${rootDirNote}\n\n${modelIdentityInstruction}`;
        const chatMessages: ProviderMessage[] = [
          { role: "system" as const, content: systemPrompt },
          ...contextMessages,
          { role: "user" as const, content: userContent },
        ];
        const assignedServerIds = Array.isArray(agentCfg2?.mcpServers)
          ? agentCfg2.mcpServers as string[]
          : [];
        const mcpTools = assignedServerIds.length > 0
          ? getAvailableMcpTools(assignedServerIds)
          : [];
        const toolMap = new Map<string, { serverId: string; toolName: string }>();
        const toolDefs: ToolDefinition[] = mcpTools.map((t) => {
          const namespacedName = `${t.serverId}__${t.name}`;
          toolMap.set(namespacedName, { serverId: t.serverId, toolName: t.name });
          return {
            type: "function" as const,
            function: {
              name: namespacedName,
              description: t.description ?? t.name,
              parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
            },
          };
        });
        toolDefs.push(...wikiToolDefs);

        const hasToolLoop = toolDefs.length > 0;
        const hasMcpTools = mcpTools.length > 0;
        const hasWikiTools = wikiToolDefs.length > 0;
        const browserDirective = hasMcpTools
          ? `You have browser automation tools available: ${mcpTools.map((t) => t.name).join(", ")}. ` +
            "CRITICAL: Only use these tools when the user's request explicitly requires interacting with a web browser or web page. " +
            'For conversational questions, general knowledge, or anything that does not require a browser, respond directly WITHOUT calling any tools. ' +
            'When a browser task IS required, call the tools immediately and completely — do NOT say you "will" do something, just do it. ' +
            'After any inspection step (e.g. browser_snapshot), take the next required action immediately — do NOT narrate your findings before acting. ' +
            'Continue calling tools until the task is fully finished, then give a brief summary.'
          : "";
        const wikiDirective = hasWikiTools
          ? 'You have access to the project wiki tools: search_project_wiki and create_wiki_entry. ' +
            'Use search_project_wiki when the user asks about project-specific knowledge, decisions, or procedures. ' +
            'Use create_wiki_entry only when the user explicitly asks to save something to the wiki — it always requires user approval. ' +
            'For all other questions, respond directly without calling any tools.'
          : "";
        const toolDirective = [browserDirective, wikiDirective].filter(Boolean).join("\n\n");

        if (!byokKey) {
          throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE);
        }

        if (providerName === "anthropic") {
          if (hasToolLoop) {
            responseContent = await runProviderMcpToolLoop(
              (msgs, tools, choice) =>
                sendAnthropicWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions),
              chatMessages,
              toolDefs,
              toolMap,
              agentId ?? convRow?.agent_id ?? "default",
              window.webContents,
              sendChunk,
              undefined,
              agenticMode,
              wikiInlineHandlers.size > 0 ? wikiInlineHandlers : undefined,
              toolDirective,
            );
          } else {
            responseContent = await sendAnthropicMessage(
              conversationId,
              byokKey,
              providerModel,
              chatMessages.slice(1),
              systemPrompt,
              sendChunk,
              generationOptions,
            );
          }
        } else if (providerName === "openai") {
          if (hasToolLoop) {
            responseContent = await runProviderMcpToolLoop(
              (msgs, tools, choice) =>
                sendOpenAIWithTools(byokKey, providerModel, msgs, tools ?? [], choice, generationOptions),
              chatMessages,
              toolDefs,
              toolMap,
              agentId ?? convRow?.agent_id ?? "default",
              window.webContents,
              sendChunk,
              handleStreamModel,
              agenticMode,
              wikiInlineHandlers.size > 0 ? wikiInlineHandlers : undefined,
              toolDirective,
            );
          } else {
            responseContent = await sendOpenAIMessage(
              conversationId,
              byokKey,
              providerModel,
              chatMessages,
              sendChunk,
              generationOptions,
            );
          }
        } else {
          const azureEndpoint = getAzureEndpoint();
          if (!azureEndpoint) {
            throw new Error("Azure endpoint not configured");
          }
          if (hasToolLoop) {
            responseContent = await runProviderMcpToolLoop(
              (msgs, tools, choice) =>
                sendAzureWithTools(byokKey, azureEndpoint, providerModel, msgs, tools ?? [], choice, generationOptions),
              chatMessages,
              toolDefs,
              toolMap,
              agentId ?? convRow?.agent_id ?? "default",
              window.webContents,
              sendChunk,
              handleStreamModel,
              agenticMode,
              wikiInlineHandlers.size > 0 ? wikiInlineHandlers : undefined,
              toolDirective,
            );
          } else {
            responseContent = await sendAzureMessage(
              conversationId,
              byokKey,
              azureEndpoint,
              providerModel,
              chatMessages,
              sendChunk,
              generationOptions,
            );
          }
        }

        sendStreamEnd();
      } catch (error) {
        console.error(`${providerName} error:`, error);
        const message = error instanceof Error ? error.message : "Unexpected provider error";
        window.webContents.send("chat:stream-error", {
          type: "api",
          message,
          retryable: message !== NO_PROVIDER_CONFIGURED_MESSAGE && message !== "Azure endpoint not configured",
        });
        responseContent = message;
      }

      // Save assistant message
      const assistantMsgId = randomUUID();
      db.prepare(
        "INSERT INTO messages (id, conversation_id, role, content, attachments, timestamp, model) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        assistantMsgId,
        conversationId,
        "assistant",
        responseContent,
        null,
        Date.now(),
        capturedStreamModel ?? selectedModel ?? null,
      );

  return { assistantMsgId };
}

export function registerChatHandlers(): void {
  safeHandle(
    "chat:send-message",
    async (event, conversationId: string, content: string, options?: ChatSendOptions) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return null;
      return dispatchChatSend(window, conversationId, content, options);
    },
  );

  safeHandle("chat:stop-generation", async (_event, conversationId?: string) => {
    abortActiveStream(conversationId);
    return true;
  });
}
