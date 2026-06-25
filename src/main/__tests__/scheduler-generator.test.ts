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
})
