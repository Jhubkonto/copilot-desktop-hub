import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { sendCopilotChatMessage, sendCopilotNonStreaming, abortCopilotStream, type CopilotApiError, type ToolDefinition } from "./copilot-api";
import { getAgentConfig } from "./agents";
import { getDatabase } from "./database";
import {
  getProviderForAgent,
  getApiKey,
  sendOpenAIMessage,
  sendAnthropicMessage,
  sendAnthropicWithTools,
  sendAzureMessage,
  getAzureEndpoint,
  abortActiveStream,
  toOpenAICompatibleMessages,
  type MessageContentPart,
  type ProviderMessage,
} from "./providers";
import { safeHandle } from "./safe-handle";
import { runOrchestration, type OrchestratorAgent } from "./orchestrator";
import { parseProjectConfig } from "./project-handlers";
import { listDirectoryEntries } from "./file-handlers";
import { getAvailableMcpTools } from "./mcp";
import { runProviderMcpToolLoop } from './tool-loop'

// Session-scoped cache for directory listings. Keyed by project ID.
// Entries are invalidated when the project's rootDirectory changes.
const dirListingCache = new Map<string, { rootDirectory: string; block: string }>()

/** Clears the directory listing cache — used in tests to isolate test state. */
export function clearDirListingCache(): void {
  dirListingCache.clear()
}

export function registerChatHandlers(): void {
  const db = getDatabase();

  safeHandle(
    "chat:send-message",
    async (
      event,
      conversationId: string,
      content: string,
      options?: {
        attachments?: {
          id: string;
          name: string;
          path: string;
          size: number;
        }[];
        images?: { id: string; name: string; dataUrl: string }[];
        regenerate?: boolean;
        agentId?: string;
        model?: string;
        messageId?: string;
        projectId?: string;
        contextSnapshot?: string;
      },
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return null;

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
          db.prepare(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            conversationId,
            agentId ?? null,
            projectId ?? null,
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
          const projRow = db
            .prepare("SELECT config_json FROM projects WHERE id = ?")
            .get(convProjectId) as { config_json: string | null } | undefined;
          const projCfg = parseProjectConfig(projRow?.config_json ?? null);

          if (projCfg.instructionsEnabled && projCfg.instructions.trim()) {
            let instructions = projCfg.instructions;
            for (const { key, value } of projCfg.variables) {
              instructions = instructions.replaceAll(`{{${key}}}`, value);
            }

            // Apply variable substitution to agent system prompt if already injected
            if (projCfg.variables.length > 0) {
              for (const { key, value } of projCfg.variables) {
                augmentedContent = augmentedContent.replaceAll(
                  `{{${key}}}`,
                  value,
                );
              }
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
      }

      let responseContent: string;

      // Determine which provider to use based on agent config
      let providerName = "copilot";
      let providerModel = "default";
      const agentCfg2 = convRow?.agent_id
        ? getAgentConfig(convRow.agent_id)
        : null;
      const agentModel =
        typeof agentCfg2?.model === "string" ? agentCfg2.model : undefined;
      const conversationModel =
        typeof convRow?.model === "string" ? convRow.model : undefined;
      const selectedModel =
        modelOverride && modelOverride !== "default"
          ? modelOverride
          : conversationModel && conversationModel !== "default"
            ? conversationModel
            : agentModel && agentModel !== "default"
              ? agentModel
              : defaultModel !== "default"
                ? defaultModel
                : undefined;
      if (selectedModel && selectedModel !== "default") {
        const resolved = getProviderForAgent(selectedModel);
        providerName = resolved.provider;
        providerModel = resolved.model;
      }
      const effectiveModelName =
        selectedModel && selectedModel !== "default" ? selectedModel : "gpt-4o";
      const modelIdentityInstruction =
        `Runtime model for this conversation: ${effectiveModelName}. ` +
        "If the user asks which model or language model is running this chat, answer with this exact value.";

      // Try BYOK provider if configured
      const byokKey =
        providerName !== "copilot"
          ? getApiKey(providerName as "openai" | "anthropic")
          : null;

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
              providerHistoryMessages,
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

      if (byokKey && providerName === "openai") {
        try {
          const messages: ProviderMessage[] = [
            { role: "system" as const, content: modelIdentityInstruction },
            ...providerHistoryMessages,
            { role: "user" as const, content: userContent },
          ];
          responseContent = await sendOpenAIMessage(
            conversationId,
            byokKey,
            providerModel,
            messages,
            (chunk) => {
              window.webContents.send("chat:stream-response", chunk);
            },
            generationOptions,
          );
          window.webContents.send("chat:stream-response", null);
        } catch (error) {
          console.error("OpenAI error:", error);
          const msg = `OpenAI API error: ${(error as Error).message}`;
          window.webContents.send("chat:stream-error", {
            type: "api",
            message: msg,
            retryable: true,
          });
          responseContent = msg;
        }
      } else if (byokKey && providerName === "anthropic") {
        try {
          const agentSystemPrompt =
            typeof agentCfg2?.systemPrompt === "string"
              ? agentCfg2.systemPrompt
              : undefined;
          const systemPrompt = agentSystemPrompt
            ? `${agentSystemPrompt}\n\n${modelIdentityInstruction}`
            : modelIdentityInstruction;
          const messages: ProviderMessage[] = [
            { role: "system" as const, content: systemPrompt },
            ...providerHistoryMessages,
            { role: "user" as const, content: userContent },
          ];
          const assignedServerIds = Array.isArray(agentCfg2?.mcpServers)
            ? agentCfg2.mcpServers as string[]
            : [];
          const anthropicMcpTools = assignedServerIds.length > 0
            ? getAvailableMcpTools(assignedServerIds)
            : [];

          if (anthropicMcpTools.length > 0) {
            const toolMap = new Map<string, { serverId: string; toolName: string }>();
            const toolDefs: ToolDefinition[] = anthropicMcpTools.map((t) => {
              const namespacedName = `${t.serverId}__${t.name}`;
              toolMap.set(namespacedName, { serverId: t.serverId, toolName: t.name });
              return {
                type: 'function' as const,
                function: {
                  name: namespacedName,
                  description: t.description ?? t.name,
                  parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
                },
              };
            });
            responseContent = await runProviderMcpToolLoop(
              (msgs, tools, choice) =>
                sendAnthropicWithTools(
                  byokKey,
                  providerModel,
                  msgs,
                  tools ?? [],
                  choice,
                  generationOptions,
                ),
              messages,
              toolDefs,
              toolMap,
              agentId ?? convRow?.agent_id ?? 'default',
              window.webContents,
              (chunk) => window.webContents.send("chat:stream-response", chunk),
            );
            window.webContents.send("chat:stream-response", null);
          } else {
            responseContent = await sendAnthropicMessage(
              conversationId,
              byokKey,
              providerModel,
              messages.slice(1),
              systemPrompt,
              (chunk) => {
                window.webContents.send("chat:stream-response", chunk);
              },
              generationOptions,
            );
            window.webContents.send("chat:stream-response", null);
          }
        } catch (error) {
          console.error("Anthropic error:", error);
          const msg = `Anthropic API error: ${(error as Error).message}`;
          window.webContents.send("chat:stream-error", {
            type: "api",
            message: msg,
            retryable: true,
          });
          responseContent = msg;
        }
      } else if (byokKey && providerName === "azure") {
        try {
          const azureEndpoint = getAzureEndpoint();
          if (!azureEndpoint) throw new Error("Azure endpoint not configured");
          const messages: ProviderMessage[] = [
            { role: "system" as const, content: modelIdentityInstruction },
            ...providerHistoryMessages,
            { role: "user" as const, content: userContent },
          ];
          responseContent = await sendAzureMessage(
            conversationId,
            byokKey,
            azureEndpoint,
            providerModel,
            messages,
            (chunk) => {
              window.webContents.send("chat:stream-response", chunk);
            },
            generationOptions,
          );
          window.webContents.send("chat:stream-response", null);
        } catch (error) {
          console.error("Azure error:", error);
          const msg = `Azure API error: ${(error as Error).message}`;
          window.webContents.send("chat:stream-error", {
            type: "api",
            message: msg,
            retryable: true,
          });
          responseContent = msg;
        }
      } else {
        // Use Copilot API with GitHub OAuth token (OpenAI-compatible, supports vision)
        try {
          const agentSystemPrompt =
            typeof agentCfg2?.systemPrompt === "string"
              ? agentCfg2.systemPrompt
              : undefined;
          const rootDirNote = injectedRootDirectory
            ? `\n\nThe user's project root directory (${injectedRootDirectory}) has been scanned and its file tree is provided in the user message within [Project File Structure] tags. Treat it as real file system data — do NOT say you cannot access the file system.`
            : '';
          const chatMessages: ProviderMessage[] = [];
          chatMessages.push({
            role: "system" as const,
            content: agentSystemPrompt
              ? `${agentSystemPrompt}${rootDirNote}\n\n${modelIdentityInstruction}`
              : `You are GitHub Copilot, an AI programming assistant.${rootDirNote}\n\n${modelIdentityInstruction}`,
          });
          chatMessages.push(...providerHistoryMessages);
          chatMessages.push({ role: "user" as const, content: userContent });

          // Use agent model or default
          const copilotModel =
            selectedModel && selectedModel !== "default"
              ? selectedModel
              : "gpt-4o";

          // Build MCP tool definitions if the agent has servers assigned
          const assignedServerIds = Array.isArray(agentCfg2?.mcpServers) ? agentCfg2.mcpServers as string[] : []
          const mcpTools = assignedServerIds.length > 0 ? getAvailableMcpTools(assignedServerIds) : []

          if (mcpTools.length > 0) {
            // Namespace tool names to avoid cross-server collisions
            const toolMap = new Map<string, { serverId: string; toolName: string }>()
            const toolDefs: ToolDefinition[] = mcpTools.map((t) => {
              const namespacedName = `${t.serverId}__${t.name}`
              toolMap.set(namespacedName, { serverId: t.serverId, toolName: t.name })
              return {
                type: 'function' as const,
                function: {
                  name: namespacedName,
                  description: t.description ?? t.name,
                  parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>
                }
              }
            })
            responseContent = await runProviderMcpToolLoop(
              (msgs, tools, choice) =>
                sendCopilotNonStreaming(
                  toOpenAICompatibleMessages(msgs),
                  tools,
                  copilotModel,
                  generationOptions,
                  choice,
                ),
              chatMessages,
              toolDefs,
              toolMap,
              agentId ?? convRow?.agent_id ?? 'default',
              window.webContents,
              (chunk) => window.webContents.send("chat:stream-response", chunk),
            )
          } else {
            responseContent = await sendCopilotChatMessage(
              window,
              chatMessages,
              (chunk) => {
                window.webContents.send("chat:stream-response", chunk);
              },
              copilotModel,
              generationOptions,
              conversationId,
            );
          }
          window.webContents.send("chat:stream-response", null);
        } catch (error) {
          console.error("Copilot API error:", error);
          const apiErr = error as CopilotApiError;
          const errorType = apiErr.errorType || "network";
          const retryable = apiErr.retryable ?? true;
          const retryAfterSeconds = apiErr.retryAfterSeconds;
          let friendlyMessage: string;
          switch (errorType) {
            case "auth":
              friendlyMessage = "Authentication failed. Please sign in again.";
              break;
            case "model_not_available":
              friendlyMessage =
                "Model not available. Choose a different model and try again.";
              break;
            case "rate_limit":
              friendlyMessage =
                "Rate limited by Copilot API. Please wait a moment and try again.";
              break;
            case "server":
              friendlyMessage =
                "Copilot service is temporarily unavailable. Please try again.";
              break;
            case "empty_response":
              friendlyMessage =
                "Copilot returned an empty response. Please try again.";
              break;
            default:
              friendlyMessage = `Copilot API error: ${(error as Error).message}`;
          }
          const streamErrorPayload: Record<string, unknown> = {
            type: errorType,
            message: friendlyMessage,
            retryable,
          };
          if (retryAfterSeconds !== undefined)
            streamErrorPayload.retryAfterSeconds = retryAfterSeconds;
          window.webContents.send("chat:stream-error", streamErrorPayload);
          responseContent = friendlyMessage;
        }
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
        selectedModel ?? null,
      );

      return { assistantMsgId };
    },
  );

  safeHandle("chat:stop-generation", async (_event, conversationId?: string) => {
    abortActiveStream(conversationId);
    abortCopilotStream(conversationId);
    return true;
  });
}
