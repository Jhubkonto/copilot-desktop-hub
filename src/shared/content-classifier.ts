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
