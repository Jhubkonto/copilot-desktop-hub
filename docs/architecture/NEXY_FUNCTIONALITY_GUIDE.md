# Nexy functionality guide — “explain it like I’m five”

## Document purpose

This is the friendly explanation of Nexy. It starts with the mental model a child could understand, then adds the technical names needed to maintain the software.

**Baseline:** Nexy `1.3.37`, reviewed `2026-08-19`  
**Product:** local-first, provider-agnostic AI workspace  
**Main platforms:** Electron desktop and Kotlin/Jetpack Compose Android companion  
**Primary references:** [README](../../README.md), [technical architecture](../../src/docs/ARCHITECTURE.md), [Android standalone contract](../android-standalone-contract.md)

## 1. The one-sentence explanation

Nexy is a notebook with a team of helpers inside it: you can ask an AI question, give the helpers instructions and documents, let them use carefully controlled tools, save the results, and continue the work from a desktop or phone.

Nexy is the notebook and traffic controller. It is not the AI brain itself. The brain may be an OpenAI, Anthropic, Azure, Gemini, Mistral, Groq, xAI, OpenRouter, Claude CLI, Codex CLI, or Hermes CLI backend that the user supplies.

## 2. The child-sized picture

Imagine a little workshop:

```text
You
 │
 ▼
Nexy window ── “What are we working on?”
 │
 ├── Project box       = one workspace and its files
 ├── Agent helper      = a character with a job and instructions
 ├── Conversation book = what was said and done
 ├── Tool belt        = file, web, MCP, desktop, Git, and build tools
 ├── Memory shelf     = knowledge files, wiki, prompts, skills, summaries
 └── Delivery shelf   = artifacts, workflows, schedules, and run history
```

The desktop version has the keys to the workshop: it can access the operating system, SQLite, project files, installed CLIs, child processes, and the network. The visible React window does not get those keys directly. A small secure bridge hands the window only the actions Nexy has explicitly allowed.

The Android version is a second notebook. It keeps a local copy so it can still show and edit many things without the desktop. When paired, it asks the desktop to perform desktop-only work. Android can also chat directly with Anthropic, OpenAI, or OpenRouter when the phone has its own locally stored key.

## 3. The important words

| Word | Like I’m five | Technical meaning |
| --- | --- | --- |
| Conversation | One notebook page of a chat | A persisted thread containing user, assistant, tool, and activity history |
| Message | One speech bubble | A database record with role, content, model/provider, usage, attachments, thinking, and finish state |
| Project | A labeled box of related work | A workspace scope with sources, agents, configuration, wiki, milestones, and Git context |
| Agent | A helper with a specific job | A reusable configuration containing instructions, model/backend, tools, memory, skills, and knowledge rules |
| Skill | A recipe card | A reusable instruction module with versioning, provenance, tool presets, and approval rules |
| Knowledge file | A book the helper may read | Agent-owned context that can be always injected or requested on demand |
| Project wiki | The team’s noticeboard | Searchable project knowledge that can be written manually or extracted from chats |
| Prompt | A saved starting sentence | A versioned, reusable prompt with variables, scope, tags, and categories |
| Provider | A distant brain you call | A native or OpenAI-compatible model API selected through a common streaming interface |
| CLI backend | A helper program already installed | Claude, Codex, or Hermes command-line/ACP integration run by the desktop |
| Tool | A hand that can do something | A built-in, MCP, CLI, or desktop-automation capability called during a turn |
| Artifact | A saved piece of work | A versioned multi-file document, code project, UI, data set, prompt, or plan |
| Workflow | A recipe with several steps | A saved plan whose steps run in separate conversations with status and retry history |
| Schedule | An alarm clock | A persisted one-time or recurring trigger for chat or workflow execution |
| Pairing | Giving the phone a trusted workshop pass | Authenticated WebSocket connection with token and, for local TLS, certificate pinning |

## 4. What happens when Nexy starts

### Desktop

1. Electron starts the main process and enforces one running Nexy instance.
2. Nexy creates a frameless browser window with `contextIsolation`, no Node integration, and sandboxing.
3. The main process opens `{userData}/data/nexy.db`, enables SQLite WAL mode, and applies any pending migrations in order.
4. Nexy registers typed IPC handlers for chat, settings, conversations, agents, projects, tools, MCP, Git, builds, Android, workflows, schedules, and other domains.
5. Enabled MCP servers and the mobile WebSocket service are initialized when applicable.
6. The React renderer calls one hydration operation through `window.api` and fills the UI store with settings, projects, agents, conversations, and other state.
7. Auto-update, debug logging, global shortcuts, and lifecycle handlers become active.

### Android

1. The Kotlin app opens its Room database and local settings store.
2. It restores the last selected project, conversation, drafts, sync status, and paired-server profile.
3. It checks connectivity separately from the user’s Standalone/Remote preference.
4. If paired, it negotiates the WebSocket protocol and synchronizes the local dataset.
5. If not paired, the app still supports local browsing, editing, drafts, local backup/restore, and direct provider chat when a local provider key exists.

## 5. The central story: asking a question

Suppose the user types “Summarize this project.”

```text
1. React composer reads the text.
2. Renderer sends a typed request through window.api.
3. Preload forwards only that approved request over Electron IPC.
4. Main process loads the conversation, project, agent, settings, and context.
5. Backend routing chooses a provider API, CLI backend, or orchestrator.
6. The model streams thinking, tool activity, and answer text.
7. Nexy turns raw provider/CLI output into ordered turn events.
8. Renderer reduces events into the live timeline and draws them.
9. Android listeners may receive the same authoritative events through WebSocket.
10. The completed assistant message, usage, thinking blocks, and tool records are saved.
```

The model does not automatically know the whole computer. Nexy builds a context package from allowed sources: recent conversation messages, a rolling summary when needed, the selected agent instructions, project instructions, skills, knowledge files, wiki results, attached files, and explicitly requested context. It keeps this bounded by the model’s context budget.

## 6. Why the answer appears one piece at a time

Providers and CLI tools usually stream output. Nexy does not wait for the entire answer. `ChatTurnEmitter` labels each piece with a turn ID and sequence number, such as:

```text
turn_started
user_message_committed
activity_changed: thinking
thinking_delta
activity_changed: tool
tool_started
tool_finished
assistant_text_delta
turn_completed
```

The desktop reducer applies only the normalized `chat:turn-event` stream. Older compatibility events are still emitted for existing consumers. If events arrive late, the turn ID and sequence number prevent an old turn from corrupting the current one.

If a turn stops or fails, Nexy preserves a recoverable partial record rather than leaving an infinite spinner. The user can stop one conversation or activate the emergency stop that prevents new work from continuing.

## 7. How Nexy chooses a brain

The user can bring a key (BYOK) or use a local CLI.

### API provider route

The provider registry knows provider names, model aliases, endpoints, capabilities, and fallback behavior. The provider adapters normalize requests and stream responses into Nexy’s internal format. Native routes include Anthropic and OpenAI-style APIs; compatible routes cover Azure, Gemini, Mistral, Groq, xAI, and OpenRouter configurations.

API keys are stored through Electron `safeStorage` where available. The key is used by the main process and is not sent to the renderer as ordinary application state.

### CLI route

Nexy detects installed Claude, Codex, and Hermes tools. A CLI adapter starts and supervises the tool, translates its events into Nexy chat events, and handles CLI-specific tool activity, costs, model reporting, cancellation, and skill-capture behavior.

The CLI remains the owner of its own authentication. Nexy does not pretend that a CLI account is the same thing as an API key.

## 8. How helpers use tools safely

There are four broad tool families:

1. **Built-in tools:** file editing and web fetch, controlled by per-agent settings.
2. **MCP tools:** capabilities discovered from configured Model Context Protocol stdio servers.
3. **CLI tools:** tools reported by a CLI backend during a CLI chat.
4. **Desktop capabilities:** screen capture, OCR, clipboard, mouse/keyboard automation, Git, builds, and project services exposed through Nexy’s own handlers or MCP bridge.

An agent may call a tool, receive the result, and continue thinking. The agentic loop is capped at 20 iterations for normal tool use. Approval modes are `auto`, `always-ask`, or `disabled`; the UI shows a review dialog for calls that need permission.

MCP servers are configured and persisted by Nexy. Enabled stdio servers are child processes. Nexy discovers their tools, applies server and per-tool trust settings, and shuts them down with the app. An external project MCP bridge is loopback-only, project-scoped, token-authenticated, and approval-gated for writes.

## 9. Agents, skills, knowledge, and memory

### Agents

An agent is not a separate AI service. It is a bundle of choices: name, icon, system instructions, model/backend, temperature, tools, memory behavior, context rules, skills, MCP trust, and custom slash commands. Agents may be global or assigned to a project.

The agent builder can edit JSON/configuration directly or guide the user through a generator conversation. Import/export makes configurations portable.

### Skills

A skill is a reusable recipe. It can be attached to several agents, versioned, generated through a wizard, imported/exported, and saved from an explicit conversation request. The shared skill service parses and validates `SKILL.md` content and applies case-insensitive upsert rules.

For CLI skill capture, Nexy creates a short-lived loopback bridge that exposes only `save_skill`, uses a per-run secret, asks for UI approval, then closes. The CLI cannot write the skill database by itself.

### Knowledge and memory

Knowledge files are explicit documents attached to an agent. They can be always injected or loaded on demand. Project wiki entries are project-scoped records with search and extraction flows. Conversation compression creates rolling summaries so older context can be represented without sending every old message.

Nexy distinguishes instructions, documents, conversation state, and memories. The current memory design is described in [NEXY_MEMORY_SYSTEM_DESIGN.md](../NEXY_MEMORY_SYSTEM_DESIGN.md); it is not correct to explain Nexy as silently remembering every past conversation.

## 10. Projects and workspace context

A project tells Nexy “these things belong together.” It may include:

- a project name, color, and portable configuration;
- one or more source folders or repositories;
- a primary agent and project team;
- orchestration settings and scope rules;
- workspace variables and milestones;
- wiki entries, prompts, artifacts, audits, and workflow templates;
- Git and build context.

Project source IDs and relative paths are used in portable workflows. Absolute desktop paths and secrets stay desktop-local and are excluded from Android synchronization.

## 11. Multi-agent orchestration

When enabled, a leader agent receives a `delegate_to_agent` tool. It can ask a specialist agent to perform a bounded subtask, collect the result, and continue. Delegation depth is capped at five levels so helpers cannot create an infinite family tree. Team activity is streamed to the user as separate activity records.

This is different from an automated workflow. Orchestration is a live model decision inside one chat turn; a workflow is a saved, reviewable sequence of separate conversations.

## 12. Saved work: artifacts and workflows

### Artifacts

An artifact is a durable result with versions. It may contain Markdown, source code, UI, data, prompts, plans, quizzes, debriefs, or teach-back material. Artifact versions let the user compare, export, regenerate, and refer to an exact version.

### Automated workflows

The user describes a goal in a generator. Nexy produces a plan, saves it as pending, and lets the user review it before execution. A run can be:

- gated: pause for approval after each step;
- automatic: continue unless a failure needs attention;
- retried, skipped, aborted, or run again from a saved template.

Each step runs in its own dedicated conversation, not in the project’s main chat. The managed deliverable path uses `collect`, `model`, `review`, and `publish` steps:

```text
project source -> immutable source version -> generated artifact version
             -> human review -> checksum-checked preview -> atomic publish
```

Editing an artifact creates a new immutable version and marks dependent inputs stale. Publishing checks project confinement, link escapes, destination checksum, preview expiry, and unchanged approved content.

## 13. Scheduling

The scheduler is Nexy’s alarm clock. A task can fire once or recur daily, on weekdays, weekly, or monthly. It can send a normal chat message or start one or more attached workflow specs. The scheduler stores tasks and run history, rehydrates timers after restart, catches up missed runs according to its policy, retries with backoff, and reports success, failure, or approval-needed status.

Scheduled work is constrained by the permissions and tool allow-list saved with the task. A timer cannot silently turn an unsafe tool into an approved tool.

## 14. Git, files, and builds

The desktop project Git workbench handles repository discovery, branches, checkout, fetch, pull, merge, status, diffs, staging, commit, push, stash, discard, and conflict-related actions. The UI uses typed project-Git operations; it is separate from ordinary AI coding chats.

The build dashboard can run preflight, typecheck, tests, package/build commands, development launch, publish to a local update feed, inspect history, cancel builds, and roll back a published update. Build output is streamed into a log record. Android can request desktop build actions while paired; it cannot build a desktop workspace in standalone mode.

## 15. Voice, images, screen, and sharing

- **Voice input:** desktop can use local Whisper.cpp; Android uses on-device speech input. Paired Android voice can send a transcription request to the desktop when appropriate.
- **Voice output:** Nexy supports system speech and optional local Supertonic neural voice output on desktop.
- **Images:** users can paste, drag, attach, or capture screenshots. Android standalone attachments are content-addressed by SHA-256 and transferred in verified chunks when synchronized.
- **Screen tools:** the desktop capture overlay selects a region; OCR can read text; the desktop navigator can inspect windows, clipboard, mouse, keyboard, focus, and scroll under tool approval.
- **Sharing:** Android can accept share intents and turn shared text/files into a new chat composition.

## 16. Conversation helpers

- **Slash commands:** quick actions for model selection, context, conversation management, sharing, completion state, usage, help, and other app commands.
- **`@` context:** lets the user explicitly attach files, wiki information, Git context, or other supported sources.
- **Compression:** creates a previewable summary before replacing older context with a rolling summary.
- **Forking:** copies a conversation to a different provider/model path.
- **Export/import:** preserves portable conversation records and attachments where supported.
- **Debrief:** asks a model to explain a conversation’s result, tools, APIs, reproduction steps, and approach; it does not mark the conversation complete.
- **Quiz and teach-back:** generate learning artifacts from conversation content.
- **Ratings:** record feedback and retrieve rated past strategies for applicable context.

## 17. Android: two modes, not one confused state

Android has two independent ideas:

1. **Can I reach the desktop?** This is connection status.
2. **Should I use the desktop right now?** This is the Standalone/Remote preference.

In standalone mode, Android can browse and edit its local Room data, keep drafts, back up/restores, and use direct Anthropic/OpenAI/OpenRouter chat with a phone-local key. It cannot access desktop files, shell, Git, CLI models, stdio MCP, desktop automation, builds, scheduled execution, or workspace-writing generators.

In remote mode, the authenticated WebSocket sends requests to the desktop. The desktop stays authoritative for SQLite, project files, artifacts, model execution, scheduling, and desktop-only capabilities.

## 18. Pairing and synchronization in simple language

Pairing is like giving a phone a secret badge and a picture of the workshop’s lock. The QR code contains a token and, for the local server, a certificate fingerprint. Android accepts the local certificate only when its fingerprint matches the pinned value.

After pairing:

1. both sides agree on a protocol version;
2. the first connection may exchange a bounded snapshot;
3. later connections exchange only changes after a durable cursor;
4. each change has an ID, device sequence, entity version, operation, and canonical payload;
5. replaying an acknowledged change is safe;
6. independent field edits merge;
7. same-field edits and delete-versus-edit become visible conflicts;
8. tombstones remain until the other side has acknowledged them.

Secrets, API key payloads, passwords, pairing secrets, workspace paths, transient streams, logs, and build state are removed at synchronization boundaries. Android credentials remain in the Android Keystore-backed vault.

## 19. Where data lives

### Desktop SQLite

The desktop database stores settings, projects, conversations, messages, agents, skills, knowledge files, MCP configuration, tool overrides, prompts, summaries, artifacts, workflow runs, scheduler tasks/runs, credentials metadata, audits, and other durable records. Versioned migrations update it without treating the current schema as a disposable file.

### Android Room

Android stores its local synchronized dataset, drafts, outbox, conflicts, attachment references, local settings, and encrypted local credential references. It is authoritative for the phone’s local view while offline, but desktop-only actions are never faked as local operations.

### Files and child processes

Project files remain in the chosen workspace. MCP servers, CLI tools, build processes, local feed servers, and local speech workers run as controlled desktop processes. Nexy records enough status and audit history to explain what happened.

## 20. The security story

The main rules are:

- the renderer cannot use Node or Electron directly;
- preload exposes only the typed `window.api` bridge;
- main handlers validate the sender and return structured errors;
- provider keys use OS-protected storage where available;
- tools can be disabled or approval-gated per agent;
- MCP and external bridges are scoped, authenticated, and lifecycle-bound;
- project paths are confined and link escapes are rejected for publication;
- Android synchronization strips secrets and local paths;
- local mobile TLS is pinned to the QR-provided certificate fingerprint;
- remote/standalone capability differences are explicit;
- logs avoid provider credentials and synchronization payload bodies.

Nexy is a powerful local tool, so “local” does not mean “risk-free.” Giving an agent a file-writing, command-running, desktop-automation, or external MCP tool is a real permission decision.

## 21. The source-code map

| Question | Start here |
| --- | --- |
| How does the app start? | `src/main/index.ts`, `src/main/ipc-handlers.ts` |
| How does the UI talk to desktop services? | `src/preload/index.ts`, `src/shared/types.ts` |
| How does chat dispatch? | `src/main/chat-handlers.ts`, `chat-provider-dispatch.ts`, `backend-routing.ts` |
| How are providers implemented? | `src/main/providers.ts`, `src/main/providers/`, `provider-registry.ts` |
| How do CLI backends work? | `src/main/cli-adapters/` |
| How is context built? | `src/main/chat-context-builder.ts`, `context-compression.ts` |
| How do tools loop? | `src/main/tool-loop.ts`, `tools.ts`, `mcp.ts` |
| How do agents work? | `src/main/agents.ts`, `knowledge.ts`, `skills.ts`, `skill-service.ts` |
| How do projects and wiki work? | `project-handlers.ts`, `project-sources.ts`, `wiki-handlers.ts`, `wiki-context.ts` |
| How are durable records stored? | `database.ts`, `database-migrations.ts` |
| How are artifacts/workflows stored and run? | `artifacts.ts`, `artifact-generator.ts`, `automated-workflow-*` |
| How does scheduling work? | `scheduler-engine.ts`, `scheduler-handlers.ts` |
| How does Git/build work? | `code-change/`, `project-git-handlers.ts`, `build-runner.ts`, `build-handlers.ts` |
| How does Android pair and sync? | `ws-server.ts`, `ws-handlers.ts`, `standalone-sync.ts`, `android/` |

## 22. What Nexy is not

- It is not a hosted Nexy account with a shared cloud database.
- It is not automatically “Claude Code.” Claude Code’s tool names exist only when a CLI backend is actually in use.
- It is not an always-on autonomous employee. Scheduled or automated work still follows saved permissions, step states, approval modes, and failure handling.
- It is not a magic memory that knows every prior project. Context must come from the conversation, explicit project/agent sources, stored summaries, wiki, knowledge, memory features, or tools.
- Android is not a remote shell when it is standalone or disconnected.
