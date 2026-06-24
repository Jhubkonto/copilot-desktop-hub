# Debrief Feature — Implementation Roadmap

## Context

Users currently have no structured way to capture learnings from an AI chat session. The Debrief feature lets a user mark a conversation as "complete," triggering an AI-generated summary of what was accomplished, commands used, a reproduction guide, and the mental/troubleshooting approach taken. The resulting debrief can be stored as a Prompt, saved to the Project Wiki, exported as Markdown, or used as the basis for a self-quiz. This bridges ephemeral conversations into persistent, reviewable knowledge.

---

## Architecture Anchors (existing patterns to reuse)

- **Modal system**: `ModalShell` in [src/renderer/components/ui/primitives.tsx](../../src/renderer/components/ui/primitives.tsx) — all modals use this.
- **Reference modal**: [WikiExtractionModal.tsx](../../src/renderer/components/WikiExtractionModal.tsx) — multi-step, AI-driven. Closest analog to Debrief.
- **IPC pattern**: `safeHandle` in every handler → registered in `ipc-handlers.ts` → typed in `src/shared/types.ts` → preload bridge in `src/preload/index.ts`. Never use `ipcMain.handle` directly.
- **AI extraction pattern**: `wiki:extract-learnings` in `wiki-handlers.ts` — transcript fetching, head/tail truncation, `sendProviderNonStreaming`, JSON parse + validation. Replicate exactly.
- **Storage APIs already wired**:
  - Wiki: `window.api.createWikiEntry(...)` → channel `wiki:create-entry`
  - Prompt: `window.api.createPrompt(input)` → channel `prompt:create`
  - File export: `window.api.saveTextFile(name, content)` → channel `app:save-text-file`
- **Current DB migration version**: 40. New migrations start at v41.
- **Conversation types**: `Conversation` (camelCase, renderer) and `ConversationRow` (snake_case, DB row) are separate types — both need `completedAt` / `completed_at` added.

---

## Phase 1 — Foundation: DB, Types, IPC Plumbing

**Goal:** All structural prerequisites in place. No UI. Feature is "dark" but everything compiles and tests pass.

### Checklist

- [x] **DB migration v41** — Append to `MIGRATIONS` in [src/main/database-migrations.ts](../../src/main/database-migrations.ts):
  ```sql
  CREATE TABLE IF NOT EXISTS conversation_debriefs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    summary TEXT NOT NULL DEFAULT '',
    commands_tools TEXT NOT NULL DEFAULT '[]',
    reproduction_guide TEXT NOT NULL DEFAULT '',
    mental_model TEXT NOT NULL DEFAULT '',
    generated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_debriefs_conversation ON conversation_debriefs(conversation_id);
  ```

- [x] **DB migration v42** — Append immediately after v41:
  ```sql
  ALTER TABLE conversations ADD COLUMN completed_at INTEGER;
  ```

- [x] **Shared types** — Add to [src/shared/types.ts](../../src/shared/types.ts):
  ```typescript
  export interface DebriefSection {
    summary: string
    commandsAndTools: string[]
    reproductionGuide: string
    mentalModel: string
  }

  export interface Debrief {
    id: string
    conversationId: string
    projectId: string | null
    summary: string
    commandsTools: string[]
    reproductionGuide: string
    mentalModel: string
    generatedAt: number
    createdAt: number
  }
  ```
  - Extend `Conversation` with `completedAt: number | null`
  - Extend `ConversationRow` with `completed_at: number | null`
  - Add to `IpcChannels` union: `'conversation:generate-debrief'`, `'conversation:get-debrief'`, `'conversation:mark-complete'`
  - Add to `IpcReturnMap`:
    ```typescript
    'conversation:generate-debrief': Debrief
    'conversation:get-debrief': Debrief | null
    'conversation:mark-complete': boolean
    ```

- [x] **Preload bridge** — Add to [src/preload/index.ts](../../src/preload/index.ts):
  ```typescript
  generateDebrief: (conversationId: string, projectId: string | null, model?: string) =>
    typedInvoke('conversation:generate-debrief', conversationId, projectId, model),
  getDebrief: (conversationId: string) =>
    typedInvoke('conversation:get-debrief', conversationId),
  markConversationComplete: (conversationId: string) =>
    typedInvoke('conversation:mark-complete', conversationId),
  ```

- [x] **Handler module** — Create [src/main/debrief-handlers.ts](../../src/main/debrief-handlers.ts) with `registerDebriefHandlers()`. Register all three channels via `safeHandle`; stubs return `null` / throw `'Not implemented'` for now.

- [x] **Register** — Import and call `registerDebriefHandlers()` in [src/main/ipc-handlers.ts](../../src/main/ipc-handlers.ts).

- [x] **Test mock stubs** — Add `generateDebrief`, `getDebrief`, `markConversationComplete` as `vi.fn().mockResolvedValue(...)` to [src/test/mocks/api.ts](../../src/test/mocks/api.ts).

- [x] **DB migration test** — Create [src/main/__tests__/debrief-handlers.test.ts](../../src/main/__tests__/debrief-handlers.test.ts) confirming `initializeBaseSchema` + `runMigrations` creates `conversation_debriefs` and `conversations.completed_at`. Use the CLAUDE.md mock boilerplate.

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Phase 2 — AI Generation: Main Process Handler

**Goal:** Real LLM call generating structured debrief JSON, persisted to DB.

### Checklist

- [x] **Implement `conversation:generate-debrief`** in [src/main/debrief-handlers.ts](../../src/main/debrief-handlers.ts):
  - Fetch messages: `SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY timestamp ASC`
  - Truncate transcript: `HEAD = 4000`, `HARD_LIMIT = 40_000` — same pattern as `wiki-handlers.ts`
  - Resolve provider: same model resolution as `wiki:extract-learnings` (BYOK key → `getProviderForAgent`; fallback to `ClaudeAdapter`)
  - System prompt:
    ```
    You are a session debrief assistant. Analyze this AI chat conversation and return
    ONLY a JSON object (no markdown, no preamble) with this exact schema:
    {
      "summary": "2-4 sentence summary of what was accomplished",
      "commandsAndTools": ["tool or command 1", ...],
      "reproductionGuide": "Step-by-step guide: 1. ... 2. ...",
      "mentalModel": "The reasoning approach / troubleshooting strategy used"
    }
    commandsAndTools: CLI commands, MCP tools, APIs, or techniques used.
    reproductionGuide: numbered steps a reader can follow to reproduce from scratch.
    mentalModel: the diagnostic or design thinking, not just the steps.
    ```
  - Strip markdown fences, `JSON.parse`, validate shape
  - `INSERT OR REPLACE INTO conversation_debriefs` with `crypto.randomUUID()` id
  - Return typed `Debrief`

- [x] **Implement `conversation:get-debrief`** — `SELECT * FROM conversation_debriefs WHERE conversation_id = ?`, parse `commands_tools` JSON, return `Debrief | null`.

- [x] **Implement `conversation:mark-complete`** — `UPDATE conversations SET completed_at = ? WHERE id = ?` using `Date.now()`, return `true`.

- [x] **Unit tests** — Extend [src/main/__tests__/debrief-handlers.test.ts](../../src/main/__tests__/debrief-handlers.test.ts):
  - `generate-debrief` with mocked `sendProviderNonStreaming` returns correctly shaped `Debrief`
  - Malformed LLM JSON returns graceful error (no unhandled throw)
  - `get-debrief` returns `null` for unknown conversation
  - `mark-complete` sets `completed_at` on the conversations row

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Phase 3 — Debrief Modal UI

**Goal:** Three-step modal: generating → review/edit → storage options.

### Checklist

- [x] **Create [src/renderer/components/DebriefModal.tsx](../../src/renderer/components/DebriefModal.tsx)**:
  - Props:
    ```typescript
    interface DebriefModalProps {
      conversationId: string
      conversationTitle: string
      projectId: string | null
      model: string
      onClose: () => void
    }
    ```
  - State: `step: 'generating' | 'review' | 'storage'`, `debrief: Debrief | null`, `error: string | null`, `edited: DebriefSection`

  - **Step 1 — Generating**: `Loader2` spinner with `role="status"` and `aria-live="polite"`. On mount call `window.api.generateDebrief(...)`. Success → `step = 'review'`. Error → error message + Retry + Close.

  - **Step 2 — Review**: Four labelled edit sections styled to match `WikiExtractionModal` (`text-[10px] font-semibold uppercase tracking-wider`):
    - Summary: `<textarea rows={4}`
    - Commands & Tools: tag-chip UI (comma-separated input → chips)
    - How to Reproduce: `<textarea rows={6}`
    - Mental Model: `<textarea rows={4}`
    - Footer: Back / Continue to Storage

  - **Step 3 — Storage**: Three independent action buttons, each with own loading state + toast on success. `Close` always visible. No action auto-closes the modal — user can use all three.

  - Escape key closes modal (same `useEffect` keydown pattern as other modals).

- [x] **Export markdown format**:
  ```markdown
  # Debrief: {conversationTitle}
  Generated: {date}

  ## Summary
  {summary}

  ## Commands & Tools Used
  - {tool1}

  ## How to Reproduce
  {reproductionGuide}

  ## Mental Model / Approach
  {mentalModel}
  ```

- [x] **Renderer test** — Create [src/renderer/__tests__/DebriefModal.test.tsx](../../src/renderer/__tests__/DebriefModal.test.tsx):
  - Spinner renders on mount
  - After `generateDebrief` resolves, review step renders four sections
  - Each section is editable
  - "Export Markdown" triggers `window.api.saveTextFile` with correct content

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Phase 4 — Completion Marking: Tick UI in ChatWindow & ChatsPane

**Goal:** Visual "mark complete" affordance and Zustand wiring. No AI calls.

### Checklist

- [x] **conversationSlice** — Extend [src/renderer/store/slices/conversationSlice.ts](../../src/renderer/store/slices/conversationSlice.ts):
  - Add `completedConversationIds: string[]` initialized `[]`
  - Populate from `loadConversations` (rows with non-null `completed_at`)
  - Add `markConversationComplete: (id: string) => Promise<void>` — calls `window.api.markConversationComplete(id)`, adds id to state

- [x] **uiSlice** — Extend [src/renderer/store/slices/uiSlice.ts](../../src/renderer/store/slices/uiSlice.ts):
  - Add `pendingDebriefConversationId: string | null` and `setPendingDebriefConversationId`
  - `markConversationComplete` sets this after IPC succeeds, which mounts the modal

- [x] **ChatWindow — "Mark Complete" button** in [src/renderer/components/ChatWindow.tsx](../../src/renderer/components/ChatWindow.tsx):
  - Add `CheckCircle` icon button to toolbar/actions area
  - Shown only when `conversationId` is set and not yet in `completedConversationIds`
  - When already complete: dimmed "Completed ✓" label with date
  - On click: `markConversationComplete(conversationId)` → sets `pendingDebriefConversationId`

- [x] **DebriefModal mount in ChatWindow** — Below the `WikiExtractionModal` block (~line 1312):
  ```tsx
  {pendingDebriefConversationId === conversationId && (
    <DebriefModal
      conversationId={conversationId}
      conversationTitle={currentConversation?.title ?? 'Untitled'}
      projectId={chatProjectId && chatProjectId !== '__none__' ? chatProjectId : null}
      model={effectiveModel}
      onClose={() => setPendingDebriefConversationId(null)}
    />
  )}
  ```

- [x] **ChatsPane — completion tick** in [src/renderer/components/section-pane/ChatsPane.tsx](../../src/renderer/components/section-pane/ChatsPane.tsx):
  - Read `completedConversationIds` from store
  - Render a small green `CheckCircle` icon (`w-3 h-3`) next to the title when complete. Follow pin icon pattern.
  - Add `aria-label="Completed"` on the icon span.

- [x] **Test** — Verify completion tick renders when `completedConversationIds` includes the conversation id.

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Phase 5 — Storage Actions: Save to Wiki, Save as Prompt, Export MD

**Goal:** Wire each Step 3 button to its backend. All IPC channels already exist.

### Checklist

- [x] **Save as Prompt** — calls `window.api.createPrompt(input)`:
  ```typescript
  {
    title: `Debrief: ${conversationTitle}`,
    body: formattedBodyText,  // all four sections as plain text
    description: 'AI-generated session debrief',
    category: 'Debrief',
    tags: ['debrief', 'session'],
    scope: projectId ? 'project' : 'global',
    project_id: projectId ?? null,
  }
  ```
  Note: the preload method is `createPrompt` (not `createPromptLibraryEntry`).

- [x] **Save to Wiki** — calls `window.api.createWikiEntry(projectId, title, body, tags, { conversationId })`:
  - Title: `Debrief: ${conversationTitle}`; tags: `['debrief']`
  - Button disabled (greyed out with tooltip) when `projectId` is null

- [x] **Export Markdown** — calls `window.api.saveTextFile('debrief.md', markdownContent)`:
  - Use the format defined in Phase 3
  - Toast on success (non-null path); silent cancel on null

- [x] **Independent action states** — Each button has its own `loading` boolean. None auto-closes the modal. All three can be used in sequence.

- [x] **Update renderer test** — Assert `createPrompt`, `createWikiEntry`, and `saveTextFile` called with correct arguments on button click.

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Phase 6 — Polish & Integration

**Goal:** Keyboard shortcut, re-debrief flow, edge cases, accessibility, visual consistency.

### Checklist

- [x] **Keyboard shortcut** — Register `Ctrl+Shift+D` / `Cmd+Shift+D` in `ChatWindow.tsx` via `useEffect` keydown handler. Only active when `conversationId` is set and no other modal is open.

- [x] **Re-debrief flow** — If conversation is already complete, clicking "Debrief session" calls `window.api.getDebrief(conversationId)` first. If a debrief exists, mount `DebriefModal` at `step = 'review'` pre-populated via `initialDebrief` prop. Otherwise, generate fresh.

- [x] **Empty conversation guard** — In `conversation:generate-debrief` handler: if message count is 0, throws `'Conversation has no messages to debrief'` without calling the LLM. `DebriefModal` shows inline error with Close.

- [x] **ChatsPane context menu** — Added "Mark complete" `CheckCircle` button and "Quiz me" `BrainCircuit` button to the hover action group on each conversation row (alongside the delete button).

- [x] **Accessibility**:
  - All `DebriefModal` buttons have `aria-label` or visible text
  - Step 1 spinner: `role="status"` + `aria-live="polite"`
  - Focus trap and focus-return inherited from `ModalShell`

- [x] **Error boundary** — Generation `catch` renders inline error with "Retry" + "Close"; does not crash the modal.

- [x] **Visual consistency** — Section labels: `text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500`. Textareas: `rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm`. Match `WikiExtractionModal` exactly.

- [x] **Mock API completeness** — [src/test/mocks/api.ts](../../src/test/mocks/api.ts) has typed return values for all six new API methods (generateDebrief, getDebrief, markConversationComplete, generateQuiz, saveQuizAttempt, listQuizAttempts).

- [x] **End-to-end renderer test** — DebriefModal tests cover: spinner on mount, review step renders after resolve, sections editable, Export Markdown triggers saveTextFile, error state shows Retry.

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Phase 7 — Quiz: Test Your Knowledge

**Goal:** Let users generate multiple-choice questions from a completed debrief and quiz themselves on the learnings. Score history is persisted.

### Overview

The Quiz feature takes the persisted `Debrief` object (Phase 1–2) and sends it to the LLM to generate 5–8 multiple-choice questions covering four categories: `command`, `concept`, `sequence`, `approach`. Questions are presented one at a time with immediate feedback (correct/incorrect + explanation). Scores are saved per attempt. Users can re-quiz with freshly generated questions at any time.

### Checklist

#### Types
- [x] **Add to [src/shared/types.ts](../../src/shared/types.ts)**:
  ```typescript
  export interface QuizQuestion {
    id: string
    question: string
    options: [string, string, string, string]  // always exactly 4
    correctIndex: 0 | 1 | 2 | 3
    explanation: string
    category: 'command' | 'concept' | 'sequence' | 'approach'
  }

  export interface QuizResult {
    questionId: string
    selectedIndex: number
    correct: boolean
  }

  export interface QuizAttempt {
    id: string
    conversation_id: string
    score: number
    total: number
    attempted_at: number
  }

  export interface QuizGenerationResult {
    questions: QuizQuestion[]
  }
  ```
- [x] Add to `IpcChannels` union: `'conversation:generate-quiz'`, `'conversation:save-quiz-attempt'`, `'conversation:list-quiz-attempts'`
- [x] Add to `IpcReturnMap`:
  ```typescript
  'conversation:generate-quiz': QuizGenerationResult
  'conversation:save-quiz-attempt': QuizAttempt
  'conversation:list-quiz-attempts': QuizAttempt[]
  ```

#### DB Migration
- [x] **Migration v43** in [src/main/database-migrations.ts](../../src/main/database-migrations.ts):
  ```sql
  CREATE TABLE IF NOT EXISTS conversation_quiz_attempts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    attempted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quiz_attempts_conversation
    ON conversation_quiz_attempts(conversation_id, attempted_at DESC);
  ```

#### Main Process Handler
- [x] **Create [src/main/quiz-handlers.ts](../../src/main/quiz-handlers.ts)** with `registerQuizHandlers()`:

  **`conversation:generate-quiz`**:
  - Look up `conversation_debriefs` by `conversation_id`; throw `'No debrief found — generate a debrief first.'` if missing
  - Build structured user prompt from all four debrief fields; truncate if > 8,000 chars
  - System prompt:
    ```
    You are a quiz generator for a technical learning tool. You receive a structured debrief
    of a completed AI chat session and must produce multiple-choice questions that test the
    user's understanding.

    Return ONLY a JSON array with 5-8 objects. Each object MUST have:
    - "question": string — clear and specific
    - "options": exactly 4 strings — all plausible (no obviously wrong answers)
    - "correctIndex": integer 0-3 (zero-based index into options)
    - "explanation": 2-4 sentences teaching WHY the answer is correct
    - "category": one of "command", "concept", "sequence", "approach"

    Cover all four categories. Make distractors plausible — use related-but-wrong commands,
    partial truths, or common misconceptions.
    ```
  - `sendProviderNonStreaming` with `temperature: 0.7, maxTokens: 3000`
  - Strip fences, `JSON.parse`, validate shape; silently drop malformed questions; if < 2 valid questions, return empty array
  - Assign `crypto.randomUUID()` to each question's `id` (ephemeral — not stored)
  - Return `{ questions }`

  **`conversation:save-quiz-attempt`**: insert row into `conversation_quiz_attempts`, return `QuizAttempt`.

  **`conversation:list-quiz-attempts`**: return rows ordered by `attempted_at DESC`.

- [x] **Register** — Import and call `registerQuizHandlers()` in [src/main/ipc-handlers.ts](../../src/main/ipc-handlers.ts).

#### Preload Bridge
- [x] Add to [src/preload/index.ts](../../src/preload/index.ts):
  ```typescript
  generateQuiz: (conversationId: string, model?: string) =>
    typedInvoke('conversation:generate-quiz', conversationId, model),
  saveQuizAttempt: (conversationId: string, score: number, total: number) =>
    typedInvoke('conversation:save-quiz-attempt', conversationId, score, total),
  listQuizAttempts: (conversationId: string) =>
    typedInvoke('conversation:list-quiz-attempts', conversationId),
  ```

#### QuizModal Component
- [x] **Create [src/renderer/components/QuizModal.tsx](../../src/renderer/components/QuizModal.tsx)**:
  - Props: `{ conversationId: string; onClose: () => void }`
  - State: `step: 'generating' | 'question' | 'feedback' | 'summary'`, `questions: QuizQuestion[]`, `currentIndex: number`, `selectedIndex: number | null`, `results: QuizResult[]`, `error: string | null`

  - **Step 1 — Generating**: Spinner with `role="status"` + `aria-live="polite"`. On mount, call `window.api.generateQuiz(conversationId)`. On success → `step = 'question'`. On error → inline error + Retry + Close.

  - **Step 2 — Question**: Progress bar `{n} / {total}`. Category badge (color-coded: `command`=blue, `concept`=purple, `sequence`=amber, `approach`=green). Question text. Four option tiles labeled A/B/C/D, selectable on click. Submit button opacity animates 0.4 → 1.0 on selection.

  - **Step 3 — Feedback**: Re-render options with colors: green border/bg for `correctIndex`, red for wrong selection. Explanation card with blue tint. Correct/Incorrect banner. Footer: "Next Question" / "See Results". Focus auto-moves to Next button.

  - **Step 4 — Summary**:
    - Score: `{score}/{total}` in large text with motivational label (Perfect / Excellent / Good work / Keep practicing)
    - Category breakdown: 2-column grid of color-coded category cards
    - Past attempts: chip row if > 1 attempt returned
    - Footer: "Try Again" + "Done"

  - Escape key closes modal at any step.
  - `BrainCircuit` icon (from `lucide-react`) in modal header.

#### Trigger Points (three entry points)
- [x] **DebriefModal Step 3** — "Quiz Me" `BrainCircuit` button in indigo tint alongside the three storage actions in [src/renderer/components/DebriefModal.tsx](../../src/renderer/components/DebriefModal.tsx). Mounts `QuizModal` overlaid on top when clicked.

- [x] **ChatWindow toolbar** — "Quiz me on this" item in the actions dropdown in [src/renderer/components/ChatWindow.tsx](../../src/renderer/components/ChatWindow.tsx). Shown when `conversationId` is set and messages exist. `showQuizModal` state; `QuizModal` mounted below `DebriefModal` block.

- [x] **ChatsPane hover group** — `BrainCircuit` icon button in [src/renderer/components/section-pane/ChatsPane.tsx](../../src/renderer/components/section-pane/ChatsPane.tsx) hover group on each conversation row. `quizConvId` state; `QuizModal` mounted below `DeleteConversationDialog`.

#### Tests
- [x] **Main process tests** — [src/main/__tests__/quiz-handlers.test.ts](../../src/main/__tests__/quiz-handlers.test.ts):
  - `generate-quiz` with mocked `sendProviderNonStreaming` returns array of valid `QuizQuestion[]`
  - Malformed JSON returns empty questions array gracefully
  - Fewer than 2 valid questions returns empty array
  - Mixed valid/invalid drops malformed questions silently
  - Strips markdown code fences before parsing
  - Missing debrief throws descriptive "No debrief found" error
  - `save-quiz-attempt` writes correct row and returns it
  - `list-quiz-attempts` returns rows ordered newest-first

- [x] **Renderer tests** — [src/renderer/__tests__/QuizModal.test.tsx](../../src/renderer/__tests__/QuizModal.test.tsx):
  - Spinner renders on mount
  - Error state when generateQuiz fails
  - Error when quiz returns no questions
  - First question renders after generateQuiz resolves
  - Submit disabled until option selected
  - Correct/incorrect feedback shown with explanation
  - "Next Question" advances to second question
  - Summary renders with Try Again / Done after last question
  - "Try Again" resets and calls generateQuiz again
  - "Done" calls onClose
  - `saveQuizAttempt` called with correct score/total args

### Phase Gate
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Future Ideas (Out of Scope — Noted for Later)

- **Spaced repetition reminders** — After completing a quiz, offer "Schedule a review in 3 days" using the existing `ScheduledTask` system to re-launch the quiz.
- **Weak-area targeting** — On the 2nd+ attempt, send previous category scores to the LLM and bias question generation toward missed categories.
- **Personal best tracking** — Track highest score per conversation; show "New personal best!" on the summary screen.
- **Export quiz as study sheet** — "Save as Markdown" on the summary: writes all questions, options, correct answers, and explanations to a `.md` file via `saveTextFile`.
- **Streak tracking** — Compute a daily quiz streak across all conversations; display in the quiz summary.
- **Difficulty progression** — Add a difficulty level selector (Beginner / Intermediate / Advanced) that adjusts the LLM prompt to generate easier or harder distractors.

---

## Complete File Index

### New files

| File | Phase | Purpose |
|---|---|---|
| [src/main/debrief-handlers.ts](../../src/main/debrief-handlers.ts) | 1–2 | IPC handlers: generate-debrief, get-debrief, mark-complete |
| [src/renderer/components/DebriefModal.tsx](../../src/renderer/components/DebriefModal.tsx) | 3 | Three-step debrief modal |
| [src/main/quiz-handlers.ts](../../src/main/quiz-handlers.ts) | 7 | IPC handlers: generate-quiz, save/list quiz attempts |
| [src/renderer/components/QuizModal.tsx](../../src/renderer/components/QuizModal.tsx) | 7 | Four-step quiz modal |
| [src/main/__tests__/debrief-handlers.test.ts](../../src/main/__tests__/debrief-handlers.test.ts) | 1 | Main process tests |
| [src/renderer/__tests__/DebriefModal.test.tsx](../../src/renderer/__tests__/DebriefModal.test.tsx) | 3 | Renderer modal tests |

### Modified files

| File | Phase | Change |
|---|---|---|
| [src/main/database-migrations.ts](../../src/main/database-migrations.ts) | 1, 7 | Migrations v41 (`conversation_debriefs`), v42 (`completed_at`), v43 (`quiz_attempts`) |
| [src/shared/types.ts](../../src/shared/types.ts) | 1, 7 | `DebriefSection`, `Debrief`, `QuizQuestion`, `QuizResult`, `QuizAttempt`, `QuizGenerationResult`; extend `Conversation`/`ConversationRow`; 6 new IPC channels |
| [src/preload/index.ts](../../src/preload/index.ts) | 1, 7 | `generateDebrief`, `getDebrief`, `markConversationComplete`, `generateQuiz`, `saveQuizAttempt`, `listQuizAttempts` |
| [src/main/ipc-handlers.ts](../../src/main/ipc-handlers.ts) | 1, 7 | Call `registerDebriefHandlers()` and `registerQuizHandlers()` |
| [src/test/mocks/api.ts](../../src/test/mocks/api.ts) | 1, 7 | Stub `vi.fn()` entries for all 6 new API methods |
| [src/renderer/store/slices/conversationSlice.ts](../../src/renderer/store/slices/conversationSlice.ts) | 4 | `completedConversationIds`, `markConversationComplete` |
| [src/renderer/store/slices/uiSlice.ts](../../src/renderer/store/slices/uiSlice.ts) | 4 | `pendingDebriefConversationId` + setter |
| [src/renderer/components/ChatWindow.tsx](../../src/renderer/components/ChatWindow.tsx) | 4, 7 | "Mark complete" button; mount `DebriefModal`; "Quiz me on this" in actions dropdown; mount `QuizModal` |
| [src/renderer/components/section-pane/ChatsPane.tsx](../../src/renderer/components/section-pane/ChatsPane.tsx) | 4, 7 | Completion tick icon; quiz icon in hover group; mount `QuizModal` |
| [src/renderer/components/DebriefModal.tsx](../../src/renderer/components/DebriefModal.tsx) | 7 | "Quiz Me" button in Step 3; mount `QuizModal` |

---

## Phase 8 — Android Support

**Goal:** Full parity with the desktop Debrief & Quiz experience on the Android companion app. All six debrief/quiz operations are available over WebSocket; conversation lists show animated completion badges; a `DebriefScreen` and `QuizScreen` are reachable from every conversation history view.

---

### Phase 8.1 — Desktop: Expose Debrief/Quiz over WebSocket

**Goal:** Allow Android to trigger all six debrief/quiz operations over WebSocket. Shared helpers keep IPC and WS code DRY.

#### Checklist

- [x] **Extract shared helpers in `src/main/debrief-handlers.ts`**
  - [x] `generateDebriefForWs(conversationId, projectId?, model?)` — full LLM generation + DB insert + `broadcastToMobile({ event: 'debrief:ready', data: { debrief } })`
  - [x] `getDebriefForWs(conversationId)` — DB SELECT returning `Debrief | null`
  - [x] `markCompleteForWs(conversationId)` — UPDATE + `broadcastToMobile({ event: 'debrief:conversation-completed', ... })`
  - [x] IPC handler delegates to these helpers

- [x] **Extract shared helpers in `src/main/quiz-handlers.ts`**
  - [x] `generateQuizForWs(conversationId, model?)`
  - [x] `saveQuizAttemptForWs(conversationId, score, total)`
  - [x] `listQuizAttemptsForWs(conversationId)`

- [x] **Add 6 WS command branches in `src/main/ws-handlers.ts`**
  - [x] `conversation:generate-debrief` → `generateDebriefForWs()` → reply `debrief:ready { debrief }` / `debrief:error { message }`
  - [x] `conversation:get-debrief` → `getDebriefForWs()` → reply `debrief:loaded { debrief }`
  - [x] `conversation:mark-complete` → `markCompleteForWs()` → reply `debrief:conversation-completed { conversationId, completedAt }`
  - [x] `conversation:generate-quiz` → `generateQuizForWs()` → reply `quiz:ready { questions }` / `quiz:error { message }`
  - [x] `conversation:save-quiz-attempt` → `saveQuizAttemptForWs()` → reply `quiz:attempt-saved { attempt }`
  - [x] `conversation:list-quiz-attempts` → `listQuizAttemptsForWs()` → reply `quiz:attempts-listed { conversationId, attempts }`

- [x] **`broadcastToMobile` side-effects on IPC handlers** — desktop mark-complete and generate-debrief also push to Android

#### Phase Gate
```bash
npm run lint && npm run typecheck && npm run build
```

---

### Phase 8.2 — Android: Data Models & WsEvent Types

**Goal:** All Kotlin data classes and new `WsEvent` subtypes needed by the UI phases. Pure data layer.

#### Checklist

- [x] **Create `android/.../data/model/ConversationDebrief.kt`**
  ```kotlin
  data class ConversationDebrief(
      val id: String, val conversationId: String, val projectId: String?,
      val summary: String, val commandsTools: List<String>,
      val reproductionGuide: String, val mentalModel: String,
      val generatedAt: Long, val createdAt: Long,
  )
  ```
- [x] **Create `android/.../data/model/QuizModels.kt`**
  ```kotlin
  data class QuizQuestion(val id: String, val question: String, val options: List<String>, val correctIndex: Int, val explanation: String, val category: String)
  data class QuizAttempt(val id: String, val conversationId: String, val score: Int, val total: Int, val attemptedAt: Long)
  ```
- [x] **Add `val completed_at: Long? = null` to `Conversation.kt`**
- [x] **Add 8 new WsEvent subclasses to `WsEvent.kt`**:
  `DebriefReady`, `DebriefLoaded`, `DebriefError`, `DebriefConversationCompleted`,
  `QuizReady`, `QuizError`, `QuizAttemptSaved`, `QuizAttemptsListed`
- [x] **Extend `WsEventParser.kt`**:
  - [x] Parse 8 new event types
  - [x] Private helpers `parseConversationDebrief`, `parseQuizQuestion`, `parseQuizAttempt`
  - [x] Parse `completed_at` in `parseConversationArray`
  - [x] Updated signature passes `currentDebrief` and `completedConversationIds` StateFlows
- [x] **Extend `WsRepository.kt`**:
  - [x] `val currentDebrief: StateFlow<ConversationDebrief?>` + backing flow
  - [x] `val completedConversationIds: StateFlow<Set<String>>` — populated from `ConversationList` rows + updated on `DebriefConversationCompleted`
  - [x] Send functions: `generateDebrief`, `getDebrief`, `markConversationComplete`, `generateQuiz`, `saveQuizAttempt`, `listQuizAttempts`

#### Phase Gate
```bash
./gradlew assembleDebug
```

---

### Phase 8.3 — Android: Completion Badges

**Goal:** Conversations marked complete show a small animated green checkmark in all conversation list views without requiring a screen refresh.

#### Checklist

- [x] **`HomeScreenComponents.kt`** — `ConversationRow` gains `isCompleted: Boolean = false` parameter
  - [x] `AnimatedVisibility(visible = isCompleted, enter = fadeIn(tween(300)) + scaleIn(tween(300), initialScale = 0.6f))` wrapping `Icon(Icons.Default.CheckCircle, tint = Color(0xFF34D399), size = 13.dp)`
  - [x] Badge appears to the left of the title text, after any active-spinner
- [x] **`ScopedChatHistoryScreen.kt`** — `completedConversationIds by WsRepository.completedConversationIds.collectAsState()`; pass `isCompleted = conversation.id in completedConversationIds` to `ConversationRow`
- [x] **`HomeScreenTabs.kt`** — Pass `isCompleted = conv.completed_at != null` to `ConversationRow`
- [x] **Live update** — `debrief:conversation-completed` broadcast updates `completedConversationIds` → badge animates in within ~500ms of desktop action

---

### Phase 8.4 — Android: DebriefScreen

**Goal:** Full-page Compose screen for reading an AI-generated debrief, with animated state transitions and a "Quiz Me" shortcut.

#### Checklist

- [x] **Create `android/.../ui/debrief/DebriefViewModel.kt`**
  - [x] `sealed class DebriefUiState`: `Loading`, `Loaded(debrief)`, `Error(message)`
  - [x] `fun load(conversationId)` — calls `WsRepository.getDebrief()`; on `DebriefLoaded(null)` auto-triggers `generateDebrief()`
  - [x] `fun retry(conversationId)` — resets to `Loading`, calls `generateDebrief()`
  - [x] Collects `WsRepository.events` for `DebriefReady`, `DebriefLoaded`, `DebriefError`

- [x] **Create `android/.../ui/debrief/DebriefScreen.kt`**
  - [x] `AnimatedContent(targetState = uiState, transitionSpec = fadeIn + slideInVertically togetherWith fadeOut)` as root container
  - [x] **Loading state**: `CircularProgressIndicator`; "Generating debrief…" text fades in after 800ms delay via `AnimatedVisibility`
  - [x] **Loaded state**: `LazyColumn` with 4 `ElevatedCard` sections (Summary, Commands & Tools, How to Reproduce, Mental Model)
    - [x] Commands & Tools: `FlowRow` of `AssistChip`s with secondary-container tint
    - [x] Reproduction guide: `Surface(tonalElevation=1.dp)` block
    - [x] Mental model: italic body text
  - [x] **Error state**: centered error icon + message + `FilledTonalButton("Try Again")`
  - [x] Top app bar: "Debrief" title, back nav, `Psychology` icon "Quiz Me" button (only visible in Loaded state)

- [x] **Navigation routes in `NavGraph.kt`**
  - [x] `debrief/{conversationId}` route with slide-up enter/exit transitions
  - [x] `quiz/{conversationId}` route (placeholder used by DebriefScreen's "Quiz Me" button and Phase 8.5)

- [x] **Entry point in `ScopedChatHistoryScreen.kt` + `HomeScreenComponents.kt`**
  - [x] "Debrief" dropdown menu item (Article icon) in `ConversationRow` — always visible
  - [x] "Mark complete" dropdown menu item (CheckCircle icon) — only visible when `!isCompleted`
  - [x] "Quiz me" dropdown menu item (Psychology icon) — only visible when `isCompleted`
  - [x] `onDebrief`, `onMarkComplete`, `onQuiz` callbacks wired through `ScopedChatHistoryScreen` → `NavGraph`

---

### Phase 8.5 — Android: QuizScreen

**Goal:** Animated 5-state interactive quiz with option-selection animations, feedback reveals, and a score-counting summary.

#### Checklist

- [x] **Create `android/.../ui/quiz/QuizViewModel.kt`**
  - [x] `sealed class QuizUiState`: `Generating`, `Question(question, index, total, selected?)`, `Feedback(question, index, total, selected, isCorrect)`, `Summary(score, total, categoryBreakdown, pastAttempts)`, `Error(message)`
  - [x] `fun startQuiz(conversationId)` → `WsRepository.generateQuiz()`; collects `QuizReady` → `Question(index=0)`; `QuizError` → `Error`
  - [x] `fun selectOption(index)` — updates `selected` in `Question` state
  - [x] `fun submitAnswer()` — transitions `Question` → `Feedback`
  - [x] `fun nextQuestion()` — advances to next question or builds `Summary` + calls `saveQuizAttempt` + `listQuizAttempts`
  - [x] `fun tryAgain(conversationId)` — delegates to `startQuiz()`
  - [x] `QuizAttemptsListed` event updates `pastAttempts` in `Summary` state

- [x] **Create `android/.../ui/quiz/QuizScreen.kt`**
  - [x] `AnimatedContent` root with:
    - Generating/Question/Feedback: `slideInHorizontally + fadeIn` / `slideOutHorizontally + fadeOut`
    - Summary: `slideInVertically + fadeIn` / `fadeOut`
  - [x] **Generating state**: `CircularProgressIndicator` + delayed "Generating quiz questions…" label
  - [x] **Question state**:
    - [x] `LinearProgressIndicator` with `animateFloatAsState` for smooth progress
    - [x] Category badge `SuggestionChip` (blue/purple/amber/green by category)
    - [x] Question text in `titleMedium`
    - [x] 4 option tiles — letter circle (A/B/C/D) + option text
    - [x] `animateColorAsState(200ms)` on border/background when selected
    - [x] Submit `FilledTonalButton` with `animateFloatAsState` alpha (0.4 → 1.0 on selection)
  - [x] **Feedback state**:
    - [x] Correct/Incorrect banner slides in from top with `slideInVertically { -it }`
    - [x] Options re-render with `animateColorAsState` — green border for correct, red for wrong-selected
    - [x] Explanation `ElevatedCard` expands with `expandVertically + fadeIn` after 150ms delay
    - [x] "Next Question" / "See Results" button
  - [x] **Summary state**:
    - [x] Score `animateIntAsState(tween(800ms))` counts from 0 to actual score
    - [x] Motivational label (Perfect / Great / Good / Keep practicing)
    - [x] Category breakdown: 2-column grid of `ElevatedCard`s staggered in with 100ms delays
    - [x] Past attempts: `LazyRow` of `SuggestionChip`s (last 3)
    - [x] `OutlinedButton("Try Again")` + `FilledTonalButton("Done")` side by side
  - [x] **Error state**: centered icon + message + retry button

---

### Phase 8.6 — Roadmap Update *(this phase)*

- [x] Append complete Phase 8 section to `roadmap/roadmap-new/DEBRIEF_ROADMAP.md`
- [x] Update Complete File Index with all new Android files

---

### Phase Gate (Full Android Build)
```bash
cd android
./gradlew assembleDebug
```

Manual smoke test:
1. Desktop marks conversation complete → Android companion shows green completion badge animated in within ~500ms
2. Android long-press conversation → tap "Debrief" → `DebriefScreen` shows spinner → content slides up into view
3. Android tap "Quiz Me" in debrief top bar → `QuizScreen` slides in → answer questions → option tiles animate selection → feedback expands → summary counts score up
4. Android long-press completed conversation → tap "Quiz me" → jumps directly to `QuizScreen`

---

### New Android Files (Phase 8)

| File | Phase | Purpose |
|---|---|---|
| [android/.../data/model/ConversationDebrief.kt](../../android/app/src/main/java/io/nexy/android/data/model/ConversationDebrief.kt) | 8.2 | Debrief data class |
| [android/.../data/model/QuizModels.kt](../../android/app/src/main/java/io/nexy/android/data/model/QuizModels.kt) | 8.2 | QuizQuestion + QuizAttempt data classes |
| [android/.../ui/debrief/DebriefViewModel.kt](../../android/app/src/main/java/io/nexy/android/ui/debrief/DebriefViewModel.kt) | 8.4 | 3-state (Loading/Loaded/Error) state machine |
| [android/.../ui/debrief/DebriefScreen.kt](../../android/app/src/main/java/io/nexy/android/ui/debrief/DebriefScreen.kt) | 8.4 | Animated debrief viewer with ElevatedCard sections |
| [android/.../ui/quiz/QuizViewModel.kt](../../android/app/src/main/java/io/nexy/android/ui/quiz/QuizViewModel.kt) | 8.5 | 5-state (Generating/Question/Feedback/Summary/Error) state machine |
| [android/.../ui/quiz/QuizScreen.kt](../../android/app/src/main/java/io/nexy/android/ui/quiz/QuizScreen.kt) | 8.5 | Animated interactive quiz with option/feedback/summary animations |

### Modified Android Files (Phase 8)

| File | Phase | Change |
|---|---|---|
| [android/.../data/model/Conversation.kt](../../android/app/src/main/java/io/nexy/android/data/model/Conversation.kt) | 8.2 | Added `completed_at: Long? = null` |
| [android/.../data/model/WsEvent.kt](../../android/app/src/main/java/io/nexy/android/data/model/WsEvent.kt) | 8.2 | 8 new event subclasses: debrief + quiz events |
| [android/.../data/WsEventParser.kt](../../android/app/src/main/java/io/nexy/android/data/WsEventParser.kt) | 8.2 | Parse all 8 new events; `completed_at` in `parseConversationArray`; new StateFlow params |
| [android/.../data/WsRepository.kt](../../android/app/src/main/java/io/nexy/android/data/WsRepository.kt) | 8.2 | `currentDebrief` + `completedConversationIds` StateFlows; 6 send functions |
| [android/.../ui/home/HomeScreenComponents.kt](../../android/app/src/main/java/io/nexy/android/ui/home/HomeScreenComponents.kt) | 8.3, 8.4 | Completion badge; Debrief/Mark-complete/Quiz dropdown items |
| [android/.../ui/home/ScopedChatHistoryScreen.kt](../../android/app/src/main/java/io/nexy/android/ui/home/ScopedChatHistoryScreen.kt) | 8.3, 8.4 | Collect `completedConversationIds`; `onOpenDebrief`/`onOpenQuiz` callbacks |
| [android/.../ui/home/HomeScreenTabs.kt](../../android/app/src/main/java/io/nexy/android/ui/home/HomeScreenTabs.kt) | 8.3 | Pass `isCompleted = conv.completed_at != null` to `ConversationRow` |
| [android/.../navigation/NavGraph.kt](../../android/app/src/main/java/io/nexy/android/navigation/NavGraph.kt) | 8.4, 8.5 | Routes for `debrief/{conversationId}` and `quiz/{conversationId}`; wire `onOpenDebrief`/`onOpenQuiz` |
