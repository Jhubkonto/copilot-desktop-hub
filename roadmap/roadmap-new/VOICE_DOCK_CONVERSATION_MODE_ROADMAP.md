# Roadmap: Voice Dock, Spoken Recaps, and Project Conversation Mode

Drafted 2026-07-29.

Status: Superseded.

Conversation Mode portions of this roadmap were retired by
`TALK_TO_PROJECT_RETIREMENT_AND_VOICE_PARITY_ROADMAP.md`. Do not continue
Conversation Mode implementation from this document. Voice input and spoken
output portions remain historical implementation context only.

Implementation progress: Phase 0 is complete except for the physical-device
Android early-stop baseline. Phase 1 now includes reusable local Whisper,
application-owned Android PCM capture, and authenticated chunked transcription
uploads. Desktop capture now has explicit start, stop, and cancel primitives,
bounded duration/size state, AudioWorklet-first PCM capture, and draft-only
transcript insertion. Physical-device acceptance checks remain open.
Phase 3 now includes desktop installed-voice playback, speech-safe Read Response
and deterministic Quick Recap actions, unified playback controls, persistent
desktop speech preferences, optional autoplay, and recording interruption.
Android chat responses and notification summaries now share the foreground
speech service, speech-safe response/Quick Recap policy, persistent installed
voice preferences, playback actions, notification controls, and audio-focus
lifecycle. Teachback prompt playback uses the same service; Android device
validation remains open. Phase 3 is now implementation-complete: notification,
desktop, and paired-Android recaps share one persisted message-output service,
and optional AI Recap actions identify their provider or CLI model.
Phase 6 now includes the adaptive Android Conversation Mode surface, durable
session restoration, project/chat scope selection, transcript and evidence
cards, Voice Dock and spoken-answer continuity, recoverable connection states,
and precise chat/wiki/artifact source navigation. Android compilation and
physical-device acceptance remain blocked by the offline Gradle plugin cache.

Latest verification (2026-07-29):

- Focused shared/backend/desktop Conversation Mode tests: 32 passed.
- Android Conversation Mode lifecycle/routing policy tests: 6 passed through
  the cached Kotlin compiler/JUnit runtime.
- TypeScript typecheck: passed.
- ESLint: passed with two pre-existing warnings outside this implementation.
- Electron production build: passed.
- Full Vitest suite: 1,540 passed, 4 unrelated tests failed, and 3 existing CLI
  suites could not load because their `child_process` mocks omit `execFile`.
- Android project build gates remain blocked before Kotlin/Compose compilation.
  Gradle 9.4.1 is available locally, but the wrapper, Foojay resolver, and
  Android plugin metadata needed for an offline build are not fully cached.

Primary milestone: UI Unification — standardize the interaction model and visual language across desktop and Android.

Related milestones: Feature Enhancement and Bug Fixing.

## Executive summary

This roadmap turns Nexy's existing voice input and read-aloud features into one coherent, cross-platform voice system:

1. **Voice Dock** provides reliable press-and-hold recording, a draggable in-chat microphone, and editable transcription.
2. **Spoken output** provides a natural oral version of a result without reading Markdown, code, commands, URLs, or raw tool output.
3. **Project Conversation Mode** provides a voice-first, evidence-based session that can answer questions across one selected project's chats, wiki, artifacts, and ongoing work.

The first production release is intentionally bounded:

- One project is required and visibly selected.
- Retrieval stays inside that project.
- Conversation Mode is read-only.
- Project files and the external web are excluded.
- Each turn has a fixed retrieval budget and at most one refinement pass.
- Every answer retains visible source references.
- Voice capture ends when the user releases the control, not when Android detects silence.
- Android uses the paired desktop's local Whisper installation when available.
- The visual answer and spoken answer are produced together, avoiding a second model request.
- Speech playback uses voices already installed on the operating system.

This scope solves the Android cutoff problem and delivers the useful core of project-wide voice conversation without introducing an unrestricted background agent, system overlay permission, paid speech dependency, or cross-project data leakage.

## Problem statement

### Voice input is unreliable on Android

Android currently uses `SpeechRecognizer` in
`android/app/src/main/java/io/nexy/android/ui/chat/OnDeviceVoiceInput.kt`.
The recognizer owns end-of-speech detection and Nexy sets the UI to stopped in
`onEndOfSpeech()`. A pause, cadence change, or recognition-engine decision can
therefore stop dictation before the user is finished.

Android documents that `SpeechRecognizer` is not intended for continuous
recognition:
<https://developer.android.com/reference/android/speech/SpeechRecognizer>

Nexy needs to own audio capture duration and submit the completed recording for
transcription only after the user releases or explicitly stops recording.

### Read-aloud is fragmented

- Android chat creates a `TextToSpeech` instance inside `ChatScreen.kt` and
  reads the raw assistant message.
- `NexySpeechService.kt` separately speaks notification summaries.
- `fcm-sender.ts` separately generates a short LLM-authored spoken summary of a
  broader conversation.
- Desktop has local Whisper dictation but no equivalent unified spoken-output
  controller.

Raw assistant messages may contain code, commands, Markdown, structured data,
URLs, or tool output. Reading them literally is often unpleasant or
meaningless.

### Project knowledge is distributed

Useful context may be located in:

- the current voice session;
- a selected project chat;
- conversation titles and message bodies;
- rolling conversation summaries;
- project wiki entries;
- active-turn snapshots;
- project artifacts and roadmaps;
- project files.

Nexy already stores or exposes most of these sources, but there is no dedicated
session that retrieves them under an explicit scope, records which sources
supported an answer, and presents a concise spoken result.

### Unbounded retrieval would be risky

A model with unrestricted search access could consume excessive context, wander
between projects, repeat searches, treat partial work as final, or expose
unrelated project information. Voice also makes accidental authorization more
likely because conversational wording can be ambiguous.

Conversation Mode therefore needs a deterministic scope, budget, evidence
model, and read-only default.

## Product principles

1. **Scope is always visible.** The user should never have to infer which
   project or sources are being searched.
2. **One project by default.** Nexy may list projects, but it searches only the
   selected project until the user explicitly changes scope.
3. **Silence does not end a held recording.** Nexy owns capture duration.
4. **Transcripts remain editable.** Dictation inserts into the composer and does
   not send automatically.
5. **Spoken output is authored for listening.** It is not raw Markdown passed to
   TTS.
6. **Evidence is inspectable.** Each factual response records its sources and
   can navigate back to them.
7. **Retrieval is bounded.** Search rounds, sources, excerpts, characters, and
   elapsed time all have hard limits.
8. **Discussion is not authorization.** The initial mode cannot mutate project
   state or ongoing chats.
9. **Free local speech is the baseline.** Installed OS TTS and local Whisper are
   preferred; optional provider usage is labelled.
10. **Desktop and Android share one product contract.** Layout adapts by
    platform, but terminology, states, source types, settings, and behaviors
    remain consistent.
11. **Privacy is explicit.** Temporary audio is deleted after transcription;
    retained transcripts and source references follow normal conversation
    persistence.
12. **Accessibility is first-class.** A tap-to-start/stop alternative exists for
    users who cannot maintain a hold gesture.

## User-facing model

### Feature 1: Voice Dock

The Voice Dock is an in-app floating control available in chat and Conversation
Mode. It is not an Android "draw over other apps" overlay in the first release.

Primary gestures:

- Hold the microphone center to record.
- Release to stop and transcribe.
- Move toward a cancel target before release to discard.
- Drag the outer grip to reposition the dock.
- Tap in accessibility mode to start; tap again to stop.
- Tap while Nexy is speaking to interrupt playback and begin a follow-up.

Behavior:

- The dock is 60–64 dp/CSS px at the interaction surface.
- Idle opacity is approximately 60 percent.
- Touched, listening, error, and speaking states are nearly opaque.
- A short haptic confirms recording start and stop on Android.
- Position is clamped inside safe content bounds.
- Portrait and landscape positions are stored separately on Android.
- The dock avoids the composer, IME, system bars, and display cut-outs.
- Desktop placement is stored per window size class.
- "Dock microphone" restores the normal composer control.
- "Reset position" restores the recommended bottom-right location.

### Feature 2: Spoken output

Two actions are available where meaningful:

- **Read response** reads a sanitized version of prose content.
- **Hear recap** speaks a short explanation of what the turn accomplished.

Conversation Mode normally speaks its dedicated `spokenAnswer`, which is
generated alongside `answerText`.

Playback controls:

- play;
- pause/resume;
- stop;
- replay;
- speed;
- voice;
- interrupt with microphone;
- Android notification controls while background playback is active.

### Feature 3: Project Conversation Mode

Conversation Mode opens as a dedicated session with a visible scope bar:

```text
Nexy Development  ›  All chats  +  Wiki  +  Artifacts
```

The user may optionally narrow the session to one or more chats. The first
release does not allow cross-project comparison, project-file search, external
web search, or state-changing actions.

Example flow:

1. Open Conversation Mode from the Voice Dock, desktop toolbar, Android home,
   or chat overflow menu.
2. Select a project, or accept the current chat's project.
3. Optionally select a chat.
4. Hold to ask a question and release.
5. Watch the shared state progress through Transcribing, Searching, Answering,
   and Speaking.
6. Hear the concise answer.
7. Expand the transcript and source cards.
8. Open a source at the relevant chat, message, wiki entry, artifact, or active
   turn.
9. Ask a follow-up without restating the project or subject.

## Unified interaction states

Both platforms use the same state vocabulary:

```text
Idle
  → Listening
  → Transcribing
  → Searching
  → Answering
  → Speaking
  → Idle
```

Additional terminal or interrupt states:

```text
Listening → Cancelled → Idle
Transcribing | Searching | Answering → Error → Idle
Speaking → Paused → Speaking
Speaking → Interrupted → Listening
Any active state → Stopped → Idle
```

Rules:

- Exactly one top-level state is active.
- State changes are driven by the session controller, not inferred separately
  by each UI.
- The visual label and accessibility announcement use the same shared state.
- Static state changes, spinners, timers, and meter changes fit Nexy's existing
  limited-motion policy; decorative animation is not required.
- Reduced-motion and no-motion preferences are respected on both platforms.

## Visual and interaction specification

### Shared anatomy

The expanded surface contains:

1. scope bar;
2. status line;
3. microphone/stop control;
4. compact transcript;
5. spoken-answer controls;
6. expandable source list;
7. suggested follow-up actions;
8. close/collapse control.

### Desktop

- Entry points: chat composer microphone menu, chat header, project header, and
  an optional keyboard shortcut.
- Conversation Mode opens as a right-side panel or compact floating panel
  inside the Nexy window.
- It must not require always-on-top behavior in the first release.
- Source selection routes through the existing application store and opens the
  appropriate conversation, project wiki entry, or artifact panel.
- The dock uses the same semantic colors, radius, borders, typography, and icon
  sizes as Android's Compose implementation.
- `speechSynthesis`/installed operating-system voices provide the free local
  playback baseline.

### Android

- Entry points: chat microphone menu, project screen, home action, and
  notification deep link.
- Conversation Mode opens as a modal sheet that can expand to full screen and
  collapse into the Voice Dock.
- The floating control remains inside Nexy's activity.
- The screen uses `WindowInsets` and IME state to clamp placement.
- The existing `NexySpeechService` evolves into the single background playback
  owner.
- Notification actions provide pause/resume, stop, and reopen.
- A wakelock is not held merely because Conversation Mode is open.

### Accessibility

- Minimum interactive target: 48 dp/CSS px.
- Spoken and visible state descriptions are equivalent.
- All icons have meaningful content descriptions/ARIA labels.
- Dragging is never the only way to place the dock; presets are available.
- Holding is never the only way to record; tap-to-toggle is available.
- Source cards expose source type, title, state, and position.
- Color is not the only recording or error indicator.
- Screen-reader focus does not jump when the compact surface changes state.

## Scope and permission model

### Session scope

The first-release scope is:

```ts
interface ConversationModeScope {
  projectId: string
  conversationIds: string[] | null // null means all project chats
  includeWiki: boolean             // default true
  includeArtifacts: boolean        // default true
  includeActiveWork: boolean       // default true
  includeProjectFiles: false
  includeWeb: false
  allowOtherProjects: false
}
```

Scope rules:

- `projectId` is mandatory before the first question.
- Every query joins or filters on the selected `projectId`.
- Selected conversation IDs are verified to belong to the selected project.
- Source hydration repeats ownership checks; it does not trust IDs supplied by
  the model or client.
- A scope change is stored as a session event and displayed in the transcript.
- Ambiguous spoken chat names produce a disambiguation prompt, not a guess.
- Scope never expands implicitly because a source mentions another project.

### Discussion mode

The first release is discussion-only. Allowed operations are:

- list projects for selection;
- search project conversations and summaries;
- read bounded message excerpts;
- search project wiki entries;
- list/read project artifacts;
- inspect active-turn snapshots;
- answer and cite;
- navigate to a source.

Disallowed operations include:

- sending messages to existing chats;
- creating or deleting chats;
- stopping active turns;
- editing files;
- updating the wiki;
- running commands;
- changing settings;
- accessing other projects;
- searching the web.

### Later action mode

Action Mode is deferred until read-only behavior is proven. It requires:

- a separate visible mode;
- per-action capability checks;
- a spoken and visual confirmation;
- exact target and action preview;
- cancellation;
- audit log;
- no ambiguous pronoun-only confirmations.

Action Mode is not a hidden permission flag on a read-only session.

## Retrieval architecture

### Source priority

The default priority is:

| Priority | Source | Purpose |
|---:|---|---|
| 1 | Conversation Mode session | Follow-ups and references such as "that build" |
| 2 | Explicitly selected chat(s) | Precise prior decisions and results |
| 3 | Conversation title and rolling summary | Fast project-wide orientation |
| 4 | Project wiki | Durable decisions, facts, and procedures |
| 5 | Active-turn snapshot | Current work and in-progress status |
| 6 | Project artifacts | Plans, reports, debriefs, and generated outputs |
| 7 | Bounded message excerpts | Supporting detail from top-ranked chats |
| Later | Project files | Current implementation evidence |
| Later | External web | Current external facts with explicit permission |

### Deterministic retrieval pipeline

The model does not receive an unrestricted search tool loop.

1. **Resolve scope**
   - Validate project and optional conversation IDs.
   - Resolve named chat candidates.
   - Carry forward session entities only if they still belong to scope.

2. **Collect lightweight candidates**
   - Current session turns.
   - Selected chat titles and rolling summaries.
   - Other project chat titles, recency, and rolling summaries.
   - Wiki title, tags, and bounded preview.
   - Artifact title, kind, description, and current-version manifest.
   - Active-turn status and activity label.

3. **Rank candidates**
   - exact title/name match;
   - selected-source boost;
   - term overlap;
   - phrase overlap;
   - recency;
   - source-type prior;
   - follow-up entity reference.

4. **Hydrate the top candidates**
   - Fetch bounded excerpts and precise source metadata.
   - Separate completed facts from partial streamed work.

5. **Optional single refinement**
   - If evidence is inadequate or conflicting, generate one revised local query
     set and repeat within the remaining budget.

6. **Generate the answer**
   - Give the model only hydrated evidence and stable source handles.
   - Require claims to refer to supplied handles.
   - Produce visual and spoken forms together.

7. **Validate**
   - Reject unknown or out-of-scope source handles.
   - Mark evidence state.
   - Persist answer, spoken output, sources, and budget usage.

### Default per-turn budget

```ts
interface ConversationModeBudget {
  maxSearchRounds: 2
  maxConversationsRanked: 30
  maxConversationsHydrated: 5
  maxWikiEntriesHydrated: 4
  maxArtifactsHydrated: 4
  maxActiveTurnsHydrated: 5
  maxMessageExcerpts: 20
  maxExcerptChars: 1_200
  maxEvidenceChars: 24_000
  maxWallClockMs: 15_000
}
```

Implementation notes:

- Limits are enforced in application code and cannot be raised by model output.
- The second round uses only the remaining budget.
- Duplicate sources and overlapping excerpts are collapsed.
- A timeout returns the best supported answer collected so far.
- "Search more deeply" is deferred until a visible per-turn budget control is
  designed; it must not silently become the default.

### Evidence states

Every result has one of:

- `sufficient` — evidence supports the answer;
- `incomplete` — relevant sources exist but do not establish a conclusion;
- `conflicting` — sources disagree;
- `still-running` — the requested work is active and has no final result;
- `not-found` — no relevant evidence was found within scope and budget;
- `error` — retrieval or answer generation failed.

Spoken answers use natural language for these states. They do not imply certainty
when work is incomplete.

### Active work semantics

Active-turn snapshots from `src/main/active-chat-turns.ts` are treated as
ephemeral evidence.

- `active` is described as current activity, not a result.
- Partial assistant text is labelled partial.
- `completed` may be cited as a result only after persistence is confirmed.
- `failed` includes the failure state without inventing a resolution.
- The 30-second in-memory terminal TTL means durable messages remain the source
  of truth after the snapshot expires.

## Answer contract

The internal result contract is shared across desktop and Android:

```ts
interface ConversationModeAnswer {
  sessionId: string
  turnId: string
  answerText: string
  spokenAnswer: string
  evidenceState:
    | 'sufficient'
    | 'incomplete'
    | 'conflicting'
    | 'still-running'
    | 'not-found'
    | 'error'
  sources: ConversationModeSource[]
  suggestedActions: Array<{
    type: 'open-source' | 'narrow-scope' | 'repeat' | 'stop'
    label: string
    sourceId?: string
  }>
  retrieval: {
    rounds: number
    elapsedMs: number
    truncated: boolean
  }
}
```

`answerText`:

- may use concise Markdown;
- provides enough context to stand alone;
- states uncertainty and conflicts;
- does not expose chain-of-thought.

`spokenAnswer`:

- contains one to four natural sentences by default;
- avoids Markdown, URLs, code, commands, table syntax, and citation IDs;
- states the outcome first;
- mentions failure or required user action;
- may name the human-readable sources generally;
- contains no private reasoning.

The prompt requests both fields in the same final provider response. A strict
parser validates the envelope. If parsing fails:

1. preserve the response as `answerText`;
2. derive a conservative local `spokenAnswer`;
3. mark the structured-output fallback in diagnostics;
4. do not make a second paid model call automatically.

## Spoken recap strategy

### Conversation Mode

Because Conversation Mode already makes an answer-generation request, it
produces `spokenAnswer` in that same request. This is the default and does not
add a second provider round trip.

### Normal chat responses

Normal assistant messages gain two recap strategies:

1. **Quick recap**
   - Local, deterministic, and free.
   - Uses the final response, structured tool outcomes, and error state.
   - Removes Markdown/code/URLs and selects outcome-oriented prose.

2. **AI-quality recap**
   - Optional and clearly labelled as using the selected provider or CLI.
   - Summarizes only the latest completed turn, not the entire conversation.
   - Reuses a common spoken-output prompt and persistence path.

The existing `generateSpokenSummary()` implementation in `fcm-sender.ts` should
be refactored into the shared service. Notification summaries, message recaps,
and Conversation Mode spoken output then use one policy and one data contract.

### TTS selection

Android's `TextToSpeech` API exposes installed voices and whether they require a
network connection:
<https://developer.android.com/reference/android/speech/tts/TextToSpeech>

Settings:

- voice picker with preview;
- offline/downloaded voices only;
- speech rate, default about 0.95x;
- pitch, default 1.0;
- spoken response length: brief, conversational, detailed;
- auto-speak: never, Conversation Mode only, every completed turn;
- interrupt playback when recording starts;
- shortcut to Android TTS voice-data settings when needed.

No third-party paid TTS dependency is required for the first release.

## Reliable recording and transcription

### Capture contract

```text
Pointer/finger down
  → start PCM capture
Hold
  → continue through silence
Release
  → finalize WAV
  → transcribe
  → insert editable transcript
```

Capture requirements:

- 16 kHz mono PCM16 WAV when supported;
- internal temporary file or bounded streaming buffer;
- visible timer and level meter;
- configurable safety limit, default 10 minutes;
- maximum uncompressed audio size aligned with desktop's current 50 MiB limit;
- cancel deletes temporary audio;
- failures preserve the existing text draft;
- backgrounding during capture stops safely and asks whether to transcribe the
  captured portion;
- incoming phone/audio-focus interruption stops safely.

Android's `AudioRecord` is suitable for application-owned PCM capture:
<https://developer.android.com/reference/android/media/AudioRecord>

### Desktop

Refactor `src/renderer/hooks/useVoiceInput.ts` into a reusable recorder and
transcription controller:

- replace deprecated `ScriptProcessorNode` with `AudioWorklet` where supported,
  with a tested fallback;
- expose `start`, `stop`, `cancel`, duration, level, and error;
- let composer and Voice Dock share the same instance;
- preserve current local `whisper.cpp` configuration;
- add explicit maximum-duration and maximum-size handling.

### Paired Android

The first reliable Android path is:

1. Capture PCM locally with `AudioRecord`.
2. Upload it over Nexy's authenticated TLS WebSocket.
3. Transcribe with the desktop's configured local Whisper executable/model.
4. Return transcript and detected language metadata.
5. Delete temporary audio on both sides.

Do not put an entire long recording in a single JSON message. Add a bounded
upload session:

```text
voice:upload-start
voice:upload-chunk
voice:upload-finish
voice:upload-cancel
```

Protocol rules:

- server creates an opaque upload ID;
- every chunk carries sequence and checksum/length metadata;
- chunks are base64 in the existing JSON protocol for compatibility, limited to
  a small fixed size;
- the server writes to a per-upload temporary file;
- total bytes, chunk count, idle time, and session count are capped;
- finish validates sequence, WAV header, and size before transcription;
- disconnect and timeout delete temporary files;
- replies go only to the authenticated requesting socket;
- no temporary audio path is exposed to Android.

Refactor the transcription body in `src/main/voice-handlers.ts` into a reusable
main-process function called by Electron IPC and the WebSocket handler.

### Standalone Android

The first release retains the existing system recognizer as a clearly labelled
fallback when no desktop is connected. It does not claim press-and-hold
reliability.

A subsequent slice may add a downloadable native `whisper.cpp` backend:
<https://github.com/ggml-org/whisper.cpp>

That slice must measure:

- APK/native build impact;
- model download size and integrity;
- transcription latency by device tier;
- battery and thermal behavior;
- cancellation and process-death recovery;
- supported languages;
- privacy disclosure;
- low-storage behavior.

It remains opt-in and downloads models after installation rather than bloating
the base APK.

## Persistence and database design

Use append-only migrations in `src/main/database-migrations.ts`.

### Conversation kind

Reuse the existing `conversations.kind` column and add the recognized value
`project-conversation-mode` in shared and platform models.

Conversation Mode sessions remain real conversations so they benefit from:

- normal persistence;
- Android sync;
- transcript display;
- project ownership;
- export;
- follow-up history;
- completion and archiving behavior.

They are filtered from ordinary chat lists unless the user saves or explicitly
opens voice-session history.

### Session metadata

Add:

```sql
CREATE TABLE conversation_mode_sessions (
  conversation_id TEXT PRIMARY KEY
    REFERENCES conversations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL
    REFERENCES projects(id) ON DELETE CASCADE,
  scope_json TEXT NOT NULL,
  response_style TEXT NOT NULL DEFAULT 'conversational',
  auto_speak INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Turn metadata and spoken output

Add:

```sql
CREATE TABLE conversation_mode_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL
    REFERENCES messages(id) ON DELETE CASCADE,
  assistant_message_id TEXT
    REFERENCES messages(id) ON DELETE SET NULL,
  spoken_answer TEXT,
  evidence_state TEXT NOT NULL,
  retrieval_stats_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

For reusable normal-chat recaps, add:

```sql
CREATE TABLE message_spoken_outputs (
  message_id TEXT PRIMARY KEY
    REFERENCES messages(id) ON DELETE CASCADE,
  spoken_text TEXT NOT NULL,
  output_kind TEXT NOT NULL,
  generation_kind TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

This avoids overloading assistant message text and lets a recap be regenerated
without editing the message.

### Source references

Add:

```sql
CREATE TABLE conversation_mode_sources (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL
    REFERENCES conversation_mode_turns(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_sub_id TEXT,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  location_json TEXT NOT NULL DEFAULT '{}',
  rank INTEGER NOT NULL,
  score REAL,
  created_at INTEGER NOT NULL
);
```

Do not copy full chat histories into this table. Store small excerpts and stable
references. Source opening re-reads current data and handles deleted sources
gracefully.

### Settings

Shared setting keys:

- `voice_dock_enabled`;
- `voice_dock_record_gesture`;
- `voice_recording_max_seconds`;
- `voice_transcription_backend`;
- `spoken_output_enabled`;
- `spoken_output_auto_play`;
- `spoken_output_rate`;
- `spoken_output_pitch`;
- `spoken_output_voice_id`;
- `spoken_output_offline_only`;
- `conversation_mode_response_style`.

Platform-local layout settings:

- Android portrait/landscape normalized dock position;
- desktop normalized dock position per size class;
- expanded/collapsed preference.

Settings need typed shared contracts and live desktop/Android sync where the
value is not platform-specific.

## Main-process architecture

Introduce focused services instead of adding more logic to `ws-handlers.ts`:

```text
src/main/conversation-mode/
  conversation-mode-types.ts
  conversation-mode-scope.ts
  conversation-mode-search.ts
  conversation-mode-retrieval.ts
  conversation-mode-answer.ts
  conversation-mode-persistence.ts
  conversation-mode-handlers.ts
  conversation-mode-ws.ts

src/main/voice/
  audio-upload-manager.ts
  local-whisper.ts
  spoken-output.ts
  spoken-recap.ts
```

Responsibilities:

- `scope` validates ownership and scope changes.
- `search` contains bounded SQL and ranking primitives.
- `retrieval` owns budget accounting and evidence hydration.
- `answer` builds provider messages, parses structured results, and validates
  source handles.
- `persistence` owns transactions and row mapping.
- `handlers` registers desktop IPC through `safeHandle`.
- `ws` registers Android commands through the emerging WebSocket command
  registry/wrapper.
- `audio-upload-manager` owns temporary upload state and cleanup.
- `local-whisper` is shared by IPC and WebSocket transcription.
- `spoken-output` stores/retrieves spoken forms.
- `spoken-recap` provides quick and optional AI recap strategies.

Avoid adding a second general-purpose chat engine. Reuse provider routing and
streaming primitives, but pass a Conversation Mode-specific system prompt,
tool allowlist, round cap, and output parser.

## Shared contracts and transport

### TypeScript

Add shared types and IPC return mappings in `src/shared/types.ts`, then expose
typed preload methods in `src/preload/index.ts`.

Suggested desktop channels:

- `conversation-mode:create`;
- `conversation-mode:get`;
- `conversation-mode:update-scope`;
- `conversation-mode:send`;
- `conversation-mode:stop`;
- `conversation-mode:list-sources`;
- `spoken-output:get`;
- `spoken-output:generate`;
- `voice:recording-policy`.

Suggested streamed events:

- `conversation-mode:state`;
- `conversation-mode:answer-delta`;
- `conversation-mode:source`;
- `conversation-mode:complete`;
- `conversation-mode:error`.

### WebSocket

Mirror the same domain events on Android:

- `conversation-mode:create`;
- `conversation-mode:get`;
- `conversation-mode:update-scope`;
- `conversation-mode:send`;
- `conversation-mode:stop`;
- `conversation-mode:state`;
- `conversation-mode:source`;
- `conversation-mode:complete`;
- audio upload commands described above.

Every event includes `sessionId` and `turnId` where applicable so late messages
cannot update the wrong UI.

### Android

Add typed `WsEvent` variants, parser cases, repository methods, and reducer/view
model coverage. The protocol additions should follow the existing shared naming
and error-envelope conventions.

The later WebSocket code-generation roadmap can migrate these hand-written
contracts. Conversation Mode should not block on that larger rewrite.

## Desktop implementation map

Primary touchpoints:

- `src/renderer/components/chat/ChatComposer.tsx`
- `src/renderer/components/chat/VoiceInputButton.tsx`
- `src/renderer/hooks/useVoiceInput.ts`
- `src/renderer/components/ChatWindow.tsx`
- `src/renderer/App.tsx`
- `src/renderer/store/`
- `src/renderer/styles/global.css`
- `src/preload/index.ts`
- `src/shared/types.ts`
- `src/main/voice-handlers.ts`
- `src/main/conversation-handlers.ts`
- `src/main/chat-context-builder.ts`
- `src/main/active-chat-turns.ts`
- `src/main/artifacts.ts`
- `src/main/wiki-context.ts`

New renderer modules:

```text
src/renderer/components/conversation-mode/
  ConversationModePanel.tsx
  ConversationModeScopeBar.tsx
  ConversationModeTranscript.tsx
  ConversationModeSources.tsx
  SpokenPlaybackControls.tsx

src/renderer/components/voice/
  VoiceDock.tsx
  VoiceDockMenu.tsx
  VoiceStatus.tsx

src/renderer/hooks/
  useConversationMode.ts
  useSpokenPlayback.ts
  useVoiceDockPosition.ts
```

## Android implementation map

Primary touchpoints:

- `ui/chat/OnDeviceVoiceInput.kt`
- `ui/chat/ChatScreen.kt`
- `ui/chat/ChatScreenInput.kt`
- `ui/chat/ChatViewModel.kt`
- `service/NexySpeechService.kt`
- `data/WsRepository.kt`
- `data/WsEventParser.kt`
- `data/model/WsEvent.kt`
- `data/local/LocalSettingsStore.kt`
- `ui/home/HomeScreen.kt`
- application navigation and manifest service declarations.

New Android modules:

```text
ui/voice/
  VoiceDock.kt
  VoiceDockState.kt
  VoiceDockPositionStore.kt
  HoldToRecordGesture.kt
  PcmAudioRecorder.kt
  VoiceInputController.kt

ui/conversationmode/
  ConversationModeScreen.kt
  ConversationModeViewModel.kt
  ConversationModeScopeBar.kt
  ConversationModeSources.kt
  SpokenPlaybackControls.kt

service/
  SpokenPlaybackController.kt
```

The exact package split may be adjusted to match current Android navigation and
ViewModel conventions, but voice capture, playback, and retrieval UI must not
remain embedded in the 80+ KiB chat screen.

## Delivery phases

### Phase 0 — Contract, telemetry, and design baseline

Goal: lock the shared behavior before platform-specific implementation.

Tasks:

- [x] Define shared states, scope, answer, source, budget, and error contracts.
- [x] Add wireframes for compact, expanded, keyboard-visible, recording, searching,
  speaking, error, and disconnected states.
- [x] Define semantic visual tokens shared by Tailwind and Compose.
- [x] Define privacy and retention copy.
- [x] Add feature flags:
  - `voiceDockV1`;
  - `spokenOutputV1`;
  - `conversationModeV1`.
- [x] Add diagnostics that record state durations, retrieval counts, fallback usage,
  and errors without storing audio or transcript text in logs.
- [ ] Capture baseline Android early-stop reproduction cases on a physical device.

Phase 0 implementation references:

- `src/shared/conversation-mode.ts`
- `src/renderer/__tests__/conversation-mode-contract.test.ts`
- `android/app/src/main/java/io/nexy/android/ui/conversation/ConversationModeContract.kt`
- `android/app/src/main/java/io/nexy/android/ui/conversation/ConversationModeDiagnostics.kt`
- `android/app/src/test/java/io/nexy/android/ui/conversation/ConversationModeContractTest.kt`
- `docs/voice-conversation-mode-design-baseline.md`

Exit criteria:

- [x] Desktop and Android state diagrams match.
- [x] Product strings and source-type names are agreed.
- [x] No open decision changes the database or protocol shape.

### Phase 1 — Shared recording and local transcription foundation

Goal: Nexy owns recording duration on desktop and can reuse desktop Whisper from
Android.

Tasks:

- [x] Extract desktop local Whisper execution into `local-whisper.ts`.
- [x] Refactor desktop audio capture into start/stop/cancel primitives.
- [x] Add duration, audio-level, byte, and timeout state.
- [x] Implement Android `AudioRecord` PCM capture.
- [x] Implement authenticated, chunked audio upload sessions.
- [x] Handle upload timeout, disconnect, cancel, invalid sequence, oversize input,
  and cleanup.
- [x] Preserve drafts and insert transcripts without auto-send.
- [x] Add recorder lifecycle handling for backgrounding and audio-focus loss.

Phase 1 implementation references:

- `src/main/local-whisper.ts`
- `src/main/__tests__/local-whisper.test.ts`
- `src/main/voice-handlers.ts`
- `src/main/voice-upload-sessions.ts`
- `src/main/__tests__/voice-upload-sessions.test.ts`
- `src/main/ws-server.ts`
- `src/main/ws-handlers.ts`
- `src/renderer/lib/pcm-voice-recorder.ts`
- `src/renderer/lib/composer-draft.ts`
- `src/renderer/hooks/useVoiceInput.ts`
- `src/renderer/components/ChatWindow.tsx`
- `src/renderer/__tests__/pcm-voice-recorder.test.ts`
- `src/renderer/__tests__/composer-draft.test.ts`
- `src/renderer/__tests__/hooks/useVoiceInput.test.ts`
- `android/app/src/main/java/io/nexy/android/ui/conversation/PcmVoiceRecorder.kt`
- `android/app/src/main/java/io/nexy/android/ui/conversation/PairedVoiceTranscriptionClient.kt`
- `android/app/src/test/java/io/nexy/android/ui/conversation/PcmVoiceRecorderTest.kt`
- `android/app/src/test/java/io/nexy/android/ui/conversation/PairedVoiceTranscriptionClientTest.kt`

Exit criteria:

- A held Android recording continues through at least 10 seconds of silence.
- Releasing causes exactly one transcription.
- Cancel leaves the draft unchanged.
- A 10-minute safety limit stops cleanly.
- All temporary audio is removed after success, failure, cancel, timeout, and
  disconnect.
- Existing desktop dictation still works.

### Phase 2 — Unified Voice Dock

Goal: ship the same dock behavior and visual language on both platforms.

Tasks:

- [ ] Add in-chat floating dock and composer docking controls.
  - [x] Desktop: add the in-chat dock, "Float microphone," and "Dock microphone"
    controls while sharing the existing recorder instance.
  - [x] Android implementation: add the Compose dock and composer docking
    controls while sharing one recorder/upload controller.
  - [ ] Android validation: compile and exercise the Compose dock on a device.
- [ ] Implement grip drag and center hold separately.
  - [x] Desktop: isolate pointer-captured grip movement from hold/release recording
    and cover both paths with component tests.
  - [x] Android implementation: isolate the drag-grip pointer input from the
    microphone hold/tap pointer input.
  - [ ] Android validation: execute Compose interaction tests for both gesture
    targets.
- [ ] Store normalized positions and clamp to safe bounds.
  - [x] Desktop: persist normalized positions per compact, medium, and expanded
    window size class and re-clamp them after resize.
  - [x] Android foundation: define tested normalized position, orientation, and
    safe-bound conversion primitives.
  - [x] Android implementation: persist portrait and landscape positions, restore
    them after navigation/restart, and apply/reset them in the Compose dock.
  - [ ] Android validation: verify persistence across process restart and rotation.
- [ ] Add keyboard/IME avoidance.
  - [x] Desktop: reserve the composer region while converting normalized dock
    positions.
  - [x] Android foundation: include system insets, IME height, and composer height
    in safe-bound calculations.
  - [x] Android implementation: connect the primitives to live safe-drawing and
    IME `WindowInsets`.
  - [ ] Android validation: verify placement with the keyboard, cut-outs, and
    gesture navigation on a device.
- [ ] Add timer, state label, level indicator, error state, and haptics.
  - [x] Desktop: add visible and screen-reader state, duration, level, error,
    transcribing, and cancel feedback.
  - [x] Android implementation: add matching duration, level, state/error labels,
    cancellation, opacity changes, and start/stop/move haptics.
  - [ ] Android validation: verify haptic and visual behavior on a device.
- [ ] Add tap-to-toggle accessibility mode.
  - [x] Desktop: add a persistent tap-to-start/stop alternative with keyboard and
    screen-reader controls.
  - [x] Android implementation: add persistent tap-to-start/stop mode and
    screen-reader actions.
  - [ ] Android validation: complete TalkBack interaction review.
- [ ] Add onboarding hint and settings.
  - [x] Desktop: add hold/tap state hints, placement reset, and gesture-mode
    setting in the dock.
  - [x] Android implementation: add first-use gesture guidance, position reset,
    persistent gesture mode, and a disabled-by-default Voice Dock settings toggle.
  - [ ] Android validation: review onboarding and settings on compact and expanded
    devices.
- [x] Keep the original composer microphone available when the dock is disabled.
  The desktop retains it as the default and after docking; Android retains its
  existing microphone while the feature flag is disabled.

Exit criteria:

- Position survives restart, rotation, and desktop window resize.
- The dock never becomes unreachable.
- Recording does not accidentally drag the dock.
- Dragging does not start recording.
- Screen-reader and keyboard-only operation is complete.
- Desktop and Android screenshots pass the UI-unification review.

Phase 2 progress, 2026-07-29:

- Added the desktop Voice Dock and composer dock/undock integration in
  `src/renderer/components/chat/VoiceDock.tsx`, `ChatComposer.tsx`, and
  `ChatWindow.tsx`.
- Added tested desktop placement/persistence logic in
  `src/renderer/lib/voice-dock-position.ts`.
- Added Android placement primitives and JVM tests in
  `VoiceDockPlacement.kt` and `VoiceDockPlacementTest.kt`; the Compose UI and
  live inset wiring remain open.
- Focused desktop validation: 12 tests passed, TypeScript typecheck passed,
  focused ESLint passed, and `git diff --check` passed.
- Repository desktop validation: production build passed; repository ESLint
  passed with two unrelated existing warnings. The full suite passed 1,498 of
  1,502 executed tests; four unrelated existing tests failed and three existing
  suites could not load because of incomplete `child_process` mocks.
- At the time of the desktop slice, Android execution was blocked before Gradle
  configuration because the Gradle wrapper distribution and required offline
  plugin metadata were unavailable. The Kotlin tests remained authored but
  unexecuted.

Phase 2 Android implementation progress, 2026-07-29:

- Added the Compose Voice Dock in `ui/conversation/VoiceDock.kt`, with separate
  grip and microphone gesture targets, press-and-hold and persistent tap modes,
  screen-reader actions, timer/level/status/error feedback, cancellation, haptics,
  first-use guidance, docking, and placement reset.
- Added `VoiceDockController.kt` to own exactly one application PCM recorder and
  paired upload client, finish transcription only after recorder release, cancel
  on backgrounding, and return text to the editable composer without sending.
- Wired the dock into `ChatScreen.kt` and `ChatScreenInput.kt`, including runtime
  microphone permission handling, connection preflight, legacy recognizer
  preservation while disabled, and restored floating state.
- Added portrait/landscape position, gesture-mode, onboarding, floating-state,
  and feature preferences to `PreferenceStore.kt`, plus a Voice Dock toggle in
  Android's voice/notification settings.
- Added focused JVM coverage for user-visible dock state labels. Existing
  placement, PCM recorder, upload-client, event-parser, and contract tests remain
  part of the Android suite.
- Android compilation and test execution remain blocked before project
  configuration. The Gradle distribution is now locally present, but the Foojay
  and Android Gradle plugin resolution metadata required by the offline sandbox
  is unavailable. A temporary local resolution shim was removed after proving it
  could not safely reconstruct AGP's transitive classpath.
- Desktop regression validation for this slice: 34 focused voice tests passed,
  TypeScript typecheck passed, repository ESLint passed with two unrelated
  existing warnings, Electron production build passed, and `git diff --check`
  passed.
- The full Vitest run passed 1,497 of 1,502 executed tests. Five unrelated
  existing tests failed (motion-policy, build-handler, two timing-sensitive
  suites, and quiz artifact behavior), and three existing CLI suites could not
  load because their `child_process` mocks do not export `execFile`.

### Phase 3 — Unified spoken playback and normal-turn recaps

Goal: replace raw, fragmented TTS behavior with one spoken-output system.

Tasks:

- [x] Refactor Android playback into one controller/service.
  - [x] Route chat response, Quick Recap, and notification-summary playback
    through `NexySpeechService`.
  - [x] Move interactive Teachback prompt playback to the unified service.
- [x] Add desktop installed-voice playback controller.
- [x] Add voice, rate, pitch, offline-only, and auto-play settings.
  - [x] Desktop: persist and expose installed voice, rate, pitch, offline-only,
    and auto-play preferences in the shared playback surface.
  - [x] Android: expose the matching preferences through the unified service and
    settings UI.
- [x] Add pause/resume/stop/replay and Android notification actions.
  - [x] Desktop: add accessible pause, resume, stop, and replay controls beside
    the active assistant response.
  - [x] Android: add matching playback and notification actions.
- [x] Stop desktop playback when a new recording begins.
- [x] Add deterministic Quick Recap without a second model request.
- [x] Move `fcm-sender.ts` spoken-summary logic behind the common service.
- [x] Add optional AI-quality recap for normal messages.
- [x] Persist spoken outputs against messages.

Exit criteria:

- Code blocks, commands, URLs, and Markdown syntax are not read literally in a
  recap.
- Playback interruption behaves the same from chat and Conversation Mode.
- Android releases audio focus correctly.
- No second model request occurs for Quick Recap.
- AI-quality recap is visibly labelled as provider/CLI usage.

Phase 3 desktop progress, 2026-07-29:

- Added the shared speech sanitizer, deterministic Quick Recap builder, and
  bounded persistent settings contract in `src/renderer/lib/spoken-output.ts`.
- Added one installed-voice playback controller in
  `src/renderer/hooks/useSpokenOutput.ts`, including local-voice filtering,
  pause/resume/stop/replay, stale-event isolation, and cleanup on unmount.
- Added Read response and Quick Recap actions to assistant messages plus a
  compact, accessible playback/settings surface in
  `src/renderer/components/chat/SpokenOutputControls.tsx`.
- Wired optional autoplay and automatic playback interruption on microphone
  recording through `ChatWindow.tsx`.
- Focused validation passed 35 tests. TypeScript typecheck, repository ESLint,
  Electron production build, and `git diff --check` passed. The full suite passed
  1,504 tests; five unrelated existing tests failed and three existing CLI suites
  could not load because their `child_process` mocks omit `execFile`.
- Android unit/build execution remains blocked before project configuration:
  local Gradle 9.4.1 starts, but cannot resolve the uncached Foojay settings
  plugin while network access is denied.

Phase 3 Android progress, 2026-07-29:

- Added a single action-driven foreground playback service for chat responses,
  deterministic Quick Recaps, and notification summaries. The service exposes
  play, pause, resume, stop, and replay commands to both the in-chat surface and
  media-style notification actions.
- Added the matching speech sanitizer and deterministic Quick Recap policy,
  excluding fenced/inline code, command lines, URLs, images, links, and Markdown
  markers before Android TTS receives text.
- Added persistent installed-voice, rate, pitch, offline-only, and autoplay
  preferences to Android settings. Offline-only selection rejects voices that
  report a network requirement.
- Replaced the chat-owned `TextToSpeech` instance with Read response and Quick
  Recap actions plus compact active-message playback controls. Starting Voice
  Dock recording stops active speech first.
- Routed Teachback prompt playback through the same service and stop playback
  before Teachback launches speech recognition.
- Corrected audio-focus ownership by retaining and abandoning the exact
  `AudioFocusRequest`, pausing on transient loss, resuming on gain, and releasing
  focus on pause, stop, completion, failure, and service destruction.
- Four focused Kotlin policy tests passed via the cached Kotlin compiler and
  JUnit runtime. Full Android compilation and Compose/device validation remain
  open because Gradle cannot resolve the Foojay settings plugin offline.
- Desktop regression validation passed 35 focused tests, TypeScript typecheck,
  repository ESLint with two unrelated warnings, Electron production build, and
  `git diff --check`. The full Vitest suite passed 1,504 tests; five unrelated
  existing tests failed and three existing CLI suites could not load because
  their `child_process` mocks omit `execFile`.

Phase 3 shared recap and persistence completion, 2026-07-29:

- Added the process-neutral spoken-output sanitizer, deterministic recap policy,
  output kinds, and generation metadata in `src/shared/spoken-output.ts`.
- Added append-only migration 84 and the `message_spoken_outputs` table. Spoken
  text is keyed to its assistant message, updated without editing chat history,
  and deleted by foreign-key cascade with its source message.
- Added one backend service for deterministic output persistence and optional
  provider/Claude CLI recaps. AI Recap considers only the selected completed
  assistant message, sanitizes provider output before storage and playback, and
  records whether the provider or CLI generated it plus the model identifier.
- Routed `fcm-sender.ts` notification summaries through that service and changed
  notification scope from the whole conversation to the latest completed
  assistant turn.
- Added matching desktop and paired-Android AI Recap actions. Both surfaces
  explicitly label the action as provider/CLI usage and show the actual model
  with active playback. Desktop and paired Android Read/Quick Recap actions also
  persist their deterministic speech-safe forms through the common table.
- Focused main/renderer validation passed 56 tests. TypeScript typecheck,
  repository ESLint (two unrelated warnings), Electron production build, and
  `git diff --check` passed. The full Vitest suite passed 1,510 tests; five
  unrelated existing tests failed and three existing CLI suites could not load
  because their `child_process` mocks omit `execFile`.
- The Android platform-neutral spoken-output policy passed four JUnit tests via
  the cached Kotlin compiler. Full Gradle configuration remains blocked because
  the Foojay settings plugin is unavailable in the offline sandbox, so Compose
  and device validation remain open.

### Phase 4 — Conversation Mode persistence and bounded retrieval

Goal: create a durable, project-scoped, evidence-based read-only session.

Tasks:

- [x] Add append-only database migrations.
- [x] Add Conversation Mode session CRUD and project ownership checks.
- [x] Add bounded candidate search across session, chats, summaries, wiki,
  artifacts, and active turns.
- [x] Add ranking, hydration, deduplication, budget accounting, and one refinement
  pass.
- [x] Add source handles and evidence-state calculation.
  - [x] Persist project-validated source handles and reload deleted sources as
    unavailable without losing their title/excerpt.
  - [x] Calculate evidence state from retrieval/model outcomes.
- [x] Add structured answer parser and fallback.
- [x] Persist turns, spoken answers, sources, and retrieval statistics.
- [x] Add desktop IPC and Android WebSocket commands/events.
  - [x] Add session create/get/list/update/delete IPC and authenticated WebSocket
    commands, plus matching Android models, parser events, and repository calls.
  - [x] Add turn lifecycle, retrieval progress, answer, interruption, and
    cancellation commands/events.

Exit criteria:

- An out-of-project source can never be hydrated by ID.
- The maximum search-round and evidence budgets are enforced in tests.
- Answers retain navigable sources after restart.
- Active work is never represented as completed work.
- Deleted sources show a graceful unavailable state.
- A malformed model result still yields a safe visual answer and conservative
  spoken result.

Phase 4 persistence and session transport progress, 2026-07-29:

- Added append-only migration 85 with `conversation_mode_sessions`,
  `conversation_mode_turns`, and `conversation_mode_sources`, project/turn
  indexes, foreign-key cascades, and stable non-foreign-key source handles for
  graceful deleted-source rendering.
- Added a shared session/scope/turn/source contract and recognized
  `project-conversation-mode` as a conversation kind on desktop and Android.
  Unsaved voice sessions are filtered from ordinary desktop and Android chat
  lists while remaining real project conversations.
- Added transactional session CRUD and turn persistence in
  `src/main/conversation-mode.ts`. Selected chat scopes, turn messages, and
  every chat/message/wiki/artifact/active-turn source are checked against the
  owning project before storage; reload re-checks source ownership/existence
  before making a source navigable.
- Added typed Electron IPC/preload methods and authenticated Android WebSocket
  session commands. Android now has matching wire models, parser events,
  repository calls, and parser tests for persisted turns and unavailable
  sources.
- Focused desktop validation passed 46 tests. TypeScript typecheck, repository
  ESLint (two unrelated existing warnings), Electron production build, and the
  focused database/session/contract/preload suites passed.
- The full Vitest suite passed 1,516 tests; five unrelated existing tests
  failed and three existing CLI suites could not load because their
  `child_process` mocks omit `execFile`.
- Android test execution remains blocked before project configuration because
  the Foojay settings plugin is unavailable in the offline sandbox. The locally
  installed Gradle 9.4.1 distribution was invoked directly and reproduced that
  configuration-stage blocker.
- Added `conversation-mode-retrieval.ts` with saved-scope enforcement, bounded
  SQL previews, deterministic lexical/title/phrase/recency/type ranking,
  selected-chat and session-history boosts, project-owned hydration, stable
  source handles, overlapping-source deduplication, and hard conversation,
  source-type, message, excerpt, evidence-character, round, and wall-clock
  budgets. Caller overrides may lower but cannot raise application limits.
- Added one optional local refinement callback. It can run only after inadequate
  first-round evidence, cannot alter scope or budget, and consumes the one
  remaining search round. Active snapshots are explicitly labelled partial,
  failed, or awaiting persisted verification rather than being presented as
  completed work.
- Retrieval and persistence tests now cover cross-project exclusion, attempts to
  widen a saved scope, all hard budget families, one-pass refinement,
  cross-round deduplication, timeout fallback, active-work semantics, and durable
  ephemeral active-turn handles. The focused Conversation Mode/database/contract
  set passed 54 tests; typecheck, lint (two unrelated existing warnings),
  Electron production build, and `git diff --check` passed.
- The full Vitest suite passed 1,524 tests. Five unrelated existing tests failed
  and three existing CLI suites could not load because their `child_process`
  mocks omit `execFile`.
- Added `conversation-mode-answer.ts` with one-request visual/spoken answer
  prompts, strict JSON-envelope validation, known-handle enforcement,
  speech-safe local fallback, and conservative evidence-state calculation for
  empty, truncated, conflicting, active, failed, and answer-error outcomes.
- Added `conversation-mode-runner.ts` with durable user/assistant messages,
  retrieval/source/answer progress events, exactly one provider answer request,
  atomic answer/turn/source persistence, per-session concurrency protection, and
  cancellation/interruption that discards late provider results. Current-turn
  user messages are explicitly excluded from retrieval so a question cannot
  cite itself as supporting evidence.
- Added typed desktop send/stop methods and state/source/complete/error event
  subscriptions. Authenticated Android WebSocket send/stop commands now mirror
  the same lifecycle, including cancellation versus interruption, and Android
  has matching repository methods, wire models, parser branches, and parser
  coverage.
- The answer/lifecycle/session/retrieval/contract focused set passed 48 tests.
  TypeScript typecheck, ESLint (two unrelated existing warnings), and the
  Electron production build passed. The full Vitest suite passed 1,535 tests;
  four unrelated existing tests failed and three existing CLI suites could not
  load because their `child_process` mocks omit `execFile`.
- Android Gradle remains blocked before Kotlin compilation: the wrapper cannot
  download Gradle in the restricted environment, and the installed Gradle
  distribution cannot resolve the uncached Foojay settings plugin offline.

### Phase 5 — Conversation Mode desktop UI

Goal: provide the complete desktop experience.

Tasks:

- [x] Add project-first entry flow and current-project shortcut.
- [x] Add panel, scope bar, transcript, sources, status, playback, and stop
  actions.
- [x] Add selected-chat narrowing and ambiguity resolution.
- [x] Wire source navigation to chat, message, wiki, and artifact surfaces.
- [x] Add follow-up history and entity reference display.
- [x] Add save/archive/discard session actions.
- [x] Add keyboard shortcut and focus management.

Exit criteria:

- A user can complete the full flow without touching the mouse.
- Closing and reopening restores the session and scope.
- Streaming events from an older turn cannot overwrite the current turn.
- Source navigation lands on the correct surface and message where supported.

Implementation notes (2026-07-29):

- Added a lazy-loaded, resizable desktop Conversation Mode panel with a
  project-first picker, current-chat shortcut, `Ctrl+Shift+V` entry, focus trap,
  Enter-to-send, and durable last-session restoration per project.
- The shared session scope is visible and editable. Users can search all chats
  or an explicit chat selection, include or exclude wiki, artifacts, and active
  work, choose response style and auto-speak, and open scope controls directly
  from a model ambiguity suggestion.
- Durable turns reload as a follow-up transcript with evidence state, entity
  source cards, dedicated spoken answers, active retrieval/answer status,
  cancellation, Voice Dock transcription, and playback pause/resume/stop.
- Saved sessions can be switched, closed without deletion, archived through
  the existing conversation completion path, or explicitly discarded after
  confirmation.
- Conversation retrieval now retains a relevant message handle for hydrated
  chats. Source actions route to the chat and message anchor, project wiki, or
  artifact panel; ChatWindow temporarily suppresses auto-follow while centering
  and focusing a referenced message.
- Event handling admits a turn only from its initial retrieval event and then
  matches every source, status, completion, and error event to that turn.
  Finished and older turn IDs cannot overwrite the active UI.
- Focused Conversation Mode UI/retrieval tests passed 12 tests. The broader
  Conversation Mode, ChatWindow, Voice Dock, and spoken-output regression set
  passed 103 tests. TypeScript typecheck, ESLint (two unrelated existing
  warnings), Electron production build, and `git diff --check` passed.
- The full Vitest suite passed 1,539 tests. Five unrelated existing tests
  failed and three existing CLI suites could not load because their
  `child_process` mocks omit `execFile`.

### Phase 6 — Conversation Mode Android UI and parity

Goal: provide the same functional contract in an adaptive Android surface.

Tasks:

- [x] Add modal-sheet/full-screen Conversation Mode.
- [x] Add project and optional-chat selection.
- [x] Add compact/collapsed Voice Dock continuity.
- [x] Add transcript, source cards, status, playback, and stop actions.
- [x] Add source deep links and back-stack restoration.
- [x] Add offline/disconnected states.
- [x] Add process-death-safe session reload.

Exit criteria:

- Android and desktop use identical scope and evidence semantics.
- Rotating, backgrounding, and restoring the app do not lose completed turns.
- Disconnect during upload or retrieval produces a recoverable state.
- Source cards reopen the correct chat/wiki/artifact destination.

Implementation and verification notes (2026-07-29):

- Android uses the same persisted session, scope, turn, source, evidence-state,
  and spoken-answer wire models as desktop. The adaptive route is full-screen
  on compact devices and a modal side sheet on wider configurations.
- Home offers a project-first entry point, and project chats offer a narrowed
  current-chat entry point. Scope changes persist through the shared backend.
- The ViewModel stores the selected project/session in `SavedStateHandle`,
  reloads authoritative completed turns and their message transcript after
  recreation or reconnect, and rejects late events from other sessions/turns.
- Conversation Mode reuses the application-owned Voice Dock recorder and the
  shared foreground speech service. Recording remains editable draft input and
  never auto-sends.
- Source routing now restores exact chat-message, wiki-entry, and artifact
  destinations; normal navigation back-stack behavior returns to the live
  Conversation Mode session.
- Six platform-neutral Android lifecycle/routing tests passed through the
  cached Kotlin compiler and JUnit runtime. They cover stale-event isolation,
  completed-turn reload, disconnect/reconnect recovery, accepted completion,
  source routing, and durable selection after archive/discard.
- Focused shared/backend/desktop Conversation Mode tests passed 32 tests.
  TypeScript typecheck, ESLint (two unrelated existing warnings), Electron
  production build, and `git diff --check` passed.
- The full Vitest suite passed 1,540 tests. Four unrelated existing tests
  failed and three existing CLI suites could not load because their
  `child_process` mocks omit `execFile`. The Android no-motion policy test no
  longer reports the Conversation Mode screen; its two existing violations
  remain in `ChatScreenComponents.kt` and `ConnectionStatusIndicator.kt`.
- Android Gradle configuration still cannot reach Kotlin/Compose compilation:
  the wrapper distribution and Foojay/Android plugin metadata are unavailable
  offline. Physical rotation, background, and source-navigation acceptance
  checks therefore remain part of the Phase 7 device hardening gate.

Phase 6 model/UI parity follow-up, 2026-07-30:

- Android Conversation Mode now reuses the ordinary chat `ModelPickerSheet`,
  including the same searchable vendor-grouped model catalog and CLI
  availability. The selected model and backend survive recreation through
  `SavedStateHandle` and travel together on every turn.
- Model-list events now identify a CLI model's backend. The trusted desktop
  runner executes explicit Claude CLI, Codex CLI, or Hermes selections through
  the matching installed adapter instead of misrouting them to an API
  provider. When the default provider has no API key, Conversation Mode falls
  back to an available desktop CLI before returning the existing setup error.
- The compact Android header controls are grouped into a consistent two-column
  panel: scope/model, response style/auto-speak, and archive/discard actions
  share alignment, height, spacing, and truncation behavior.
- Focused model-routing, lifecycle, contract, and accessibility validation
  passed 15 tests. TypeScript typecheck, repository lint (the same two existing
  warnings), Electron production build, and `git diff --check` passed.
- Nexy's actual Settings build path completed signed `assembleRelease` in
  2m37s, including Kotlin/Compose compilation, release lint, signing validation,
  and APK packaging. The standalone shell still cannot start Gradle tests
  because its wrapper/Foojay resolution is blocked by the network sandbox.

### Phase 7 — Hardening, rollout, and observability

Goal: prove safety, reliability, performance, and usability before default-on
release.

Tasks:

- [x] Run database migration and downgrade/older-client compatibility checks.
- [x] Load test search across large projects.
- [ ] Measure voice upload and transcription latency on LAN and VPN/Tailscale.
- [ ] Test low-memory, low-storage, background, lock-screen, and audio-focus cases.
- [x] Add privacy documentation and settings descriptions.
- [x] Add feature-flag rollout and rollback.
- [x] Add debug export containing state timings, counts, and error codes only.
- [ ] Conduct UI parity and accessibility review.
- [ ] Remove duplicate legacy TTS paths only after rollout is stable.

Phase 7 implementation record, rollout/observability slice:

- `voice-rollout.ts` makes the completed voice features default-on while treating
  an explicitly persisted `false` as an immediate, restart-safe rollback. The
  Conversation Mode switch is enforced by both Electron IPC and authenticated
  Android WebSocket commands; it is not merely a hidden renderer control.
- Desktop General settings and Android voice/notification settings now use the
  same privacy and fallback language. Disabling Conversation Mode immediately
  leaves standard chat and the original microphone path available.
- The Android connection handshake now carries a versioned `VoiceCapabilities`
  payload. New Android clients interpret a missing payload from an older desktop
  conservatively and do not expose an unsupported entry point.
- `conversation-mode-observability.ts` aggregates state timings, retrieval
  counts, fallbacks, cancellations/interruption, and normalized error codes.
  The exported schema contains no fields for audio, transcripts, answers,
  excerpts, prompts, names, paths, or message/session/turn IDs.
- The complete privacy statement is recorded in
  `docs/voice-conversation-mode-privacy.md`.
- Focused rollout, observability, runner, settings, preload, contract, and panel
  suites passed 41 tests. TypeScript typecheck, repository lint (with the same
  two unrelated warnings), the Electron production build, and
  `git diff --check` passed.
- The full Vitest baseline passed 1,544 tests. Three unrelated existing test
  failures remain (including the policy test that reports the same two Android
  visual-motion findings), along with the three existing CLI mock suite-load
  failures; the new rollout and observability suites are green.
- Android Gradle remains blocked before Kotlin/Compose compilation: the wrapper
  cannot download Gradle in the restricted environment, and the installed
  Gradle 9.4.1 distribution cannot resolve the uncached Foojay settings plugin
  in offline mode. Capability parser coverage was added to the Android unit
  suite for execution when that dependency boundary is available.

Phase 7 implementation record, compatibility/load slice:

- The migration suite now creates a real v84 database with existing project,
  chat, and message data, upgrades it through migration 85, and verifies the
  original data remains intact. It then exercises the database with the v84
  migration set to model an older client opening the newer database: ordinary
  chat writes still succeed and the v85 Conversation Mode rows remain intact.
- Candidate discovery now applies project ownership, search predicates, bounded
  previews, and per-source row limits inside SQLite. Conversation hydration also
  scans at most 120 matching messages instead of loading an entire long-running
  chat into process memory. Existing hard limits on ranked conversations,
  hydrated source families, excerpt size, evidence size, rounds, and wall-clock
  time remain authoritative.
- The repeatable large-project test dataset contains 2,000 chats and 20,000
  messages, deliberately places the relevant decision in an old chat, and runs
  retrieval five times. Its agreed local gate is P95 below 2,000 ms while still
  finding the old source and respecting candidate/evidence caps.
- The compatibility and retrieval suites passed 27 tests; the broader
  Conversation Mode, migration, rollout, renderer-contract, and panel selection
  passed 53 tests. TypeScript typecheck, repository lint (with the same two
  unrelated warnings), Electron production build, and `git diff --check`
  passed.
- The full Vitest baseline passed 1,545 tests. Four unrelated existing failures
  remain (the two known Android visual-motion findings, mobile package-version
  mocking, quiz regeneration, and one workflow test timing out under the full
  parallel load), together with the three existing CLI mock suite-load failures.

Phase 7 implementation record, accessibility/parity slice:

- Desktop progress is now an explicit polite, atomic status region and retrieved
  evidence is exposed as a named source group. Existing dialog, focus-trap,
  keyboard, field, playback, stop, and error semantics remain intact.
- Android now uses the same progress and evidence vocabulary as desktop. The
  screen title and source list expose heading semantics, progress is a polite
  live region, and source cards describe their destination or unavailable state.
  Evidence and fixed-scope badges are no longer focusable controls with no
  action.
- The cross-platform interaction and terminology review, implemented checks,
  and remaining Narrator/NVDA, TalkBack, zoom/font-size, switch-access, and
  contrast acceptance steps are recorded in
  `docs/voice-conversation-mode-accessibility-review.md`.
- The focused desktop interaction suite passed 4 tests; three source-policy
  tests enforce live progress, grouped evidence, non-focusable status badges,
  and shared evidence vocabulary. TypeScript typecheck, repository lint (with
  the same two unrelated warnings), the Electron production build, and
  `git diff --check` passed.
- The full Vitest baseline passed 1,546 tests. Three unrelated existing tests
  failed (the two known Android visual-motion findings, mobile package-version
  mocking, and quiz regeneration), together with the three existing CLI
  mock suite-load failures.
- Android Gradle remains blocked before Kotlin/Compose compilation because the
  wrapper distribution and Foojay/plugin metadata are not available offline.
  The UI parity/accessibility task therefore remains unchecked until the
  platform-neutral vocabulary test and the manual assistive-technology matrix
  can be executed on Android.

Exit criteria:

- No known temporary-audio leak.
- No project-scope leakage in adversarial ID and prompt tests.
- P95 retrieval stays within the agreed latency and evidence budget on the test
  dataset.
- Crash-free and error-rate targets are met during staged rollout.
- The original microphone path remains available as rollback until the new
  recorder is proven.

### Phase 8 — Deferred extensions

These are explicitly not part of the first production release:

- downloadable native Whisper on standalone Android;
- project-file retrieval;
- explicit web search;
- cross-project comparison;
- Action Mode with confirmations;
- background hotword or always-listening behavior;
- Android system-wide overlay;
- real-time streaming transcription;
- speaker diarization;
- cloud TTS providers;
- automatic wiki updates;
- proactive completion announcements from multiple active chats.

Each extension requires its own privacy, cost, permission, and performance
review.

## Testing strategy

### Main-process unit tests

- Scope rejects conversations, wiki entries, artifacts, and messages from other
  projects.
- Budget counters cannot exceed configured limits.
- Refinement executes at most once.
- Candidate ranking gives selected chats and exact title matches appropriate
  priority.
- Duplicate excerpts collapse.
- Source handles are validated against the hydrated set.
- Evidence states map correctly.
- Structured-output fallback is safe.
- Persistence transactions roll back fully on failure.
- Temporary upload sessions clean up on every terminal path.
- WAV validation rejects malformed and oversized input.
- Existing Electron IPC transcription and new WebSocket transcription call the
  same Whisper function.

### Renderer tests

- Voice state transitions.
- Hold/release/cancel gestures.
- Drag grip does not record.
- Position clamping and reset.
- Scope selection and ambiguity UI.
- Late-event isolation by session/turn ID.
- Source rendering and navigation.
- Playback controls and interruption.
- Feature-flag fallback.
- Keyboard and ARIA behavior.

### Android unit tests

- Recorder state reducer.
- WebSocket event parser for every new event.
- Upload sequence/retry/cancel logic.
- ViewModel session and turn isolation.
- Scope ownership errors.
- Rotation/process recreation state restoration.
- TTS controller state and audio-focus handling.
- Settings serialization and position normalization.

### Android instrumentation tests

- Long press survives silence and releases once.
- Cancel target discards.
- Dock drag and edge clamping.
- IME and system-inset avoidance.
- Sheet expand/collapse continuity.
- Notification playback controls.
- TalkBack labels and focus order.

### Integration tests

- Android capture → chunk upload → desktop Whisper → transcript insertion.
- Desktop and Android open the same Conversation Mode session.
- Project selection and source retrieval remain synchronized.
- Active-turn answer distinguishes running from completed.
- Restart restores transcript and sources.
- Old Android client ignores unknown server events safely.
- New Android client handles older desktop capability negotiation.

### Manual matrix

Platforms:

- Windows desktop;
- macOS desktop where available;
- Linux desktop where available;
- Android API 26 minimum;
- Android current stable;
- small, medium, and flagship Android hardware.

Scenarios:

- quiet room;
- long pause;
- background noise;
- Bluetooth headset;
- wired headset;
- phone call interruption;
- app background/foreground;
- lock screen during playback;
- connection loss during upload;
- connection loss during answer generation;
- portrait/landscape;
- large font and display scaling;
- light/dark theme;
- reduced/no motion;
- offline installed TTS voice;
- no suitable TTS voice;
- Whisper not installed on desktop.

## Verification gates

Every implementation slice must pass:

```text
npm run typecheck
npm run lint
npm test
android\gradlew.bat testDebugUnitTest
android\gradlew.bat assembleDebug
```

Additional gates:

- focused Vitest files for retrieval, persistence, upload, and IPC;
- Android parser/reducer/unit suites for protocol additions;
- manual cross-platform visual comparison;
- physical-device audio test;
- accessibility pass;
- repository's Nexy application smoke-check workflow after each UI adoption
  phase.

## Performance and reliability targets

Initial targets:

- Dock interaction feedback: under 100 ms.
- Recording start confirmation: under 250 ms after permission is granted.
- No duration loss caused by silence.
- Upload memory: bounded by chunk size, not total recording length.
- Transcription begins within 500 ms of validated upload completion on LAN.
- Retrieval: maximum two rounds, hard 15-second application budget before
  returning best available evidence.
- UI remains responsive while recording, uploading, searching, and speaking.
- No transcript is sent automatically.
- No audio persists after terminal cleanup.

Latency from local Whisper inference depends on model and hardware, so the UI
must show real state and allow cancellation rather than promising a fixed
transcription time.

## Privacy and security

- The microphone is active only during an explicit user gesture or tap-to-toggle
  session.
- A persistent visible recording state is mandatory.
- Audio upload uses the existing authenticated TLS WebSocket.
- Upload IDs are random, short-lived, and bound to the requesting connection.
- Audio is written only under an application temporary directory.
- Temporary files are removed on success, failure, cancel, disconnect, timeout,
  and startup orphan cleanup.
- Audio and transcript text are excluded from diagnostic logs.
- Retrieval SQL always includes project ownership checks.
- Model prompts contain only hydrated, in-scope evidence.
- Source excerpts are minimized.
- The user can discard a temporary Conversation Mode session.
- No external web or cloud speech call occurs in the first release unless the
  user separately enabled an AI-quality recap through an existing provider.
- Conversation Mode never exposes chain-of-thought; it presents outcomes and
  evidence only.

## Capability negotiation and compatibility

Desktop advertises:

```ts
interface VoiceCapabilities {
  protocolVersion: 1
  audioUpload: boolean
  localWhisperReady: boolean
  conversationMode: boolean
  spokenOutputPersistence: boolean
  maxAudioBytes: number
  maxRecordingSeconds: number
}
```

Android behavior:

- If upload and local Whisper are available, show "Desktop Whisper".
- If connected but Whisper is unavailable, explain how to configure it and
  offer system dictation fallback.
- If disconnected, retain system dictation and local TTS.
- Unknown capability fields are ignored.
- Unknown events do not break parsing or connection.

Desktop behavior:

- It accepts older clients without the new commands.
- It rejects unsupported upload protocol versions with a typed error.
- It cleans up abandoned sessions from disconnected or upgraded clients.

## Metrics and diagnostics

Collect locally:

- time in each state;
- recording duration;
- upload bytes and duration;
- transcription backend and duration;
- retrieval rounds;
- candidate/hydrated source counts;
- evidence characters;
- answer duration;
- structured-output fallback count;
- interruption and cancellation count;
- error codes;
- source-open action count.

Do not collect:

- raw audio;
- transcript text;
- answer text;
- excerpts;
- project names;
- file paths;
- message IDs in exported diagnostics unless explicitly requested.

Suggested debug event shape:

```ts
interface ConversationModeDiagnostic {
  sessionHash: string
  turnHash: string
  state: string
  durationMs?: number
  count?: number
  code?: string
  timestamp: number
}
```

## Acceptance criteria for the first production release

The release is complete when all of the following are true:

1. Android press-and-hold recording continues until release despite pauses.
2. The floating microphone is draggable, accessible, semi-transparent, safely
   clamped, and persistent on both platforms.
3. Transcription inserts an editable draft and never auto-sends.
4. Paired Android can use desktop local Whisper without a paid speech service.
5. Desktop and Android share the same voice and Conversation Mode states.
6. Conversation Mode requires and visibly displays one project.
7. Conversation Mode searches only session history, selected project chats,
   summaries, wiki, artifacts, and active work.
8. Every retrieval turn respects hard round, source, character, and time
   budgets.
9. Every answer records navigable source references and an evidence state.
10. Active work is clearly distinguished from completed work.
11. Conversation Mode is read-only.
12. `answerText` and `spokenAnswer` are generated together.
13. Spoken output does not read code, commands, URLs, Markdown, or raw tool
    output literally.
14. Playback can pause, resume, stop, replay, and be interrupted by the
    microphone.
15. Installed OS voices provide the default free TTS path.
16. Temporary audio is deleted on all terminal paths.
17. Sessions, turns, sources, and spoken output survive restart.
18. Desktop/Android source navigation and visual parity pass manual review.
19. All automated verification gates pass.
20. Feature flags permit safe rollback to the existing microphone and chat
    experience.

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Long Android recordings consume memory | Stream bounded chunks to a temp file; never retain the whole recording in UI state |
| Local Whisper is slow on some desktops | Show state and timer, support cancel, document model choice |
| WebSocket drops mid-upload | Sequence chunks, type errors, delete partial file, allow retry |
| Model cites a source it did not receive | Stable handles plus post-generation validation |
| Cross-project leakage | Ownership filters during candidate collection and hydration |
| Search quality is weak with lexical ranking | Selected-source boost, summaries, one bounded refinement; measure before adding embeddings |
| Search becomes expensive on large projects | Candidate caps, excerpt caps, indexes, timing diagnostics |
| Spoken output sounds unnatural | Same-turn dedicated spoken field, installed voice picker, speed control |
| TTS reads sensitive or unsuitable text | User-triggered default, explicit auto-play settings, sanitization |
| Voice gesture excludes some users | Tap-to-toggle alternative and placement presets |
| Dock covers content | Opacity, drag grip, safe-area clamping, dock/reset actions |
| Action-like wording causes mutation | First release has no mutation capabilities |
| `ws-handlers.ts` grows further | Put domain logic in dedicated modules with a thin command bridge |
| Desktop and Android drift | Shared terminology/contracts, parity tests, paired visual acceptance |
| Schema changes break older clients | Additive migrations and capability negotiation |

## Explicit non-goals for version 1

- Replacing normal text chat.
- Always listening in the background.
- Wake-word detection.
- Floating above other Android applications.
- Real-time word-by-word transcription.
- Autonomous project modification.
- Hidden cross-project retrieval.
- Unlimited deep research.
- External web browsing.
- Cloud speech subscriptions.
- Reading arbitrary tool output aloud.
- Persisting raw recordings.
- Exposing private model reasoning.

## Recommended implementation order

The dependency path is:

```text
Shared contracts
  → reliable recorder and reusable desktop Whisper
  → cross-platform Voice Dock
  → unified spoken playback
  → Conversation Mode persistence and retrieval
  → desktop Conversation Mode UI
  → Android Conversation Mode UI
  → hardening and staged rollout
```

Phase 1 is the highest-value starting point because it fixes the observed
Android failure independently of the larger retrieval feature. Phase 2 then
delivers the visible UI-unification milestone. Conversation Mode builds on the
same recorder, dock, state, and playback controllers rather than duplicating
them.

## Definition of done for the roadmap

This roadmap is ready to move from `roadmap-new` to `roadmap-in-progress` when:

- Phase 0 contracts and wireframes are accepted;
- the first implementation slice is assigned;
- database and WebSocket names are confirmed;
- the desktop-assisted Android transcription path is accepted as the first
  reliable backend;
- first-release source scope and read-only behavior remain unchanged;
- a rollout owner and physical Android test devices are identified.
