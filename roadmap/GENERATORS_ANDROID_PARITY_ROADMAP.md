# Android Generator Parity Roadmap

## Context

The Agent Generator Android implementation was fixed and brought to full parity with the desktop in the previous session. The same class of bugs and missing features applies to the three remaining generators:

- **Project Generator** (`ui/projectgenerator/`)
- **Skill Generator** (`ui/skillgenerator/`)
- **Artifact Generator** (`ui/artifactgenerator/`)

All three are missing the same things the Agent Generator was missing before its fix:

1. **Model picker** — no way to see or change which model is used; label always shows "Default model" with no resolved-model feedback
2. **Resolved model broadcast** — desktop `ws-handlers.ts` never broadcasts `<generator>:model` back to Android on `start`, so Android never learns the actual model being used
3. **Snackbar error + retry** — errors go to `uiState.error` but no screen shows a snackbar with a Retry action (agent generator uses `SnackbarHost` + `LaunchedEffect(uiState.error)`)
4. **Insert prompt button** — no `TextFields` icon button in the chat input row to open a prompt bottom sheet (agent generator has this)
5. **Retry last message** — no `retryLastMessage()` in ViewModels (agent generator has it, used by snackbar retry action)
6. **`selectedModel` + `resolvedModel` in state** — ViewModels have no model state at all

> Artifact Generator is slightly different: it has a two-phase flow (CHAT → SPEC_REVIEW → generation, no DONE phase with a name). Apply all items that map to it and skip items that don't apply (e.g. "Set up manually" — not needed for artifacts).

---

## Root cause (same as Agent Generator)

When no explicit model override is sent, the desktop's `getAgentGeneratorModel()` / equivalent resolves the global `default_model` setting. If the saved model ID is a CLI model (e.g. `claude-haiku-4-5-20251001`) and no Anthropic BYOK key is configured, the provider lookup falls through to whatever BYOK is configured (e.g. OpenRouter with a routing model that returns empty). The fix already applied to Agent Generator:

1. Desktop: check if saved model ID matches a CLI model before falling through to BYOK/OpenRouter
2. Desktop: broadcast `<generator>:model` with the resolved model ID on `start` so Android can display it

The same fix needs to be applied to project-generator, skill-generator, and artifact-generator on the desktop, and the same model picker + resolved model display pattern applied on Android.

---

## Desktop fixes needed (`src/main/`)

### `project-generator.ts` and `skill-generator.ts`

Both likely use their own `getProjectGeneratorModel()` / `getSkillGeneratorModel()` (or delegate to `getAgentGeneratorModel()`). Verify the same CLI routing fix is in place:

- [ ] **PG-D1** Check `getProjectGeneratorModel()` has the CLI model ID routing before BYOK/OpenRouter fallback (same fix as `getAgentGeneratorModel()`)
- [ ] **SG-D1** Check `getSkillGeneratorModel()` has the same fix
- [ ] **AG-D1** Check `artifact-generator.ts` has equivalent model resolution with CLI routing fix

### `ws-handlers.ts`

- [ ] **WS-1** On `project-generator:start`: resolve model, broadcast `project-generator:model { sessionId, modelId }` before running chat
- [ ] **WS-2** On `skill-generator:start`: resolve model, broadcast `skill-generator:model { sessionId, modelId }`
- [ ] **WS-3** On `artifact-generator:start`: resolve model, broadcast `artifact-generator:model { sessionId, modelId }`

Pattern (copy from agent-generator block in ws-handlers.ts):
```typescript
if (command === 'project-generator:start') {
  try {
    const resolvedModel = modelOverride ?? getProjectGeneratorModel()
    broadcastToMobile({ event: 'project-generator:model', data: { sessionId, modelId: resolvedModel } })
  } catch { /* surfaces from runProjectGeneratorChatForAndroid */ }
}
```

---

## Android changes

### WsEvent.kt — add `*Model` events

- [ ] **PG-A1** Add `data class ProjectGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()`
- [ ] **SG-A1** Add `data class SkillGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()`
- [ ] **AG-A1** Add `data class ArtifactGeneratorModel(val sessionId: String?, val modelId: String) : WsEvent()`

### WsEventParser.kt — parse new events

- [ ] **PG-A2** Add parser case for `"project-generator:model"` → `WsEvent.ProjectGeneratorModel`
- [ ] **SG-A2** Add parser case for `"skill-generator:model"` → `WsEvent.SkillGeneratorModel`
- [ ] **AG-A2** Add parser case for `"artifact-generator:model"` → `WsEvent.ArtifactGeneratorModel`

---

## Project Generator

### ProjectGeneratorViewModel.kt

- [ ] **PG-V1** Add `selectedModel: String? = null` and `resolvedModel: String? = null` to `ProjectGeneratorUiState`
- [ ] **PG-V2** Handle `WsEvent.ProjectGeneratorModel` → `_uiState.value = _uiState.value.copy(resolvedModel = event.modelId.ifBlank { null })`
- [ ] **PG-V3** Add `fun setModel(modelId: String?)` — sets `selectedModel`
- [ ] **PG-V4** Add `fun retryLastMessage()` — re-sends the last user message (same as AgentGeneratorViewModel)
- [ ] **PG-V5** Add `fun dismissError()` — clears `error`
- [ ] **PG-V6** Pass `model` in WS payload when `selectedModel != null` (in `sendMessage`)

### ProjectGeneratorScreen.kt

- [ ] **PG-S1** Collect `models` from `WsRepository.models` and send `model:list` on `LaunchedEffect(Unit)`
- [ ] **PG-S2** Compute `activeModelLabel` using `uiState.selectedModel ?: uiState.resolvedModel` (same pattern as AgentGeneratorScreen)
- [ ] **PG-S3** Add model picker `TextButton` in top bar (Tune icon + label, opens `showModelSheet`)
- [ ] **PG-S4** Add model picker `ModalBottomSheet` with grouped vendor layout + search (copy from AgentGeneratorScreen lines 244–345)
- [ ] **PG-S5** Add `SnackbarHost` + `LaunchedEffect(uiState.error)` that shows error with "Retry" action calling `vm.retryLastMessage()` then `vm.dismissError()`
- [ ] **PG-S6** Add `IconButton(TextFields)` in chat input row to open prompt bottom sheet
- [ ] **PG-S7** Add prompt `ModalBottomSheet` (copy from AgentGeneratorScreen lines 205–241)
- [ ] **PG-S8** Add `promptInsert` / `insertPromptText` flow to ViewModel and Screen (collect `uiState.promptInsert` in `LaunchedEffect`)

---

## Skill Generator

### SkillGeneratorViewModel.kt

- [ ] **SG-V1** Add `selectedModel: String? = null` and `resolvedModel: String? = null` to `SkillGeneratorUiState`
- [ ] **SG-V2** Handle `WsEvent.SkillGeneratorModel` → update `resolvedModel`
- [ ] **SG-V3** Add `fun setModel(modelId: String?)`
- [ ] **SG-V4** Add `fun retryLastMessage()`
- [ ] **SG-V5** Add `fun dismissError()`
- [ ] **SG-V6** Pass `model` in WS payload when `selectedModel != null`
- [ ] **SG-V7** Add `promptInsert: Pair<Int, String>? = null` to state + `fun insertPromptText(body: String)`

### SkillGeneratorScreen.kt

- [ ] **SG-S1** Collect `models`, send `model:list` on enter
- [ ] **SG-S2** Compute `activeModelLabel` from `selectedModel ?: resolvedModel`
- [ ] **SG-S3** Add model picker `TextButton` in top bar
- [ ] **SG-S4** Add model picker `ModalBottomSheet`
- [ ] **SG-S5** Add `SnackbarHost` + error `LaunchedEffect` with retry
- [ ] **SG-S6** Add prompt insert `IconButton` + `ModalBottomSheet`

---

## Artifact Generator

> Note: Artifact Generator uses a different two-phase flow. It sends `artifact-generator:start/message` for the chat phase and `artifact-generator:generate` to trigger artifact creation. No "Set up manually" needed. Apply model picker and snackbar fixes; prompt insert applies to the chat input.

### ArtifactGeneratorViewModel.kt

- [ ] **AG-V1** Add `selectedModel: String? = null` and `resolvedModel: String? = null` to `ArtifactGeneratorUiState`
- [ ] **AG-V2** Handle `WsEvent.ArtifactGeneratorModel` → update `resolvedModel`
- [ ] **AG-V3** Add `fun setModel(modelId: String?)`
- [ ] **AG-V4** Add `fun retryLastMessage()`
- [ ] **AG-V5** Add `fun dismissError()`
- [ ] **AG-V6** Pass `model` in WS payload when `selectedModel != null`
- [ ] **AG-V7** Add `promptInsert: Pair<Int, String>? = null` to state + `fun insertPromptText(body: String)`

### ArtifactGeneratorScreen.kt

- [ ] **AG-S1** Collect `models`, send `model:list` on enter
- [ ] **AG-S2** Compute `activeModelLabel` from `selectedModel ?: resolvedModel`
- [ ] **AG-S3** Add model picker `TextButton` in top bar
- [ ] **AG-S4** Add model picker `ModalBottomSheet`
- [ ] **AG-S5** Add `SnackbarHost` + error `LaunchedEffect` with retry
- [ ] **AG-S6** Add prompt insert `IconButton` + `ModalBottomSheet`

---

## Reference implementation

All patterns are already in `AgentGeneratorScreen.kt` and `AgentGeneratorViewModel.kt`. When implementing, copy directly from those files:

| Pattern | Source location |
|---|---|
| Model picker TextButton + ModalBottomSheet | `AgentGeneratorScreen.kt` lines 142–156, 244–345 |
| `activeModelLabel` computation | `AgentGeneratorScreen.kt` line 93–94 |
| Snackbar + retry LaunchedEffect | `AgentGeneratorScreen.kt` lines 107–118 |
| Prompt insert button + sheet | `AgentGeneratorScreen.kt` lines 204–241, 408–410 |
| `selectedModel` / `resolvedModel` state | `AgentGeneratorViewModel.kt` lines 34–35 |
| `WsEvent.AgentGeneratorModel` handler | `AgentGeneratorViewModel.kt` lines 48–50 |
| `setModel` / `retryLastMessage` / `dismissError` | `AgentGeneratorViewModel.kt` lines 111–113, 155–163 |
| WsEvent type declaration | `WsEvent.kt` line 161 |
| WsEvent parser case | `WsEventParser.kt` lines 1014–1017 |
| Desktop model broadcast | `ws-handlers.ts` lines 1653–1658 |

---

## Verification checklist

- [ ] Project Generator: open on Android → model label shows resolved model after first send → error shows snackbar with Retry → prompt insert button works → model picker lets you select a specific model
- [ ] Skill Generator: same as above
- [ ] Artifact Generator: same as above (minus "Set up manually")
- [ ] All three: select a CLI model in picker → send message → correct CLI model used (check desktop logs)
- [ ] All three: no provider configured → error snackbar appears (not silent empty response)
