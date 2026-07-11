import { describe, it, expect } from 'vitest'
import { calcNextRunAt, calcScheduledAt, isMissed, formatOccurrenceKey } from '../scheduler-recurrence'
import type { ScheduledTask } from '../../shared/types'

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'Test task',
    prompt: 'Do something',
    enabled: true,
    agentId: null,
    projectId: null,
    model: null,
    conversationId: null,
    scheduleType: 'daily',
    localTime: '09:00',
    weekday: null,
    monthDay: null,
    timezone: 'UTC',
    toolPolicy: { preApproved: [], alwaysAsk: [], neverAllow: [] },
    notificationPref: 'failures_only',
    nextRunAt: null,
    lastRunAt: null,
    targetType: 'chat',
    workflowSpecs: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

// Helpers to build UTC timestamps for a specific date/time
function utc(year: number, month: number, day: number, hours = 0, minutes = 0): number {
  return Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
}

// ============================================================
// calcNextRunAt — daily
// ============================================================

describe('calcNextRunAt — daily', () => {
  it('returns same-day fire if localTime is still in the future', () => {
    const task = makeTask({ localTime: '15:00' })
    const from = utc(2024, 6, 10, 10, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 6, 10, 15, 0))
  })

  it('rolls to next day when localTime has already passed today', () => {
    const task = makeTask({ localTime: '09:00' })
    const from = utc(2024, 6, 10, 12, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 6, 11, 9, 0))
  })

  it('returns next day over midnight boundary', () => {
    const task = makeTask({ localTime: '01:00' })
    const from = utc(2024, 6, 10, 23, 30)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 6, 11, 1, 0))
  })
})

// ============================================================
// calcNextRunAt — daily across DST (America/New_York, spring-forward)
// Spring forward 2024: 10 Mar 02:00 local → 03:00 (clocks skip 1 hour)
// ============================================================

describe('calcNextRunAt — daily across DST (America/New_York spring-forward)', () => {
  const tz = 'America/New_York'

  it('schedule at 09:00 still fires on spring-forward day', () => {
    const task = makeTask({ localTime: '09:00', timezone: tz })
    // One day before spring forward, at 00:00 ET (= 05:00 UTC on 9 Mar)
    const from = Date.UTC(2024, 2, 9, 5, 0) // 2024-03-09 00:00 ET
    const result = calcNextRunAt(task, from)
    // Should be 2024-03-09 09:00 ET = 14:00 UTC
    expect(result).toBe(Date.UTC(2024, 2, 9, 14, 0))
  })

  it('schedule at 09:00 on spring-forward day (after the fire time)', () => {
    const task = makeTask({ localTime: '09:00', timezone: tz })
    // 2024-03-10 10:00 ET (clocks have sprung forward), = 14:00 UTC
    const from = Date.UTC(2024, 2, 10, 14, 0)
    const result = calcNextRunAt(task, from)
    // Next: 2024-03-11 09:00 ET = 13:00 UTC (now in EDT, UTC-4)
    expect(result).toBe(Date.UTC(2024, 2, 11, 13, 0))
  })
})

// ============================================================
// calcNextRunAt — daily across DST (fall-back)
// Fall back 2024: 3 Nov 02:00 ET → 01:00 (clocks repeat 1 hour)
// ============================================================

describe('calcNextRunAt — daily across DST (America/New_York fall-back)', () => {
  const tz = 'America/New_York'

  it('schedule at 09:00 on fall-back day fires once', () => {
    const task = makeTask({ localTime: '09:00', timezone: tz })
    // 2024-11-03 08:00 ET = 12:00 UTC (before fire time)
    const from = Date.UTC(2024, 10, 3, 12, 0)
    const result = calcNextRunAt(task, from)
    // 2024-11-03 09:00 ET = 14:00 UTC (EST now, UTC-5)
    expect(result).toBe(Date.UTC(2024, 10, 3, 14, 0))
  })
})

// ============================================================
// calcNextRunAt — weekdays
// ============================================================

describe('calcNextRunAt — weekdays', () => {
  it('skips Saturday and Sunday', () => {
    const task = makeTask({ scheduleType: 'weekdays', localTime: '09:00' })
    // 2024-06-08 is Saturday UTC
    const from = utc(2024, 6, 8, 10, 0)
    const result = calcNextRunAt(task, from)
    // Next weekday 09:00 UTC should be Monday 2024-06-10
    expect(result).toBe(utc(2024, 6, 10, 9, 0))
  })

  it('fires on Friday and next occurrence is Monday', () => {
    const task = makeTask({ scheduleType: 'weekdays', localTime: '09:00' })
    // 2024-06-07 is Friday, after fire time
    const from = utc(2024, 6, 7, 10, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 6, 10, 9, 0))
  })
})

// ============================================================
// calcNextRunAt — weekly
// ============================================================

describe('calcNextRunAt — weekly', () => {
  it('returns next occurrence of the specified weekday', () => {
    // weekday 3 = Wednesday, 2024-06-10 is Monday
    const task = makeTask({ scheduleType: 'weekly', localTime: '10:00', weekday: 3 })
    const from = utc(2024, 6, 10, 8, 0)
    const result = calcNextRunAt(task, from)
    // Next Wednesday = 2024-06-12
    expect(result).toBe(utc(2024, 6, 12, 10, 0))
  })

  it('rolls a full week when weekday has passed', () => {
    const task = makeTask({ scheduleType: 'weekly', localTime: '10:00', weekday: 1 }) // Monday
    const from = utc(2024, 6, 10, 12, 0) // Monday after fire time
    const result = calcNextRunAt(task, from)
    // Next Monday = 2024-06-17
    expect(result).toBe(utc(2024, 6, 17, 10, 0))
  })
})

// ============================================================
// calcNextRunAt — monthly
// ============================================================

describe('calcNextRunAt — monthly', () => {
  it('returns the correct day this month if still upcoming', () => {
    const task = makeTask({ scheduleType: 'monthly', localTime: '08:00', monthDay: 20 })
    const from = utc(2024, 6, 10, 0, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 6, 20, 8, 0))
  })

  it('rolls to next month when day has passed', () => {
    const task = makeTask({ scheduleType: 'monthly', localTime: '08:00', monthDay: 5 })
    const from = utc(2024, 6, 10, 0, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 7, 5, 8, 0))
  })

  it('clamps Feb 30 to Feb 28 in a non-leap year', () => {
    const task = makeTask({ scheduleType: 'monthly', localTime: '08:00', monthDay: 30 })
    // Start from Feb 1 so the algorithm searches within February first
    const from = utc(2023, 2, 1, 0, 0)
    const result = calcNextRunAt(task, from)
    // Feb 2023 has 28 days → clamped to 28
    expect(result).toBe(utc(2023, 2, 28, 8, 0))
  })

  it('clamps Feb 30 to Feb 29 in a leap year', () => {
    const task = makeTask({ scheduleType: 'monthly', localTime: '08:00', monthDay: 30 })
    // Start from Feb 1 so the algorithm searches within February first
    const from = utc(2024, 2, 1, 0, 0)
    const result = calcNextRunAt(task, from)
    // Feb 2024 is a leap year (29 days) → clamped to 29
    expect(result).toBe(utc(2024, 2, 29, 8, 0))
  })

  it('handles month-day on the 31st when month has 30 days', () => {
    const task = makeTask({ scheduleType: 'monthly', localTime: '08:00', monthDay: 31 })
    const from = utc(2024, 3, 31, 12, 0) // March 31 after fire → next is April
    const result = calcNextRunAt(task, from)
    // April has 30 days → clamped to April 30
    expect(result).toBe(utc(2024, 4, 30, 8, 0))
  })
})

// ============================================================
// calcNextRunAt — one-time
// ============================================================

describe('calcNextRunAt — one-time', () => {
  it('returns upcoming fire time when not yet run', () => {
    const task = makeTask({ scheduleType: 'one-time', localTime: '14:00', lastRunAt: null })
    const from = utc(2024, 6, 10, 8, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBe(utc(2024, 6, 10, 14, 0))
  })

  it('returns null when task has already run', () => {
    const task = makeTask({ scheduleType: 'one-time', lastRunAt: utc(2024, 6, 10, 14, 0) })
    const result = calcNextRunAt(task, utc(2024, 6, 10, 15, 0))
    expect(result).toBeNull()
  })

  it('returns null when fire time has already passed without lastRunAt', () => {
    const task = makeTask({ scheduleType: 'one-time', localTime: '08:00', lastRunAt: null })
    const from = utc(2024, 6, 10, 12, 0)
    const result = calcNextRunAt(task, from)
    expect(result).toBeNull()
  })
})

// ============================================================
// calcScheduledAt — catch-up: only the latest missed occurrence
// ============================================================

describe('calcScheduledAt', () => {
  it('returns today fire time for daily when still in the past', () => {
    const task = makeTask({ scheduleType: 'daily', localTime: '09:00' })
    const now = utc(2024, 6, 10, 12, 0)
    expect(calcScheduledAt(task, now)).toBe(utc(2024, 6, 10, 9, 0))
  })

  it('returns yesterday for daily when today fire has not happened yet', () => {
    const task = makeTask({ scheduleType: 'daily', localTime: '18:00' })
    const now = utc(2024, 6, 10, 12, 0)
    expect(calcScheduledAt(task, now)).toBe(utc(2024, 6, 9, 18, 0))
  })

  it('returns one-time nextRunAt', () => {
    const task = makeTask({ scheduleType: 'one-time', nextRunAt: utc(2024, 6, 10, 8, 0) })
    expect(calcScheduledAt(task, utc(2024, 6, 10, 9, 0))).toBe(utc(2024, 6, 10, 8, 0))
  })

  it('weekly — returns last weekly occurrence', () => {
    // weekday 1 = Monday. 2024-06-10 is Monday.
    const task = makeTask({ scheduleType: 'weekly', localTime: '09:00', weekday: 1 })
    const now = utc(2024, 6, 10, 12, 0)
    expect(calcScheduledAt(task, now)).toBe(utc(2024, 6, 10, 9, 0))
  })
})

// ============================================================
// isMissed
// ============================================================

describe('isMissed', () => {
  it('returns false for a run less than 2 minutes ago', () => {
    const scheduledAt = utc(2024, 6, 10, 9, 0)
    const now = scheduledAt + 90_000
    expect(isMissed(scheduledAt, now)).toBe(false)
  })

  it('returns true for a run more than 2 minutes ago', () => {
    const scheduledAt = utc(2024, 6, 10, 9, 0)
    const now = scheduledAt + 3 * 60 * 1000
    expect(isMissed(scheduledAt, now)).toBe(true)
  })
})

// ============================================================
// formatOccurrenceKey
// ============================================================

describe('formatOccurrenceKey', () => {
  it('produces a stable key for the same calendar day', () => {
    const task = makeTask({ id: 'abc', timezone: 'UTC' })
    const d1 = new Date(utc(2024, 6, 15, 8, 0))
    const d2 = new Date(utc(2024, 6, 15, 23, 59))
    expect(formatOccurrenceKey(task, d1)).toBe(formatOccurrenceKey(task, d2))
  })

  it('produces different keys for different days', () => {
    const task = makeTask({ id: 'abc', timezone: 'UTC' })
    const d1 = new Date(utc(2024, 6, 15, 8, 0))
    const d2 = new Date(utc(2024, 6, 16, 8, 0))
    expect(formatOccurrenceKey(task, d1)).not.toBe(formatOccurrenceKey(task, d2))
  })

  it('includes task id in the key', () => {
    const task = makeTask({ id: 'my-task', timezone: 'UTC' })
    const d = new Date(utc(2024, 6, 15, 8, 0))
    expect(formatOccurrenceKey(task, d)).toMatch(/^my-task\//)
  })
})
