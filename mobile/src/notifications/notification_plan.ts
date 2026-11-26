import type { WindowId } from '../daily/module_catalog';
import { addDays, DAY_CLOSE_HOUR, isWeekend, zonedTimeToInstant } from '../time/logical_day';

/**
 * The rolling notification plan (spec Section 4): at most one notification per window
 * per day, 14 days ahead. A window already complete today gets no notification.
 */
export const PLAN_DAYS = 14;
const IOS_PENDING_LIMIT = 64;

export interface ScheduleSettings {
  readonly timeZone: string;
  readonly morningTime: string;
  readonly eveningTime: string;
  readonly weekendTimesEnabled: boolean;
  readonly weekendMorningTime: string;
  readonly weekendEveningTime: string;
}

export interface PlannedNotification {
  readonly date: string;
  readonly window: WindowId;
  readonly fireAt: Date;
  readonly title: string;
  readonly body: string;
}

export function windowTime(settings: ScheduleSettings, date: string, window: WindowId): string {
  const weekend = settings.weekendTimesEnabled && isWeekend(date);
  if (window === 'morning') return weekend ? settings.weekendMorningTime : settings.morningTime;
  return weekend ? settings.weekendEveningTime : settings.eveningTime;
}

/** Fire instant for a logical day's window; times before 03:00 fall on the next calendar date. */
export function windowFireAt(settings: ScheduleSettings, date: string, window: WindowId): Date {
  const time = windowTime(settings, date, window);
  const hour = Number(time.slice(0, 2));
  const calendarDate = hour < DAY_CLOSE_HOUR ? addDays(date, 1) : date;
  return zonedTimeToInstant(calendarDate, time, settings.timeZone);
}

/** Notification text. The morning body names the day's word once A1 ships (M3); until then it points to D1 (decision E3). */
export function notificationContent(window: WindowId): { title: string; body: string } {
  return window === 'morning'
    ? { title: 'Morning micro-habits', body: 'Set your top 3 for today.' }
    : { title: 'Evening micro-habits', body: 'Review your priorities and write today’s journal.' };
}

export function buildNotificationPlan(input: {
  readonly now: Date;
  readonly today: string;
  readonly settings: ScheduleSettings;
  /** Windows that contain at least one enabled, implemented module. */
  readonly windowsWithTasks: Readonly<Record<WindowId, boolean>>;
  readonly todayComplete: Readonly<Record<WindowId, boolean>>;
  readonly days?: number;
}): PlannedNotification[] {
  const plan: PlannedNotification[] = [];
  const days = input.days ?? PLAN_DAYS;
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(input.today, offset);
    for (const window of ['morning', 'evening'] as const) {
      if (!input.windowsWithTasks[window]) continue;
      if (offset === 0 && input.todayComplete[window]) continue;
      const fireAt = windowFireAt(input.settings, date, window);
      if (fireAt.getTime() <= input.now.getTime()) continue;
      plan.push({ date, window, fireAt, ...notificationContent(window) });
    }
  }
  if (plan.length > IOS_PENDING_LIMIT) throw new Error(`Plan has ${plan.length} entries; iOS keeps at most 64`);
  return plan;
}
