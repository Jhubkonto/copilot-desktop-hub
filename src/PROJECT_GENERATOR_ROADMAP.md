# Project Generator Parity And UX Roadmap

## Current State

Desktop has the more complete Project Generator experience: chat, generated spec preview, editable review, manual setup, project creation, agent creation, default model assignment, project selection, and rollback. Android had a thinner Settings-only flow with chat, read-only review, confirm, and done states.

## Completed

- [x] Add mobile Project Generator `sessionId` support for start, message, confirm, cancel, and result events.
- [x] Add `project-generator:turn-complete` so Android can finish assistant clarification turns without waiting for a generated spec.
- [x] Ignore unrelated Android Project Generator events by active session id.
- [x] Preserve generated `rootDirectory`, `instructionMode`, `defaultModel`, agent tools, response format, and temperature in Android models and confirm payloads.
- [x] Support wrapped mobile spec payloads while keeping the older bare payload parser-compatible.
- [x] Apply `defaultModel` when creating a project from the shared desktop/mobile creation path.
- [x] Load existing agent summaries on the desktop bridge when Android does not provide full agent context.
- [x] Add Android Projects-tab access to Project Generator while preserving manual project creation.
- [x] Make Android review editable for core project fields: name, root directory, instructions, and instruction mode.

## Remaining Work

- [ ] Add a full Android editor for variables, scope globs, milestones, orchestration, default model selection, and agent details.
- [ ] Add an Android post-create “Open project” flow that refreshes projects and navigates directly to the created project surface.
- [ ] Centralize Project Generator spec normalization in a shared module with explicit validation errors for missing required fields.
- [ ] Add desktop renderer tests for the modal edit/create path.
- [ ] Add Android parser and ViewModel tests for full spec parsing, turn completion, session filtering, and confirm payloads.
- [ ] Add an end-to-end parity check that creates a project from the same spec through desktop and Android paths and compares stored project config.

## Acceptance Criteria

- Android no longer stays loading after assistant clarification turns.
- Android-created projects preserve the same project config and agent settings as desktop-created projects for the same generated spec.
- Project Generator is discoverable from the Android project list, not only Settings.
- Both clients handle loading, retry, reset, cancel, creation success, and creation error states without losing user input.
