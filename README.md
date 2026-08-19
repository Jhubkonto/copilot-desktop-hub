# Nexy

A provider-agnostic native AI workspace — locally-first, with custom agents, multi-provider LLM support (BYOK or CLI), MCP server integration, built-in tools, project-scoped workspaces, and a full-featured Android companion app.

## Features

### Chat & Composition

- Multi-conversation chat with streaming responses and per-conversation abort
- **No account required** — connect your own API keys (OpenAI, Anthropic, Azure, Gemini, Mistral, Groq, xAI) or point at a local CLI (Claude CLI, Codex CLI, Hermes CLI)
- Agentic mode: up to 20 tool-call iterations per request with automatic inspection-step recovery
- Slash commands and `@`-context references for model switching, context injection, and chat management
- Screen capture overlay with rubber-band region selection and clipboard image injection
- Voice input via local Whisper.cpp (ggml-base.en model auto-downloaded on first use)
- Conversation compression: rolling summarization with preview and custom summary generation for long sessions
- Conversation portability: export/import JSON packs, fork to another provider, and generate markdown transcripts

### Agents & Orchestration

- Custom agent builder: system prompt, model, temperature, tools, memory, context rules, and custom slash commands
- Agent knowledge files with always/on-demand injection and inline editing
- Skill library: reusable instruction modules attachable to any agent, with tool presets and approval rules
- Multi-agent orchestration: leader agent delegates sub-tasks to specialist team agents via `delegate_to_agent` (capped at 5 levels)
- Agent and skill generators: structured conversation-driven wizards that emit a full spec and create the resource
- Agent export/import (JSON)

### Automated Workflows & Scheduling

**How it works:**

1. **Describe your goal** in a chat-style generator, project-scoped or fully standalone (global) — the planner assigns each step to one of your existing agents (that agent's own skills apply) or a plain model, whichever fits the step best.
2. **Review the generated plan** before anything runs. A plan is saved the moment it's generated and stays "Pending" indefinitely — reviewing it doesn't commit you to running it right away.
3. **Run it whenever you're ready**, step-by-step (gated: pause for your approval after every step) or fully automatic (advance immediately, only pausing on failure). Each step executes in its own dedicated conversation — never the project's main chat — with per-step retry, skip, and run-level abort.
4. **Reuse it later** via "Run again" on a finished run, no need to re-describe the goal to the AI — every generated plan is saved as a reusable template independent of its run history.

- Scheduled tasks: one-time or recurring (daily/weekdays/weekly/monthly) triggers that fire a plain chat message or drive one or more attached Automated Workflows, with crash-safe timer rehydration, missed-run catch-up, and retry with backoff
- A workflow's project scope (or lack of one) is fixed at creation — there's no way to move a standalone workflow into a project, or vice versa, afterward
- Fully synchronized between desktop and the Android companion over the paired WebSocket connection — generate, review, run, and manage workflows from either device

### Projects & Knowledge

- Project workspaces with per-project agent config, orchestration settings, scope rules, milestones, and workspace variables
- Project wiki: manual and AI-extracted knowledge entries, `@wiki` context references, queryable via `search_project_wiki` MCP tool
- External project-wiki MCP bridge: project-scoped loopback access for Codex/Claude with approval-gated writes ([details](docs/project-wiki-mcp.md))
- Prompt library with versioning, variable substitution, categories, tags, and per-version rollback
- Project and agent generators: guided multi-turn wizards for scaffolding new workspaces and teams

### MCP & Tools

- MCP (Model Context Protocol) server management: add, enable/disable, inspect discovered tools, and configure per-agent trust
- Easy Redmine MCP connector: local stdio integration for project/issue lookup and approval-gated ticket creation ([setup](integrations/easyredmine-mcp/README.md))
- Built-in tools: file editing and web fetch — with per-tool approval controls
- Desktop Navigator MCP (built-in): list windows, screenshot, OCR, clipboard read/write, mouse movement and clicks, keyboard input, window focus, and scroll — full desktop automation for agents using `@nut-tree-fork/nut-js`

### Artifacts

- Artifact generator: create multi-file documents, code, UI, data, prompts, and plans with version history and export (markdown, raw files)

### Project Git workbench

- Git housekeeping supports repository discovery, branches, checkout, fetch, pull, merge, diff, staging, commit, push, stash, and discard operations
- Desktop exposes typed `/code-*` Git commands; Android provides the tap-driven `/code` panel
- AI-assisted coding remains available through normal CLI-backed project conversations and configured MCP tools
- Per-project audit history keeps prior edit sessions readable with per-file, per-hunk diff inspection (Project Settings → Changes tab)

### Build & Deployment Pipelines

- Desktop build dashboard: typecheck, test, package, and publish workflows with build history
- Local update feed server (HTTP) for self-hosting releases on LAN
- Android build dashboard: Gradle commands, APK signing config, ADB device install, and Android OTA feed
- Workspace path configuration and rollback to previous build versions

### Android Companion App

Local-first Kotlin + Jetpack Compose app that works independently and synchronizes with a paired
desktop over the authenticated WebSocket connection:

- Pairing via QR code scan or manual token entry (mDNS/Bonjour auto-discovery, TLS with a QR-pinned local certificate, or a trusted external `wss://` endpoint)
- Standalone launch, Room-backed cached data, durable drafts, and an idempotent synchronization outbox
- Direct Anthropic, OpenAI, and OpenRouter chat with encrypted Android-local credentials
- Versioned peer synchronization with snapshots, incremental batches, tombstones, and conflict review
- Encrypted export/restore including content-addressed standalone attachments
- Home screen with scoped conversation history (filter by project or agent)
- Chat screen with live streaming output and voice input (on-device speech-to-text)
- Tool call approval with real-time activity feed (thinking, tool execution)
- FCM push notifications for offline approval requests (requires Firebase service account)
- Agent, skill, prompt, wiki, project, and artifact browsers — all remotely managed from desktop
- Agent and project generator wizards
- MCP server and CLI management
- Global and per-agent settings, model browser, provider configuration
- Connection diagnostics, notification diagnostics, and model availability checks
- Tap-driven `/code` Git panel with repository, branch, diff, staging, commit, push, and stash actions
- OTA update installer: receives builds from the desktop local feed server
- Android build dashboard
- Appearance settings (theme)
- Live connected-device count shown in desktop Settings → Mobile tab

See [Android standalone mode](docs/android-standalone.md) for offline limits, synchronization,
conflict handling, backups, and desktop-required capabilities. The
[standalone data and capability contract](docs/android-standalone-contract.md) defines identifiers,
record ownership, excluded fields, and the per-area capability matrix. The
[rollout and recovery policy](docs/android-standalone-rollout.md) defines privacy defaults, staged
enablement, automatic rollback criteria, and the release checklist.

### Desktop Experience

- SQLite-backed persistence for all settings, conversations, agents, projects, skills, prompts, and tool overrides
- Versioned database migrations (no data loss on upgrades)
- Theming, zoom, global hotkey, auto-start, toast notifications, and auto-updates (electron-updater)
- Debug mode with timestamped logging and Gist sharing for bug reports
- WCAG 2.1 AA accessible: focus-trapped modals, listbox/option ARIA on command menus, tablist/tab roles, `aria-activedescendant` on chat composer

## Tech Stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Shell     | Electron 33                                    |
| UI        | React 19, Tailwind CSS, Lucide icons           |
| Language  | TypeScript (strict)                            |
| State     | Zustand 5 + Immer                              |
| Database  | better-sqlite3 (SQLite, WAL mode)              |
| Markdown  | react-markdown + rehype-highlight + remark-gfm |
| MCP       | @modelcontextprotocol/sdk                      |
| Build     | electron-vite, Vite 6                          |
| Packaging | electron-builder                               |
| Tests     | Vitest 4, Testing Library, happy-dom           |
| Android   | Kotlin, Jetpack Compose, Material 3            |

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+**
- **Windows 10/11** or **macOS 12+**
- Python and a C++ compiler may be needed to build the `better-sqlite3` native module on some platforms (usually pre-built binaries are available)

## Installation

```bash
git clone https://github.com/Jhubkonto/nexy.git
cd nexy
npm install
```

`npm install` automatically runs `electron-rebuild` via the `postinstall` script to compile `better-sqlite3` against the correct Electron Node ABI.

## Running in Development

```bash
npm run dev
```

This starts the Electron app with Vite HMR for the renderer. On first launch, the onboarding screen will guide you through connecting a backend: BYOK API key, Claude CLI, Codex CLI, or Hermes CLI.

## Building for Production

```bash
# Build all bundles (main + preload + renderer)
npm run build

# Build + package for the current platform
npm run package

# Platform-specific packages
npm run package:win    # Windows NSIS installer + win-unpacked/
npm run package:mac    # macOS DMG
npm run package:linux  # Linux AppImage / deb
```

Packaged distributable files are written to the `release/` directory. The unpacked folder (`win-unpacked/`, etc.) can be run directly without installing.

## Scripts

| Script               | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Start the Electron + Vite development server              |
| `npm run build`      | Compile main, preload, and renderer bundles               |
| `npm run package`    | Build and create a distributable for the current platform |
| `npm run test`       | Run the Vitest suite once                                 |
| `npm run test:watch` | Run tests in watch mode                                   |
| `npm run typecheck`  | Type-check all source without emitting output             |
| `npm run lint`       | Run ESLint across `src/`                                  |

## Project Structure

```text
.
├── src/
│   ├── main/             # Main process: IPC handlers, database, providers, MCP, tools,
│   │                     #   project Git, build/android pipelines, WS server, local feed
│   ├── preload/          # Secure contextBridge preload (window.api)
│   ├── renderer/         # React SPA: components, hooks, Zustand store, slash commands
│   │   ├── components/   # UI panels (Chat, Sidebar, AgentPanel, SkillPanel, SelfHealPanel, …)
│   │   ├── components/chat/  # ChatWindow sub-components
│   │   ├── hooks/        # Custom React hooks (useChat, useFileInput, …)
│   │   └── store/        # Zustand store root + domain slices
│   ├── shared/           # Cross-boundary types, models, utilities
│   └── test/             # Test helpers and renderer environment mocks
├── android/              # Kotlin + Compose companion app
├── resources/            # App icons (icon.png, icon.ico, icon.icns)
├── scripts/              # Utility scripts (generate-icons.py)
├── roadmap/              # Feature roadmaps (scheduler, agent generator, …)
├── docs/                 # Mobile setup notes, agent presets, and feature plans
├── src/docs/             # Architecture and technical reference docs
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.typecheck.json
└── vitest.config.ts
```

For a detailed breakdown of modules, data flows, database schema, IPC model, and security model, see [ARCHITECTURE.md](src/docs/ARCHITECTURE.md).
For a plain-language product explanation and SWAD/SWDD design records, see the [Nexy architecture document set](docs/architecture/README.md).
For the current documentation map and the status of historical roadmaps, see [Documentation maintenance](docs/DOCUMENTATION_MAINTENANCE.md).

## Troubleshooting

**App crashes with `NODE_MODULE_VERSION` error**
`better-sqlite3` was compiled against the wrong Node ABI. Fix with:

```bash
npx electron-rebuild -f -w better-sqlite3
```

**Blank window / white screen on dev start**
Wait for Vite to finish its initial bundle — the renderer URL loads before the Vite dev server is ready on the first cold start. The window will populate automatically.

**Backend unavailable**
If chats cannot start, open Settings and verify that at least one backend is ready: a configured BYOK provider key, Claude CLI, Codex CLI, or Hermes CLI.

**Install natural local speech output**
Open **Settings → General → Local neural voice output** and select **Install Supertonic**. Nexy verifies the optional model download and keeps system voices as a fallback. Supertonic model licensing and attribution are documented in [docs/licenses/SUPERTONIC.md](docs/licenses/SUPERTONIC.md).

**Windows installer closes without installing**
Run `Nexy Setup x.x.x.exe` as Administrator, or install to a user-owned path (e.g. `C:\Users\<you>\Apps\Nexy`) instead of `C:\Program Files\`. Alternatively run `win-unpacked\Nexy.exe` directly — no installation needed.

## Contributing

Contributions are welcome. Before making major changes, review the roadmaps in `roadmap/` for current priorities. Run `npm test` and `npm run typecheck` before submitting a PR.

## License

Nexy is licensed under the [MIT License](LICENSE). This is a free and
permissive license: anyone, including an employer, may use, copy, modify,
redistribute, and commercially use a released copy, provided the required
copyright and license notices are retained.

The MIT license grants permission to use the software; it does not itself
assign copyright ownership to the person or organization using it. To the
extent the rights are owned by the author, the Nexy project and its original
copyright remain attributed to Julian Lacis. Ownership can nevertheless be
affected by employment contracts, contributions from other authors, or
mandatory law, so the project notice is not a substitute for an employment/IP
agreement.

The project may use a different license for a future release. A later license
change applies to that release and later releases; it does not revoke the MIT
rights already granted to recipients of an earlier MIT release. See the
[third-party notices](THIRD_PARTY_NOTICES.md).

Nexy does not include or grant access to Anthropic, OpenAI, Claude Code, or
Codex services. Users provide their own provider accounts, API keys, or local
CLI installations, and those services remain subject to their own terms.
