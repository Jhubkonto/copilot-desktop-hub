import type { DiffHunk, DiffLine } from '../shared/types'

function buildLcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = a[i - 1] === b[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1])
    }
  }
  return table
}

function tracebackLcs(table: number[][], a: string[], b: string[]): DiffLine[] {
  const lines: DiffLine[] = []
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      lines.unshift({ type: 'context', lineNumber: { before: i, after: j }, content: a[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      lines.unshift({ type: 'added', lineNumber: { before: null, after: j }, content: b[j - 1] })
      j--
    } else {
      lines.unshift({ type: 'removed', lineNumber: { before: i, after: null }, content: a[i - 1] })
      i--
    }
  }
  return lines
}

function groupIntoHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = lines.map((line, index) => line.type === 'context' ? -1 : index).filter((index) => index >= 0)
  if (changed.length === 0) return []

  const ranges: Array<{ start: number; end: number }> = []
  let start = Math.max(0, changed[0] - context)
  let end = Math.min(lines.length - 1, changed[0] + context)
  for (const index of changed.slice(1)) {
    const nextStart = Math.max(0, index - context)
    if (nextStart <= end + 1) end = Math.min(lines.length - 1, index + context)
    else {
      ranges.push({ start, end })
      start = nextStart
      end = Math.min(lines.length - 1, index + context)
    }
  }
  ranges.push({ start, end })

  return ranges.map((range) => {
    const hunkLines = lines.slice(range.start, range.end + 1)
    const firstBefore = hunkLines.find((line) => line.lineNumber.before !== null)?.lineNumber.before ?? 1
    const firstAfter = hunkLines.find((line) => line.lineNumber.after !== null)?.lineNumber.after ?? 1
    const beforeCount = hunkLines.filter((line) => line.type !== 'added').length
    const afterCount = hunkLines.filter((line) => line.type !== 'removed').length
    return {
      header: `@@ -${firstBefore},${beforeCount} +${firstAfter},${afterCount} @@`,
      lines: hunkLines,
    }
  })
}

export function computeLineDiff(before: string, after: string): DiffHunk[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  return groupIntoHunks(tracebackLcs(buildLcsTable(beforeLines, afterLines), beforeLines, afterLines))
}
