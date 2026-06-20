# Nexy Android — UI/UX Revamp Roadmap

Last updated: 2026-06-20

This roadmap was produced from a full source audit of every Android screen, component, navigation route, and theme file. The goal is to transform the app from a functional but friction-heavy companion into something buttery smooth, visually cohesive, and intuitive to use.

Status legend:
- `Done` — implemented
- `In Progress` — actively being worked on
- `Pending` — not yet started

---

## Phase Summary

| Phase | Theme | Complexity | Primary Payoff |
|---|---|---|---|
| A | Navigation & Global App Feel | M | Orientation, connection awareness, less top-bar clutter |
| B | Chat Experience Polish | M | Core feature — performance, trust, animations |
| C | Component Library Expansion | M | Unblocks D, E, F, I |
| D | AgentConfig Refactor | L | Eliminates God Screen, adds unsaved-changes safety |
| E | ProjectConfig & Settings IA | M | Deduplication, correct information hierarchy |
| F | Content Management Screens | M | Lists become power tools |
| G | Accessibility & Touch Targets | S | TalkBack compliance, 48dp minimums |
| H | Performance | S | Eliminates Markwon hot-spot, debounces search |
| I | Generator UX | M | Step visibility, safe back-navigation, retry |
| J | Visual Polish & Microinteractions | S–M | Theme completeness, animation, haptics |
| K | Chat Input Redesign | M | Floating card, collapsed attachment menu, always-visible send |

**Sequencing constraint:** Phase C must precede D, E, F, and I. Phase K is independent of all others and absorbs the send-button fix from B.

---

## Phase A — Navigation & Global App Feel

**Complexity: M**

The home screen top bar carries 5 action items; the back-gesture contract is non-standard; most screens have no connection awareness.

### Checklist

- [ ] **Fix BackHandler exit contract** (`HomeScreen.kt:131–133`): back from tabs 1/2 returns to tab 0 — add a visible tab indicator so users understand why; evaluate adopting a `NavigationBar` (bottom nav) to surface Artifacts/Skills without crowding the top bar
- [x] **Reduce HomeScreen top-bar crowding** (`HomeScreen.kt:216–236`): 5 action items (ConnectionChip, Refresh, Artifacts, Skills, Settings); collapse Artifacts + Skills into overflow `MoreVert` menu or move to a bottom nav — `Done`
- [x] **Extract `NexyConnectionBanner` to `NexyUx.kt`**: `ChatScreen` has a connection banner; `AgentConfigScreen` has its own variant — unify into one composable and apply to `ProjectConfigScreen`, `SkillsScreen`, `ArtifactsScreen` — `Done`
- [x] **Add auto-refresh on screen re-entry**: `SkillsScreen` and `ArtifactsScreen` load only in `LaunchedEffect(Unit)` — add `LifecycleResumeEffect` / `ON_RESUME` trigger — `Done`
- [x] **Remove explicit Refresh icon from HomeScreen top bar** — refresh is already triggered on tab change (`LaunchedEffect(selectedTab)`) — `Done`
- [x] **Add pull-to-refresh to Projects and Agents tabs** (`HomeScreenTabs.kt`) — Chats tab already uses `PullToRefreshBox`; apply to the other two tabs — `Done` (already implemented)

---

## Phase B — Chat Experience Polish

**Complexity: M**

Chat is the core feature. Every interaction should feel immediate and clear.

### Checklist

- [x] **Fix send button invisible-when-disabled** (`ChatScreenInput.kt:149–150`): `canSend == false` renders the button as `surface` color against `surfaceVariant` — effectively invisible; use `outline` or reduced-alpha variant — `Done`
- [x] **Cache Markwon instance** (`ChatScreenBubbles.kt:256–263`): `Markwon.create(ctx)` is called in the `update` lambda of every `AndroidView` — move to a `CompositionLocal<Markwon>` at `ChatScreen` level, created once with `remember { Markwon.create(context) }` — `Done`
- [x] **Add `AnimatedVisibility` to `ThinkingHistoryBubble` expand/collapse** (`ChatScreenBubbles.kt:158`): wrap block content with `AnimatedVisibility(visible = expanded, enter = expandVertically(), exit = shrinkVertically())` — `Done`
- [x] **Add `AnimatedVisibility` to `ToolCallBubble` expanded details** (`ChatScreenBubbles.kt:418`): same pattern as above — `Done`
- [x] **Add message timestamps**: `ChatMessage.timestamp` exists — display relative time (e.g., "2 min ago") below each `MessageBubble` in `labelSmall` / muted color — `Done`
- [x] **Draft persistence**: `input` is a local `remember` in `ChatScreen.kt:103` — persist in `ChatViewModel` as `StateFlow<String>` keyed to `conversationId` so returning to the conversation restores the draft — `Done`
- [x] **Image attachment thumbnail preview**: for image attachments with `data:` URL, decode and render a small thumbnail inside the `AttachmentChip` instead of a generic file icon — `Done`
- [x] **File-size rejection recovery** (`ChatScreen.kt:133–137`): add a "Choose another" snackbar action that re-invokes the file picker — `Done`
- [x] **Hoist `ModalBottomSheet` state out of conditional blocks**: `promptSheetState` and `inspectorSheetState` are created inside `if (show...)` branches — hoist to composable scope alongside `modelSheetState` — `Done`

---

## Phase C — Component Library Expansion

**Complexity: M** *(must precede Phases D, E, F, I)*

Build the shared tools that subsequent phases rely on. All changes go to `NexyUx.kt`.

### Checklist

- [x] **`NexySkeletonLoader` composable**: shimmer placeholder using `InfiniteTransition` + `Brush.linearGradient`; replaces full-screen `CircularProgressIndicator` in loading states — `Done`
- [x] **`NexyExpandableSection` composable**: header row with animated chevron + `AnimatedVisibility`-wrapped content; params: `title: String`, `expanded: Boolean`, `onToggle: () -> Unit`, `badge: String? = null`, `content: @Composable ColumnScope.() -> Unit`; used by AgentConfig (Phase D), `ThinkingHistoryBubble`, `ToolCallBubble` — `Done`
- [x] **`NexyStepIndicator` composable**: horizontal step-progress row; params: `steps: List<String>`, `currentStep: Int`; implements step circles connected by lines — `primary` for completed/active, `outline` for future; used by all generator screens (Phase I) — `Done`
- [x] **`NexyInputValidation` composable**: wraps `OutlinedTextField` + animated error message slot; params: `value`, `onValueChange`, `label`, `errorMessage: String?`, forwarded `OutlinedTextField` params; eliminates scattered `if (error) Text(error)` patterns — `Done`
- [x] **`NexyConnectionBanner` composable**: extracted from `ChatScreen` and `AgentConfigScreen` patterns (see Phase A); params: `connectionState: ConnectionState`, `lastError: String? = null` — `Done`
- [x] **Fix `NexyFormSheet` keyboard avoidance** (`NexyUx.kt:181`): inner `Column` has no `imePadding()` — keyboard hides text fields inside sheets; add `.imePadding()` — `Done`
- [x] **Add debouncing to `NexySearchField`**: add `debounceMs: Long = 300` parameter using `LaunchedEffect(query) { delay(debounceMs); onQueryChange(query) }`; apply in `ArtifactsScreen` and `SkillsScreen` — `Done`

---

## Phase D — AgentConfig Refactor

**Complexity: L**

`AgentConfigScreen.kt` is 763 lines with 13+ sections on a single scrollable screen — a classic God Screen.

### Checklist

- [ ] **Collapsible sections using `NexyExpandableSection`** (Phase C): convert each `SectionHeader` + block to `NexyExpandableSection`; default expanded: Identity + Behaviour; collapsed: Backend, Generation, Tools, Skills, Context, Context Rules, Custom Commands, MCP, Knowledge Files; persist expanded state with `rememberSaveable`
- [ ] **Unsaved-changes guard on back**: derive `hasUnsavedChanges` by comparing current field values to the original loaded config; intercept back navigation with `NexyConfirmDialog("Discard changes?")` when dirty
- [ ] **Skills section search**: add compact `NexySearchField` above `SkillAttachmentsSection`; filter `orderedSkills` by name/description; show `NexyEmptyState` when no match
- [ ] **Skills reorder UX**: replace `TextButton("Move up")` / `TextButton("Move down")` with compact `Icons.Default.KeyboardArrowUp` / `Icons.Default.KeyboardArrowDown` icon buttons at 48.dp touch targets; add `Icons.Default.DragHandle` as a drag-to-reorder affordance
- [ ] **Inline validation on Save**: validate `name.isNotBlank()`, `maxTokensText.toIntOrNull() != null`, `temperature in 0f..1f`; surface errors via `NexyInputValidation` rather than silently clamping values
- [ ] **Knowledge Files animated panel swap**: wrap the `editingKnowledgeFile != null` branch with `AnimatedContent(targetState = editingKnowledgeFile)` for a smooth transition
- [ ] **`Column` → `LazyColumn` for skills and MCP lists**: `SkillAttachmentsSection` and `McpServerAssignmentSection` render all cards in a `Column` inside the outer `verticalScroll` — convert to `LazyColumn` items

---

## Phase E — ProjectConfig & Settings Information Architecture

**Complexity: M**

Settings has duplicated entries and miscategorised items. ProjectConfig needs the same collapsible-section treatment as AgentConfig.

### Checklist

- [ ] **Fix Settings duplication** (`SettingsScreen.kt:76–113`): "CLI Models" (line 79) and "MCP Servers" (line 109) both navigate to `McpAndCliScreen`; remove the duplicate row, rename the survivor to "MCP Servers & CLI Models"
- [ ] **Reclassify settings sections**: move "Updates" → General section; move "Self-Heal Reports" → Developer section; move "Prompt Library" → Configuration section (alongside Global Settings and Models)
- [ ] **Add subtitle breadcrumb to `NexyTopAppBar`**: add optional `subtitle: String?` parameter shown as secondary muted text under the title; apply `subtitle = "Settings"` on all settings detail screens
- [ ] **ProjectConfigScreen collapsible sections + unsaved-changes guard**: same approach as Phase D; collapse all except Core Settings by default; add BackHandler guard
- [ ] **Milestone status selection** (`ProjectConfigScreen.kt`): replace 3 `TextButton` items in a row with `MultiChoiceSegmentedButtonRow` or a compact `ExposedDropdownMenuBox`
- [ ] **Model settings deduplication**: ensure `ModelsScreen` links to GlobalSettings for default-model selection rather than duplicating the picker

---

## Phase F — Content Management Screens

**Complexity: M**

Skills, Artifacts, Prompts, and Wiki lists should be powerful tools, not passive viewers.

### Checklist

- [ ] **Show search result count**: display "Showing X of Y" in `labelSmall` below the search field in Skills, Artifacts, and Prompts screens
- [ ] **Tag chip filtering in SkillsScreen**: make tag `AssistChip` / `Badge` tappable — clicking sets `searchQuery` to the tag value; existing filter logic already searches tags
- [ ] **Sort options**: add sort `IconButton` (`Icons.Default.Sort`) to top bar of Skills, Artifacts, Prompts; sort sheet with `RadioButton` rows: Name A→Z, Name Z→A, Recently Updated, Usage Count (skills)
- [ ] **Pull-to-refresh for Skills and Prompts**: apply `PullToRefreshBox` (already used in `SelfHealReportsScreen`) to `SkillsScreen` and `PromptsScreen`
- [ ] **Artifact diff view**: add "Compare" action in version history list; show before/after split in an `AlertDialog` or `ArtifactDiffScreen` with changed lines highlighted in `secondaryContainer`
- [ ] **Wiki extraction preview**: add a collapsible preview card showing the first 5 lines of extracted content before the user accepts each item in `WikiExtractionSheet`
- [ ] **Prompts scope filter chips**: add `FilterChip` row for scope (Global, Project, Agent) above the search field in `PromptsScreen`
- [ ] **Stale data fix**: audit `LaunchedEffect(Unit)` across all content screens; convert to `LaunchedEffect(projectId)` or add `LifecycleResumeEffect` trigger

---

## Phase G — Accessibility & Touch Targets

**Complexity: S**

No user should be excluded. No tap target should require precision.

### Checklist

- [ ] **Add all missing `contentDescription` values**: 30+ icon usages have `contentDescription = null`; priority locations:
  - `ChatScreenBubbles.kt`: `Icons.Default.Psychology` in `ThinkingHistoryBubble`, expand/collapse chevrons in `ToolCallBubble` and `ThinkingHistoryBubble`
  - `ChatScreenInput.kt`: verify Send button has `contentDescription = "Send"`
  - `AgentConfigScreen.kt`: all Delete icons — ensure each has a unique descriptive label
  - `SkillsScreen.kt`: icons in `SkillAttachmentRow`
- [ ] **Raise `IconButton` touch targets to 48.dp minimum** (`ChatScreenInput.kt:113,121,129,137`): change `Modifier.size(36.dp)` to `Modifier.size(48.dp)` or add `Modifier.minimumInteractiveComponentSize()`; adjust inner icon sizes proportionally
- [ ] **IME action chains on multi-field forms**: set `imeAction = ImeAction.Next` on non-last fields and `ImeAction.Done` on the last field in `AgentConfigScreen`, `ProjectConfigScreen`, and creation bottom sheets
- [ ] **Verify `ApprovalDialog` tab order**: confirm TalkBack announces the dialog as modal and Approve/Reject buttons are reachable in logical order

---

## Phase H — Performance

**Complexity: S**

Remove the known recomposition hot-spots. The app should be smooth at 60 fps on mid-range hardware.

### Checklist

- [ ] **Markwon `CompositionLocal`** (`ChatScreenBubbles.kt:252–264`): highest-priority fix — `Markwon.create(ctx)` is recreated on every recomposition; create `val LocalMarkwon = staticCompositionLocalOf<Markwon>` in `ChatScreen.kt`; provide via `CompositionLocalProvider(LocalMarkwon provides remember { Markwon.create(context) })`; consume via `LocalMarkwon.current` in `MessageBubble`
- [ ] **Search debouncing** (`ArtifactsScreen.kt`, `SkillsScreen.kt`): `filteredX` recomputes on every keystroke; move to ViewModel with `debounce(300)` on a `MutableStateFlow<String>` (pairs with Phase C `NexySearchField` debouncing)
- [ ] **`Column` → `LazyColumn` for AgentConfig skills list**: (overlaps Phase D — pull forward if the screen has many skills)
- [ ] **Hoist `ModalBottomSheet` state** (`ChatScreen.kt`): three sheet states created inside conditional blocks — hoist to composable scope (pairs with Phase B)
- [ ] **Guard auto-scroll to bottom** (`ChatScreen.kt:226–229`): check `listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index` before calling `animateScrollToItem` to avoid interrupting the user when they have scrolled up to read history

---

## Phase I — Generator UX

**Complexity: M**

The CHAT → REVIEW → CONFIRM pattern is strong. Surface it clearly to users and give them safe navigation within the flow.

### Checklist

- [ ] **Add `NexyStepIndicator` to all generators** (Phase C component): place below `NexyTopAppBar`, above content area; map each ViewModel's phase enum to a step index; covers `AgentGeneratorScreen`, `ProjectGeneratorScreen`, `SkillGeneratorScreen`, `ArtifactGeneratorScreen`
- [ ] **Add "Previous" button within generator flow**: REVIEW phase gets a "Back" button that returns to CHAT phase without clearing generated content; CONFIRM phase gets a "Back" to REVIEW; only "Start over" / reset dialog clears all state
- [ ] **Error retry in generators** (`AgentGeneratorScreen.kt:62–68`): `NexyInfoDialog` with only "OK" leaves users stuck at the current phase; add a "Retry" button that re-invokes the last action (e.g., `vm.sendMessage(lastInput)`)
- [ ] **Linear progress indicator**: verify `LinearProgressIndicator` (already imported) is shown only during active streaming/generation and hidden in idle phases
- [ ] **Verify state survival across configuration change**: confirm `rememberLazyListState` in generator chat phases is correctly hoisted to outlast recomposition

---

## Phase J — Visual Polish & Microinteractions

**Complexity: S–M**

The foundation is correct. Add the texture that makes the app feel premium.

### Checklist

- [ ] **Move hardcoded colors to theme** (`ApprovalDialog.kt:84,98`): `Color(0xFF16A34A)` (approve green) and `Color(0xFFEF4444)` (reject red) are hardcoded; add `success` / `successContainer` color pairs to `Color.kt` + `Theme.kt` using Tailwind Green500 (`#22C55E`) / Green700 (`#15803D`) to match the existing palette; apply in `ApprovalDialog` and any other success-state usage
- [ ] **List item entrance animations**: add `Modifier.animateItem()` to `LazyColumn` `items { }` in `SkillsScreen`, `ArtifactsScreen`, `PromptsScreen` for smooth insert/remove on filter
- [ ] **Haptic feedback on FAB**: add `LocalHapticFeedback.current.performHapticFeedback(HapticFeedbackType.LongPress)` on FAB `onClick` in `HomeScreen`, `SkillsScreen`, `PromptsScreen`; replace raw `vibrate()` in `ApprovalDialog` with the Compose `HapticFeedback` API for consistency
- [ ] **Extract Nexy brand violet to `Color.kt`**: `Color(0xFFA78BFA)` is hardcoded in both `SplashScreen.kt:54–57` and `HomeScreen.kt:207–213`; extract to `val NexyViolet = Color(0xFFA78BFA)` and reference from both files
- [ ] **Animate `ConnectionChip` state transitions**: wrap `ConnectionChip` content changes with `AnimatedContent(targetState = connectionState)` for a crossfade instead of abrupt text/color swap
- [ ] **Verify ripple on all `Surface` + `.clickable()` combos**: confirm none use `indication = null` unintentionally; all interactive `Surface` rows should show Material ripple
- [ ] **Optional: downloadable display font** via Compose `downloadableFonts` API for branded headings (skip if desktop visual parity takes priority)

---

## Phase K — Chat Input Redesign

**Complexity: M**

The current `ChatInputBar` uses a `HorizontalDivider` separator, four always-visible action icons in a fixed sub-row, and a send button that becomes invisible against the background when disabled. The redesign replaces this with a floating rounded card (no border), collapses attachment actions behind a `+` button that opens a `ModalBottomSheet`, and keeps the send button always visible with reduced-alpha disabled state — matching the clean floating-card pattern established by leading chat apps.

### Checklist

- [ ] **Remove `HorizontalDivider` separator** (`ChatScreenInput.kt:61`): the card's `tonalElevation` provides visual separation from the message list; add `Modifier.padding(horizontal = 12.dp, bottom = 8.dp)` to the outer `Column` so the card floats with side margins
- [ ] **Wrap content in a floating `Surface`** (`ChatScreenInput.kt`): replace the flat background `Column` with `Surface(shape = RoundedCornerShape(20.dp), tonalElevation = 2.dp)` so the card appears to lift off the screen
- [ ] **Attachment chips inside the card**: keep existing `LazyRow` of `AttachmentChip` items, positioned above the text field within the card `Surface`
- [ ] **Text field occupies top portion of card**: `BasicTextField` with `Modifier.padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 4.dp)`, `maxLines = 5`; placeholder text unchanged
- [ ] **Collapse four action icons into a single `+` button** (`ChatScreenInput.kt:113–144`): replace `IconButton(AttachFile)`, `IconButton(Screenshot)`, `IconButton(TextFields)`, `IconButton(Info)` in the inner row with one circular `+` `IconButton` (36dp, `surfaceVariant` fill); tapping shows a `ModalBottomSheet` with `ListItem` rows:
  - Attach File → `onAttachFile()`
  - Latest Screenshot → `onCaptureScreen()`
  - Insert Prompt → `onInsertPrompt()`
  - Context Inspector → `onShowInspector()`
- [ ] **Hoist attachment sheet state inside `ChatInputBar`**: `val attachSheetState = rememberModalBottomSheetState()`; `var showAttachSheet by remember { mutableStateOf(false) }`; show `ModalBottomSheet` when `showAttachSheet == true` — not inside any conditional branch
- [ ] **Bottom action row**: `Row(modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp))` — `+` button left-aligned, `Spacer(Modifier.weight(1f))`, send button right-aligned
- [ ] **Fix send button disabled state** (absorbed from Phase B): send button always rendered; when `!canSend` use `Modifier.alpha(0.38f)` + `onSurface` tint instead of `colorScheme.surface` background (which makes it invisible); when `canSend` use filled `primary` circle with `onPrimary` icon
- [ ] **`ChatInputBar` signature unchanged**: same parameters — all callbacks preserved; callers in `ChatScreen.kt` need no changes

### Before / After

| | Before | After |
|---|---|---|
| Separator | `HorizontalDivider` top border | None — card elevation separates |
| Attachment actions | 4 icons always visible below text | Hidden behind `+`; revealed in bottom sheet |
| Card shape | Full-width pill (`RoundedCornerShape(24.dp)`) edge-to-edge | Floating card (`RoundedCornerShape(20.dp)`) with 12dp side margins |
| Send button disabled | Invisible (`surface` on `surfaceVariant`) | Visible at 38% alpha |
| Text field max lines | 4 | 5 |

---

## Audit Findings Reference

The following issues were identified during the audit. Each is addressed in the phases above.

### Critical (high user impact)
- `Markwon.create(ctx)` recreated on every bubble recomposition — Phase B/H
- 30+ missing `contentDescription` values — Phase G
- Send button invisible when disabled — Phase B
- AgentConfigScreen God Screen (763 lines, 13+ sections) — Phase D
- `NexyFormSheet` keyboard avoidance missing — Phase C

### High
- HomeScreen top bar crowded with 5 actions — Phase A
- ThinkingHistoryBubble and ToolCallBubble expand/collapse with no animation — Phase B
- Search filters have no debouncing (every keystroke triggers recomposition) — Phase C/H
- `ModalBottomSheet` state hoisted inside conditional branches — Phase B/H
- No unsaved-changes warning on form back navigation — Phase D/E
- Settings IA: MCP Servers listed in two separate rows navigating to the same screen — Phase E
- Settings IA: Self-Heal and Updates miscategorised under "Tools" — Phase E
- No pull-to-refresh on Projects and Agents tabs — Phase A
- Skills/Artifacts screens don't auto-refresh on re-entry (stale data after desktop edits) — Phase A/F

### Medium
- No message timestamps in chat — Phase B
- Draft text lost on back navigation — Phase B
- No image thumbnail preview inside AttachmentChip — Phase B
- No step progress indicator in any generator screen — Phase I
- No "Previous" button within generator phases — Phase I
- Tag chips on skills are not tappable to filter — Phase F
- No sort options on list screens — Phase F
- No search result count shown after filtering — Phase F
- Milestone status uses 3 TextButtons in a row — Phase E
- `IconButton` touch targets at 36.dp (below 48.dp minimum) — Phase G

### Low / Polish
- Hardcoded `Color(0xFF16A34A)` and `Color(0xFFEF4444)` in `ApprovalDialog.kt` — Phase J
- Brand violet `Color(0xFFA78BFA)` duplicated in `SplashScreen` and `HomeScreen` — Phase J
- No entrance animations on list items — Phase J
- No haptic feedback on FAB — Phase J
- ConnectionChip state change has no crossfade animation — Phase J
- No skeleton loaders (only spinners or blank space during loading) — Phase C
