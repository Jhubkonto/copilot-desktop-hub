# Skills and runtime capabilities

> This document describes the current lifecycle. The user-facing capability flow is implemented
> for desktop chat and the Android chat entry point; advanced package discovery and full catalog
> parity remain separate management paths.

## Diagnosis: `audit-thingsboard-instance`

The ThingsBoard audit package is a valid NEXY skill package. Its `SKILL.md` is the executable
instruction source. `manifest.json` and `agents/openai.yaml` are companion metadata files; they
are not an invocation mechanism in NEXY.

There are separate capability gates in NEXY, but users can now complete them from the chat:

1. **Discovery** — the project source must be configured in NEXY and the package must be below a
   supported skill root. Project sources now include `.claude/skills`, `.agents/skills`, and
   `skills`.
2. **Import** — discovery is read-only. The package must be imported into NEXY's managed skill
   library.
3. **Chat/project/agent activation** — an imported skill can be used in the current chat without
   an agent, or promoted to a project or agent for reuse. `$audit-thingsboard-instance` remains an
   explicit invocation; activation only prepares the context.
4. **Runtime capability** — the skill cannot create or grant browser tools. The capability sheet
   can select a connected browser MCP server, while NEXY's MCP catalog provides Playwright
   (Chromium) for setup.

The previous failure was therefore not one missing registration table. It was a mismatch between
an external harness package and NEXY's four-stage lifecycle, plus the missing `skills/` discovery
root. The package manifest's browser requirement is now retained in the managed/discovered skill
metadata so the UI and future diagnostics can explain a missing runtime prerequisite instead of
reporting only “skill unavailable”.

## ThingsBoard audit setup (current UX)

For the Lynx audit:

1. Import the package directly from its `SKILL.md`, or discover it from an enabled project source.
2. Open a chat and choose **Capabilities** in the chat header.
3. Select `audit-thingsboard-instance`, select **Playwright (Chromium)** once it is configured,
   and leave MCP trust at **Ask before running**.
4. Choose **This chat** for a one-off audit, or promote the setup to the current project/agent.
   Promotion is additive. To later revoke a project grant or loosen its approval level, edit
   **Project Settings → Capabilities**, which owns the project's full set. Prefer project scope for
   domain knowledge that belongs to one codebase (an instance-audit skill, a project-specific MCP
   server); prefer agent scope only for capabilities a role should carry across every project.
5. Invoke explicitly:

   ```text
   $audit-thingsboard-instance
   ```

7. Supply the instance URL, authorization confirmation, scope, and output directory. Enter
   credentials only in the interactive browser handoff.

If the skill appears in discovery but cannot activate, import it from the Skills screen. If the
readiness checklist reports a missing or disconnected browser, use **Open MCP setup** (or **Fix
MCP setup**) to open the MCP workspace, then return to the chat. The same actions are available
from the Android capability sheet and navigate to the desktop-owned MCP settings when paired. If
Playwright connects but the browser cannot start,
inspect the MCP server error; the `npx` launch path may need network access or a locally installed
Playwright MCP executable.

## Architectural boundary

Skills describe behavior and may declare required capabilities. MCP servers provide capabilities.
The skill package must never be able to silently install, enable, or trust an MCP server. This
keeps external skill instructions from expanding the agent's authority. Capability negotiation and
read-only enforcement remain runtime responsibilities and should be extended with a dedicated
audit adapter if the ThingsBoard workflow needs hard network-method enforcement rather than
instruction-level compliance.
