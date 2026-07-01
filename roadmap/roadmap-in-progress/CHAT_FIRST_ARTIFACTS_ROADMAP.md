# Roadmap: Reposition Artifacts Around Chat-First Creation

## Summary

Shift artifacts from a standalone creation-first feature to a chat-first persistence feature. Keep artifacts as a durable, versioned output system, but make normal chat the place users ask for content. The main flow is: generate in chat, then promote a useful assistant reply into an artifact. Preserve the existing list-first artifact history entry points on both platforms.

## Key Changes

### Product behavior

- Keep `Artifacts` as a browser/library, not a primary creation destination.
- Preserve current list-first navigation:
  - Desktop `Artifacts` continues opening the `SectionPane` list.
  - Android `Artifacts` continues opening `ArtifactsScreen` list before any detail view.
- Remove standalone new-artifact generation from artifact history:
  - Desktop artifact lists are browse/history surfaces with no generator entry.
  - Android `ArtifactsScreen` has no generator action or standalone generator route.
- Define the primary artifact creation path as `Save as artifact` / `Promote to artifact` from assistant output.

#### Action checklist

- [x] Audit current desktop artifact toolbar actions and remove standalone generation.
- [x] Remove generator actions from the desktop artifact pane and project artifact list.
- [x] Remove the Android `ArtifactsScreen` generator action and standalone route.
- [x] Verify desktop artifact navigation still opens the existing `SectionPane` list.
- [x] Verify Android artifact navigation still lands on `ArtifactsScreen` list-first.
- [x] Update any roadmap-adjacent docs or labels that still imply artifacts are a primary creation surface.

### New chat-to-artifact flow

- Add a new assistant-message action on desktop and Android: `Save as artifact`.
- Scope v1 to assistant replies only. Do not support promoting user messages, tool-call rows, or in-progress streaming content.
- Promotion saves the literal assistant output without another LLM pass.
- Promotion opens a lightweight confirm sheet/dialog with these fields:
  - `title`: prefilled from the first Markdown heading if present, otherwise conversation title, otherwise `New Artifact`.
  - `kind`: default `document`; allowed values limited to `document`, `prompt`, `plan`, `code`, `other`.
  - `scope`: default current project when chat is project-scoped, otherwise `global`.
  - `file path`: default by kind: `output.md` for `document`/`plan`, `prompt.md` for `prompt`, `output.ts` for `code`, `output.txt` for `other`.
- Saved artifact shape for v1:
  - exactly one output file
  - one initial version
  - file body equals the assistant message text after removing Nexy-only control wrappers if any exist
  - export formats default to `markdown` + `raw-files` for Markdown/text kinds; `raw-files` only for `code`
- After save, show success toast/snackbar with `View artifact` action. The artifacts list refreshes immediately.

#### Action checklist

- [x] Add a desktop assistant-message action for `Save as artifact`.
- [x] Add an Android assistant-message overflow action for `Save as artifact`.
- [x] Create a desktop promotion dialog with title, kind, scope, and file-path fields.
- [x] Create an Android promotion bottom sheet with the same fields and defaults.
- [x] Implement title defaulting from first Markdown heading, then conversation title, then `New Artifact`.
- [x] Implement kind-based default file-path generation.
- [x] Default scope from the active project when the chat is project-scoped, otherwise global.
- [x] Restrict v1 promotion to completed assistant replies only.
- [x] Save promoted content as a single-file initial artifact version.
- [x] Show success feedback with a `View artifact` affordance.
- [x] Refresh artifact list/detail state immediately after successful promotion.

### Backend and interface changes

- Add a non-LLM artifact persistence path alongside the current generator flow.
- New desktop IPC and Android WS command:
  - `artifact:promote-message`
- Request payload:
  - `conversationId`
  - `messageId`
  - `title`
  - `kind`
  - `scope { type: 'global' | 'project', projectId? }`
  - `filePath`
- Behavior:
  - read the referenced assistant message from persistence
  - validate that the message belongs to the conversation and is an assistant message
  - create artifact/version/file rows using existing artifact tables
  - write the promoted content to artifact storage using the same storage-root conventions as generated artifacts
  - emit the same artifact list/detail refresh events already used by artifact creation flows where possible
- Do not add artifact-spec generation to promotion v1. Promotion is persistence, not generation.
- Keep existing `Generate new version` behavior on artifacts. A promoted artifact can later be revised through the current artifact generator flow.

#### Action checklist

- [x] Add shared types for the `artifact:promote-message` request and response shape.
- [x] Add desktop IPC handler for `artifact:promote-message`.
- [x] Add Android WS command handling for `artifact:promote-message`.
- [x] Implement message lookup and role/conversation ownership validation.
- [x] Implement promoted artifact file writing using the existing artifact storage-root conventions.
- [x] Insert artifact, version, and file rows through the existing schema.
- [x] Reuse current artifact refresh/broadcast mechanisms so both desktop and Android update without custom polling.
- [x] Preserve current generator and version-revision behavior unchanged.

### UI integration by surface

- Desktop chat:
  - add `Save as artifact` to assistant message actions, alongside existing per-message actions
  - add optional `Open artifacts` shortcut in the chat action menu only if no artifact browser is open
- Desktop artifacts pane:
  - keep list behavior unchanged
  - do not expose standalone new-artifact generation
  - keep artifact detail side panel and version/export/revise actions unchanged
- Android chat:
  - add `Save as artifact` to assistant message overflow/actions
  - use a bottom sheet for promotion metadata entry
- Android artifacts:
  - keep `ArtifactsScreen` as the first destination when tapping artifacts
  - do not expose standalone new-artifact generation
  - keep current detail-after-selection behavior for this roadmap; do not require a new detail route in this pass

#### Action checklist

- [x] Wire desktop chat message actions to open the promotion dialog with the selected message context.
- [x] Wire Android chat assistant-message actions to open the promotion sheet with the selected message context.
- [x] Add desktop success navigation from promotion feedback into the artifact browser/detail view.
- [x] Add Android success navigation from promotion feedback into the artifact browser/detail view.
- [x] Keep desktop artifact detail panel behavior intact after promotion.
- [x] Keep Android selected-artifact detail flow intact after promotion.

## Completion gate for every key change

Do not mark any key change complete until all of the following are done for that change:

- [x] Write or update automated tests covering the changed behavior.
- [x] Run relevant test suites and confirm they pass.
- [x] Run `npm run lint` and fix any introduced issues.
- [x] Run `npm run typecheck` and fix any introduced type errors.
- [x] Run a build verification check and confirm it passes.
- [ ] Perform a manual smoke test for the affected desktop and/or Android flow.

## Test Plan

- Desktop renderer tests:
  - assistant message shows `Save as artifact`
  - save dialog prefills title/kind/scope/file path correctly
  - project-scoped chat defaults promotion to project scope
  - successful promotion shows success feedback and refreshes the artifacts list
  - non-assistant messages do not show the action
- Desktop main-process tests:
  - `artifact:promote-message` rejects missing conversation/message, wrong role, and empty content
  - promotion creates artifact, version, and file rows with correct scope and storage path
  - promotion of a second saved reply with the same title creates a new version only when explicitly targeted as the same artifact; otherwise v1 creates a new artifact
- Android tests:
  - assistant message action opens the promotion sheet
  - promotion sends the correct WS command payload
  - tapping `Artifacts` still lands on the artifact list screen
  - artifact list refreshes after promotion
- Manual scenarios:
  - save a PRD-style reply as a document artifact
  - save a prompt reply as a prompt artifact
  - save a code reply from a project chat and confirm it lands in project-scoped artifacts
  - revise a promoted artifact with `Generate new version`
  - export a promoted artifact from both desktop and Android

## Assumptions and defaults

- Create artifacts from chat; artifact lists are history/browser surfaces.
- Keep Android list-first artifact navigation as-is.
- Make reply promotion the primary v1 artifact-entry path.
- Do not add a pre-send `Generate as artifact` composer action in v1. That can be a later phase after promotion proves useful.
- Do not change artifact schema shape beyond adding one new command/path into the existing artifact persistence model.
