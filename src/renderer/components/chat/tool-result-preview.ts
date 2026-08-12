import { stripAnsiEscapes } from '../../../shared/ansi'

// Keep the collapsed path bounded. In particular, do not split, strip, or diff a
// multi-hundred-KB tool result just to show the first few lines in the transcript.
export const RESULT_PREVIEW_LINES = 3
export const RESULT_PREVIEW_CHARS = 240
export const RESULT_MAX_CHARS = 2000
const RESULT_SCAN_CHARS = 4096

export interface ToolResultPreview {
  preview: string
  truncated: boolean
  remainder: string
  hiddenLineCount: number
  /** Only populated after the caller explicitly asks for expanded content. */
  cleanedResult?: string
}

/**
 * Builds the small transcript preview without touching the complete result unless
 * `fullyProcessed` is true (the expanded/details view). The exact hidden-line count
 * is retained for results that fit inside the bounded scan; larger results use the
 * generic "Show more" label because counting all lines would defeat the optimization.
 */
export function buildToolResultPreview(result: string, fullyProcessed = false): ToolResultPreview {
  const cleanedResult = fullyProcessed
    ? stripAnsiEscapes(result)
    : undefined
  const source = cleanedResult ?? stripAnsiEscapes(result.slice(0, RESULT_SCAN_CHARS))
  const sourceWasBounded = !fullyProcessed && result.length > RESULT_SCAN_CHARS
  const lines = source.split('\n')
  const lineLimited = lines.length > RESULT_PREVIEW_LINES
  let preview = lineLimited ? lines.slice(0, RESULT_PREVIEW_LINES).join('\n') : source
  const charLimited = preview.length > RESULT_PREVIEW_CHARS
  if (charLimited) preview = preview.slice(0, RESULT_PREVIEW_CHARS)

  const truncated = sourceWasBounded || lineLimited || charLimited
  const hiddenLineCount = !sourceWasBounded && lineLimited
    ? lines.length - RESULT_PREVIEW_LINES
    : 0

  let remainder = ''
  if (fullyProcessed && truncated && cleanedResult) {
    remainder = cleanedResult.slice(preview.length)
    if (remainder.length > RESULT_MAX_CHARS) {
      remainder = `${remainder.slice(0, RESULT_MAX_CHARS)}\n…(truncated)`
    }
  }

  return { preview, truncated, remainder, hiddenLineCount, cleanedResult }
}
