import { describe, expect, it } from 'vitest'
import { extractCitations, mergeCitations } from '../../shared/citations'
import type { Citation } from '../../shared/citations'

describe('structured citations', () => {
  it('extracts URL citation annotations without treating ordinary URLs as sources', () => {
    const citations = extractCitations({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'Answer CiteTurn1view0',
          annotations: [{ type: 'url_citation', id: 'CiteTurn1view0', title: 'Example', url: 'https://example.com/source' }],
        }],
      }],
      unrelated: { url: 'https://example.com/not-a-citation' },
    })

    expect(citations).toEqual([{
      id: 'CiteTurn1view0',
      url: 'https://example.com/source',
      title: 'Example',
    }])
  })

  it('merges repeated stream metadata by URL and keeps aliases', () => {
    const citations: Citation[] = []
    mergeCitations(citations, [{ id: 'source-1', url: 'https://example.com', title: 'Example' }])
    mergeCitations(citations, [{ id: 'CiteTurn1view0', url: 'https://example.com', aliases: ['source-1'] }])
    expect(citations).toEqual([{
      id: 'source-1',
      url: 'https://example.com',
      title: 'Example',
      aliases: ['source-1'],
    }])
  })
})
