# Roadmap: Learning Features — Quiz Decoupling, NL-Directed Quizzes & Teach-Back

Drafted 2026-07-18.

## Implementation status (2026-07-18)

The core learning milestone is implemented:
- Phase 1 core: quizzes no longer depend on debrief generation; conversation, existing debrief, and project sources work; natural-language topic/difficulty/count parsing and persisted regeneration specs are wired end to end.
- Phase 2 core: quiz attempts persist by artifact/version, summaries aggregate historical category performance, and missed concepts can generate a focused re-quiz.
- Phase 3 complete: `/teachback [topic]` creates a durable artifact, records and transcribes through local Whisper, speaks prompts through local OS TTS, persists version-bound rubric history, supports two interactive viva follow-ups, and is available on paired Android devices.
- Phase 4 complete: `DebriefArtifactCard` has a Structured/Story toggle backed by `generateDebriefStoryForWs` (`debrief-handlers.ts`), which retells the debrief's structured content as a 3-5 beat narrative with inline line-art SVGs, cached as `story.json` on the debrief's version. The renderer validates each SVG against the closed element/attribute grammar (`src/renderer/lib/story-svg.ts`), falling back to a mood emoji on any violation, and each beat has a "Read aloud" button via `window.speechSynthesis`.

Deferred follow-ups remain in this roadmap: the quiz options popover, non-MCQ question formats, the project knowledge dashboard, scheduled practice, a role-playing Feynman mode, and the brainstormed ideas in the register below (flashcards/spaced repetition, memory-match minigame, etc). These are not required for the completed milestone.

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

## Phase 4 — "Story mode": narrative retelling + illustrated beats

`Priority: P3 · Effort: M · Risk: medium (LLM SVG quality is inconsistent)`

Reframes a debrief as a short narrative/analogy instead of a dry structured summary — a tone toggle, not a new artifact kind, plus optional inline line-art per scene.

1. **Story generation.** `STORY_SYSTEM_PROMPT` alongside `DEBRIEF_SYSTEM_PROMPT` (`debrief-handlers.ts:28`). Input is the existing structured `debrief.json` (`summary`, `commandsAndTools`, `reproductionGuide`, `mentalModel`) — not the raw transcript, cheaper and keeps grounding tight. Output is **JSON, not markdown**, so it parses deterministically:
   ```json
   {
     "title": "string",
     "beats": [
       { "caption": "≤200 chars", "mood": "problem|attempt|discovery|resolution", "svg": "<svg>...</svg>" }
     ]
   }
   ```
   3-5 beats, causal chain preserved (what went wrong → what was tried → what worked) so it stays technically accurate under the narrative framing.
2. **SVG constraints (the actual quality lever).** State explicitly in the system prompt, backed by a worked few-shot example (e.g. a key-in-a-lock icon) so the model has a concrete style anchor instead of inventing its own conventions:
   - Exactly `viewBox="0 0 100 100"`, no `width`/`height` attributes — renderer controls sizing.
   - Allowed elements only: `svg, g, circle, rect, line, path, polygon, polyline`. Nothing else.
   - Forbidden: `script`, `foreignObject`, `image`, `use[href^=http]`, any `on*` attribute, `style` with `url(...)`.
   - Max 12 elements per icon — keeps it abstract/iconographic by design; more shapes reliably produces worse output.
   - Colors: `fill="currentColor"` (primary) or `fill="var(--story-accent)"` (secondary) only — no literal hex, so icons theme correctly in light/dark automatically since the SVG is inlined in HTML rather than loaded as an external file.
3. **Renderer-side validation.** Before render, check each `svg` string against the element/attribute allowlist (a closed grammar, not a full sanitizer) — on any violation, fall back to the `mood`-mapped emoji (🧩 problem / 🔧 attempt / 💡 discovery / ✅ resolution) rather than attempting partial sanitization.
4. **Storage.** `story.json` written as a sibling file to `debrief.json` via the same version-file helper in `artifacts.ts` — generated lazily on first request, cached thereafter; no new artifact version, no migration. Regenerate only on explicit user action (mirrors `QuizArtifactCard`'s Regenerate button).
5. **Renderer.** `DebriefArtifactCard.tsx` gets a Structured/Story toggle; Story view renders each beat as a panel (icon + caption), with a per-beat "Read aloud" button wired to the existing local OS TTS bridge built for teach-back.

## Brainstorm register (captured, not committed)

| Idea | Sketch |
|---|---|
| Flashcards / spaced repetition | Extract fact cards from debriefs; SM-2-style scheduling on top of Phase 2's attempts table. |
| "Explain this file/PR" challenges | Pick a file or recent diff from the project workspace; user explains, model grades. |
| Cross-conversation glossary | Per-project concept index built from debrief `mentalModel`s, linkable from chat. |
| Onboarding mode | Generate a guided tour quiz sequence for a project a collaborator hasn't worked in. |
| Android practice | Implemented: paired Android devices can generate/open teach-back artifacts, dictate or edit answers, hear prompts, receive rubric feedback, continue viva turns, and restore attempt history. |
| Memory-match minigame | Flip-card term↔definition pairs from a debrief's `mentalModel`/wiki; new `ArtifactKind: 'matchgame'` reusing `QuizArtifactCard`'s step-flow UI. |
| Speed round | Quiz variant with per-question countdown and score multiplier; same question bank, different pacing wrapper. |
| Fill-in-the-blank code challenge | Blank key tokens in a real repo snippet; user retypes/selects — ties learning to the actual codebase. |
| Concept map artifact | Auto-generated node graph from wiki entries or a debrief's `mentalModel`, click-to-expand nodes. |
| Progress rings / streak bar | Cross-feature XP on the home screen from quiz completions, teach-back sessions, flashcard reviews. |
| Rapid-fire oral trivia | TTS reads a question, user answers by voice, STT + LLM grades — hands-free Android commute mode. |

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
