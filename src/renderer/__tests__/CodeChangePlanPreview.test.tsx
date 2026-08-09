import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PlanCard, parseAffectedFiles } from '../components/CodeChangePlanPreview'
import type { ErrorReportEntry } from '@shared/types'

function makeReport(overrides: Partial<ErrorReportEntry>): ErrorReportEntry {
  return { id: 'r1', investigation_affected_files: '[]', ...overrides } as unknown as ErrorReportEntry
}

describe('PlanCard confidence badge', () => {
  it('renders a numeric confidence as a percentage with a high-confidence (green) style', () => {
    const { getByText } = render(
      <PlanCard report={makeReport({ investigation_confidence: '80' })} affectedFiles={[]} body="Body" />
    )
    const badge = getByText('80% confidence')
    expect(badge.className).toContain('text-nexy-success')
  })

  it('renders a low numeric confidence with a red style', () => {
    const { getByText } = render(
      <PlanCard report={makeReport({ investigation_confidence: '10' })} affectedFiles={[]} body="Body" />
    )
    const badge = getByText('10% confidence')
    expect(badge.className).toContain('text-nexy-error')
  })

  it('renders a mid-range numeric confidence with an amber style', () => {
    const { getByText } = render(
      <PlanCard report={makeReport({ investigation_confidence: '45' })} affectedFiles={[]} body="Body" />
    )
    const badge = getByText('45% confidence')
    expect(badge.className).toContain('text-nexy-warning')
  })

  it('still renders legacy qualitative confidence values with their own color', () => {
    const { getByText } = render(
      <PlanCard report={makeReport({ investigation_confidence: 'high' })} affectedFiles={[]} body="Body" />
    )
    const badge = getByText('high confidence')
    expect(badge.className).toContain('text-nexy-success')
  })

  it('hides the badge entirely for unknown/none confidence', () => {
    const { queryByText } = render(
      <PlanCard report={makeReport({ investigation_confidence: 'unknown' })} affectedFiles={[]} body="Body" />
    )
    expect(queryByText(/confidence/)).toBeNull()
  })

  it('clamps out-of-range numeric confidence into 0-100', () => {
    const { getByText } = render(
      <PlanCard report={makeReport({ investigation_confidence: '150' })} affectedFiles={[]} body="Body" />
    )
    expect(getByText('100% confidence')).toBeInTheDocument()
  })
})

describe('PlanCard revision notes', () => {
  it('shows the persisted revision notes above the plan body', () => {
    const { getByText } = render(
      <PlanCard
        report={makeReport({ investigation_revision_notes: 'Look in src/android instead of the desktop code' })}
        affectedFiles={[]}
        body="Body"
      />
    )
    expect(getByText('Revised with')).toBeInTheDocument()
    expect(getByText('Look in src/android instead of the desktop code')).toBeInTheDocument()
  })

  it('does not show revision notes while streaming (showSummary=false)', () => {
    const { queryByText } = render(
      <PlanCard
        report={makeReport({ investigation_revision_notes: 'Old guidance' })}
        affectedFiles={[]}
        body="Body"
        showSummary={false}
      />
    )
    expect(queryByText('Old guidance')).toBeNull()
  })

  it('omits the callout entirely when there are no revision notes', () => {
    const { queryByText } = render(
      <PlanCard report={makeReport({ investigation_revision_notes: null })} affectedFiles={[]} body="Body" />
    )
    expect(queryByText('Revised with')).toBeNull()
  })
})

describe('parseAffectedFiles', () => {
  it('parses a JSON array of file paths', () => {
    expect(parseAffectedFiles(makeReport({ investigation_affected_files: '["a.ts","b.ts"]' }))).toEqual(['a.ts', 'b.ts'])
  })

  it('falls back to an empty array on invalid JSON', () => {
    expect(parseAffectedFiles(makeReport({ investigation_affected_files: 'not json' }))).toEqual([])
  })
})
