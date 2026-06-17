# Nexy Android UX/UI Quality Roadmap

Last updated: 2026-06-17

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

- [ ] Extract shared top app bar patterns for back-only screens and settings/tool screens.
- [ ] Extract shared navigation row pattern for Settings and secondary list destinations.
- [ ] Extract shared list row/action menu pattern for repeated title/subtitle/action rows.
- [ ] Extract shared form sheet shell for create/edit sheets.
- [ ] Review all one-off `AlertDialog` usages and migrate appropriate cases to shared dialogs.

### Information architecture

- [ ] Decide whether `Advanced tools` should remain in Settings or become a top-level Tools screen.
- [ ] Add concise section summaries for dense Settings groups.
- [ ] Move low-frequency diagnostics details behind expandable detail rows where appropriate.
- [ ] Review Settings ordering after real usage: Connection, Models, Notifications, Appearance, Updates, Advanced tools, Diagnostics, Actions.

### Core flow polish

- [ ] Add explicit send-failure feedback if a chat send command cannot be delivered.
- [ ] Add retry/resend state for failed optimistic user messages.
- [ ] Add attachment picker feedback for unsupported or unreadable files.
- [ ] Consider replacing custom pull-to-refresh wrappers in chat/home with Material `PullToRefreshBox`.
- [ ] Add loading indicators to Artifacts, Prompt Library, and provider screens where data is requested but not yet returned.

### Accessibility and visual QA

- [ ] Add Compose UI tests for destructive confirmation dialogs.
- [ ] Add Compose UI tests for secondary screen search and clear-search flows.
- [ ] Add Compose UI tests for Feature Generator phase indicator and reset confirmation.
- [ ] Audit icon content descriptions across all Android screens.
- [ ] Verify touch targets are at least 48dp for list action menus and compact controls.
- [ ] Test text wrapping/truncation on small phones and large screens.
- [ ] Check light/dark contrast for status badges, error banners, and advanced tool rows.

### Secondary screen polish

- [ ] Add search to Providers if provider list grows or includes extra metadata.
- [ ] Add filter chips to Self-Heal reports for status groups.
- [ ] Add artifact status filter chips if artifact volume grows.
- [ ] Add prompt category filter chips if prompt volume grows.
- [ ] Add empty-detail guidance for artifact details with no current version/files.

## Acceptance Standard

- Every destructive action is confirmed, undoable, or clearly reversible.
- Every screen that fetches remote data has a visible empty, loading, error, and retry path.
- Primary actions are visible; long-press and gestures are shortcuts only.
- Multi-step flows show current phase and next action.
- Searchable lists have clear search, no-result, and reset states.
- Android unit tests pass after each UX change.
