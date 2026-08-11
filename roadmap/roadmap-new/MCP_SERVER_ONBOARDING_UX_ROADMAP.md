# MCP Server Onboarding UX Roadmap

## Problem

Adding an MCP server today is a **blank-form-first** flow. `McpServerPanel.tsx` opens
to a list, and "Add MCP Server" drops the user into raw fields — *Name*, *Command*,
*Arguments*, *Working Directory*, *Env* — which assumes the user already knows a package
name like `npx -y @modelcontextprotocol/server-github` off the top of their head. Almost
nobody does. Users think in **capabilities** ("read my GitHub", "search the web", "use my
filesystem"), not launch commands.

The fix is to make **catalog-first the default path** and demote the raw command form to an
"Advanced / Custom" escape hatch.

## What already exists (don't rebuild)

- **Presets are already a mini-catalog.** `PLAYWRIGHT_PRESETS` (`McpServerPanel.tsx:104`)
  is a `{ label, description, config: {command,args,env} }` array rendered as "Quick-add
  presets" cards. The gallery is an *expansion* of this shape, promoted to the top of the
  flow — not a from-scratch build.
- **Paste-JSON import already works.** `handleJsonImport` (`McpServerPanel.tsx:218`) parses
  the Claude Desktop `{ "mcpServers": { … } }` shape and bulk-adds. It just needs to be
  surfaced better and to pre-fill the form for review rather than importing blind.
- **Status / tool discovery is already push-based.** `connectServer` → `client.listTools()`
  populates `instance.tools`; `broadcastServerStatus` pushes `mcp:server-status-changed`
  with `toolCount`. A "✓ Connected, found N tools" pre-flight reuses this almost entirely.

## Findings that shape the plan

1. **Single React surface.** Everything is `src/renderer/components/McpServerPanel.tsx`,
   opened via the `showMcpPanel` Zustand flag from `GeneralTab.tsx` ("Configure"). One file
   to restructure.
2. **Android is NOT shared.** It is native Kotlin (`android/app/src/`); desktop is React.
   Roadmap treats Android as a fast-follow that consumes the same catalog JSON.
3. **⚠️ Secrets are stored in plaintext.** `mcp_servers.config_json` holds the whole config
   **including `env`** as a plain JSON string — `saveServerConfig` (`mcp.ts:86`) does
   `JSON.stringify(rest)`. This is *not* the `safeStorage`-encrypted path provider API keys
   use. Any "guided secret field" (Phase 2) must fix this or it ships a regression in disguise.
4. **Add-time trust has no home yet.** Trust is per-*agent* (`agent_mcp_server_trust`, keyed
   by `agent_id`); the global panel has no agent context. Trust-at-add-time (Phase 3) needs
   either a global default-trust column on `mcp_servers` or an explicit "apply to which
   agents?" step.

## Catalog entry shape

New `src/shared/mcp-catalog.ts`, imported by the panel (and future Android export):

```ts
export interface McpCatalogEntry {
  id: string                    // 'github', 'filesystem'
  name: string                  // default server name pre-filled into the form
  description: string
  category: McpCatalogCategory  // 'web' | 'files' | 'dev' | 'data' | 'productivity' | 'browser'
  command: string
  args: string[]
  env?: Record<string, string>
  imageResponses?: 'allow' | 'omit'
  // Declared secrets → rendered as labeled fields (Phase 2), stored encrypted
  requiredEnv?: { key: string; label: string; helpUrl?: string; secret?: boolean }[]
  docsUrl?: string
  keywords?: string[]           // capability search ("screenshot", "browse")
}
```

Seeded hand-curated with the official `@modelcontextprotocol/server-*` family (filesystem,
git, github, fetch, memory, time, sequential-thinking, everything) plus the existing
Playwright entries. No network dependency in Phase 1.

## Phased plan

### Phase 1 — Catalog-first UX (pure renderer + one new shared file) ← THIS PR
- Add `src/shared/mcp-catalog.ts` with `MCP_CATALOG` + `searchCatalog()` helper.
- Restructure `McpServerPanel.tsx` from two views into three:
  - **Gallery (default)** — searchable capability cards grouped by category; a "Custom
    server" card and a "Paste JSON" card sit at the end.
  - **Guided form** — pre-filled from a card; Command / Arguments / Working Directory tucked
    behind an "Advanced" disclosure (visible by default for the Custom entry).
  - **Paste JSON** — unchanged import, reachable as a gallery card instead of a header toggle.
- No IPC changes, no schema changes. Highest ROI, lowest risk.

### Phase 2 — Pre-flight test + guided secrets ← SHIPPED
- ✅ New IPC `mcp:test-server` (`testMcpServer` in `mcp.ts`): an ephemeral, **non-persisting**
  stdio connect that calls `listTools()` and returns `{ ok, tools[] }` or the error, then tears
  the transport down without touching the live `servers` map. Wired as a "Test connection"
  button in the form showing "✓ Connected — found N tools" or the spawn error.
- ✅ `requiredEnv` rendered as labeled, masked secret fields with "How to get one" help links;
  guided keys are held out of the generic env editor and merged back on save.
- ✅ **Secret storage fixed**: `config_json` (which carries `env` secrets) is now encrypted at
  rest via Electron `safeStorage`, flagged by a new `mcp_servers.config_encrypted` column
  (migration 91). Mirrors `provider-secrets.ts`; legacy plaintext rows still decode, and we
  fall back to plaintext when the OS keyring is unavailable.
- Tests: encryption round-trip + plaintext fallback, `mcp:test-server` happy/blank/no-persist
  paths (`mcp.test.ts`); guided secret field + Test-connection success/failure
  (`mcpserverpanel.test.tsx`).

### Phase 3 — Live registry federation + add-time trust
- ✅ Main-process registry browser backed by the official read-only
  `GET /v0.1/servers` endpoint, with name search, one-hour in-memory/SQLite caching, stale-cache
  fallback, and normalized server metadata in `src/main/mcp-registry.ts`.
- ✅ Registry results are treated as discovery metadata, not trusted commands. Only pinned npm or
  PyPI packages using `npx`/`uvx` and `stdio` are offered as guided installs; remote-only and
  unsupported package entries remain viewable with source/documentation links.
- ✅ The MCP panel now has a "Browse official MCP Registry" view and sends installable results
  through the existing guided form, including declared environment-variable fields.
- ✅ Post-install handoff asks whether to assign the server to an agent. A dedicated
  `agent:assign-mcp-server` operation adds the server and persists the selected trust tier, with
  **Ask before running** as the default.
- Tests cover registry normalization, cache reuse/stale fallback, backend assignment/trust
  persistence, and the renderer browse/install/handoff flows.

### Phase 4 — Android parity ← SHIPPED
- ✅ Added the `mcp:catalog` companion command. It sends the hand-curated `MCP_CATALOG`
  metadata over the existing WebSocket connection; registry results and user-entered secrets
  are intentionally excluded.
- ✅ Android parses and caches the catalog in `WsRepository`, clears it on disconnect, and
  requests it when opening MCP settings. The catalog includes capability tags, install command
  metadata, declared environment-variable fields, and image-response settings.
- ✅ Reworked the native add sheet into a capability-first gallery with search, catalog cards,
  "Needs key" badges, masked required-secret fields, command preview, and a preserved Custom /
  Advanced escape hatch for npm, local script, Docker, and manual servers.
- ✅ Catalog installs forward environment variables and `imageResponses` through the existing
  mobile-to-desktop add command; no credentials are stored on the phone by this flow.
- ✅ Added desktop WS coverage for catalog delivery and Android parser coverage for required
  environment metadata.

Android parity now consumes the same desktop-curated catalog contract; adding or revising a
catalog entry only requires changing `src/shared/mcp-catalog.ts`.

### Follow-up UI polish — Android MCP management ← SHIPPED

The first Android parity pass still mixed server administration, connection health, and a raw
tool inventory into one long scrolling page. The native settings surface now:

- leads with an MCP workspace summary (server, connection, and tool counts);
- presents configured servers as bounded cards with clear status, tool count, and overflow actions;
- moves tools into a dedicated searchable **Tool library** bottom sheet;
- groups tools by server and collapses multi-server groups by default, while search expands matching
  groups automatically;
- uses a lazy list for server and tool content so the page remains usable as the inventory grows.

The underlying protocol and tool data are unchanged; this is an information-architecture pass
that keeps the main settings surface focused on servers and makes the full tool inventory a
purpose-built browsing experience.

### Follow-up UI polish — Desktop MCP workspace ← SHIPPED

The desktop panel now follows the same information architecture instead of treating every MCP
concern as one settings list:

- **Servers** is the default workspace. It leads with connection/tool summaries, presents
  bounded server cards, and keeps raw commands and working directories behind a Technical details
  disclosure.
- **Tool library** is a dedicated searchable view grouped by server, with capability filters for
  Files, Browser, Git, Web, Data, and System. Tool rows use friendly labels, descriptions,
  access metadata, and clearly marked impact guidance.
- **Agent access** is a dedicated view for selecting an agent, enabling/removing servers, and
  setting the server-level approval policy. New access remains approval-required by default;
  per-tool overrides continue to live in the agent editor for advanced cases.
- The server catalog and guided onboarding remain available from the Servers workspace, including
  the official registry, Custom server, and Paste JSON escape hatches.

Impact labels are intentionally presented as guidance derived from tool names/descriptions; they
are not a replacement for reviewing a server's source or documentation.

## Historical first-PR scope

Phase 1 only: `mcp-catalog.ts` + `McpServerPanel.tsx` restructure. Self-contained, no
main-process or DB risk, immediately fixes the blank-form-first problem. Phase 2's
secret-storage fix is the one not to let slip — it is a latent security issue independent of
the UX work.
