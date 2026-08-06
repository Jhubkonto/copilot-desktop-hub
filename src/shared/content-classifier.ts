export type DominantType = 'code' | 'table' | 'math' | 'text'

export interface ContentHints {
  hasCode: boolean
  hasTable: boolean
  hasMath: boolean
  dominantType: DominantType
}

const CODE_FENCE = /^```/m
const TABLE_ROW = /^\|.+\|/m
const MATH_BLOCK = /\$\$[\s\S]+?\$\$/
const MATH_INLINE = /\$[^$\n]+\$/

export function classifyContent(text: string): ContentHints {
  const hasCode = CODE_FENCE.test(text)
  const hasTable = TABLE_ROW.test(text)
  const hasMath = MATH_BLOCK.test(text) || MATH_INLINE.test(text)

  let dominantType: DominantType = 'text'
  if (hasCode) dominantType = 'code'
  else if (hasTable) dominantType = 'table'
  else if (hasMath) dominantType = 'math'

  return { hasCode, hasTable, hasMath, dominantType }
}

const HEADING_LINE = /^#{1,3}\s+.+$/gm
const CODE_FENCE_BLOCK = /```[\s\S]*?```/g
const MIN_DOCUMENT_LENGTH = 400
const MIN_HEADING_COUNT = 2
const MAX_CODE_SHARE = 0.7

/**
 * Heuristic for "this response is a standalone document" (a report/plan/brief the
 * model wrote out inline) rather than a short reply or a code answer — used to decide
 * when to surface a prominent "Save as artifact" affordance instead of leaving the
 * content to live only as chat text.
 */
export function looksLikeStandaloneDocument(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < MIN_DOCUMENT_LENGTH) return false
  const headingCount = (trimmed.match(HEADING_LINE) || []).length
  if (headingCount < MIN_HEADING_COUNT) return false
  const codeFenceChars = (trimmed.match(CODE_FENCE_BLOCK) || []).join('').length
  if (codeFenceChars > trimmed.length * MAX_CODE_SHARE) return false
  return true
}
