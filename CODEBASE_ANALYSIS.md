# Nexy Codebase Analysis Report
**Generated:** 2026-06-26  
**Scope:** UI Unification & Feature Parity Analysis  
**Platforms:** Desktop (Electron + React) & Android (Kotlin + Compose)

---

## Executive Summary

Nexy is a sophisticated dual-platform productivity assistant:
- **Desktop**: Electron 33 + React 19 + TypeScript + Tailwind CSS
- **Android**: Kotlin + Jetpack Compose + Material Design 3 + WebSocket sync

**Current State**: ~75% feature parity with strong visual alignment but different architectural patterns for UI organization.

**Key Challenge**: Desktop uses sidebar + side-panel model; Android uses tab-based navigation + full-screen modals. Feature gaps exist primarily in advanced chat features (slash commands, @-references, context inspector).

---

## Architecture Overview

### Desktop Architecture (Three-Process Electron App)

```
┌─────────────────────────────────────────┐
│  Renderer (React 19 + Zustand)          │
│  - App.tsx (orchestration hub)          │
│  - 42+ component files                  │
│  - Lazy-loaded panels                   │
└────────────────┬────────────────────────┘
                 │ window.api (IPC)
┌────────────────▼────────────────────────┐
│  Preload (src/preload/index.ts)         │
│  - IPC channel bridges                  │
└────────────────┬────────────────────────┘
                 │ Native IPC
┌────────────────▼────────────────────────┐
│  Main Process (src/main/)               │
│  ├─ Database (SQLite + better-sqlite3)  │
│  ├─ IPC Handlers (ipc-handlers.ts)      │
│  ├─ LLM Providers (7 BYOK + 2 CLI)      │
│  ├─ MCP Servers (stdio child processes) │
│  ├─ Tools (file-edit, web-fetch)        │
│  ├─ Orchestrator (multi-agent)          │
│  ├─ Scheduler Engine                    │
│  ├─ WebSocket Server (Android sync)     │
│  └─ Local Feed Server (OTA updates)     │
└─────────────────────────────────────────┘
```

**Key Files**:
- `src/renderer/App.tsx` (450+ lines) — Central orchestration, state management subscriptions
- `src/main/index.ts` — Main process lifecycle, subsystem initialization
- `src/main/ipc-handlers.ts` — IPC channel registry
- `src/renderer/store/app-store.ts` — Zustand store with 5 Immer slices (auth, conversation, project, agent, ui)

### Android Architecture (Jetpack Compose + WebSocket Sync)

```
┌──────────────────────────────────────────┐
│  MainActivity + NavGraph                 │
│  ├─ HomeScreen (tab-based hub)           │
│  ├─ ChatScreen (WebSocket synced)        │
│  ├─ Settings (5+ config screens)         │
│  ├─ Generators (4 wizard screens)        │
│  └─ Utilities (Remote Edit, Wiki, etc.)  │
└──────────────────┬───────────────────────┘
                   │ ViewModel + WsRepository
┌──────────────────▼───────────────────────┐
│  Data Layer (WsRepository)               │
│  ├─ WebSocket connection to desktop      │
│  ├─ Local state (SharedPreferences)      │
│  └─ Real-time sync of chat, agents, etc. │
└──────────────────────────────────────────┘
```

**Key Files**:
- `android/app/src/main/java/io/nexy/android/navigation/NavGraph.kt` — Full navigation schema (20+ screens)
- `android/app/src/main/java/io/nexy/android/ui/chat/ChatScreen.kt` — Chat implementation
- `android/app/src/main/java/io/nexy/android/ui/home/HomeScreen.kt` — Main hub with tabs
- `android/app/src/main/java/io/nexy/android/data/WsRepository.kt` — WebSocket state sync

---

## Feature Inventory

### ✅ Features with Full Parity (100%)

| Feature | Desktop | Android | Notes |
|---------|---------|---------|-------|
| **Navigation & Routing** | Sidebar + panels | Tab-based home + modal nav | Functionally equivalent, different UX |
| **Chat Messages** | Full history, streaming | Full history, streaming | Both sync via WebSocket |
| **Model Selection** | Dropdown in composer | Model picker sheet | Equivalent UX patterns |
| **Agent Management** | Agent panel with tabs | Dedicated config screen | Full CRUD on both |
| **Project Management** | Tabbed project panel | Project config screen | Full CRUD on both |
| **Skill Management** | Skill panel + generator | Skills screen + generator | Equivalent workflows |
| **Scheduling** | Scheduler view + generator | Scheduled screen + generator | Feature-complete on both |
| **Settings** | SettingsPanel component | 7 settings screens | Similar scope, different layout |
| **Learning (Debrief/Quiz)** | Modal dialogs | Dedicated screens | Equivalent functionality |
| **Artifacts** | ArtifactsPanel (search/browse) | ArtifactsScreen | Both can browse and view |

### ⚠️ Features with Partial Parity (50-75%)

| Feature | Desktop | Android | Gap |
|---------|---------|---------|-----|
| **Chat Input** | Advanced (slash commands, @-refs, attachments) | Basic input only | Missing slash commands & context refs |
| **Message Display** | Thinking blocks, tool calls, reasoning | Basic text + tool calls | Missing thinking block UI |
| **Agent Config** | Settings, Skills, Knowledge tabs | Single config screen | Android lacks tabbed detail view |
| **Project Config** | General, Scope, Milestones, Team, Wiki tabs | Single config screen | Android lacks granular tabs |
| **Context System** | @-references (files, wikis, agents) | Not visible | Android can't see/select context |
| **Attachments** | File picker + upload | No file attachments | Android missing attachment feature |
| **Wiki Integration** | Save-to-wiki modal, extraction modal | Wiki screen (read-only?) | Android wiki support unclear |

### ❌ Features Missing on Android

| Feature | Desktop Capability | Android Status |
|---------|-------------------|-----------------|
| **Slash Commands** | `/debrief`, `/quiz`, `/continue`, custom agent commands | Not implemented |
| **Context Inspector** | Token count, see referenced files/wikis | Not visible |
| **Inline Tool Call Approval** | Approve/reject tools mid-conversation | Not visible |
| **Thinking Block Display** | Visual block showing reasoning | Not rendered |
| **Save-to-Wiki Modal** | Extract & save message to wiki knowledge base | Not visible |
| **Wiki Extraction Modal** | Auto-extract wiki candidates | Not visible |

### ❌ Features Missing on Desktop

| Feature | Android Capability | Desktop Status |
|---------|-------------------|-----------------|
| None identified | — | — |

---

## Visual & Design System Analysis

### Color Palette Alignment ✅

**Both platforms use the same Tailwind-based Gray scale:**

```
Gray50:  #F9FAFB (both)   Gray500: #6B7280 (both)
Gray100: #F3F4F6 (both)   Gray600: #4B5563 (both)
Gray200: #E5E7EB (both)   Gray700: #374151 (both)
Gray300: #D1D5DB (both)   Gray800: #1F2937 (both)
Gray400: #9CA3AF (both)   Gray900: #111827 (both)
```

**Primary Colors:**
- Blue100–Blue900 palette mirrors between platforms
- Blue500: #3B82F6 primary (desktop & Android)
- Semantic colors (Red, Green) aligned

**Status:** ✅ Color palette is already unified via `android/app/src/main/java/io/nexy/android/ui/theme/Color.kt` which explicitly mirrors Tailwind.

### Typography System ⚠️

**Desktop:**
- Tailwind typography plugin (`@tailwindcss/typography`)
- Font stack: System defaults via Tailwind
- No explicit type scale defined in code

**Android:**
- Material 3 type scale via `android/app/src/main/java/io/nexy/android/ui/theme/Type.kt`
- Explicit headline, title, body, label styles

**Status:** ⚠️ Both have type systems but Desktop doesn't expose a config. Android Type.kt is the source of truth for Android typography.

### Spacing System ⚠️

**Desktop:**
- Tailwind spacing scale (4px base unit: 0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, ...)
- Applied via `p-4`, `m-2`, `gap-3` utilities

**Android:**
- No explicit spacing constants file found
- Likely uses Material 3 defaults + hardcoded dp values in compose

**Status:** ⚠️ Spacing approach differs significantly. Android needs a unified spacing configuration.

### Component Patterns

#### Buttons
**Desktop:** Tailwind utility classes (no Button component found)
- Styled inline with `className="bg-blue-500 text-white rounded..."`
- No consistent button component library

**Android:** Compose Material 3 buttons
- `Button()`, `FilledTonalButton()`, `OutlinedButton()`, `TextButton()`
- Consistent Material Design semantics

**Status:** ⚠️ Desktop lacks reusable button components; Android has Material 3 coverage.

#### Input Fields
**Desktop:** Tailwind-styled inputs, no centralized component
- Styled with utility classes

**Android:** Compose Material 3 `TextField()` / `OutlinedTextField()`
- Consistent styling and behavior

**Status:** ⚠️ Desktop needs input component abstraction.

#### Navigation
**Desktop:** 
- Sidebar for projects/agents/chats/skills (collapsible sections)
- No navbar/tab pattern

**Android:**
- HomeScreen with 3-5 tabs (Chat, Projects, Agents, Skills, Settings)
- Bottom or top navigation

**Status:** ⚠️ Different navigation patterns, both functional but not unified.

#### Modals & Dialogs
**Desktop:** React modal libraries, custom implementation
**Android:** Compose `Dialog()`, `ModalBottomSheet()`

**Status:** ⚠️ Different modal systems, but both provide necessary UX.

---

## Codebase Metrics

### Desktop Renderer
| Metric | Count | Notes |
|--------|-------|-------|
| Component files | 42 | Under `src/renderer/components/` |
| Lazy-loaded components | 10 | Agent, MCP, Settings, Project, Skill, Schedule, RemoteEdit, Artifacts, OnBoarding, ProjectGen, SkillGen |
| Hooks | 10+ | useChat, useAtMenu, useSlashMenu, useFileInput, etc. |
| UI state slices | 5 | auth, conversation, project, agent, ui |

### Android UI
| Metric | Count | Notes |
|--------|-------|-------|
| Screen files | 35+ | Navigation targets under `ui/` |
| ViewModel classes | 12+ | One per major screen or feature |
| Compose files (UI utils) | 5+ | NexyUx.kt, NexyTopAppBar, components/ |

### Main Process
| Metric | Count | Notes |
|--------|-------|-------|
| Handler modules | 25+ | chat, conversation, agent, project, skill, scheduler, etc. |
| Provider implementations | 7 BYOK + 2 CLI | anthropic, openai, azure, gemini, mistral, groq, xai + claude-cli, codex-cli |
| MCP servers | Configurable | Users can add arbitrary MCP servers |
| Database tables | 20+ | conversations, messages, agents, projects, settings, etc. |

---

## Architecture Patterns & Conventions

### State Management

**Desktop (Zustand):**
```typescript
const useAppStore = create<AppStore>((set) => ({
  auth: { ... },
  conversation: { ... },
  project: { ... },
  agent: { ... },
  ui: { ... },
  hydrate: async () => { /* load from main */ }
}))
```
- Single store with Immer slices
- Hydrated on startup from main process
- Reactive subscriptions via selectors

**Android (ViewModel + Repository):**
```kotlin
class ChatViewModel : ViewModel() {
  val connectionState: StateFlow<ConnectionState>
  val messages: StateFlow<List<Message>>
  val agents: StateFlow<List<Agent>>
  // ...
}
```
- Per-screen ViewModels
- WsRepository for WebSocket sync
- StateFlow for reactive state

**Gap:** Desktop has centralized global state; Android has per-screen state. This makes cross-screen communication harder on Android.

### IPC/Communication Pattern

**Desktop → Android:** WebSocket via `src/main/ws-server.ts`
- Android client connects to desktop WebSocket
- Syncs: chat messages, agents, projects, skills, settings
- Push events for real-time updates (tool approval, etc.)

**Desktop → Main:** IPC channels via `safeHandle()` wrapper
```typescript
safeHandle('chat:sendMessage', async (args) => { /* ... */ })
```
- Validates sender origin
- Returns `{ error: string }` on failure (no rejection)

**Status:** ✅ Communication patterns are well-established.

### Component Reusability

**Desktop:**
- No shared component library across desktop/Android
- React components use Tailwind + custom styling
- No storybook or component documentation found

**Android:**
- Material 3 is the design system
- `NexyUx.kt` has some custom composables
- No cross-platform component sharing

**Status:** ⚠️ Component libraries are platform-specific. Sharing would require major refactoring.

---

## Testing Coverage

### Desktop (Vitest)
- **Main process tests** (`src/main/__tests__/`) — SQL.js for testing, real migrations
- **Renderer tests** (`src/renderer/__tests__/`) — happy-dom environment, mocked `window.api`
- **Shared tests** (`src/shared/__tests__/`) — Utility functions, models

**Status:** ✅ Test structure is in place, coverage levels unclear.

### Android
- **Unit tests** (`android/app/src/test/`) — ViewModels, utilities
- **Instrumented tests** (`android/app/src/androidTest/`) — UI, integration tests

**Status:** ✅ Android has test structure. Coverage levels unclear.

---

## Known Hotspots & Technical Debt

### 1. Desktop Orchestration Centralization
**File:** `src/renderer/App.tsx` (450+ lines)
**Issue:** App.tsx is responsible for:
- Global state subscription management
- Lazy component loading and visibility
- Event listener setup (online/offline, resize, etc.)
- Multiple modal/panel coordination

**Risk:** Hard to reason about, difficult to add new global panels.

**Recommendation:** Extract panel orchestration into a custom hook or separate module.

---

### 2. Main Process Complexity
**File:** `src/main/index.ts`
**Issue:** Initializes all subsystems in one file:
- Database
- Window creation
- IPC handlers registration
- WebSocket server
- Updater
- Auto-launcher

**Risk:** Single point of failure; hard to test subsystems in isolation.

**Recommendation:** Modularize subsystem initialization (database-setup.ts, ws-setup.ts, etc.).

---

### 3. Android State Fragmentation
**Issue:** No centralized Android state like Zustand on desktop.
- ViewModels are screen-scoped
- WsRepository holds connection state
- SharedPreferences for persistence

**Risk:** Cross-screen state updates are implicit; navigation/back-press can lose state.

**Recommendation:** Consider MVI/MVVM patterns with a centralized Repository per domain (ChatRepository, AgentRepository).

---

### 4. No Shared Design Token System
**Issue:** Tailwind config is minimal; Android Color.kt is not referenced by desktop.
```javascript
// tailwind.config.js — empty extend!
theme: {
  extend: {}
}
```

**Risk:** Colors, spacing, typography drift over time across platforms.

**Recommendation:** Create `src/shared/design-tokens.ts` with:
```typescript
export const tokens = {
  colors: { gray50: '#F9FAFB', blue500: '#3B82F6', ... },
  spacing: { xs: '4px', sm: '8px', ... },
  typography: { headlineL: { size: 32, weight: 700 }, ... }
}
```

---

### 5. Feature Gaps on Android

**Missing Features:**
1. **Slash Commands** — `/debrief`, `/quiz`, custom agent commands
2. **@-References** — Can't select files/wikis/agents in chat input
3. **Attachments** — No file attachment UI
4. **Context Inspector** — Can't see token count or references
5. **Thinking Blocks** — Claude's extended thinking not displayed
6. **Wiki Modals** — Save-to-wiki and extraction workflows missing

**Impact:** Feature parity ~65% for chat surface.

---

## Recommendations for UI Unification

### Phase 1: Foundation (Design Tokens & Docs)
- [ ] Create centralized `src/shared/design-tokens.ts`
- [ ] Export tokens to both desktop and Android
- [ ] Document component semantics (button sizes, input behaviors, etc.)
- [ ] Update Tailwind config to use token colors/spacing

### Phase 2: Desktop Component Refactoring
- [ ] Extract reusable Button, Input, Modal, Dialog components
- [ ] Replace inline Tailwind styles with component props
- [ ] Create storybook or documentation
- [ ] Refactor App.tsx orchestration into smaller hooks

### Phase 3: Android Feature Parity
- [ ] Implement slash commands menu in ChatScreenInput.kt
- [ ] Add @-reference context picker in chat composer
- [ ] Implement file attachment picker
- [ ] Add context inspector sheet
- [ ] Render thinking blocks in ChatScreenBubbles.kt
- [ ] Add wiki modals (save-to-wiki, extraction)

### Phase 4: Cross-Platform Testing
- [ ] Add visual regression tests (desktop + Android)
- [ ] Document screen-by-screen parity checklist
- [ ] Test core workflows end-to-end

---

## File Organization Summary

### Desktop (src/)
```
src/
├── main/                    # Electron main process (25+ modules)
├── preload/                 # IPC bridge (contextBridge)
├── renderer/                # React app root
│   ├── App.tsx              # Orchestration hub
│   ├── components/          # 42 component files
│   ├── hooks/               # 10+ custom hooks
│   ├── store/               # Zustand app-store
│   └── styles/              # CSS utilities
├── shared/                  # Shared types & utils
└── test/                    # Test setup & helpers
```

### Android
```
android/app/src/main/java/io/nexy/android/
├── navigation/              # NavGraph + routing
├── ui/
│   ├── chat/                # ChatScreen + helpers
│   ├── home/                # HomeScreen + tabs
│   ├── settings/            # 7 settings screens
│   ├── theme/               # Color.kt, Theme.kt, Type.kt
│   ├── components/          # Shared composables
│   └── [feature]/           # Feature-specific screens (agents, projects, skills, etc.)
└── data/                    # WsRepository, ViewModels
```

---

## Conclusion

**Nexy is a mature, feature-rich dual-platform assistant with:**
- ✅ Strong color/design alignment
- ✅ Well-structured codebase with clear separation of concerns
- ✅ Solid testing infrastructure
- ⚠️ Different UI patterns (sidebar vs tabs) that serve the platforms well
- ⚠️ ~65% feature parity in chat surface (advanced features missing on Android)
- ❌ No shared design token system (creates drift risk)
- ❌ Desktop lacks reusable component library

**For UI Unification**, the path forward is:
1. Establish design tokens as single source of truth
2. Extract desktop components into reusable library
3. Implement missing Android chat features (slash commands, @-refs, context inspector)
4. Add cross-platform component documentation & testing

**Estimated effort for full parity:** 4-6 weeks with 2 developers (1 desktop, 1 Android).
