# Copilot Desktop Hub

A desktop workspace for GitHub Copilot-style chat, custom agents, tools, context management, and MCP-powered workflows.

<!-- TODO: add screenshot -->

## Features

- Native Electron desktop shell with React + TypeScript UI
- Multi-conversation chat interface with streaming responses
- GitHub authentication and session-aware chat flows
- Custom agent builder with prompts, model settings, memory, context rules, and custom slash commands
- Skills tab for per-agent built-in tool controls and MCP tool overrides
- Agent knowledge files with always/on-demand injection and inline editing
- Title bar agent badge, quick edit action, and directory breadcrumb picker
- Working directory management with recent directory history and manual/browse switching
- Slash commands for chat management, models, sharing, context, and code-oriented prompts
- MCP server management and tool discovery
- Built-in terminal, file, and web tool plumbing with approval controls
- SQLite-backed persistence for settings, conversations, agents, projects, and tool overrides
- Project organization, pinning, theming, updates, and toast notifications
- Automated Vitest coverage for renderer and main-process behavior

## Tech Stack

- Electron
- React 19
- TypeScript
- Zustand + Immer
- Tailwind CSS
- better-sqlite3
- Vitest + Testing Library
- electron-vite / Vite

## Prerequisites

- Node.js 18+
- Windows 10/11 or macOS 12+

## Getting Started

```bash
git clone https://github.com/Jhubkonto/copilot-desktop-hub.git
cd copilot-desktop-hub
npm install
npm run dev
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Electron + Vite development environment |
| `npm run build` | Build main, preload, and renderer bundles |
| `npm run package` | Build the app and create distributable packages |
| `npm run test` | Run the Vitest suite once |
| `npm run typecheck` | Run TypeScript without emitting output |
| `npm run lint` | Run ESLint on `src/` |

## Project Structure

```text
.
├─ src/
│  ├─ main/                 # Electron main process, IPC handlers, DB, auth, MCP, tools
│  ├─ preload/              # Secure preload bridge exposed as window.api
│  ├─ renderer/             # React UI, Zustand store, components, slash commands
│  ├─ shared/               # Shared models and IPC-related types
│  └─ test/                 # Test helpers and renderer mocks
├─ resources/               # App resources bundled with releases
├─ implementation-plan.md   # Feature roadmap and implementation notes
├─ electron.vite.config.ts  # Electron + Vite build config
├─ electron-builder.yml     # Packaging config
└─ vitest.config.ts         # Test runner config
```

## Architecture Notes

- **IPC boundary:** renderer code talks to the main process only through the preload bridge (`window.api`).
- **SQLite:** persistent app state lives in a local better-sqlite3 database initialized in the main process.
- **Zustand:** renderer UI state, selections, and async actions are coordinated through a central Zustand store.

## Contributing

Contributions are welcome. Before making major changes, review `implementation-plan.md` to understand the feature roadmap, expected behavior, and test coverage requirements.

## License

MIT
