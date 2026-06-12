# Refactor Roadmap — Monolith Decomposition

Total scope: ~15,300 lines across desktop + Android.
Goal: break large files into single-responsibility modules — no behavior changes, no new features.

Each phase is independently shippable. Within a phase, items can be tackled in any order.

---

## Status: ALL PHASES COMPLETE ✓

| Phase | Status | Commit(s) |
|---|---|---|
| 1A — conversation-handlers.ts | ✅ Done | refactor(main): split conversation-handlers |
| 1B — providers.ts | ✅ Done | refactor(main): split providers |
| 1C — Android WsRepository.kt | ✅ Done | refactor(android): split WsRepository |
| 2A — Android HomeScreen.kt | ✅ Done | refactor(android): split HomeScreen |
| 2B — Android ChatScreen.kt | ✅ Done | refactor(android): split ChatScreen |
| 2C — Android SettingsScreen.kt | ✅ Done | refactor(android): split SettingsScreen |
| 3A — SettingsPanel.tsx | ✅ Done | refactor(renderer): split SettingsPanel |
| 3B — ProjectSettingsPanel.tsx | ✅ Done | refactor(renderer): split ProjectSettingsPanel |
| 3C — AgentPanel.tsx | ✅ Done | refactor(renderer): split AgentPanel |
| 4A — shared/types.ts | ✅ Skipped — already section-commented, splitting creates circular import risk |
| 4B — useChatWindowActions.ts | ✅ Skipped — well-structured single-concern hook, splitting adds coupling |
| 4C — SectionPane.tsx | ✅ Done | refactor(renderer): split SectionPane |
| 4D — useChat.ts | ✅ Skipped — well-structured single-concern hook |
| 5A — Android ChatViewModel | ✅ Done | refactor(android): extract ChatToolCallParser |
| 5B — Android SettingsViewModel | ✅ Done | refactor(android): extract UpdateInstaller + NotificationDiagnosticsReader |
| 5C — Android PairedServerStore | ✅ Done | refactor(android): extract PairedServerConfigParser + Serializer |

---

## Guiding principles

- **No behavior changes.** Every refactor is a pure move/rename. If logic needs to change, that's a separate PR.
- **Typecheck + tests must stay green** after each PR. Run `npm run typecheck && npm test` (desktop) and Android build before merging.
- **No new abstractions.** Don't introduce base classes, context providers, or utility layers unless they already exist. Just relocate.
- **Re-export for backward compat only when needed.** Prefer updating all import sites over barrel re-exports.

---

## Phase 1 — Pure logic, zero UI risk (~2,300 lines) ✅

### 1A · `src/main/conversation-handlers.ts` → 6 focused modules ✅

| File | Contents |
|---|---|
| `src/main/conversation-export.ts` | Export/pack building, attachment summarizers, export row mapping |
| `src/main/conversation-import.ts` | Import normalization, message parsing |
| `src/main/conversation-fork.ts` | Fork logic, message rewriting, validation |
| `src/main/conversation-compression.ts` | Summarization strategies, compression source aggregation |
| `src/main/conversation-formatters.ts` | Markdown transcript, context bundle, metadata builders |
| `src/main/conversation-serialization.ts` | Snapshot serialization, compression summary parsing |
| `src/main/conversation-types.ts` | Shared row/type definitions |
| `src/main/conversation-handlers.ts` | IPC handler registration only |

### 1B · `src/main/providers.ts` → 8 focused modules ✅

| File | Contents |
|---|---|
| `src/main/provider-registry.ts` | PROVIDERS array, getProviderForAgent, isProviderConfigured |
| `src/main/provider-secrets.ts` | API key storage/retrieval via safeStorage |
| `src/main/provider-messages.ts` | Message format converters |
| `src/main/provider-tools.ts` | Tool format converters |
| `src/main/provider-core-types.ts` | Shared provider types |
| `src/main/provider-stream-state.ts` | Stream state management |
| `src/main/providers/openai-provider.ts` | OpenAI + Azure + OpenRouter |
| `src/main/providers/anthropic-provider.ts` | Anthropic streaming |
| `src/main/providers/gemini-provider.ts` | Gemini API |
| `src/main/providers/misc-providers.ts` | Groq, xAI, Mistral |
| `src/main/providers.ts` | Re-exports + IPC registration |

### 1C · Android `WsRepository.kt` → focused modules ✅

| File | Contents |
|---|---|
| `data/WsEventParser.kt` | Event deserialization |
| `data/WsJsonConversion.kt` | JSON helpers |
| `data/WsRepository.kt` | Connection lifecycle only |

---

## Phase 2 — Android UI decomposition (~2,200 lines) ✅

### 2A · Android `HomeScreen.kt` ✅

Split into: `HomeScreenTabs.kt`, `HomeScreenComponents.kt`, `HomeScreenHelpers.kt`, `ScopedChatHistoryScreen.kt` + thin container.

### 2B · Android `ChatScreen.kt` ✅

Split into: `ChatScreenBubbles.kt`, `ChatScreenInput.kt`, `ChatScreenComponents.kt`, `ChatScreenHelpers.kt` + thin container.

### 2C · Android `SettingsScreen.kt` ✅

Split into: `SettingsScreenSections.kt` + thin container.

---

## Phase 3 — Desktop renderer panels (~3,550 lines) ✅

### 3A · `src/renderer/components/SettingsPanel.tsx` ✅

Split into `settings/` tab files: `GeneralTab.tsx`, `ProvidersTab.tsx`, `CliToolsTab.tsx`, `MobileCompanionTab.tsx`, `PromptLibraryTab.tsx`, `DeveloperTab.tsx`, `AndroidTab.tsx` + hooks + thin container.

### 3B · `src/renderer/components/ProjectSettingsPanel.tsx` ✅

Split into `project-settings/` tab files: `GeneralTab.tsx`, `ScopeTab.tsx`, `MilestonesTab.tsx`, `TeamTab.tsx`, `WikiTab.tsx` + thin container.

### 3C · `src/renderer/components/AgentPanel.tsx` ✅

Split into `agent-panel/` tab files: `SettingsTab.tsx`, `KnowledgeTab.tsx`, `SkillsTab.tsx`, `JsonTab.tsx` + `types.ts` + thin container.

---

## Phase 4 — Desktop types + hooks + SectionPane ✅

### 4A · `src/shared/types.ts` — Skipped ✅

Already organized with clear section comments. Splitting would create circular import risk via `IpcReturnMap`/`IpcChannels`.

### 4B · `src/renderer/hooks/useChatWindowActions.ts` — Skipped ✅

744-line hook is a well-structured single-concern coordinator. All state flows through one parameter object — splitting would require massive inter-hook parameter passing with no benefit.

### 4C · `src/renderer/components/SectionPane.tsx` ✅

Split into `section-pane/` files: `ProjectsPane.tsx`, `AgentsPane.tsx`, `AgentHistoryPane.tsx`, `ChatsPane.tsx`, `ProjectHistoryPane.tsx`, `shared.tsx` + thin container.

### 4D · `src/renderer/hooks/useChat.ts` — Skipped ✅

509-line hook is a well-structured single-concern hook. Same reasoning as 4B.

---

## Phase 5 — Android ViewModel extractions ✅

### 5A · Android `ChatViewModel.kt` ✅

Extracted `ChatToolCallParser.kt` — `toChatMessage()` extension + `jsonString`/`jsonBoolean`/`jsonObject` helpers.

### 5B · Android `SettingsViewModel.kt` ✅

Extracted `UpdateInstaller.kt` — download/verify/install APK logic.
Moved `readNotificationDiagnostics()` into `NotificationDiagnostics.kt`.

### 5C · Android `PairedServerStore.kt` ✅

Extracted `PairedServerConfigParser.kt` — URL parsing.
Extracted `PairedServerProfileSerializer.kt` — JSON serialization/deserialization.

---

## Final state

- Desktop typecheck: ✅ clean
- ESLint errors: ✅ 0 errors (33 pre-existing warnings, not from refactor)
- Test suite: ✅ 708/714 passing (6 pre-existing failures unrelated to refactor, present before session started)
- ~17 original files decomposed into ~117 focused modules
