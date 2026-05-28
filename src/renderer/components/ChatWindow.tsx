import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import {
  Paperclip,
  Square,
  SendHorizontal,
  X,
  Eye,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ContextInspector, type ContextSnapshot } from "./ContextInspector";
import { TeamActivityBlock, type TeamActivityStep } from "./TeamActivityBlock";
import { useAppStore } from "../store/app-store";
import {
  executeSlashCommand,
  transformCodeSlashCommand,
  SLASH_COMMANDS,
  type SlashCommandContext,
} from "../slash-commands";
import {
  MODEL_OPTIONS,
  getModelLabel,
  getModelMultiplier,
} from "../../shared/models";

type ToastType = "info" | "success" | "error";

interface Attachment {
  id: string;
  name: string;
  path: string;
  size: number;
}

interface PastedImage {
  id: string;
  dataUrl: string;
  name: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "team-activity";
  content: string;
  timestamp: number;
  model?: string | null;
  attachments?: Attachment[];
  images?: PastedImage[];
  isEdited?: boolean;
  isError?: boolean;
  errorType?: string;
  retryable?: boolean;
  isStopped?: boolean;
  contextSnapshot?: string;
}

interface ContextRef {
  key: "workspace" | "git" | "file";
  token: string;
  value?: string;
}

function hasIpcError(result: unknown): result is { error: string } {
  return typeof result === "object" && result !== null && "error" in result;
}

const AT_CONTEXT_OPTIONS = [
  {
    token: "@workspace",
    key: "workspace",
    description: "Attach workspace summary",
  },
  {
    token: "@git",
    key: "git",
    description: "Attach git branch, status, recent commits",
  },
  {
    token: "@file:",
    key: "file",
    description: "Attach file by path (example: @file:src/main.ts)",
  },
] as const;

export function ChatWindow() {
  const conversationId = useAppStore((s) => s.currentConversationId);
  const activeAgentId = useAppStore((s) => s.activeAgentId);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const projects = useAppStore((s) => s.projects);
  const agents = useAppStore((s) => s.agents);
  const conversations = useAppStore((s) => s.conversations);
  const authenticated = useAppStore((s) => s.authState.authenticated);
  const theme = useAppStore((s) => s.theme);
  const projectAgents = useAppStore((s) => s.projectAgents);

  const conversationCreated = useAppStore((s) => s.conversationCreated);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const loadAgents = useAppStore((s) => s.loadAgents);
  const newChat = useAppStore((s) => s.newChat);
  const setTheme = useAppStore((s) => s.setTheme);
  const login = useAppStore((s) => s.login);
  const logout = useAppStore((s) => s.logout);
  const addToast = useAppStore((s) => s.addToast) as (
    message: string,
    type?: ToastType,
  ) => void;

  const activeAgent = activeAgentId
    ? (agents.find((a) => a.id === activeAgentId) ?? null)
    : null;
  const currentConversation = conversationId
    ? (conversations.find((c) => c.id === conversationId) ?? null)
    : null;
  const [defaultModelSetting, setDefaultModelSetting] = useState("default");
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const conversationModel = currentConversation?.model ?? null;
  const projectId = currentConversation?.project_id ?? activeProjectId;
  const currentProject = projectId
    ? (projects.find((p) => p.id === projectId) ?? null)
    : null;
  const projectDefaultModel = currentProject?.default_model ?? null;
  // pendingModel: holds a model selection made before the first message is sent
  const effectiveModel =
    pendingModel ||
    conversationModel ||
    activeAgent?.model ||
    projectDefaultModel ||
    defaultModelSetting ||
    "default";
  const effectiveModelLabel = getModelLabel(effectiveModel);

  // Resolve the agent to display in the context bar:
  // prefer the explicitly-active agent, else the project's primary agent
  const primaryProjectAgent = projectId
    ? ((projectAgents[projectId] ?? []).find((pa) => pa.isPrimary) ?? null)
    : null;
  const displayAgent =
    activeAgent ??
    (primaryProjectAgent
      ? (agents.find((a) => a.id === primaryProjectAgent.agentId) ?? null)
      : null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(
    null,
  );
  const [generationElapsedSec, setGenerationElapsedSec] = useState(0);
  const [rateLimitRemainingSec, setRateLimitRemainingSec] = useState(0);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>(
    [],
  );
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([]);
  const [showContextInspector, setShowContextInspector] = useState(false);
  const [liveTeamActivity, setLiveTeamActivity] = useState<TeamActivityStep[]>(
    [],
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atFilter, setAtFilter] = useState("");
  const [selectedAtIndex, setSelectedAtIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLSelectElement>(null);
  const activeConversationRef = useRef<string | null>(conversationId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingContentRef = useRef("");
  const lastUndoneUserMessageRef = useRef<string | null>(null);
  const pendingEditedResendRef = useRef(false);
  const streamModelRef = useRef<string | null>(null);
  // Prevents the conversationId useEffect from resetting isGenerating when we
  // just created a new conversation via handleSend (not a user-initiated switch)
  const justCreatedConversationRef = useRef(false);
  // Resizable input panel — null means "auto" (rows=1 natural height)
  const [inputPanelHeight, setInputPanelHeight] = useState<number | null>(null);
  const inputPanelResizeRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);

  // Auto-resize textarea to fit content, respecting the drag-handle floor
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const floor = inputPanelHeight ?? 0;
    el.style.height = Math.min(Math.max(floor, el.scrollHeight), 400) + "px";
  }, [input, inputPanelHeight]);
  // Input history (like a CLI — Alt+Up/Down to cycle)
  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1); // -1 = live input (not browsing history)
  const historyDraftRef = useRef(""); // saves current draft when entering history mode
  const contextRefs = useMemo(() => {
    const refs: ContextRef[] = [];
    const regex = /(?:^|\s)@(workspace|git)\b|(?:^|\s)@file:([^\s]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      if (match[1]) {
        const key = match[1].toLowerCase() as "workspace" | "git";
        refs.push({ key, token: `@${key}` });
      } else if (match[2]) {
        refs.push({ key: "file", token: `@file:${match[2]}`, value: match[2] });
      }
    }
    return refs;
  }, [input]);

  useEffect(() => {
    activeConversationRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    window.api
      .getSetting("default_model")
      .then((value) =>
        setDefaultModelSetting(typeof value === "string" ? value : "default"),
      )
      .catch(() => setDefaultModelSetting("default"));
  }, [conversationId]);

  // Track connectivity
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    // If we just created this conversation via handleSend, don't reset the
    // generating state or messages — the stream is already in flight.
    if (justCreatedConversationRef.current) {
      justCreatedConversationRef.current = false;
      return;
    }
    if (conversationId) {
      setIsLoadingMessages(true);
      window.api
        .getMessages(conversationId)
        .then(
          (
            msgs: Array<{
              id: string;
              role: string;
              content: string;
              timestamp: number;
              model?: string | null;
              is_edited?: number;
              attachments?: string;
              context_snapshot?: string | null;
            }>,
          ) => {
            setMessages((prev) => {
              const imageMap = new Map(
                prev.filter((m) => m.images).map((m) => [m.id, m.images!]),
              );
              return msgs.map((m) => ({
                id: m.id,
                role: m.role as
                  | "user"
                  | "assistant"
                  | "system"
                  | "team-activity",
                content: m.content,
                timestamp: m.timestamp,
                model: m.model ?? null,
                isEdited: m.is_edited === 1,
                attachments: m.attachments
                  ? JSON.parse(m.attachments)
                  : undefined,
                images: imageMap.get(m.id),
                contextSnapshot: m.context_snapshot ?? undefined,
              }));
            });
          },
        )
        .catch(() => {
          addToast("Failed to load messages", "error");
          setMessages([]);
        })
        .finally(() => {
          setIsLoadingMessages(false);
        });
    } else {
      setMessages([]);
      setIsLoadingMessages(false);
    }
    setStreamingContent("");
    streamingContentRef.current = "";
    setIsGenerating(false);
    setGenerationStartedAt(null);
    setGenerationElapsedSec(0);
    setLiveTeamActivity([]);
    setPendingModel(null);
  }, [conversationId, addToast]);

  // Subscribe to streaming responses
  useEffect(() => {
    const unsubscribe = window.api.onStreamResponse((chunk: string | null) => {
      if (chunk === null) {
        const finalContent = streamingContentRef.current;
        if (finalContent) {
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: finalContent,
            timestamp: Date.now(),
            model: streamModelRef.current,
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
        streamingContentRef.current = "";
        streamModelRef.current = null;
        setStreamingContent("");
        setIsGenerating(false);
        setLoadingFailed(false);
        setGenerationStartedAt(null);
        setGenerationElapsedSec(0);
        setLiveTeamActivity([]);
        loadConversations();
      } else {
        streamingContentRef.current += chunk;
        setStreamingContent((prev) => prev + chunk);
      }
    });

    const unsubscribeError = window.api.onStreamError(
      (error: {
        type: string;
        message: string;
        retryable: boolean;
        retryAfterSeconds?: number;
      }) => {
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error.message,
          timestamp: Date.now(),
          isError: true,
          errorType: error.type,
          retryable: error.retryable,
        };
        streamingContentRef.current = "";
        streamModelRef.current = null;
        setStreamingContent("");
        setIsGenerating(false);
        setLoadingFailed(true);
        setGenerationStartedAt(null);
        setGenerationElapsedSec(0);
        if (error.type === "rate_limit") {
          const waitSeconds =
            typeof error.retryAfterSeconds === "number" &&
            error.retryAfterSeconds > 0
              ? error.retryAfterSeconds
              : 15;
          setRateLimitRemainingSec(waitSeconds);
        }
        setMessages((prev) => [...prev, errorMessage]);
        loadConversations();
      },
    );

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [loadConversations]);

  // Subscribe to live team-activity delegation events
  useEffect(() => {
    const unsub = window.api.onTeamActivity((step) => {
      setLiveTeamActivity((prev) => {
        const existing = prev.findIndex((s) => s.stepId === step.stepId);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = step;
          return next;
        }
        return [...prev, step];
      });
    });
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (!isGenerating || !generationStartedAt) return;
    const id = window.setInterval(() => {
      setGenerationElapsedSec(
        Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)),
      );
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [isGenerating, generationStartedAt]);

  useEffect(() => {
    if (rateLimitRemainingSec <= 0) return;
    const id = window.setInterval(() => {
      setRateLimitRemainingSec((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [rateLimitRemainingSec]);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const handleRegenerate = useCallback(
    async (modelOverride?: string) => {
      if (!conversationId || messages.length < 2 || isGenerating) return;

      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role !== "assistant") return;

      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;

      // Remove last assistant message from state
      setMessages((prev) => prev.slice(0, -1));

      // Delete from DB
      await window.api.deleteMessage(lastMsg.id);

      // Re-send the user message
      setIsGenerating(true);
      setGenerationStartedAt(Date.now());
      setGenerationElapsedSec(0);
      setStreamingContent("");
      streamingContentRef.current = "";
      streamModelRef.current =
        effectiveModel === "default" ? null : effectiveModel;
      const requestModel =
        effectiveModel === "default" ? undefined : effectiveModel;
      streamModelRef.current = requestModel ?? null;
      const regenModel =
        modelOverride ?? (effectiveModel === "default" ? null : effectiveModel);
      streamModelRef.current = regenModel;

      try {
        if (modelOverride) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Regenerating with ${getModelLabel(modelOverride)}.`,
              timestamp: Date.now(),
            },
          ]);
        }
        const regenOptions: {
          regenerate: true;
          model?: string;
          images?: { id: string; name: string; dataUrl: string }[];
          attachments?: {
            id: string;
            name: string;
            path: string;
            size: number;
          }[];
        } = { regenerate: true };
        if (regenModel) regenOptions.model = String(regenModel);
        if (lastUser.images && lastUser.images.length > 0)
          regenOptions.images = lastUser.images;
        if (lastUser.attachments && lastUser.attachments.length > 0)
          regenOptions.attachments = lastUser.attachments;
        await window.api.sendMessage(
          String(conversationId),
          String(lastUser.content),
          regenOptions,
        );
      } catch (error) {
        console.error("Regenerate failed:", error);
        setIsGenerating(false);
        setGenerationStartedAt(null);
        streamModelRef.current = null;
        addToast("Failed to regenerate response", "error");
      }
    },
    [conversationId, messages, isGenerating, addToast, effectiveModel],
  );

  const handleEdit = useCallback(
    (messageIndex: number) => {
      if (isGenerating) return;

      const message = messages[messageIndex];
      setInput(message.content);
      inputRef.current?.focus();
      pendingEditedResendRef.current = true;

      // Remove this message and all after it from state
      setMessages((prev) => prev.slice(0, messageIndex));

      // Delete from DB
      if (conversationId && message.timestamp) {
        window.api
          .deleteMessagesAfter(conversationId, message.timestamp)
          .catch(() => {
            addToast("Failed to delete messages", "error");
          });
      }
    },
    [conversationId, messages, isGenerating, addToast],
  );

  const handleFilePick = async () => {
    const files = await window.api.openFileDialog();
    if (files && files.length > 0) {
      setPendingAttachments((prev) => [...prev, ...files]);
    }
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const removeImage = (id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setPendingImages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            dataUrl,
            name: `image.${item.type.split("/")[1] ?? "png"}`,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current++;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current--;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const IMAGE_EXTS = new Set([
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "bmp",
      "svg",
    ]);
    const files = Array.from(e.dataTransfer.files);

    for (const f of files) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (IMAGE_EXTS.has(ext) || f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          setPendingImages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), dataUrl, name: f.name },
          ]);
        };
        reader.readAsDataURL(f);
      } else {
        const path = (f as File & { path?: string }).path || "";
        if (path) {
          setPendingAttachments((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name: f.name, path, size: f.size },
          ]);
        }
      }
    }
  };

  const pushSystemMessage = useCallback((content: string) => {
    const systemMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "system",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, systemMessage]);
  }, []);

  const buildConversationMarkdown = useCallback((): string => {
    const lines: string[] = ["# Conversation Export", ""];
    for (const msg of messages) {
      if (msg.role === "system") {
        lines.push(`_System_: ${msg.content}`);
      } else if (msg.role === "user") {
        lines.push(`## User`, "", msg.content, "");
      } else {
        lines.push(`## Assistant`, "", msg.content, "");
      }
    }
    return lines.join("\n");
  }, [messages]);

  const slashCommandCtx = useMemo<SlashCommandContext>(
    () => ({
      conversationId,
      messages: messages.filter((m) => m.role !== 'team-activity') as import('../slash-commands').ChatMessage[],
      activeAgent,
      effectiveModelLabel,
      conversationModel,
      theme,
      pushSystemMessage,
      newChat,
      login,
      logout,
      setInput,
      setTheme,
      loadAgents,
      loadConversations,
      buildConversationMarkdown,
      deleteMessagesAfter: window.api.deleteMessagesAfter,
      lastUndoneUserMessageRef,
      setMessages: setMessages as import('../slash-commands').SlashCommandContext['setMessages'],
    }),
    [
      conversationId,
      messages,
      activeAgent,
      effectiveModelLabel,
      conversationModel,
      theme,
      pushSystemMessage,
      newChat,
      login,
      logout,
      setInput,
      setTheme,
      loadAgents,
      loadConversations,
      buildConversationMarkdown,
    ],
  );

  const removeContextToken = useCallback((token: string) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setInput((prev) =>
      prev
        .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), " ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    );
  }, []);

  const resolveContextBlock = useCallback(async (refs: ContextRef[]) => {
    const lines: string[] = [];
    for (const ref of refs) {
      if (ref.key === "workspace") {
        const summary = await window.api.getWorkspaceSummary();
        lines.push(`[Workspace]\n${summary}`);
        continue;
      }
      if (ref.key === "git") {
        const gitContext = await window.api.getGitContext();
        lines.push(`[Git]\n${gitContext}`);
        continue;
      }
      if (ref.key === "file" && ref.value) {
        const result = await window.api.readContextFile(ref.value);
        const header = result.truncated
          ? `File: ${result.path} (truncated)`
          : `File: ${result.path}`;
        lines.push(`${header}\n\`\`\`\n${result.content}\n\`\`\``);
      }
    }
    return lines.join("\n\n");
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isGenerating || rateLimitRemainingSec > 0) return;

    let content = input.trim();
    if (content.startsWith("/")) {
      const transformed = transformCodeSlashCommand(content);
      if (transformed) {
        content = transformed;
      } else {
        const handled = await executeSlashCommand(content, slashCommandCtx);
        if (handled) {
          setInput("");
          setShowSlashMenu(false);
          setSlashFilter("");
          setSelectedSlashIndex(0);
          return;
        }
      }
    }

    if (input.trim().startsWith("/")) {
      setShowSlashMenu(false);
      setSlashFilter("");
      setSelectedSlashIndex(0);
    }

    const attachments =
      pendingAttachments.length > 0 ? [...pendingAttachments] : undefined;
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;

    // Auto-inject @workspace / @git from agent context rules
    const autoRefs: ContextRef[] = [];
    if (
      activeAgent?.contextRules?.autoInjectWorkspace &&
      !contextRefs.some((r) => r.key === "workspace")
    ) {
      autoRefs.push({ key: "workspace", token: "@workspace" });
    }
    if (
      activeAgent?.contextRules?.autoInjectGit &&
      !contextRefs.some((r) => r.key === "git")
    ) {
      autoRefs.push({ key: "git", token: "@git" });
    }
    const effectiveRefs = [...contextRefs, ...autoRefs];

    const cleanedContent = content
      .replace(/(?:^|\s)@(workspace|git)\b/gi, " ")
      .replace(/(?:^|\s)@file:[^\s]+/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (effectiveRefs.length > 0) {
      try {
        const contextBlock = await resolveContextBlock(effectiveRefs);
        if (contextBlock) {
          content = `${contextBlock}\n\n${cleanedContent || "Please use the attached context."}`;
        }
      } catch {
        addToast("Failed to resolve @context references", "error");
      }
    }

    const userDisplayContent = input.trim();

    // Build context snapshot for transparency badge
    const systemPrompt = activeAgent?.systemPrompt ?? "";
    const tokenEst = (str: string) => Math.ceil(str.length / 4);
    const contextSnapshot: ContextSnapshot = {
      systemPrompt,
      contextRefs: effectiveRefs.map((r) => ({ token: r.token, key: r.key })),
      attachments: pendingAttachments.map((a) => ({
        name: a.name,
        size: a.size,
      })),
      historyLength: messages.filter((m) => m.role !== "system").length,
      estimatedTokens:
        tokenEst(systemPrompt) +
        effectiveRefs.reduce(
          (s, r) =>
            s + (r.key === "workspace" ? 500 : r.key === "git" ? 200 : 300),
          0,
        ) +
        messages.filter((m) => m.role !== "system").length * 200 +
        tokenEst(userDisplayContent),
      model: effectiveModel,
      timestamp: Date.now(),
    };
    const contextSnapshotJson = JSON.stringify(contextSnapshot);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: userDisplayContent,
      timestamp: Date.now(),
      attachments,
      images,
      isEdited: pendingEditedResendRef.current,
      contextSnapshot: contextSnapshotJson,
    };
    pendingEditedResendRef.current = false;

    setMessages((prev) => [...prev, userMessage]);
    // Push to input history (skip duplicate of last entry, cap at 100)
    const sent = input.trim();
    const history = inputHistoryRef.current;
    if (sent && history[0] !== sent) {
      inputHistoryRef.current = [sent, ...history].slice(0, 100);
    }
    historyIndexRef.current = -1;
    historyDraftRef.current = "";
    setInput("");
    setPendingAttachments([]);
    setPendingImages([]);
    setLoadingFailed(false);
    setIsGenerating(true);
    setGenerationStartedAt(Date.now());
    setGenerationElapsedSec(0);
    setStreamingContent("");
    streamingContentRef.current = "";
    const requestModel =
      effectiveModel === "default" ? undefined : effectiveModel;
    streamModelRef.current = requestModel ?? null;

    let convId = activeConversationRef.current;
    if (!convId) {
      convId = crypto.randomUUID();
      justCreatedConversationRef.current = true;
      conversationCreated(convId);
      activeConversationRef.current = convId;
    }

    try {
      await window.api.sendMessage(convId, content, {
        attachments,
        images,
        agentId: activeAgentId ?? undefined,
        model: requestModel,
        messageId: userMessage.id,
        projectId: activeProjectId ?? undefined,
        contextSnapshot: contextSnapshotJson,
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      setIsGenerating(false);
      setLoadingFailed(true);
      setGenerationStartedAt(null);
      streamModelRef.current = null;
      addToast("Failed to send message. Please try again.", "error");
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Failed to send message. Please check your connection and try again.",
        timestamp: Date.now(),
        isError: true,
        errorType: "network",
        retryable: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  const handleRetry = useCallback(async () => {
    if (isGenerating || messages.length < 1) return;

    // Find the last user message
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    // Remove error messages from the end
    const trimmedMessages = [...messages];
    while (
      trimmedMessages.length > 0 &&
      trimmedMessages[trimmedMessages.length - 1].isError
    ) {
      const errMsg = trimmedMessages.pop()!;
      await window.api.deleteMessage(errMsg.id).catch(() => {});
    }
    setMessages(trimmedMessages);

    setIsGenerating(true);
    setGenerationStartedAt(Date.now());
    setGenerationElapsedSec(0);
    setStreamingContent("");
    streamingContentRef.current = "";

    const convId = activeConversationRef.current;
    if (!convId) return;

    try {
      await window.api.sendMessage(convId, lastUser.content, {
        regenerate: true,
        model: effectiveModel === "default" ? undefined : effectiveModel,
      });
    } catch (error) {
      console.error("Retry failed:", error);
      setIsGenerating(false);
      setGenerationStartedAt(null);
      streamModelRef.current = null;
      addToast("Retry failed. Please try again.", "error");
    }
  }, [messages, isGenerating, addToast, effectiveModel]);

  const handleSignIn = useCallback(() => {
    login();
  }, [login]);

  const handleSetConversationModel = useCallback(
    async (model: string) => {
      if (!conversationId) return;
      const value = model === "default" ? null : model;
      try {
        const result = await window.api.setConversationModel(
          conversationId,
          value,
        );
        if (hasIpcError(result)) {
          throw new Error(result.error);
        }
        await loadConversations();
        addToast(`Model set to ${getModelLabel(model)}`, "success");
      } catch {
        addToast("Failed to set conversation model", "error");
      }
    },
    [conversationId, loadConversations, addToast],
  );

  const handleStop = async () => {
    try {
      await window.api.stopGeneration();
      // Save partial streamed content if any
      const partialContent = streamingContentRef.current;
      if (partialContent) {
        const stoppedMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: partialContent,
          timestamp: Date.now(),
          model: streamModelRef.current,
          isStopped: true,
        };
        setMessages((prev) => [...prev, stoppedMessage]);
      }
      streamingContentRef.current = "";
      streamModelRef.current = null;
      setStreamingContent("");
      setIsGenerating(false);
      setGenerationStartedAt(null);
      setGenerationElapsedSec(0);
    } catch {
      addToast("Failed to stop generation", "error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showAtMenu) {
      const visibleContexts = AT_CONTEXT_OPTIONS.filter((opt) =>
        opt.token.slice(1).startsWith(atFilter.toLowerCase()),
      );
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedAtIndex((prev) =>
          visibleContexts.length === 0
            ? 0
            : (prev + 1) % visibleContexts.length,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedAtIndex((prev) =>
          visibleContexts.length === 0
            ? 0
            : (prev - 1 + visibleContexts.length) % visibleContexts.length,
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && visibleContexts.length > 0) {
        e.preventDefault();
        const selected = visibleContexts[selectedAtIndex] ?? visibleContexts[0];
        const atMatch = input.match(/(^|\s)@([a-z]*)$/i);
        if (atMatch) {
          setInput(
            (prev) =>
              `${prev.slice(0, atMatch.index)}${atMatch[1]}${selected.token} `,
          );
        } else {
          setInput((prev) => `${prev} ${selected.token} `.trimStart());
        }
        setShowAtMenu(false);
        setAtFilter("");
        setSelectedAtIndex(0);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowAtMenu(false);
        return;
      }
    }

    if (showSlashMenu) {
      const visibleCommands = SLASH_COMMANDS.filter((cmd) =>
        cmd.name.slice(1).startsWith(slashFilter.toLowerCase()),
      );
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSlashIndex((prev) =>
          visibleCommands.length === 0
            ? 0
            : (prev + 1) % visibleCommands.length,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSlashIndex((prev) =>
          visibleCommands.length === 0
            ? 0
            : (prev - 1 + visibleCommands.length) % visibleCommands.length,
        );
        return;
      }
      if (
        ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") &&
        visibleCommands.length > 0
      ) {
        e.preventDefault();
        const selected =
          visibleCommands[selectedSlashIndex] ?? visibleCommands[0];
        setInput(`${selected.name} `);
        setShowSlashMenu(false);
        setSlashFilter("");
        setSelectedSlashIndex(0);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    // Alt+Up/Down — cycle through input history like a CLI
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const history = inputHistoryRef.current;
      if (history.length === 0) return;
      if (e.key === "ArrowUp") {
        if (historyIndexRef.current === -1) {
          historyDraftRef.current = input;
        }
        const nextIndex = Math.min(
          historyIndexRef.current + 1,
          history.length - 1,
        );
        historyIndexRef.current = nextIndex;
        setInput(history[nextIndex]);
      } else {
        if (historyIndexRef.current === -1) return;
        const nextIndex = historyIndexRef.current - 1;
        historyIndexRef.current = nextIndex;
        setInput(
          nextIndex === -1 ? historyDraftRef.current : history[nextIndex],
        );
      }
    }
  };

  // Find the last assistant message index for regenerate button (skip team-activity messages)
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
      if (messages[i].role === "user") break;
    }
    return -1;
  })();

  const handleInputResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Capture actual rendered height so default "auto" sizing is respected
    const currentHeight = inputRef.current?.offsetHeight ?? 40;
    inputPanelResizeRef.current = {
      startY: e.clientY,
      startHeight: currentHeight,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (!inputPanelResizeRef.current) return;
      const { startY, startHeight } = inputPanelResizeRef.current;
      const newHeight = Math.max(
        40,
        Math.min(400, startHeight + (startY - ev.clientY)),
      );
      setInputPanelHeight(newHeight);
    };

    const onUp = () => {
      inputPanelResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const renderInput = () => (
    <div className="border-t border-gray-200 dark:border-gray-700/80 relative">
      {/* Drag handle at the top edge of the input panel */}
      <div
        className="absolute top-0 left-0 right-0 h-1 cursor-row-resize hover:bg-blue-400/50 active:bg-blue-500/60 transition-colors z-10"
        onPointerDown={handleInputResizePointerDown}
        aria-label="Resize input panel"
      />
      <div className="px-4 pb-4 pt-3">
        <div className="max-w-3xl mx-auto">
          {/* Model picker moved into the input card toolbar */}
          {/* Pending attachments */}
          {(pendingAttachments.length > 0 || pendingImages.length > 0) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingImages.map((img) => (
                <div key={img.id} className="relative group/img inline-flex">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-16 w-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                    aria-label="Remove image"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              {pendingAttachments.map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
                >
                  <Paperclip className="w-3 h-3" />
                  {att.name}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-0.5"
                    aria-label={`Remove ${att.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {showContextInspector && (
            <ContextInspector
              systemPrompt={activeAgent?.systemPrompt ?? ""}
              contextRefs={contextRefs}
              attachments={pendingAttachments}
              images={pendingImages}
              historyMessages={messages.filter((m) => m.role !== "system")}
              currentInput={input}
              model={effectiveModel}
              onClose={() => setShowContextInspector(false)}
            />
          )}

          {contextRefs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {contextRefs.map((ref, idx) => (
                <span
                  key={`${ref.token}-${idx}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
                >
                  {ref.token}
                  <button
                    onClick={() => removeContextToken(ref.token)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-0.5"
                    aria-label={`Remove ${ref.token}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {showSlashMenu && (
            <div className="mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              {[
                ...SLASH_COMMANDS,
                ...(activeAgent?.customCommands ?? []).map((c) => ({
                  name: c.name,
                  usage: c.name,
                  description: c.description,
                })),
              ]
                .filter((cmd) =>
                  cmd.name.slice(1).startsWith(slashFilter.toLowerCase()),
                )
                .slice(0, 8)
                .map((cmd, idx) => (
                  <button
                    key={cmd.name}
                    type="button"
                    onClick={() => {
                      setInput(`${cmd.name} `);
                      setShowSlashMenu(false);
                      setSlashFilter("");
                      setSelectedSlashIndex(0);
                      inputRef.current?.focus();
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                      idx === selectedSlashIndex
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    <span className="font-mono">{cmd.name}</span>
                    <span className="ml-3 text-gray-400">
                      {cmd.description}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {showAtMenu && (
            <div className="mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              {AT_CONTEXT_OPTIONS.filter((opt) =>
                opt.token.slice(1).startsWith(atFilter.toLowerCase()),
              )
                .slice(0, 6)
                .map((opt, idx) => (
                  <button
                    key={opt.token}
                    type="button"
                    onClick={() => {
                      const atMatch = input.match(/(^|\s)@([a-z]*)$/i);
                      if (atMatch) {
                        setInput(
                          (prev) =>
                            `${prev.slice(0, atMatch.index)}${atMatch[1]}${opt.token} `,
                        );
                      } else {
                        setInput((prev) => `${prev} ${opt.token} `.trimStart());
                      }
                      setShowAtMenu(false);
                      setAtFilter("");
                      setSelectedAtIndex(0);
                      inputRef.current?.focus();
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                      idx === selectedAtIndex
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    <span className="font-mono">{opt.token}</span>
                    <span className="ml-3 text-gray-400">
                      {opt.description}
                    </span>
                  </button>
                ))}
            </div>
          )}

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus-within:ring-2 focus-within:ring-gray-400 dark:focus-within:ring-gray-500 focus-within:border-transparent transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const next = e.target.value;
                setInput(next);
                // Typing manually exits history-browsing mode
                historyIndexRef.current = -1;
                historyDraftRef.current = "";
                const slashMatch = next.match(/^\/([a-z-]*)$/i);
                if (slashMatch) {
                  setShowSlashMenu(true);
                  setSlashFilter(slashMatch[1] ?? "");
                  setSelectedSlashIndex(0);
                } else {
                  setShowSlashMenu(false);
                }
                const atMatch = next.match(/(^|\s)@([a-z]*)$/i);
                if (atMatch) {
                  setShowAtMenu(true);
                  setAtFilter(atMatch[2] ?? "");
                  setSelectedAtIndex(0);
                } else {
                  setShowAtMenu(false);
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDragOver={(e) => e.preventDefault()}
              placeholder={
                !authenticated
                  ? "Sign in to start chatting"
                  : isOnline
                    ? "Type a message... (paste images with Ctrl+V)"
                    : "Offline — reconnect to send messages"
              }
              rows={1}
              disabled={
                !isOnline || !authenticated || rateLimitRemainingSec > 0
              }
              aria-label="Message input"
              className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleFilePick}
                  disabled={isGenerating}
                  className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Attach files"
                  aria-label="Attach files"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowContextInspector((v) => !v)}
                  className={`p-1.5 rounded-md transition-colors ${
                    showContextInspector
                      ? "text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700"
                      : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                  title="Toggle context inspector"
                  aria-label="Toggle context inspector"
                  aria-pressed={showContextInspector}
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <select
                  value={effectiveModel}
                  onChange={(e) =>
                    conversationId
                      ? handleSetConversationModel(e.target.value)
                      : setPendingModel(
                          e.target.value === "default" ? null : e.target.value,
                        )
                  }
                  ref={modelPickerRef}
                  className="text-xs bg-transparent border-0 text-gray-600 dark:text-gray-300 focus:outline-none cursor-pointer py-1 px-1 max-w-[140px]"
                  aria-label="Conversation model"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {getModelLabel(m)}
                      {getModelMultiplier(m)
                        ? ` · ${getModelMultiplier(m)}`
                        : ""}
                    </option>
                  ))}
                </select>
                {isGenerating ? (
                  <button
                    onClick={handleStop}
                    className="p-1.5 rounded-md bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 transition-colors flex items-center justify-center"
                    aria-label="Stop generating"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={
                      !input.trim() ||
                      !isOnline ||
                      !authenticated ||
                      rateLimitRemainingSec > 0
                    }
                    className={`p-1.5 rounded-md flex items-center justify-center transition-colors ${
                      input.trim() &&
                      isOnline &&
                      authenticated &&
                      rateLimitRemainingSec === 0
                        ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300"
                        : "bg-transparent text-gray-400 dark:text-gray-500 cursor-not-allowed"
                    }`}
                    aria-label="Send message"
                  >
                    <SendHorizontal className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!conversationId && messages.length === 0) {
    return (
      <div
        className={`flex-1 flex flex-col min-h-0 ${isDragging ? "ring-2 ring-blue-500 ring-inset bg-blue-50/5" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-medium text-gray-700 dark:text-gray-200 mb-2">
              {activeAgent
                ? `${activeAgent.icon} ${activeAgent.name}`
                : "Copilot Desktop Hub"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              {activeAgent
                ? `Start a conversation with ${activeAgent.name}`
                : "Start a conversation with GitHub Copilot"}
            </p>
            {!authenticated && (
              <button
                type="button"
                onClick={() => login()}
                className="mb-4 px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              >
                Sign in with GitHub
              </button>
            )}
            {isDragging && (
              <p className="text-sm text-blue-500 animate-pulse">
                Drop files to attach
              </p>
            )}
          </div>
        </div>
        {renderInput()}
      </div>
    );
  }

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 ${isDragging ? "ring-2 ring-blue-500 ring-inset bg-blue-50/5" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label="Chat conversation"
    >
      {/* Context bar — shows project and agent when at least one is set */}
      {(currentProject || displayAgent) && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 dark:border-gray-700/80 bg-gray-50 dark:bg-gray-800/50"
          aria-label="Chat context"
        >
          {currentProject && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              <span
                className={`w-2 h-2 rounded-full bg-${currentProject.color}-400`}
                aria-hidden="true"
              />
              {currentProject.name}
            </span>
          )}
          {displayAgent && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              <span aria-hidden="true">{displayAgent.icon}</span>
              {displayAgent.name}
            </span>
          )}
        </div>
      )}
      <div
        className="flex-1 overflow-y-auto min-h-0 px-4 py-6"
        role="log"
        aria-live="polite"
        aria-label="Messages"
      >
        <div className="max-w-3xl mx-auto space-y-8">
          {isLoadingMessages && (
            <>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
                >
                  <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 dark:bg-gray-800 animate-pulse">
                    <div className="h-3 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                    <div className="h-3 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
                  </div>
                </div>
              ))}
            </>
          )}
          {messages.map((msg, index) => {
            if (msg.role === "team-activity") {
              let steps: TeamActivityStep[] = [];
              try {
                steps =
                  (JSON.parse(msg.content) as { steps: TeamActivityStep[] })
                    .steps ?? [];
              } catch {
                /* ignore */
              }
              return (
                <div key={msg.id} className="max-w-3xl mx-auto">
                  <TeamActivityBlock steps={steps} isLive={false} />
                </div>
              );
            }
            return (
              <MessageBubble
                key={msg.id}
                id={msg.id}
                role={msg.role}
                content={msg.content}
                isEdited={msg.isEdited}
                modelLabel={
                  msg.role === "assistant"
                    ? getModelLabel(msg.model ?? effectiveModel)
                    : undefined
                }
                attachments={msg.attachments}
                images={msg.images}
                contextSnapshot={msg.contextSnapshot}
                isLastAssistant={index === lastAssistantIndex}
                isGenerating={isGenerating}
                isError={msg.isError}
                errorType={msg.errorType}
                retryable={msg.retryable}
                isStopped={msg.isStopped}
                onCopy={handleCopy}
                onRegenerate={
                  index === lastAssistantIndex
                    ? () => handleRegenerate()
                    : undefined
                }
                onRegenerateWithModel={
                  index === lastAssistantIndex
                    ? (model) => handleRegenerate(model)
                    : undefined
                }
                onEdit={
                  msg.role === "user" ? () => handleEdit(index) : undefined
                }
                onRetry={msg.isError && msg.retryable ? handleRetry : undefined}
                onSignIn={
                  msg.isError && msg.errorType === "auth"
                    ? handleSignIn
                    : undefined
                }
                onPickModel={
                  msg.isError && msg.errorType === "model_not_available"
                    ? () => modelPickerRef.current?.focus()
                    : undefined
                }
              />
            );
          })}
          {isGenerating && liveTeamActivity.length > 0 && (
            <div className="max-w-3xl mx-auto">
              <TeamActivityBlock steps={liveTeamActivity} isLive={true} />
            </div>
          )}
          {isGenerating && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                <MarkdownRenderer content={streamingContent} />
                <span className="animate-pulse text-gray-400">▊</span>
              </div>
            </div>
          )}
          {isGenerating && !streamingContent && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>
                    Generating
                    {generationElapsedSec > 0
                      ? ` · ${generationElapsedSec}s`
                      : "..."}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce" />
                </div>
              </div>
            </div>
          )}
          {loadingFailed && !isGenerating && !streamingContent && (
            <div className="flex justify-start">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Request failed — see error above</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 pointer-events-none z-10">
          <div className="text-lg font-medium text-blue-500 bg-white dark:bg-gray-800 px-6 py-3 rounded-xl shadow-lg">
            Drop files to attach
          </div>
        </div>
      )}
      {rateLimitRemainingSec > 0 && (
        <div className="px-4 pb-2">
          <div className="max-w-3xl mx-auto text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Rate limited — you can send again in {rateLimitRemainingSec}s.
          </div>
        </div>
      )}
      {renderInput()}
    </div>
  );
}
