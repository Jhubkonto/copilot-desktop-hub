# Roadmap: Learning Features — Quiz Decoupling, NL-Directed Quizzes & Teach-Back

Drafted 2026-07-18.

## Implementation status (2026-07-18)

The core learning milestone is implemented:
- Phase 1 core: quizzes no longer depend on debrief generation; conversation, existing debrief, and project sources work; natural-language topic/difficulty/count parsing and persisted regeneration specs are wired end to end.
- Phase 2 core: quiz attempts persist by artifact/version, summaries aggregate historical category performance, and missed concepts can generate a focused re-quiz.
- Phase 3 complete: `/teachback [topic]` creates a durable artifact, records and transcribes through local Whisper, speaks prompts through local OS TTS, persists version-bound rubric history, supports two interactive viva follow-ups, and is available on paired Android devices.

Deferred follow-ups remain in this roadmap: the quiz options popover, non-MCQ question formats, the project knowledge dashboard, scheduled practice, and a role-playing Feynman mode. These are not required for the completed milestone.

## Summary

Expand the current quiz/debrief pair into a broader "learn about your projects" system. Today both are simplistic, auto-generated, conversation-scoped artifacts and the quiz is hard-coupled to the debrief. Goals: (1) decouple quiz from debrief and let the user direct what a quiz focuses on via natural language; (2) persist learning history so knowledge builds over time; (3) add a spoken-explanation "teach-back" mode that verifies understanding by having the user explain concepts out loud.

## Key findings (current state)

**Generation (main process)**
- Debrief: `src/main/debrief-handlers.ts` — `DEBRIEF_SYSTEM_PROMPT` (`:28-37`) produces `{summary, commandsAndTools, reproductionGuide, mentalModel}`. `generateDebriefForWsInner` (`:94-193`) is the **only feature that reads raw chat history** (SELECT at `:95-97`, transcript truncated to 40k chars). Model: explicit arg → project primary agent → `DEFAULT_PROVIDER_MODEL`; falls back to the Claude CLI adapter when no API key.
- Quiz: `src/main/quiz-handlers.ts` — `QUIZ_SYSTEM_PROMPT` (`:24-33`) produces 5-8 four-option MCQs with `category: command|concept|sequence|approach`. **Hard-coupled to debrief** (`:62-85`): if no debrief artifact exists it silently generates one first, then feeds *only the debrief text* (8k-char cap) to the quiz model. The quiz never sees the chat.
- Both write versioned artifact files (`quiz.json`/`debrief.json`) through shared plumbing in `src/main/artifacts.ts` (`findArtifactForConversation`, `createPendingArtifactForConversation`, `writeArtifactVersionForConversation`).

**Triggering & display (renderer)**
- `/debrief [model]` and `/quiz [model]` — `src/renderer/slash-commands.ts:76-77`, handlers at `:577-601` → `ctx.startArtifactGeneration` → `useChatWindowActions.ts:181-193` → `window.api.startQuizGeneration` etc., with a durable chat card attached immediately.
- Cards: `src/renderer/components/artifacts/QuizArtifactCard.tsx` (full MCQ flow, per-category score breakdown, Try Again / Regenerate) and `DebriefArtifactCard.tsx`; listed in `ArtifactsPane.tsx` / `ProjectArtifactsTab.tsx`. Background progress via `backgroundActivitySlice` + `activity-tracker.ts`.

**Gaps**
- **Quiz attempts are not persisted** — score lives only in `QuizArtifactCard` React state. The old `conversation_quiz_attempts` table was dropped when quiz moved to the artifact system (`database-migrations.ts:967`). No learning history, no spaced repetition.
- Types: `QuizQuestion` (`src/shared/types.ts:56-63`) is a rigid 4-option MCQ (`options` 4-tuple, `correctIndex 0|1|2|3`).
- Speech: local whisper.cpp **STT already exists** (`src/main/voice-handlers.ts` — `voice:install-local`, `voice:transcribe`; renderer `useVoiceInput.ts` + `VoiceInputButton.tsx`) but is used only to dictate into the composer. No TTS, no transcript grading.

## Phase 1 — Decouple quiz from debrief; NL-directed quizzes

`Priority: P1 · Effort: M · Risk: low`

1. **Quiz source selection.** Refactor `generateQuizForWsInner` (`quiz-handlers.ts:62-85`) to accept a source spec instead of always resolving a debrief:
   - `conversation` — raw chat transcript (reuse the debrief's history query + truncation from `debrief-handlers.ts:94-108`);
   - `debrief` — current behavior, when one exists (no more silent auto-generation; offer it explicitly in the UI);
   - `project` — transcripts/debriefs across the project's conversations;
   - `topic` — a free-text focus supplied by the user, combined with whichever source is chosen.
2. **Natural-language trigger.** Extend `/quiz` to accept a focus argument — `/quiz on the IPC layer`, `/quiz hard 10 questions about migrations` — parsed in the `/quiz` handler (`slash-commands.ts:577-601`; follow the `resolveModel` trailing-arg pattern at `:133`). The parsed spec travels through a widened `startQuizGeneration` IPC payload (update `IpcChannels`/`IpcReturnMap` in `src/shared/types.ts` and the preload wrapper per the CLAUDE.md IPC checklist, plus the `src/test/mocks/api.ts` stub).
3. **Options UI.** Small options popover on the quiz card / composer: focus topic, difficulty, question count, source. Regenerate re-uses the last spec.
4. **Question-type variety.** Extend `QuizQuestion` with an optional `kind` (`mcq` default; add `open-ended` with model-graded answers, `ordering`); keep the 4-tuple MCQ shape backward-compatible so existing `quiz.json` artifacts still render.

## Phase 2 — Learning history & progression

`Priority: P2 · Effort: M · Risk: low`

1. **Persist attempts.** New append-only migration adding a `quiz_attempts` table (do not resurrect the dropped `conversation_quiz_attempts` schema) keyed to artifact id + version: per-question correctness, per-category scores, timestamp. Write from `QuizArtifactCard` on completion via a new IPC channel.
2. **Weak-area surfacing.** "Re-quiz me on what I missed" (generate from wrong answers) and per-category trends on the card summary step.
3. **Project knowledge dashboard.** A project tab aggregating debriefs, quiz history, and coverage ("conversations without a debrief", score-over-time), building on `ProjectArtifactsTab.tsx`.
4. **Scheduled practice.** Reuse the existing scheduler (`scheduled_tasks`) to fire periodic quizzes for a project — analogous to how it can already target `'automated_workflow'`.

## Phase 3 — Spoken teach-back practice

`Priority: P2 · Effort: L · Risk: medium`

1. **New artifact kind `'teachback'`** (extend `ArtifactKind`, `src/shared/types.ts:990-993`): the app poses a prompt drawn from a debrief's `mentalModel` or a user topic ("Explain how chat messages flow from the composer to the provider").
2. **Capture & grade.** Reuse the existing pipeline — `useVoiceInput.ts` mic capture → 16 kHz WAV → `voice:transcribe` (whisper.cpp) — then a grading LLM call comparing the transcript against the source material, returning a rubric (accuracy, completeness, clarity), corrections, and follow-up probing questions. Card UI mirrors `QuizArtifactCard`'s step flow (prompt → record → feedback).
3. **Multi-turn viva (implemented).** The model plays examiner across two persisted follow-up turns. The separate role-playing "Feynman mode" remains deferred.
4. **TTS (implemented).** Desktop uses Electron's local OS speech voices and Android uses `TextToSpeech`; prompts and follow-ups can be read aloud without uploading text to a speech provider.

## Brainstorm register (captured, not committed)

| Idea | Sketch |
|---|---|
| Flashcards / spaced repetition | Extract fact cards from debriefs; SM-2-style scheduling on top of Phase 2's attempts table. |
| "Explain this file/PR" challenges | Pick a file or recent diff from the project workspace; user explains, model grades. |
| Cross-conversation glossary | Per-project concept index built from debrief `mentalModel`s, linkable from chat. |
| Onboarding mode | Generate a guided tour quiz sequence for a project a collaborator hasn't worked in. |
| Android practice | Implemented: paired Android devices can generate/open teach-back artifacts, dictate or edit answers, hear prompts, receive rubric feedback, continue viva turns, and restore attempt history. |

## Acceptance criteria

- [x] `/quiz` works with no debrief present, never silently creates one, and accepts a free-text focus plus difficulty/count options.
- [x] Quiz generation can target conversation, debrief, project, or topic sources; regenerate preserves the spec.
- [x] Attempts persist across restarts; summary step shows historical per-category performance; "re-quiz missed questions" works.
- [x] Teach-back: record → transcribe → rubric feedback loop works end-to-end with the local whisper install.
- [x] Teach-back feedback persists per artifact version; desktop and Android restore saved turns.
- [x] Local prompt TTS and two interactive viva follow-ups work on desktop and Android.
- [x] Automatic Whisper setup supports Windows x64, Linux x64/arm64, and macOS through Homebrew, with manual paths as fallback.
- [x] New IPC channels follow the four-step checklist in `.claude/CLAUDE.md`; `src/test/mocks/api.ts` stubs added; main + renderer Vitest coverage for source selection and attempt persistence.

## Common verification gates

- `npm run typecheck`, `npm run lint`, `npm test` (both Vitest projects).
- `nexy-app-check` smoke: generate a quiz with a topic focus in a live chat; complete it; restart the app and confirm history.
- Manual: whisper install path on clean Windows/Linux/macOS profiles, desktop and Android mic capture, TTS voice availability, and dark/light pass on new cards.
