# Phase 0 — Code Changes Workspace-Path Verification

Status: **planning document**. Part of the Automated Workflow restructure roadmap — see `00-overview-and-sequencing.md` for how this fits with the other 8 phases.

## Goal

Confirm whether Code Changes creation is actually gated on a *configured workspace path* (`Project.rootDirectory`/`workspace_root`), not just a non-null project id, on both desktop and Android. If the gate is missing, add it. This closes target-hierarchy point 6: "Code Changes can only be run in a chat window, inside a project that is set up with a workspace containing a codebase."

## Depends on / Blocks

- **Depends on**: nothing. Fully independent of the other 8 phases.
- **Blocks**: nothing downstream — this is a standalone correctness fix, not a prerequisite for Phase 1+.
- **Sequencing note**: do this first, or at least early, precisely *because* it has no dependencies — it's the easiest phase to lose track of once the bigger schema/executor/UI effort (Phases 1-8) is underway.

## Architectural design choices & reasoning

- **Why this is a "verify, then maybe fix" phase rather than a known bug**: the hierarchy research confirmed Code Changes is enforced as project-required at the *application/UI layer* on both platforms (desktop: `useChatWindowActions.ts:212-213` explicitly rejects a null `projectId`; Android: `RemoteEditStartScreen(projectId: String, ...)` takes a non-nullable `projectId`). What was **not** confirmed is whether a *configured workspace path specifically* is gated — `Project.rootDirectory` is nullable in the Android model with no client-side check found. It's entirely possible a project with no workspace configured still lets a user start an investigation that has nowhere to write a diff to. This needs an actual read of the current desktop and Android code paths before deciding whether a fix is even needed.
- **Why this rule matters conceptually**: Code Changes fundamentally needs a real filesystem location to investigate and apply diffs against. A project without a workspace path is a valid, supported state (chats and workflows don't need one) — but Code Changes specifically does, and that's the one thing today's project-id-only gate doesn't verify.
- **Why fix at the UI/application layer, not the DB layer**: this mirrors the existing pattern — `error_reports.project_id`/`workspace_root` are nullable DB columns, and the actual requirement is enforced where the user initiates the action (the `/code-change` slash command handler on desktop, the navigation entry point on Android), not via a DB constraint. Any fix here should follow that same precedent rather than introducing a new DB-level CHECK.

## Itemized todo checklist

- [ ] **Desktop**: read `src/renderer/hooks/useChatWindowActions.ts:212-213` and the surrounding `/code-change` slash-command handler in full. Confirm exactly what check is performed today (project id only, or also workspace path).
- [ ] **Desktop**: find where `Project.rootDirectory`/`workspace_root` (or equivalent) is read in the renderer, and confirm whether it's available to `useChatWindowActions.ts` at the point of the existing check.
- [ ] **Desktop**: if the workspace-path check is missing, add it to the existing rejection path (extend the same `{ error: '...' }` early-return pattern used for the missing-project case) with a clear error message (e.g. "Code changes require this project to have a configured workspace.").
- [ ] **Android**: read `RemoteEditStartScreen.kt`'s construction path and confirm whether anything checks `Project.rootDirectory` before allowing navigation into it.
- [ ] **Android**: find the "Investigate with AI" entry point in `ChatScreen.kt` (`onInvestigateWithAi`, gated today on `!chatProjectId.isNullOrBlank()`) and confirm whether it should also gate on the project having a configured workspace path.
- [ ] **Android**: if missing, add the workspace-path gate at the same entry-point level (disable/hide the "Investigate with AI" option, and/or guard the nav route), following the existing pattern of hiding an action when its precondition isn't met (mirrors how the option is already hidden entirely when there's no project, rather than shown-then-erroring).
- [ ] Decide and document (in a short note added to this file's "Findings" section below, once done) which of the two platforms — if either — needed a fix, so this doesn't need to be re-investigated later.

## Verification

- [ ] Manual test on desktop: create a project with no workspace path configured, attempt to start a Code Changes investigation from chat, confirm a clear rejection (not a silent failure or a confusing downstream error when the investigation tries to touch a nonexistent path).
- [ ] Manual test on Android: same scenario — project with no workspace, attempt the "Investigate with AI" flow, confirm the same graceful rejection or the option being unavailable.
- [ ] Confirm no regression: a project *with* a configured workspace still allows Code Changes to start normally on both platforms.

## Findings

**Status: DONE.** Confirmed the gap was real on both platforms — neither enforced a configured workspace path, only a non-null project id.

- **Desktop**: `useChatWindowActions.ts`'s `startCodeChange` already computed `workspaceRoot = projectConfig?.rootDirectory?.trim() || null` but passed it straight to `captureErrorReport` without checking it was non-null — `error-report-handlers.ts`'s `createErrorReport` accepts a null `workspaceRoot` with no rejection either. Fixed by adding `if (!workspaceRoot) return { error: 'Code changes require this project to have a configured workspace.' }` immediately after computing `workspaceRoot`, mirroring the existing `if (!projectId) return { error: ... }` pattern one line above it. The `/code-change` slash command already surfaces `result.error` via `ctx.pushSystemMessage`, so this required no changes to `slash-commands.ts` — the error now reaches the user through the existing path. Desktop has no separate "Investigate with AI" button (only the slash command), so this one fix closes the gap entirely.
- **Android**: `ChatScreen.kt`'s `onInvestigateWithAi` gate (assistant-message action) checked only `!chatProjectId.isNullOrBlank()`. Fixed by adding `!projects.find { it.id == chatProjectId }?.rootDirectory.isNullOrBlank()` to the same condition, so the action is hidden entirely (not just rejected after tapping) when the resolved project has no workspace configured. Also hardened the `LaunchedEffect(investigateMessage)` navigation trigger with the same check plus a snackbar message, as defense-in-depth in case `investigateMessage` is ever set through another path in the future.
- Verified: `slash-commands.test.ts` (23 tests) passes unmodified; Android `compileDebugKotlin` succeeds; desktop `tsc --noEmit` typecheck is clean.
