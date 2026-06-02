import { describe, expect, it } from 'vitest'
import { clearDirListingCache } from '../chat-handlers'

describe('directory listing cache', () => {
  it('clears without throwing', () => {
    expect(() => clearDirListingCache()).not.toThrow()
  })
})
