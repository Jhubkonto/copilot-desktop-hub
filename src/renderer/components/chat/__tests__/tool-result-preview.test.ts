import { describe, expect, it } from 'vitest'
import { buildToolResultPreview } from '../tool-result-preview'

describe('buildToolResultPreview', () => {
  it('keeps collapsed processing bounded for very large results', () => {
    const result = `${Array.from({ length: 2000 }, (_, index) => `line ${index}`).join('\n')}\nfinal line`

    const preview = buildToolResultPreview(result)

    expect(preview.preview).toBe('line 0\nline 1\nline 2')
    expect(preview.truncated).toBe(true)
    // Counting every hidden line would require scanning the complete result.
    expect(preview.hiddenLineCount).toBe(0)
    expect(preview.remainder).toBe('')
    expect(preview.cleanedResult).toBeUndefined()
  })

  it('strips the complete result only for expanded content', () => {
    const result = 'first\nsecond\nthird\n\x1b[31mfourth\x1b[0m'

    const preview = buildToolResultPreview(result, true)

    expect(preview.cleanedResult).toBe('first\nsecond\nthird\nfourth')
    expect(preview.remainder).toBe('\nfourth')
  })
})
