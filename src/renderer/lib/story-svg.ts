const ALLOWED_TAGS = new Set(['svg', 'g', 'circle', 'rect', 'line', 'path', 'polygon', 'polyline'])
const ALLOWED_COLOR_VALUES = new Set(['currentcolor', 'var(--story-accent)', 'none'])
const MAX_ELEMENTS = 12
const MAX_LENGTH = 4000

/**
 * Validates a model-generated story-beat SVG against the closed grammar described in the
 * story system prompt (debrief-handlers.ts STORY_SYSTEM_PROMPT). Returns the serialized,
 * re-parsed markup if it passes, or null so the caller can fall back to a mood emoji.
 */
export function sanitizeStorySvg(raw: string): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  } catch {
    return null
  }
  if (doc.querySelector('parsererror')) return null

  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') return null
  if (root.getAttribute('viewBox') !== '0 0 100 100') return null
  if (root.hasAttribute('width') || root.hasAttribute('height')) return null

  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  if (elements.length > MAX_ELEMENTS) return null

  for (const el of elements) {
    if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) return null
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) return null
      if (name === 'style' && /url\(/i.test(attr.value)) return null
      if (name === 'fill' || name === 'stroke') {
        const value = attr.value.trim().toLowerCase()
        if (value && !ALLOWED_COLOR_VALUES.has(value)) return null
      }
    }
  }

  return new XMLSerializer().serializeToString(root)
}
