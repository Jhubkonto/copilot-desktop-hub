export function appendTranscriptToDraft(currentDraft: string, transcript: string): string {
  const normalizedTranscript = transcript.trim()
  if (!normalizedTranscript) return currentDraft
  if (!currentDraft.trim()) return normalizedTranscript
  return `${currentDraft.trimEnd()} ${normalizedTranscript}`
}
