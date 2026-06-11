# Nexy

A provider-agnostic native AI workspace — locally-first, with custom agents, multi-provider LLM support (BYOK or Claude CLI), MCP server integration, built-in tools, and project-scoped workspaces.

<!-- TODO: add screenshot -->

## Features

- Native Electron desktop shell with React 19 + TypeScript UI
- Multi-conversation chat with streaming responses and per-conversation abort
- GitHub Device Code OAuth with OS keychain-backed token storage
- Multi-provider LLM support: GitHub Copilot, OpenAI, Anthropic, Azure OpenAI
- Custom agent builder: system prompt, model, temperature, tools, memory, context rules, and custom slash commands
- Agent knowledge files with always/on-demand injection and inline editing
- Multi-agent orchestration: leader delegates sub-tasks to specialist team agents
- MCP (Model Context Protocol) server management and tool discovery
- Built-in tools: file editing, terminal, and web fetch — with per-tool approval controls
- Slash commands for chat management, model switching, sharing, context, and code-oriented prompts
- @-context references for injecting files and directories into prompts
- Project workspaces with organization, pinning, per-project agent config, and orchestration settings
- Title bar agent badge, quick edit action, and directory breadcrumb picker
- Working directory management with recent directory history
- Embedded xterm.js terminal panel
- SQLite-backed persistence for all settings, conversations, agents, projects, and tool overrides
- Versioned database migrations (no data loss on upgrades)
- Theming, zoom, global hotkey, auto-start, toast notifications, and auto-updates
- 600+ Vitest tests across main-process and renderer

## Tech Stack

| Layer     | Technology                                     |
| --------- | ---------------------------------------------- |
| Shell     | Electron 33                                    |
| UI        | React 19, Tailwind CSS, Lucide icons           |
| Language  | TypeScript (strict)                            |
| State     | Zustand 5 + Immer                              |
| Database  | better-sqlite3 (SQLite, WAL mode)              |
| Markdown  | react-markdown + rehype-highlight + remark-gfm |
| Terminal  | xterm.js (@xterm/xterm)                        |
| MCP       | @modelcontextprotocol/sdk                      |
| Build     | electron-vite, Vite 6                          |
| Packaging | electron-builder                               |
| Tests     | Vitest 4, Testing Library, happy-dom           |

## Prerequisites

- **Node.js 18+** (LTS recommended)
- **npm 9+**
- **Windows 10/11** or **macOS 12+**
- A GitHub account (required for Copilot authentication)
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

This starts the Electron app with Vite HMR for the renderer. On first launch you will be prompted to authenticate with GitHub via the Device Code flow.

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
