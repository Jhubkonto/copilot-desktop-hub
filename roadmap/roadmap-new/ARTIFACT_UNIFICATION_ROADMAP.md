# Artifact Unification Roadmap

## Context

The artifact feature exists in both desktop (Electron/React) and Android (Jetpack Compose) but is structurally disconnected from the rest of the app's UI language. On desktop, artifacts open as a **modal overlay** (`ArtifactsPanel` → `ModalShell`) while every other entity (Projects, Agents, Skills, Chats) lives inside a **`SectionPane`** — a resizable side panel with consistent header/search/action-button conventions. The artifact generator modal also diverges from its siblings: it lacks the "Edit form" fallback state and post-generation `DoneOverlay` that `AgentGeneratorModal` and `SkillGeneratorModal` provide. On Android, artifacts are buried in an overflow `DropdownMenu` rather than surfaced as a prominent navigation entry alongside Projects and Agents.

The goal of this roadmap is to make the artifact feature indistinguishable in look, feel, and behaviour from the existing projects/agents/skills interface — without changing the underlying backend or IPC contracts beyond what is explicitly required.

---

## Phase 1: Desktop — Move Artifacts into SectionPane Navigation

### Objective
Replace the modal-overlay artifact panel with a proper `SectionPane` tab so the Artifacts sidebar button behaves identically to Projects, Agents, Skills, and Chats.

### Checklist

- [ ] **`src/shared/types.ts`** — Add `'artifacts'` to the `ActiveSectionPane` union type (alongside `'projects' | 'agents' | 'chats' | 'skills' | 'scheduled'`).

- [ ] **`src/renderer/store/slices/uiSlice.ts`** — Remove `showArtifactsPanel: boolean` and `setShowArtifactsPanel` action. Replace all three call sites atomically in a single commit:
  - `Sidebar.tsx` (opens panel)
  - `ArtifactGeneratorModal.tsx` line ~143 (success "View" toast)
  - `ArtifactsBrowser.tsx` `handleUseInChat` (line ~279)

- [ ] **`src/renderer/components/section-pane/ArtifactsPane.tsx`** — Create new file. Model on `SkillsPane.tsx`:
  - Header row: artifact count label on left; "Generate" (indigo, `Sparkles`) + "New" (gray, `Plus`) buttons on right.
  - Search input (placeholder "Search artifacts…").
  - Scope filter pills (Global / This Project / All) — port state logic from `ArtifactsBrowser.tsx` lines 283–315.
  - List renders `ArtifactListItem` rows (Phase 2; wire a placeholder for now).
  - Pending generation row — subscribe to `pendingArtifactGeneration` from Zustand store.
  - Load artifacts via `window.api.artifactList(projectId?)` on mount and refresh.
  - "Generate" button opens `ArtifactGeneratorModal`.

- [ ] **`src/renderer/components/SectionPane.tsx`** — Add `'artifacts'` to `SectionType`; add `SECTION_LABELS['artifacts'] = 'Artifacts'`; import and render `<ArtifactsPane />` for the new case.

- [ ] **`src/renderer/components/Sidebar.tsx`** — Change the Artifacts `NavButton` (lines ~187–195):
  - Call `openSectionPane('artifacts')` instead of `setShowArtifactsPanel(true)`.
  - Remove `modal` prop (removes the `SquareArrowOutUpRight` indicator).
  - Drive `active` from `activeSectionPane === 'artifacts'`.
  - Badge count tracking: change the `useEffect` dependency from `showArtifactsPanel` to `activeSectionPane === 'artifacts'`.

- [ ] **`src/renderer/App.tsx`** — Remove lazy-imported `ArtifactsPanel` and its render call.

- [ ] **`src/renderer/components/ArtifactsPanel.tsx`** — Delete file (now dead).

### End-of-Phase Protocol
```
npm test                # confirm no broken artifact-related tests
npm run lint            # fix any lint errors
npm run typecheck       # fix any type errors from ActiveSectionPane changes
npm run build           # confirm clean build
```
Manual smoke test: Click "Artifacts" in sidebar → SectionPane opens with "Artifacts" header and × close. Toggle behaviour matches Projects/Agents/Skills. Badge count still appears.

---

## Phase 2: Desktop — Unify ArtifactListItem with Section Pane Pattern

### Objective
Replace the heavy expand-in-place `ArtifactRowItem` card with a lean hover-action row (matching `SkillsPane`/`AgentsPane`) and create an `ArtifactPanel` right-side panel for full detail, version history, and export.

### Checklist

- [ ] **`src/renderer/components/section-pane/ArtifactListItem.tsx`** (or inline in `ArtifactsPane.tsx`) — Create lean row:
  - Left: `KindBadge` (extract reusable component from `ArtifactsBrowser.tsx`).
  - Center: `title` (truncated) + status/version meta line.
  - Right (hover only, `invisible group-hover:visible`): Export (`Download`) icon + Delete (`Trash2`) icon.
  - Row click → `openArtifactPanel(artifact.id)`.
  - Copy group/hover pattern from `SkillsPane.tsx` lines 103–138.

- [ ] **`src/renderer/store/slices/uiSlice.ts`** — Add:
  - `viewingArtifactId: string | null`
  - `openArtifactPanel(id: string) => void`
  - `closeArtifactPanel() => void`

- [ ] **`src/renderer/components/ArtifactPanel.tsx`** — Create new right-side panel. Model on `AgentPanel.tsx`:
  - Fixed overlay (`position: fixed, inset-0, top-9, z-50`) with `ResizeHandle` on left edge.
  - Header: artifact title + × close button.
  - Three tabs: **Details** | **History** | **Export**.
  - **Details tab**: kind badge, status, description, storage root (read-only), project association, "Generate new version" button (opens `ArtifactGeneratorModal` targeting this artifact).
  - **History tab**: list of versions (`versionNumber`, `createdAt`, file count) with compare/select controls. Port version-history rows from `ArtifactRowItem` in `ArtifactsBrowser.tsx`.
  - **Export tab**: format buttons (raw-files, markdown, json) for current version; "Open folder" after export.
  - Footer: "Delete" (red, left) + "Use in Chat" (indigo, right → calls `requestArtifactAttach(id)`).

- [ ] **`src/renderer/App.tsx`** — Lazy-import `ArtifactPanel`; render when `viewingArtifactId !== null`.

- [ ] **`src/renderer/components/section-pane/ArtifactsPane.tsx`** — Wire `ArtifactListItem` rows; row click calls `openArtifactPanel`.

- [ ] **Storage root config** — Move the get/set storage-root UI from `ArtifactsBrowser.tsx` into the **Details** tab footer of `ArtifactPanel` (or a global "Artifacts" section in Settings). Remove it from the list view entirely.

- [ ] **`src/renderer/components/artifacts/ArtifactsBrowser.tsx`** — Delete file after all content is migrated (the `KindBadge` and `ArtifactCard.tsx` survive; only `ArtifactsBrowser` and `ArtifactRowItem` are removed).

### End-of-Phase Protocol
```
npm test
npm run lint
npm run typecheck
npm run build
```
Manual: Click artifact row → panel opens on right. Tabs work. Hover on row shows icon buttons only. Delete from panel removes and refreshes list. "Use in Chat" attaches artifact. Storage root no longer visible in list.

---

## Phase 3: Desktop — Unify ArtifactGeneratorModal with Generator Patterns

### Objective
Bring `ArtifactGeneratorModal` to full parity with `AgentGeneratorModal`: add an **EditForm** state so users can manually adjust the spec after AI review, add a **CreationOverlay** that keeps the modal open during generation (rather than closing early), and add a **DoneOverlay** with "Add to project" / "Generate another" post-creation options.

### Checklist

- [ ] **`src/renderer/components/ArtifactGeneratorModal.tsx`** — Add state variables:
  - `isEditing: boolean` (false) — drives EditForm vs. spec preview in left column.
  - `editSpec: ArtifactSpec | null` — working copy for the form.
  - `isGenerating: boolean` (false) — drives CreationOverlay.
  - `isDone: boolean` (false) — drives DoneOverlay.
  - `createdArtifactId: string | null`.
  - `createdArtifactTitle: string | null`.

- [ ] **EditForm component** (inside `ArtifactGeneratorModal.tsx`) — Fields:
  - `title` (text input)
  - `kind` (pill toggle: document / code / ui / data / prompt / agent-config / plan / bundle / other)
  - `intendedUse` (textarea)
  - `audience` (text input)
  - `outputFiles` (repeatable row: path, role, mediaType — add/remove)
  - `acceptanceCriteria` (repeatable string — add/remove)
  - Footer: "Back" + "Generate artifact" (`Sparkles`, indigo).
  - Copy the form scaffold from `AgentGeneratorModal.tsx` lines 757–810 (the AgentEditForm pattern).
  - Wire "Edit" button in spec-ready footer: `setEditSpec({...spec}); setIsEditing(true)`.

- [ ] **CreationOverlay component** (inside `ArtifactGeneratorModal.tsx`) — Copy from `AgentGeneratorModal.tsx` lines 112–156. Steps:
  ```
  ['Creating artifact…', 'Writing files…', 'Finalizing…', 'Done ✓']
  ```
  Show when `isGenerating && !isDone`.

- [ ] **DoneOverlay component** (inside `ArtifactGeneratorModal.tsx`) — Copy from `AgentGeneratorModal.tsx` lines 342–440. Adapt:
  - "Artifact Created!" headline + checkmark icon.
  - Show `createdArtifactTitle`.
  - "Add to project" section: current `projectId` project shown prominently; "Other projects…" expander lists all projects.
    - Calls `window.api.artifactMoveToProject(createdArtifactId, projectId)` (see IPC note below).
  - "Generate another" → reset all session state (messages, spec, `isDone`, `isEditing`, `createdArtifactId`) → return to CHAT phase.
  - "Done" → close modal.

- [ ] **`handleGenerate` flow** — Revamp to keep modal open during generation:
  1. Set `isGenerating = true`.
  2. Call `window.api.artifactGeneratorGenerate(runId, spec, projectId?, modelOverride?)`.
  3. On `onArtifactGeneratorDone` event: set `isGenerating = false`, `isDone = true`, capture `createdArtifactId`/`createdArtifactTitle`.
  4. Remove the current `onClose()` call that fires before generation completes.
  5. Remove the success toast ("Artifact ready → View") — `DoneOverlay` handles navigation.
  6. Keep the `_cleanupFileListener` pattern for listener lifecycle management (edge case: user closes modal mid-generation must not leak listener).

- [ ] **IPC: `artifactMoveToProject`** — Verify or add in `src/main/artifacts.ts`:
  - Handler: `artifact:move-to-project` with args `(artifactId, projectId)`.
  - DB: `UPDATE artifacts SET project_id = ? WHERE id = ?`.
  - Add channel + return type to `src/shared/types.ts` `IpcChannels` / `IpcReturnMap`.
  - Add `typedInvoke` wrapper to `src/preload/index.ts`.

- [ ] **`ArtifactsPane.tsx`** — Pass `projectId` when opening the generator from a project-scoped view. Refresh list on `onArtifactCreated` callback from modal.

### End-of-Phase Protocol
```
npm test
npm run lint
npm run typecheck
npm run build
```
Manual flow: Open generator → chat to spec → "Edit" button → EditForm opens → edit fields → "Generate artifact" → CreationOverlay (spinner) → DoneOverlay → "Add to project" assigns project → "Generate another" resets to chat. ArtifactsPane list refreshes after creation.

---

## Phase 4: Android — Integrate Artifacts into Home Screen Navigation

### Objective
Promote Artifacts out of the `DropdownMenu` overflow and into a visible navigation entry in `HomeScreen`, matching the discoverability of Projects and Agents.

### Checklist

- [ ] **`android/app/src/main/java/io/nexy/android/ui/home/HomeScreen.kt`** — In the `TopAppBar` `actions` lambda:
  - Remove the `DropdownMenuItem` for Artifacts (currently lines ~443–447).
  - Add a dedicated `IconButton` with `Icons.Default.Inventory2` (or `Icons.AutoMirrored.Filled.List`) and `contentDescription = "Artifacts"`.
  - Wire `onClick = onOpenArtifacts` (this callback already exists in the function signature and is already routed in `NavGraph.kt`).
  - If icon real-estate is tight, similarly promote Skills; leave Scheduled in overflow.

- [ ] **Verify `NavGraph.kt`** (lines ~400–409) — Confirm `artifact-generator` route passes `onViewArtifacts` correctly (needed for Phase 5 change). No new routes required for Phase 4 itself.

- [ ] **`ArtifactsScreen.kt`** — Verify the "Generate" `TextButton` in the top bar already navigates to `artifact-generator`. Confirm filter chips, search, and sort controls match the pattern used in `SkillsScreen.kt`.

### End-of-Phase Protocol
```
# Android build check (run from repo root)
cd android && ./gradlew assembleDebug
cd android && ./gradlew lint
```
Manual (device/emulator): HomeScreen top bar shows Artifacts icon. Tap → `ArtifactsScreen` with search, filter, sort. "Generate" → `ArtifactGeneratorScreen`.

---

## Phase 5: Android — Generator Parity and DonePhase Polish

### Objective
Bring `ArtifactGeneratorScreen`'s `DonePhase` to parity with `ProjectGeneratorScreen` and `AgentGeneratorScreen` by adding "View artifacts" navigation and an "Add to project" picker.

### Checklist

- [ ] **`android/app/src/main/java/io/nexy/android/ui/artifactgenerator/ArtifactGeneratorScreen.kt`** — Update function signature:
  ```kotlin
  fun ArtifactGeneratorScreen(
    onBack: () -> Unit,
    onViewArtifacts: () -> Unit,   // NEW
    vm: ArtifactGeneratorViewModel = viewModel()
  )
  ```
  In `DonePhase` composable (lines ~485–504):
  - Add `OutlinedButton(onClick = onViewArtifacts) { Text("View artifacts") }`.
  - Add project picker UI: load projects from `WsRepository.projects.collectAsState()`; render a `DropdownMenu` or `LazyColumn` of projects; on select, call `vm.moveToProject(projectId)`.

- [ ] **`ArtifactGeneratorViewModel.kt`** — Add `moveToProject(projectId: String)` method:
  - Sends `artifact:move-to-project` WsEvent (requires new `WsEvent` variant — see below).
  - Updates local `uiState` with confirmation or error.

- [ ] **`WsEvent.kt`** — Add two new sealed class entries:
  ```kotlin
  data class ArtifactMoveToProject(val artifactId: String, val projectId: String) : WsEvent()
  data class ArtifactMovedToProject(val artifactId: String, val projectId: String) : WsEvent()
  ```
  Add parsing in `WsEventParser.kt` for the response event.

- [ ] **`NavGraph.kt`** — Update the `artifact-generator` composable to pass `onViewArtifacts`:
  ```kotlin
  composable("artifact-generator") {
    ArtifactGeneratorScreen(
      onBack = { navController.popBackStack() },
      onViewArtifacts = {
        navController.popBackStack()
        navController.navigate("artifacts")
      }
    )
  }
  ```

- [ ] **`ArtifactsScreen.kt`** (optional, deferrable) — Extract the inline `ArtifactDetailScreen` composable into its own file (`ArtifactDetailScreen.kt`) and register it as a separate `artifacts/{artifactId}` route in `NavGraph.kt`. This gives proper back-stack behaviour. Risk: medium; can be deferred post-Phase-5 if timeline is tight.

- [ ] **Audit `ArtifactGeneratorScreen` vs sibling generators** — Verify streaming phases match:
  - `CHAT` → `SPEC_REVIEW` → `DONE` (current, confirmed).
  - Confirm `ArtifactGeneratorToken`, `TurnComplete`, `SpecReady`, `Done` WsEvents are handled identically to `AgentGeneratorToken` etc. Fix any gaps.

### End-of-Phase Protocol
```
cd android && ./gradlew assembleDebug
cd android && ./gradlew lint
cd android && ./gradlew test
```
Manual: `ArtifactGeneratorScreen` CHAT → SPEC_REVIEW → confirm → DonePhase shows "View artifacts" + "Add to project" + "Generate another". Each action routes correctly.

---

## Phase 6: End-to-End Integration and Testing

### Objective
Clean up dead code, verify the full IPC surface, and run all checks for a shippable state.

### Checklist

- [ ] **Dead code removal (Desktop)**:
  - Delete `src/renderer/components/ArtifactsPanel.tsx` (replaced by `ArtifactsPane` in SectionPane).
  - Delete `src/renderer/components/artifacts/ArtifactsBrowser.tsx` (replaced by `ArtifactsPane` + `ArtifactPanel`).
  - Remove `showArtifactsPanel` / `setShowArtifactsPanel` from `uiSlice.ts`.
  - Confirm `ArtifactCard.tsx` is still intact (still used in chat messages — do not delete).

- [ ] **IPC surface audit** — Confirm all channels are declared in `src/shared/types.ts` `IpcChannels` + `IpcReturnMap` and have corresponding `typedInvoke` wrappers in `src/preload/index.ts`:
  - `artifact:list`, `artifact:get`, `artifact:list-versions`, `artifact:get-version`
  - `artifact:delete`, `artifact:export`, `artifact:open-folder`
  - `artifact:move-to-project` ← new (Phase 3/5)
  - `artifact-generator:chat`, `artifact-generator:generate`
  - `artifact-generator:get-runs`, `artifact-generator:get-storage-root`, `artifact-generator:set-storage-root`
  - Events: `artifact-generator:token`, `artifact-generator:spec-ready`, `artifact-generator:file-event`, `artifact-generator:done`

- [ ] **Renderer test coverage** (`src/renderer/__tests__/`):
  - [ ] `ArtifactsPane.test.tsx` — renders count, search, scope picker; calls `artifactList`; opens generator modal.
  - [ ] `ArtifactPanel.test.tsx` — renders tabs; "Use in Chat" calls `requestArtifactAttach`; delete calls `artifactDelete` and closes panel.
  - [ ] `ArtifactGeneratorModal.test.tsx` — EditForm renders when `isEditing`; DoneOverlay renders when `isDone`; "Generate another" resets state.
  - [ ] Add `window.api.artifactMoveToProject` stub to `src/test/mocks/api.ts`.

- [ ] **Main-process test coverage** (`src/main/__tests__/`):
  - [ ] `artifacts.test.ts` — add test for `artifact:move-to-project` handler (valid and missing artifact cases).

- [ ] **Desktop regression checklist**:
  - [ ] Sidebar Artifacts → SectionPane (not modal).
  - [ ] Scope picker filters list (Global / This Project / All).
  - [ ] Row hover shows Export + Delete icon buttons only.
  - [ ] Row click → ArtifactPanel opens (right side).
  - [ ] ArtifactPanel Details / History / Export tabs all render.
  - [ ] "Use in Chat" → artifact attached to composer.
  - [ ] Delete from panel → list refreshes.
  - [ ] Generate → chat → spec ready → Edit form → Generate → CreationOverlay → DoneOverlay.
  - [ ] DoneOverlay "Add to project" assigns project; list scope refreshes.
  - [ ] DoneOverlay "Generate another" resets to CHAT phase.
  - [ ] Storage root accessible (ArtifactPanel Details or Settings).
  - [ ] Badge count on sidebar Artifacts button increments and resets on open.
  - [ ] Pending generation indicator visible in ArtifactsPane during generation.
  - [ ] `ArtifactCard.tsx` still renders correctly in chat messages.

- [ ] **Android regression checklist**:
  - [ ] Artifacts icon visible in HomeScreen top bar (not in overflow).
  - [ ] Tap → `ArtifactsScreen` (search, filter chips, sort all work).
  - [ ] Tap artifact row → detail view (or `ArtifactDetailScreen` if extracted).
  - [ ] Export and delete work from detail.
  - [ ] "Generate" → `ArtifactGeneratorScreen` CHAT phase.
  - [ ] CHAT → SPEC_REVIEW → confirm → DonePhase.
  - [ ] DonePhase "View artifacts" → navigates back to list.
  - [ ] DonePhase "Add to project" → project picker → updates artifact.
  - [ ] DonePhase "Generate another" → ViewModel resets to CHAT.
  - [ ] WsEvent `ArtifactMovedToProject` received and handled in ViewModel.

### End-of-Phase Protocol (Full Suite)
```
# Desktop
npm test
npm run lint
npm run typecheck
npm run build

# Android
cd android && ./gradlew assembleDebug
cd android && ./gradlew lint
cd android && ./gradlew test
```

---

## Cross-Cutting Ordering Dependencies

| Phase | Depends On |
|-------|-----------|
| 1 (SectionPane) | — (start here) |
| 2 (ArtifactPanel) | Phase 1 (ArtifactsPane must exist) |
| 3 (Generator parity) | Phase 2 (DoneOverlay refreshes ArtifactsPane) |
| 4 (Android nav) | — (independent; can run parallel to 1–3) |
| 5 (Android generator) | Phase 4 (NavGraph must surface the screen) |
| 6 (Cleanup + tests) | Phases 1–5 complete |

**Atomic migration risk:** `showArtifactsPanel` has call sites in `Sidebar.tsx`, `ArtifactGeneratorModal.tsx`, and `ArtifactsBrowser.tsx` — all must be migrated in the same commit in Phase 1 to avoid a partially broken state.

**IPC risk:** `artifact:move-to-project` must be authored and registered in `src/main/artifacts.ts` before Phase 3's DoneOverlay or Phase 5's Android "Add to project" can be tested end-to-end.

**Module-level listener leak risk (Phase 3):** The `_cleanupFileListener` / `_generationInFlight` pattern in `ArtifactGeneratorModal.tsx` must be audited when the modal no longer closes early — ensure closing mid-generation (× during CreationOverlay) tears down the IPC listener correctly.
