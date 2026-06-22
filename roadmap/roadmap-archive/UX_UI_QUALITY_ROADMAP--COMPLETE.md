# Nexy Android UX/UI Quality Roadmap

Last updated: 2026-06-21

Goal: keep the Android app comfortable, predictable, and safe for a solo developer using it as a companion to Nexy Desktop. This roadmap focuses on UI consistency, logical state transitions, recoverability, and confidence around high-impact actions.

## Completed

### Shared UX primitives

- [x] Add shared confirmation dialog for destructive or high-impact actions.
- [x] Add shared info/error dialog for validation and workflow errors.
- [x] Add shared empty-state component.
- [x] Add shared search field component.
- [x] Add shared status badge component.

### Safer destructive flows

- [x] Confirm chat deletion.
- [x] Confirm project deletion.
- [x] Confirm agent deletion.
- [x] Confirm message deletion.
- [x] Confirm deleting saved server profiles.
- [x] Confirm forgetting the active server.
- [x] Confirm removing API provider keys.
- [x] Confirm prompt deletion.
- [x] Confirm Feature Generator apply-all before writing workspace changes.
- [x] Confirm Feature Generator commit before creating a desktop git commit.
- [x] Confirm Feature Generator reset/start-over.

### Discoverability and navigation

- [x] Add visible overflow actions to chat rows.
- [x] Add visible overflow actions to project rows.
- [x] Add visible overflow actions to agent rows.
- [x] Remove deprecated swipe-to-delete wrappers from Home lists.
- [x] Add back navigation to QR pairing screen.
- [x] Add back navigation to manual pairing screen.
- [x] Add Android settings recovery action when camera permission is unavailable.
- [x] Group Settings power-user destinations under one `Advanced tools` section.

### Feedback and recovery

- [x] Show snackbar when a selected chat attachment is larger than 4 MB.
- [x] Show snackbar feedback when provider key update/remove commands are sent.
- [x] Surface Prompt Library validation errors.
- [x] Surface Feature Generator errors through the shared info dialog.
- [x] Show chat connection banner for reconnecting/disconnected states.
- [x] Disable chat send while disconnected or reconnecting.
- [x] Replace deprecated Compose clipboard access with Android platform clipboard service.
- [x] Add visible refresh action to Artifacts.
- [x] Add visible refresh action to Prompt Library.
- [x] Add refresh actions to empty states where recovery is useful.

### List comfort and growth

- [x] Add local search to Artifacts.
- [x] Add local search to Prompt Library.
- [x] Add local search to Self-Heal reports.
- [x] Add clear-search actions and no-result empty states.
- [x] Standardize empty states in Home, Artifacts, Prompt Library, and Self-Heal reports.
- [x] Standardize artifact kind/status badges.
- [x] Standardize Self-Heal report status badges.

### Feature Generator flow

- [x] Add visible phase progress indicator: Describe -> Spec -> Plan -> Apply -> Done.
- [x] Add visible reset action for active runs.
- [x] Add confirmation gates before apply, commit, and reset.

### Verification

- [x] Run `./gradlew.bat testDebugUnitTest` after each implementation slice.
- [x] Keep Android unit tests passing after UX changes.
- [x] Update chat history tests to assert persisted message IDs are retained.

## Remaining

### Shared UI system cleanup

- [x] Extract shared top app bar patterns for back-only screens and settings/tool screens.
- [x] Extract shared navigation row pattern for Settings and secondary list destinations.
- [x] Extract shared list row/action menu pattern for repeated title/subtitle/action rows.
- [x] Extract shared form sheet shell for create/edit sheets.
- [x] Review all one-off `AlertDialog` usages and migrate appropriate cases to shared dialogs.
- [x] Migrate existing screens to use `NexyTopAppBar` composable.
- [x] Migrate existing form sheets to use `NexyFormSheet` composable.

### Information architecture

- [x] Decide whether `Advanced tools` should remain in Settings or become a top-level Tools screen. (Decision: keep in Settings — solo-user workflow, no nav restructure needed.)
- [x] Add concise section summaries for dense Settings groups.
- [x] Move low-frequency diagnostics details behind expandable detail rows where appropriate.
- [x] Review Settings ordering after real usage: Connection, Models, Notifications, Appearance, Updates, Advanced tools, Diagnostics, Actions.

### Core flow polish

- [x] Add explicit send-failure feedback if a chat send command cannot be delivered.
- [x] Add retry/resend state for failed optimistic user messages.
- [x] Add attachment picker feedback for unsupported or unreadable files.
- [x] Replace custom pull-to-refresh wrappers in chat/home with Material `PullToRefreshBox`.
- [x] Add loading indicators to Artifacts, Prompt Library, and provider screens where data is requested but not yet returned.

### Accessibility and visual QA

- [x] Add Compose UI tests for destructive confirmation dialogs.
- [x] Add Compose UI tests for secondary screen search and clear-search flows.
- [x] Add Compose UI tests for Feature Generator phase indicator and reset confirmation.
- [x] Audit icon content descriptions across all Android screens.
- [x] Verify touch targets are at least 48dp for list action menus and compact controls.
- [x] Test text wrapping/truncation on small phones and large screens. (Audit: all text uses maxLines+ellipsis or weight(1f) fill; widthIn caps on bubbles/badges prevent overflow.)
- [x] Check light/dark contrast for status badges, error banners, and advanced tool rows. (Audit: badges use Material3 container/on-container pairs; error banners use errorContainer/onErrorContainer; no hardcoded light-only colors detected.)

### Secondary screen polish

- [x] Add search to Providers if provider list grows or includes extra metadata.
- [x] Add filter chips to Self-Heal reports for status groups.
- [x] Add artifact status filter chips if artifact volume grows.
- [x] Add prompt category filter chips if prompt volume grows.
- [x] Add empty-detail guidance for artifact details with no current version/files.

### Chat message actions

- [x] Add "Select text" to the long-press bubble menu for assistant messages (copies text; native select-text via clipboard).
- [x] Add "Branch in new chat" to the long-press bubble menu for assistant messages — forks conversation up to and including that message into a new chat (maps to the existing desktop fork/branch IPC).
- [x] Add "Retry" to the long-press bubble menu for assistant messages — re-runs the last user message that produced this response (complement to "Resend" on user bubbles).
- [x] Add "Edit message" to the long-press bubble menu for assistant messages — populates the input field with the assistant reply text so the user can copy-edit and re-send as a user message.
- [x] Add "Add to project sources" to the long-press bubble menu for assistant messages — saves the message content as a project knowledge source/artifact on the desktop.
- [x] Add per-message bottom action bar (copy / share / `...`) below assistant bubbles as an alternative to long-press, matching ChatGPT's discoverability pattern; `...` opens the same overflow menu.
- [x] Add "Read aloud" (TTS) action to the assistant bubble action bar / overflow menu — speaks the message text using Android TextToSpeech.

## Acceptance Standard

- Every destructive action is confirmed, undoable, or clearly reversible.
- Every screen that fetches remote data has a visible empty, loading, error, and retry path.
- Primary actions are visible; long-press and gestures are shortcuts only.
- Multi-step flows show current phase and next action.
- Searchable lists have clear search, no-result, and reset states.
- Android unit tests pass after each UX change.
