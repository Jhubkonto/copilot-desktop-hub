import { parseSkillMarkdown } from './skill-markdown'
import { upsertSkillConfigByName } from './skills'
import type { SkillConfig } from '../shared/types'

/** The provider-neutral input accepted by the Nexy skill capture tool. */
export interface SkillCaptureInput {
  markdown?: unknown
  name?: unknown
  description?: unknown
  instructions?: unknown
  icon?: unknown
  tags?: unknown
}

export interface PreparedSkillCapture {
  partial: Partial<SkillConfig>
  name: string
  imported: boolean
}

export interface PersistedSkillCapture {
  skill: SkillConfig
  created: boolean
}

/**
 * Detects the explicit user intent needed before exposing a library-write tool.
 * This is intentionally shared by provider and CLI dispatch so the two paths have
 * the same safety boundary.
 */
export function requestsSkillCapture(content: string): boolean {
  const hasSkillMention = /\bskills?\b|\bskill\.md\b/i.test(content)
  if (!hasSkillMention) return false

  const hasSaveVerb = /\b(save|store|keep|import|add|capture|persist)\b/i.test(content)
  if (hasSaveVerb) return true

  return /\b(create|make|write|author|generate)\b[\s\S]{0,100}\bskill\b[\s\S]{0,100}\b(nexy|library|reusable)\b/i.test(content)
}

/** Parses and validates model-supplied skill content without touching persistence. */
export function prepareSkillCapture(args: SkillCaptureInput): PreparedSkillCapture | { error: string } {
  const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : ''
  let partial: Partial<SkillConfig>
  try {
    if (markdown) {
      partial = parseSkillMarkdown(markdown)
    } else {
      partial = {
        name: typeof args.name === 'string' ? args.name : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
        instructions: typeof args.instructions === 'string' ? args.instructions : undefined,
        icon: typeof args.icon === 'string' ? args.icon : undefined,
        tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      }
    }
  } catch (error) {
    return { error: `Invalid SKILL.md document: ${error instanceof Error ? error.message : String(error)}` }
  }

  const name = (partial.name ?? '').trim()
  if (!name) return { error: 'A skill name is required (provide `name` or a `markdown` document with a name).' }
  if (!partial.instructions?.trim()) {
    return { error: 'A skill needs instructions (provide `instructions` or a `markdown` body).' }
  }

  return { partial, name, imported: Boolean(markdown) }
}

/** Persists a previously validated capture and applies the common provenance policy. */
export function persistSkillCapture(prepared: PreparedSkillCapture): PersistedSkillCapture {
  const provenanceTags = Array.from(new Set([
    ...(prepared.partial.tags ?? []),
    ...(prepared.imported ? ['imported'] : []),
    'auto-captured',
  ]))
  return upsertSkillConfigByName({ ...prepared.partial, name: prepared.name, tags: provenanceTags })
}

/** Convenience API for non-UI callers that already completed approval. */
export function captureSkill(args: SkillCaptureInput): PersistedSkillCapture | { error: string } {
  const prepared = prepareSkillCapture(args)
  if ('error' in prepared) return prepared
  try {
    return persistSkillCapture(prepared)
  } catch (error) {
    return { error: `Could not save skill "${prepared.name}": ${error instanceof Error ? error.message : String(error)}` }
  }
}
