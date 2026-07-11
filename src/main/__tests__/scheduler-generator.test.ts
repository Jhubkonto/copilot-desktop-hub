import { describe, expect, it } from 'vitest'
import { extractSpec, normalizeSpec } from '../scheduler-generator'

describe('scheduler generator', () => {
  it('extracts a schedule spec from tagged assistant text', () => {
    const spec = extractSpec(`Ready.
<schedule-spec>
{
  "name": "Daily standup",
  "prompt": "Summarize current priorities",
  "scheduleType": "weekdays",
  "localTime": "09:15",
  "timezone": "Europe/Berlin",
  "notificationPref": "failures_only"
}
</schedule-spec>`)

    expect(spec).toEqual({
      name: 'Daily standup',
      prompt: 'Summarize current priorities',
      scheduleType: 'weekdays',
      localTime: '09:15',
      timezone: 'Europe/Berlin',
      notificationPref: 'failures_only',
      targetType: 'chat',
    })
  })

  it('normalizes invalid optional fields to safe scheduler defaults', () => {
    const spec = normalizeSpec({
      name: 'Weekly review',
      prompt: 'Review the project',
      scheduleType: 'weekly',
      localTime: '25:90',
      weekday: 99,
      timezone: '',
      notificationPref: 'sometimes',
    })

    expect(spec.scheduleType).toBe('weekly')
    expect(spec.localTime).toBe('09:00')
    expect(spec.weekday).toBe(1)
    expect(spec.notificationPref).toBe('always')
    expect(spec.timezone).toBeTruthy()
  })

  it('rejects specs without a prompt', () => {
    expect(() => normalizeSpec({
      name: 'No prompt',
      prompt: '',
      scheduleType: 'daily',
      localTime: '08:00',
      timezone: 'UTC',
    })).toThrow('Schedule prompt is required')
  })

  it('returns null for invalid tagged JSON', () => {
    expect(extractSpec('<schedule-spec>{ nope }</schedule-spec>')).toBeNull()
  })

  it('defaults targetType to chat when omitted', () => {
    const spec = normalizeSpec({
      name: 'Standalone task',
      prompt: 'Do the thing',
      scheduleType: 'daily',
      localTime: '08:00',
      timezone: 'UTC',
    })
    expect(spec.targetType).toBe('chat')
  })

  it('accepts an automated_workflow target with a sourceRunId and does not require a prompt', () => {
    const spec = normalizeSpec({
      name: 'Weekly report workflow',
      scheduleType: 'weekly',
      localTime: '08:00',
      timezone: 'UTC',
      targetType: 'automated_workflow',
      sourceRunId: 'run-123',
    })
    expect(spec.targetType).toBe('automated_workflow')
    expect(spec.sourceRunId).toBe('run-123')
  })

  it('rejects an automated_workflow target with no sourceRunId', () => {
    expect(() => normalizeSpec({
      name: 'Broken workflow schedule',
      scheduleType: 'daily',
      localTime: '08:00',
      timezone: 'UTC',
      targetType: 'automated_workflow',
    })).toThrow(/sourceRunId/)
  })
})
