# External project MCP access

Nexy can expose one selected project to an external MCP client such as Codex or Claude. The
connection is named `nexy-project`; the Wiki screen remains the activation point because the
bridge is project-scoped.

On desktop, open **Project Settings → Wiki**, select **Connect** under **External LLM access**,
and copy the generated stdio configuration. On Android, open the project's **Project Wiki**
screen and use the **External LLM access** card to connect or disconnect the same desktop bridge;
Android can also copy or share the generated configuration. The configuration starts a small
stdio MCP proxy; the proxy talks to a loopback-only endpoint owned by Nexy. The external process
never opens or edits the SQLite database directly.

The endpoint exposes capability packs:

- `wiki`: search/list/propose wiki entries
- `workspace`: project context, sources, files, text search, approved file writes, and approved commands
- `git`: repositories, status, diffs, branches, log, approved commits, and approved branch creation
- `artifacts`: list/read/export versioned project artifacts
- `conversations`: search, message retrieval, and JSON export
- `audit`: edit sessions, touched files, and diffs
- `build`: preflight, standard builds, status/history, and cancellation
- `workflows`: list/get/start/retry automated workflows
- `agents`: list/get/create/update/delete agents; creation attaches the new agent to the selected project
- `skills`: list/get/create/update/delete managed skills
- `automation`: list/get/create/update/delete/run scheduled tasks and list their runs

Full tool names are discoverable through the MCP `tools/list` request. All reads are immediate.
Every tool that writes files, runs commands, changes Git, exports artifacts, starts or cancels a
build/workflow/schedule, or changes agents/skills opens Nexy's normal approval prompt. Approvals
are per operation and are never persisted as a blanket external-client trust decision.

The endpoint is bound to `127.0.0.1` and uses a per-project bearer token generated when the
connection starts. The token is only included in the copied configuration. Use **Stop** in the
Wiki tab when the external agent is finished; all bridges also stop when Nexy exits. Existing
configurations using `NEXY_PROJECT_WIKI_MCP_*` continue to work.

The selected project is enforced by the desktop bridge; callers cannot switch scope by passing a
different project id. Artifact, conversation, audit, workflow, and repository identifiers are
checked against that project before data is returned.

This endpoint is intentionally not exposed to the LAN, Tailscale, or the internet. Remote HTTP
MCP access needs a separate threat model, authentication lifecycle, and project/session
authorization design.
