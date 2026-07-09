export const CHAT_REVEAL_TARGET_MS = 2800
export const CHAT_REVEAL_MIN_PER_FRAME = 2
export const CHAT_REVEAL_MAX_PER_FRAME = 64
// Markdown (ReactMarkdown + rehype-highlight) re-parses its entire input on every render,
// which is too expensive to run at the reveal animation's ~60fps cadence — throttling the
// content handed to it to this interval keeps re-parses cheap and avoids code-block flicker
// from repeatedly re-highlighting incomplete/unclosed fences mid-stream.
export const CHAT_MARKDOWN_THROTTLE_MS = 120

export interface ChatAnimationState {
  turnId: string | null
  authoritativeText: string
  displayedOffset: number
  lastSequence: number
}

export function createChatAnimationState(): ChatAnimationState {
  return { turnId: null, authoritativeText: '', displayedOffset: 0, lastSequence: 0 }
}

export function appendChatDelta(
  state: ChatAnimationState,
  event: { turnId: string; sequence: number; chunk: string },
): ChatAnimationState {
  if (state.turnId && state.turnId !== event.turnId) return state
  if (event.sequence <= state.lastSequence) return state
  return {
    ...state,
    turnId: event.turnId,
    authoritativeText: state.authoritativeText + event.chunk,
    lastSequence: event.sequence,
  }
}

export function snapChatAnimation(
  turnId: string,
  authoritativeText: string,
  lastSequence: number,
): ChatAnimationState {
  return {
    turnId,
    authoritativeText,
    displayedOffset: authoritativeText.length,
    lastSequence,
  }
}

export function revealFrameSize(
  backlog: number,
  frameMs = 1000 / 60,
  targetMs = CHAT_REVEAL_TARGET_MS,
): number {
  if (backlog <= 0) return 0
  const framesToTarget = Math.max(1, targetMs / frameMs)
  return Math.min(
    backlog,
    CHAT_REVEAL_MAX_PER_FRAME,
    Math.max(CHAT_REVEAL_MIN_PER_FRAME, Math.ceil(backlog / framesToTarget)),
  )
}
