# Nexy

A provider-agnostic native AI workspace — locally-first, with custom agents, multi-provider LLM support (BYOK or CLI), MCP server integration, built-in tools, and project-scoped workspaces.

<!-- TODO: add screenshot -->

## Features

- Native Electron desktop shell with React 19 + TypeScript UI
- Multi-conversation chat with streaming responses and per-conversation abort
- **No account required** — connect your own API keys (OpenAI, Anthropic, Azure, Gemini, Mistral, Groq, xAI) or point at a local CLI (Claude CLI, Codex CLI)
- Custom agent builder: system prompt, model, temperature, tools, memory, context rules, and custom slash commands
- Agent knowledge files with always/on-demand injection and inline editing
- Multi-agent orchestration: leader delegates sub-tasks to specialist team agents
- MCP (Model Context Protocol) server management and tool discovery
- Built-in tools: file editing and web fetch — with per-tool approval controls
- Slash commands and @-context references for chat management, model switching, and context injection
- Project workspaces with per-project agent config, orchestration settings, and a project wiki
- Project wiki: manual and AI-extracted knowledge entries, `@wiki` context refs, model-queryable via `search_project_wiki` tool
- Prompt library with versioning, variable substitution, and per-version rollback
- Conversation portability: export/import, fork to another provider, and context compression for long sessions
- Screen capture overlay with rubber-band region selection and clipboard image injection
- Android companion app (Kotlin + Jetpack Compose): approves tool calls, monitors live output, receives OTA updates from the desktop, and sends FCM push notifications for offline approval requests
- Desktop build pipeline: typecheck, test, package, and publish releases to a local update feed from inside the app
- Android build pipeline: Gradle commands, APK signing config, ADB device install, and Android update feed
- SQLite-backed persistence for all settings, conversations, agents, projects, and tool overrides
- Versioned database migrations (no data loss on upgrades)
- Theming, zoom, global hotkey, auto-start, toast notifications, and auto-updates
- WCAG 2.1 AA accessible: focus-trapped modals, listbox/option ARIA on command menus, tablist/tab roles, aria-activedescendant on chat composer
- 714 Vitest tests across main-process and renderer

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

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+**
- **Windows 10/11** or **macOS 12+**
- Python and a C++ compiler may be needed to build the `better-sqlite3` native module on some platforms (usually pre-built binaries are available)

## Installation

```bash
git clone https://github.com/Jhubkonto/copilot-desktop-hub.git
cd copilot-desktop-hub
npm install
```

`npm install` automatically runs `electron-rebuild` via the `postinstall` script to compile `better-sqlite3` against the correct Electron Node ABI.

## Running in Development

```bash
npm run dev
```

This starts the Electron app with Vite HMR for the renderer. On first launch, the onboarding screen will guide you through connecting a backend: BYOK API key, Claude CLI, or Codex CLI.

## Building for Production

```bash
# Build all bundles (main + preload + renderer)
npm run build

# Build + package for the current platform
npm run package

# Platform-specific packages
npm run package:win    # Windows NSIS installer
npm run package:mac    # macOS DMG
npm run package:linux  # Linux AppImage / deb
```

Packaged distributable files are written to the `release/` directory.

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
│   ├── main/             # Main process: IPC handlers, database, auth, providers, MCP, tools
│   ├── preload/          # Secure contextBridge preload (window.api)
│   ├── renderer/         # React SPA: components, hooks, Zustand store, slash commands
│   │   ├── components/   # UI components (ChatWindow, Sidebar, AgentPanel, …)
│   │   ├── components/chat/  # ChatWindow sub-components
│   │   ├── hooks/        # Custom React hooks (useChat, useFileInput, …)
│   │   └── store/        # Zustand store root + domain slices
│   ├── shared/           # Cross-boundary types, models, utilities
│   └── test/             # Test helpers and renderer environment mocks
├── resources/            # Bundled app resources (icons, assets)
├── docs/                 # Mobile setup notes, agent presets, and feature plans
├── src/docs/             # Architecture and technical reference docs
├── android/ROADMAP.md    # Active roadmap
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig.typecheck.json   # Standalone typecheck config (no project-ref noise)
└── vitest.config.ts
```

For a detailed breakdown of modules, data flows, database schema, IPC model, auth flow, and security model, see [ARCHITECTURE.md](src/docs/ARCHITECTURE.md). The active roadmap lives in [android/ROADMAP.md](android/ROADMAP.md).

## Troubleshooting

**App crashes with `NODE_MODULE_VERSION` error**  
`better-sqlite3` was compiled against the wrong Node ABI. Fix with:

```bash
npx electron-rebuild -f -w better-sqlite3
```

**Blank window / white screen on dev start**  
Wait for Vite to finish its initial bundle — the renderer URL loads before the Vite dev server is ready on the first cold start. The window will populate automatically.

**Backend unavailable**  
If chats cannot start, open Settings and verify that at least one backend is ready: a configured BYOK provider key, Claude CLI, or Codex CLI.

## Contributing

Contributions are welcome. Before making major changes, review [android/ROADMAP.md](android/ROADMAP.md) for current priorities and expected coverage. Run `npm test` and `npm run typecheck` before submitting a PR.

## License

MIT
