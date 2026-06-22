import type { ScheduledTask, ScheduleType } from '../shared/types'

/**
 * Parse a "HH:MM" local-time string into { hours, minutes }.
 */
function parseLocalTime(localTime: string): { hours: number; minutes: number } {
  const [hStr, mStr] = localTime.split(':')
  return { hours: parseInt(hStr ?? '0', 10), minutes: parseInt(mStr ?? '0', 10) }
}

/**
 * Return a Date set to the given local time in the task's timezone on `baseDate`'s calendar day
 * (in that timezone). Returns a UTC Date object.
 */
function localDateAtTime(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timezone: string,
): Date {
  // Build an ISO-like string and parse it in the given TZ using Intl.
  // We use a small trick: format a reference date in the target TZ to find the UTC offset,
  // then construct the correct UTC instant.
  const candidate = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, 0, 0),
  )
  // Adjust for timezone offset by reformatting and comparing
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  // Find the UTC time that corresponds to year/month/day hours:minutes in `timezone`
  // Binary search would be robust but for ±14h offsets a single-shot correction works.
  const parts = formatter.formatToParts(candidate)
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
  const tzYear = get('year')
  const tzMonth = get('month')
  const tzDay = get('day')
  const tzHour = get('hour') === 24 ? 0 : get('hour')
  const tzMinute = get('minute')
  const tzSecond = get('second')

  const diff =
    (tzYear - year) * 365 * 24 * 60 * 60 * 1000 +
    (tzMonth - month) * 30 * 24 * 60 * 60 * 1000 +
    (tzDay - day) * 24 * 60 * 60 * 1000 +
    (tzHour - hours) * 60 * 60 * 1000 +
    (tzMinute - minutes) * 60 * 1000 +
    tzSecond * 1000

  return new Date(candidate.getTime() - diff)
}

/**
 * Decompose a UTC Date into local calendar fields for a given IANA timezone.
 */
function localFields(date: Date, timezone: string): {
  year: number; month: number; day: number; hours: number; minutes: number; weekday: number
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekdayStr = get('weekday')
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hours: parseInt(get('hour'), 10) === 24 ? 0 : parseInt(get('hour'), 10),
    minutes: parseInt(get('minute'), 10),
    weekday: WEEKDAYS.indexOf(weekdayStr),
  }
}

/**
 * Return the number of days in a given month (1-12) of a given year.
 * Clamps month-day edges (e.g. Feb 30 → Feb 28/29).
 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * Clamp a monthDay (1-31) to the actual last day of the given year/month.
 */
function clampMonthDay(year: number, month: number, monthDay: number): number {
  return Math.min(monthDay, daysInMonth(year, month))
}

/**
 * Calculate the next run timestamp (ms since epoch) for a task, starting strictly after `fromMs`.
 * Returns null for one-time tasks that have already run (lastRunAt is set).
 */
export function calcNextRunAt(task: ScheduledTask, fromMs: number): number | null {
  const { scheduleType, localTime, timezone, weekday, monthDay, lastRunAt } = task
  const { hours, minutes } = parseLocalTime(localTime)
  const tz = timezone || 'UTC'

  if (scheduleType === 'one-time') {
    if (lastRunAt !== null) return null
    const f = localFields(new Date(fromMs), tz)
    const candidate = localDateAtTime(f.year, f.month, f.day, hours, minutes, tz).getTime()
    return candidate > fromMs ? candidate : null
  }

  const maxDays = 400
  let cursor = fromMs + 1

  for (let i = 0; i < maxDays; i++) {
    const f = localFields(new Date(cursor), tz)
    const candidate = localDateAtTime(f.year, f.month, f.day, hours, minutes, tz).getTime()

    if (candidate > fromMs) {
      switch (scheduleType as ScheduleType) {
        case 'daily':
          return candidate

        case 'weekdays':
          if (f.weekday >= 1 && f.weekday <= 5) return candidate
          break

        case 'weekly': {
          const target = weekday ?? 1
          if (f.weekday === target) return candidate
          break
        }

        case 'monthly': {
          const target = clampMonthDay(f.year, f.month, monthDay ?? 1)
          if (f.day === target) return candidate
          break
        }
      }
    }

    // Advance to next calendar day in the target timezone
    cursor = localDateAtTime(f.year, f.month, f.day, 23, 59, tz).getTime() + 60_000
  }

  return null
}

/**
 * Return the scheduled occurrence timestamp for the current tick (the occurrence
 * we should be running right now). For daily/weekdays/weekly/monthly this is the
 * most recent past occurrence; for one-time it equals nextRunAt.
 */
export function calcScheduledAt(task: ScheduledTask, nowMs: number): number | null {
  if (task.scheduleType === 'one-time') return task.nextRunAt
  const { localTime, timezone, weekday, monthDay } = task
  const { hours, minutes } = parseLocalTime(localTime)
  const tz = timezone || 'UTC'

  // Walk backwards up to 7 days to find the most recent past occurrence
  const maxDays = 35
  let cursor = nowMs

  for (let i = 0; i < maxDays; i++) {
    const f = localFields(new Date(cursor), tz)
    const candidate = localDateAtTime(f.year, f.month, f.day, hours, minutes, tz).getTime()

    if (candidate <= nowMs) {
      switch (task.scheduleType as ScheduleType) {
        case 'daily':
          return candidate

        case 'weekdays':
          if (f.weekday >= 1 && f.weekday <= 5) return candidate
          break

        case 'weekly': {
          const target = weekday ?? 1
          if (f.weekday === target) return candidate
          break
        }

        case 'monthly': {
          const target = clampMonthDay(f.year, f.month, monthDay ?? 1)
          if (f.day === target) return candidate
          break
        }
      }
    }

    cursor = localDateAtTime(f.year, f.month, f.day, 0, 0, tz).getTime() - 1
  }

  return null
}

/**
 * Returns true if the scheduledAt timestamp is in the past and has been missed
 * (more than 2 minutes ago — giving a small grace window for startup jitter).
 */
export function isMissed(scheduledAt: number, nowMs: number): boolean {
  return nowMs - scheduledAt > 2 * 60 * 1000
}

/**
 * A stable, human-readable key for a task occurrence (used for idempotency checks
 * and deduplication).  Format: "<taskId>/<ISO-date-at-local-midnight>".
 */
export function formatOccurrenceKey(task: ScheduledTask, date: Date): string {
  const f = localFields(date, task.timezone || 'UTC')
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${task.id}/${f.year}-${pad(f.month)}-${pad(f.day)}`
}
