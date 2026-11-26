import type { WindowId } from '../daily/module_catalog';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { addDays } from '../time/logical_day';
import type { PlannedNotification } from './notification_plan';

/** The OS side of notifications; expo-notifications on the phone, a fake in tests. */
export interface Notifier {
  pendingIds(): Promise<string[]>;
  cancelAll(): Promise<void>;
  schedule(entry: PlannedNotification): Promise<string>;
}

interface LedgerRow {
  readonly id: number;
  readonly os_notification_id: string;
  readonly window: WindowId;
  readonly fire_at: string;
  readonly date: string | null;
  readonly status: string;
}

export interface ApplyReport {
  readonly scheduled: number;
  readonly markedFired: number;
  readonly markedSuppressed: number;
}

/**
 * Rebuilds the OS schedule from the plan while keeping history in notification_schedule:
 * 1. A tracked notification whose time has passed and that iOS no longer holds → fired.
 * 2. A future notification for a window that is now complete today → suppressed.
 * 3. Remaining future rows are dropped, everything pending is cancelled, the plan is scheduled.
 */
export async function applyNotificationPlan(
  executor: SqlExecutor,
  notifier: Notifier,
  input: {
    readonly plan: readonly PlannedNotification[];
    readonly now: Date;
    readonly today: string;
    readonly todayComplete: Readonly<Record<WindowId, boolean>>;
  },
): Promise<ApplyReport> {
  const pending = new Set(await notifier.pendingIds());
  const nowIso = input.now.toISOString();
  let markedFired = 0;
  let markedSuppressed = 0;
  runInTransaction(executor, () => {
    const rows = executor.all<LedgerRow>("SELECT * FROM notification_schedule WHERE status = 'scheduled'");
    for (const row of rows) {
      if (row.fire_at <= nowIso && !pending.has(row.os_notification_id)) {
        executor.run("UPDATE notification_schedule SET status = 'fired', status_changed_at = ? WHERE id = ?", [row.fire_at, row.id]);
        markedFired += 1;
      } else if (row.date === input.today && input.todayComplete[row.window]) {
        executor.run("UPDATE notification_schedule SET status = 'suppressed', status_changed_at = ? WHERE id = ?", [nowIso, row.id]);
        markedSuppressed += 1;
      } else {
        executor.run('DELETE FROM notification_schedule WHERE id = ?', [row.id]);
      }
    }
  });
  await notifier.cancelAll();
  const scheduledIds: [PlannedNotification, string][] = [];
  for (const entry of input.plan) scheduledIds.push([entry, await notifier.schedule(entry)]);
  runInTransaction(executor, () => {
    for (const [entry, id] of scheduledIds) {
      executor.run(
        `INSERT INTO notification_schedule (os_notification_id, window, fire_at, summary, date, status)
         VALUES (?, ?, ?, ?, ?, 'scheduled')`,
        [id, entry.window, entry.fireAt.toISOString(), entry.body, entry.date],
      );
    }
  });
  return { scheduled: scheduledIds.length, markedFired, markedSuppressed };
}

export type PingState = 'fired' | 'suppressed' | 'scheduled' | 'none';

export interface PingDay {
  readonly date: string;
  readonly morning: PingState;
  readonly evening: PingState;
}

/** Per-day notification outcome for the ping log (the M2 gate evidence). */
export function readPingLog(executor: SqlExecutor, today: string, days = 7): PingDay[] {
  const rank: Record<PingState, number> = { fired: 3, suppressed: 2, scheduled: 1, none: 0 };
  const out: PingDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const rows = executor.all<{ window: WindowId; status: string }>(
      'SELECT window, status FROM notification_schedule WHERE date = ?',
      [date],
    );
    const best = (window: WindowId): PingState =>
      rows
        .filter((row) => row.window === window && row.status !== 'cancelled')
        .map((row) => row.status as PingState)
        .reduce<PingState>((a, b) => (rank[b] > rank[a] ? b : a), 'none');
    out.push({ date, morning: best('morning'), evening: best('evening') });
  }
  return out;
}

/** IDs the ledger expects iOS to still hold (future, scheduled). */
export function trackedPendingIds(executor: SqlExecutor, now: Date): string[] {
  return executor
    .all<{ os_notification_id: string }>(
      "SELECT os_notification_id FROM notification_schedule WHERE status = 'scheduled' AND fire_at > ?",
      [now.toISOString()],
    )
    .map((row) => row.os_notification_id);
}
