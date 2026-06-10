import { describe, expect, it } from 'vitest'
import { extractPromptVariables, resolvePromptVariables } from '../../shared/prompt-variables'

describe('prompt variables', () => {
  it('extracts deduped variables in first-seen order', () => {
    expect(
      extractPromptVariables('Analyze {{repository}} for {{ focus_area }} and summarize {{repository}}.')
    ).toEqual(['repository', 'focus_area'])
  })

  it('supports dotted, dashed, and underscored variable names', () => {
    expect(
      extractPromptVariables('{{project.slug}} {{ticket-id}} {{customer_name}}')
    ).toEqual(['project.slug', 'ticket-id', 'customer_name'])
  })

  it('resolves variables with supplied values', () => {
    expect(
      resolvePromptVariables('Analyze {{repository}} for {{ focus_area }}.', {
        repository: 'Nexy',
        focus_area: 'security',
      })
    ).toBe('Analyze Nexy for security.')
  })
})
