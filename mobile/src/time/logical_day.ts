/**
 * Calendar logic in a named IANA time zone, using only Intl (no date library).
 *
 * The app's "logical day" closes at 03:00 local time (spec Section 4), so a journal
 * entry written at 01:30 belongs to the previous day. Dates are ISO strings
 * (YYYY-MM-DD); clock times are HH:MM in 24-hour form.
 */
export const DAY_CLOSE_HOUR = 3;

export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly weekday: number; // 0 = Sunday … 6 = Saturday
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wall-clock fields of an instant in the given time zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const fields: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) fields[part.type] = part.value;
  const hour = Number(fields.hour) % 24; // some engines print 24 for midnight
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour,
    minute: Number(fields.minute),
    second: Number(fields.second),
    weekday: WEEKDAYS.indexOf(fields.weekday ?? ''),
  };
}

/** The device's IANA time zone. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseIsoDate(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Adds whole days to an ISO date (pure calendar arithmetic). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [year, month, day] = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6;
}

/** Days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parseIsoDate(from);
  const [ty, tm, td] = parseIsoDate(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The logical day an instant belongs to: the calendar date, minus one before 03:00. */
export function logicalDate(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  const calendar = formatIsoDate(parts.year, parts.month, parts.day);
  return parts.hour < DAY_CLOSE_HOUR ? addDays(calendar, -1) : calendar;
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows `date` `time`.
 * A time skipped by a daylight-saving jump resolves to the instant after the gap.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = parseIsoDate(date);
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Invalid time ${time}`);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]));
  const offsetAt = (instant: number) => {
    const p = zonedParts(new Date(instant), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
  };
  let candidate = wallClockAsUtc - offsetAt(wallClockAsUtc);
  candidate = wallClockAsUtc - offsetAt(candidate);
  const check = zonedParts(new Date(candidate), timeZone);
  const shown = Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute);
  if (shown < wallClockAsUtc) {
    // Inside a spring-forward gap: move to the first valid minute after it.
    candidate += wallClockAsUtc - shown;
  }
  return new Date(candidate);
}
