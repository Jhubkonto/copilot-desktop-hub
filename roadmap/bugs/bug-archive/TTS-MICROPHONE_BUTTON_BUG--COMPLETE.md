# Bug: Microphone (Voice Input) Button Does Nothing in Generator Chat Input Fields

## Summary

The microphone button renders in generator chat input fields on both desktop and Android, but pressing it produces no visible response — no recording starts, no error is shown, and no text is inserted.

## Root Cause Analysis

### Desktop (Electron)

The voice input stack is:

```
VoiceInputButton (renders button + icon)
  └─ calls toggleVoice() from useVoiceInput hook
       └─ start() → window.api.getVoiceStatus() → getUserMedia() → record → transcribeVoice()
```

**Likely causes (in priority order):**

1. **Generator pages never mount `useVoiceInput`** — The hook is wired in `ChatWindow.tsx` for the main chat, but generator-specific screens (Agents, Projects, Skills, Schedule generators) appear to have their own input components that render `VoiceInputButton` or a mic icon without connecting it to `useVoiceInput`. The `onToggleVoice` prop is either `undefined` or a no-op stub, so the click fires but nothing happens.

2. **Whisper not installed / silent failure** — `start()` calls `window.api.getVoiceStatus()` first. If Whisper is not configured, the current implementation may return early without surfacing any feedback to the user in the generator context (unlike `ChatWindow.tsx` which routes errors to a toast).

3. **`getUserMedia` permission denied** — If the microphone permission was never granted or was revoked, `getUserMedia()` rejects but the error callback is not connected in the generator context.

### Android

The voice input stack is:

```
OnDeviceVoiceButton (IconButton)
  └─ calls voice.toggle() from rememberOnDeviceVoiceInput hook
       └─ SpeechRecognizer → onResults → onText callback
```

**Likely causes:**

1. **Generator screens pass no `onVoiceInput` callback** — `ChatScreen.kt` wires up `rememberOnDeviceVoiceInput` with an `onText` lambda that appends text to the input and updates the draft. Generator screens likely render the mic button from a shared composable but omit the equivalent setup, so `voice.toggle()` is either never called or does nothing because the listener is not registered.

2. **`RECORD_AUDIO` permission not requested** — Generator screens may not include the permission launcher setup that `ChatScreen.kt` has, causing silent failure on first use.

3. **On-device model not downloaded** — If the speech model download was never triggered from the main chat screen, the recognizer fails silently in generator screens.

## Affected Files

### Desktop
| File | Role | Issue |
|---|---|---|
| `src/renderer/hooks/useVoiceInput.ts` | Voice recording + transcription hook | Not mounted in generator contexts |
| `src/renderer/components/chat/VoiceInputButton.tsx` | Mic button UI | Renders but `onClick` prop is dead |
| `src/renderer/components/chat/ChatComposer.tsx` | Chat input used in main chat | Correctly wired; generators likely use a different input component |
| `src/renderer/components/ChatWindow.tsx` | Main chat screen | Reference implementation — wire generators to match |
| Generator screen components (e.g. `AgentChat.tsx`, `ProjectChat.tsx`, etc.) | Generator chat inputs | Missing `useVoiceInput` hook setup and error handling |

### Android
| File | Role | Issue |
|---|---|---|
| `android/.../OnDeviceVoiceInput.kt` | Voice recognition composable | Not mounted in generator screens |
| `android/.../ChatScreen.kt` | Main chat screen | Reference implementation |
| `android/.../ChatScreenInput.kt` | Shared input composable | Mic button renders but callback may not be provided |
| Generator screen Kotlin files | Generator chat inputs | Missing `rememberOnDeviceVoiceInput` setup |

## Fix Plan

### Step 1 — Identify all generator chat input components

Search for every screen/component that renders a mic/voice button outside of the main `ChatWindow.tsx` / `ChatScreen.kt`:

```
# Desktop
grep -r "VoiceInputButton\|onToggleVoice\|mic\|Mic" src/renderer --include="*.tsx" -l

# Android
grep -r "OnDeviceVoiceButton\|onVoiceInput\|voiceInput\|RECORD_AUDIO" android --include="*.kt" -l
```

### Step 2 — Desktop fix

For each generator screen that has a chat input:

1. Import and call `useVoiceInput` with both `onText` and `onError` handlers (matching the pattern in `ChatWindow.tsx:102-107`).
2. Pass `voiceState` and `onToggleVoice` down to the input component / `VoiceInputButton`.
3. Wire `onError` to show a toast (or whatever notification mechanism the generator screen uses).
4. If Whisper is not installed (`status.ready === false`), show the user an actionable message — either direct them to Settings → Voice or trigger the installer — instead of silently doing nothing.

**Reference implementation in `ChatWindow.tsx`:**
```typescript
const { voiceState, toggleVoice } = useVoiceInput({
  onText: (text) => { /* append to input */ },
  onError: (msg) => { /* show toast */ },
});
```

### Step 3 — Android fix

For each generator screen that has a chat input:

1. Call `rememberOnDeviceVoiceInput` at the screen composable level with `onText` and `onError` callbacks (matching `ChatScreen.kt:166-169`).
2. Pass the resulting `voiceInput` state down to `ChatScreenInput` (or equivalent) as the `onVoiceInput` lambda: `onVoiceInput = { voiceInput.toggle() }`.
3. Ensure `RECORD_AUDIO` is included in the permission launcher setup for the generator screen.
4. Check that model availability handling (download prompt) is triggered — reuse `OnDeviceVoiceInput.checkAndEnsureModel()` or equivalent.

**Reference implementation in `ChatScreen.kt`:**
```kotlin
val voiceInput = rememberOnDeviceVoiceInput(
  onText = { text -> input = if (input.isBlank()) text else "${input.trimEnd()} $text"; vm.setDraft(input) },
  onError = { message -> scope.launch { snackbarHostState.showSnackbar(message) } },
)
```

### Step 4 — Shared: better silent-failure feedback

In both platforms, if the voice system is not ready (Whisper not installed on desktop; model not downloaded on Android), the button should NOT silently do nothing. Instead:

- **Desktop**: Show a tooltip or small inline message: *"Voice input requires Whisper — go to Settings to set it up."*
- **Android**: Trigger the model download flow or show a snackbar with *"Downloading voice model…"* rather than doing nothing.

Consider disabling the button visually (`disabled` + tooltip) when the system is known-not-ready, so the user understands the state at a glance.

### Step 5 — Test

- [ ] Desktop: Press mic in each generator chat input → recording starts (red icon), speech is transcribed, text inserted.
- [ ] Desktop: Press mic when Whisper is not installed → user sees actionable error (not silence).
- [ ] Desktop: Deny mic permission → user sees error toast.
- [ ] Android: Press mic in each generator chat input → listening starts (red icon), speech is transcribed, text inserted.
- [ ] Android: First launch without model → download prompt appears.
- [ ] Android: Deny `RECORD_AUDIO` permission → user sees snackbar error.

## Priority

**High** — the button is visible and clickable but produces no feedback at all, which reads as a broken feature to users.
