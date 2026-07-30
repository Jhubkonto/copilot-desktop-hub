import { describe, expect, it } from 'vitest'
import { appendTranscriptToDraft } from '../lib/composer-draft'

describe('appendTranscriptToDraft', () => {
  it('inserts a normalized transcript without sending or replacing an existing draft', () => {
    expect(appendTranscriptToDraft('Keep this draft', 'new spoken text')).toBe(
      'Keep this draft new spoken text',
    )
    expect(appendTranscriptToDraft('Keep trailing layout\n\n', '  spoken text  ')).toBe(
      'Keep trailing layout spoken text',
    )
  })

  it('leaves the draft byte-for-byte unchanged when no transcript is produced', () => {
    expect(appendTranscriptToDraft('  Existing draft\n', '   ')).toBe('  Existing draft\n')
  })

  it('uses clean transcript text for an empty draft', () => {
    expect(appendTranscriptToDraft('', '  hello there  ')).toBe('hello there')
  })
})
