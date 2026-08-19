export interface Citation {
  /** Provider/CLI reference used by the answer text, when one was supplied. */
  id: string
  url: string
  title?: string
  snippet?: string
  /** Alternate provider reference fields that may point at the same source. */
  aliases?: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function normalizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function citationFromRecord(record: Record<string, unknown>): Citation | null {
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const url = normalizeUrl(firstString(record, ['url', 'uri', 'link']))
  if (!url) return null

  // Restrict the generic form to citation-shaped records. This prevents ordinary URLs in
  // tool arguments or prose payloads from becoming source cards.
  const citationShaped = type.includes('citation') || type.includes('source') || type === 'web_result' ||
    ['citation_id', 'citationId', 'reference', 'ref', 'annotations', 'source'].some((key) => key in record) ||
    (('id' in record || 'citation_id' in record || 'citationId' in record) && ('title' in record || 'name' in record))
  if (!citationShaped) return null

  const id = firstString(record, ['id', 'citation_id', 'citationId', 'reference', 'ref', 'token']) ?? url
  const aliases = [
    ...['id', 'citation_id', 'citationId', 'reference', 'ref', 'token'].flatMap((key) => {
      const value = record[key]
      return typeof value === 'string' && value.trim() && value.trim() !== id ? [value.trim()] : []
    }),
  ]
  const providerId = firstString(record, ['id', 'citation_id', 'citationId'])
  if (providerId && !providerId.startsWith('Cite')) {
    aliases.push(`Cite${providerId[0].toUpperCase()}${providerId.slice(1)}`)
  }
  return {
    id,
    url,
    ...(firstString(record, ['title', 'name', 'label']) ? { title: firstString(record, ['title', 'name', 'label']) } : {}),
    ...(firstString(record, ['snippet', 'description', 'text']) ? { snippet: firstString(record, ['snippet', 'description', 'text']) } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  }
}

/** Extracts citation-shaped metadata from provider/CLI response objects. */
export function extractCitations(value: unknown): Citation[] {
  const found: Citation[] = []
  const seen = new Set<string>()
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit)
      return
    }
    const record = asRecord(candidate)
    if (!record) return
    const citation = citationFromRecord(record)
    if (citation) {
      const key = `${citation.id}\n${citation.url}`
      if (!seen.has(key)) {
        seen.add(key)
        found.push(citation)
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (['annotations', 'citations', 'sources', 'references', 'url_citations', 'urlCitations', 'results', 'output', 'response', 'choices', 'delta', 'content', 'message', 'item'].includes(key)) {
        visit(child)
      }
    }
  }
  visit(value)
  return found
}

export function mergeCitations(target: Citation[], additions: Citation[]): void {
  for (const citation of additions) {
    const existing = target.find((candidate) => candidate.url === citation.url || candidate.id === citation.id)
    if (!existing) {
      target.push(citation)
      continue
    }
    if (!existing.title && citation.title) existing.title = citation.title
    if (!existing.snippet && citation.snippet) existing.snippet = citation.snippet
    existing.aliases = [...new Set([...(existing.aliases ?? []), ...(citation.aliases ?? [])])]
  }
}
