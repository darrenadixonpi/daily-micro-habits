import { a1WordFor } from '../content/content_selection';
import type { WindowId } from '../daily/module_catalog';
import { dueCards } from '../learning/review_queue';
import type { SqlExecutor } from '../platform/sql_executor';
import { logicalDayBounds } from '../time/logical_day';
import { notificationContent } from './notification_plan';

/**
 * Notification text per day (spec Section 4, Content preview): the morning body names the
 * day's word (reserved ahead by content_selection), the evening body states how many review
 * cards will be due that day, capped at the daily review cap.
 */
const MORNING_TASK_NAMES: Record<string, string> = { D1: 'top 3', A3: 'concept', A4: 'phrase', A5: 'on this day' };

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function createNotificationText(
  executor: SqlExecutor,
  input: { readonly enabled: readonly string[]; readonly timeZone: string; readonly reviewCap: number; readonly a4Language: string },
): (date: string, window: WindowId) => { title: string; body: string } {
  return (date, window) => {
    if (window === 'morning') {
      const rest = ['D1', 'A3', 'A4', 'A5'].filter((id) => input.enabled.includes(id)).map((id) => MORNING_TASK_NAMES[id] ?? id);
      const word = input.enabled.includes('A1') ? a1WordFor(executor, date) : null;
      if (!word) return rest.length > 0 ? { title: 'Morning micro-habits', body: `Today: ${joinNames(rest)}.` } : notificationContent('morning');
      return { title: 'Morning micro-habits', body: rest.length > 0 ? `Today’s word: ${word}. Then ${joinNames(rest)}.` : `Today’s word: ${word}.` };
    }
    const tasks = [input.enabled.includes('D2') ? 'evening review' : null, input.enabled.includes('D3') ? 'journal' : null].filter(
      (name): name is string => name !== null,
    );
    const due = input.enabled.includes('A2')
      ? Math.min(input.reviewCap, dueCards(executor, { dayEnd: logicalDayBounds(date, input.timeZone).end, a4Language: input.a4Language }).length)
      : 0;
    if (due === 0) return tasks.length > 0 ? { title: 'Evening micro-habits', body: `Time for your ${joinNames(tasks)}.` } : notificationContent('evening');
    const cards = `${due} review card${due === 1 ? '' : 's'} due`;
    return { title: 'Evening micro-habits', body: tasks.length > 0 ? `${cards}, then your ${joinNames(tasks)}.` : `${cards}.` };
  };
}
