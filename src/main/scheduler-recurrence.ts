import type { ScheduledTask, ScheduleType } from '../shared/types'

/**
 * Parse a "HH:MM" local-time string into { hours, minutes }.
 */
function parseLocalTime(localTime: string): { hours: number; minutes: number } {
  const [hStr, mStr] = localTime.split(':')
  return { hours: parseInt(hStr ?? '0', 10), minutes: parseInt(mStr ?? '0', 10) }
}

const OFFSET_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function getOffsetFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = OFFSET_FORMATTER_CACHE.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    OFFSET_FORMATTER_CACHE.set(timezone, fmt)
  }
  return fmt
}

/**
 * Return the timezone offset in milliseconds at the given UTC instant, defined as
 * `wallClock - utc` (positive east of UTC). Derived by reading the wall-clock fields the given
 * timezone shows at that instant and treating them as if they were UTC.
 */
function tzOffsetMsAt(utcMs: number, timezone: string): number {
  const parts = getOffsetFormatter(timezone).formatToParts(new Date(utcMs))
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10)
  const hour = get('hour') === 24 ? 0 : get('hour')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asUtc - utcMs
}

/**
 * Return a Date set to the given local time in the task's timezone on the given calendar day
 * (in that timezone). Returns a UTC Date object.
 *
 * Finds the UTC instant whose wall-clock representation in `timezone` equals the requested fields.
 * A single offset correction is wrong across a DST transition (the offset at the naive guess can
 * differ from the offset at the true instant), so we refine twice: the second pass re-reads the
 * offset at the corrected instant, which converges for every real-world zone. On a spring-forward
 * gap (a wall-clock time that doesn't exist) this lands on the instant just after the jump, and on
 * a fall-back overlap it resolves to the first occurrence — both acceptable for a fixed daily fire.
 */
function localDateAtTime(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timezone: string,
): Date {
  // Wall-clock target expressed as if it were UTC.
  const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
  // First guess: subtract the offset observed at the naive instant.
  let utc = wallAsUtc - tzOffsetMsAt(wallAsUtc, timezone)
  // Refine using the offset at the corrected instant (handles DST boundaries).
  utc = wallAsUtc - tzOffsetMsAt(utc, timezone)
  return new Date(utc)
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
