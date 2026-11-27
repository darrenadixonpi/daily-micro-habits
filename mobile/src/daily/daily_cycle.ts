import { listBackupNames, writeDailyBackup, type BackupFileStore, type DailyBackupResult } from '../backup/daily_backup';
import { assignDailyContent, selectionSettingsFrom, type DailyAssignment } from '../content/content_selection';
import type { ReviewDayContext } from '../learning/review_queue';
import { createNotificationText } from '../notifications/notification_text';
import { buildNotificationPlan, type ScheduleSettings } from '../notifications/notification_plan';
import { applyNotificationPlan, type ApplyReport, type Notifier } from '../notifications/notification_ledger';
import type { CryptoPrimitives } from '../platform/crypto_primitives';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import type { DerivedKeyMaterial } from '../security/passphrase_encryption';
import type { SettingValue } from '../settings/settings_definitions';
import { readAllSettings, readInternalValue, writeInternalValue } from '../settings/settings_repository';
import { closeDay, INITIAL_STREAK_STATE, type StreakEvent, type StreakState } from '../streaks/streak_engine';
import { addDays, daysBetween, deviceTimeZone, isValidTimeZone, logicalDate, logicalDayBounds } from '../time/logical_day';
import { computeDayStatus, dayCounted, recordDayStatus, type DayStatus } from './day_status';

/**
 * The once-per-open cycle (decision E1): close every logical day that ended since the
 * last run (streaks and freezes), record today's status, write yesterday's backup if
 * missing, and rebuild the notification schedule. Runs at app open, on return to the
 * foreground, after a task is completed, and after a settings change.
 */
export interface DailyCycleDeps {
  readonly executor: SqlExecutor;
  readonly crypto: CryptoPrimitives;
  readonly now: Date;
  readonly appVersion: string;
  readonly notifier: Notifier | null;
  readonly backupStore: BackupFileStore | null;
  readonly backupKey: DerivedKeyMaterial | null;
}

export interface DailyCycleReport {
  readonly today: string;
  readonly timeZone: string;
  readonly streak: StreakState;
  readonly closedDays: number;
  readonly events: readonly StreakEvent[];
  readonly dayStatus: DayStatus;
  /** Today's learning content (A1, A3, A4, A5). */
  readonly assignment: DailyAssignment;
  /** Today's A2 window: logical-day bounds, daily cap and the active A4 language. */
  readonly review: ReviewDayContext;
  readonly backup: DailyBackupResult | 'not_due' | 'no_passphrase' | 'disabled';
  readonly notifications: ApplyReport | null;
}

export function resolveTimeZone(settings: ReadonlyMap<string, SettingValue>): string {
  const mode = settings.get('schedule.time_zone_mode');
  const fixed = settings.get('schedule.fixed_time_zone');
  if (mode === 'fixed' && typeof fixed === 'string' && fixed !== '' && isValidTimeZone(fixed)) return fixed;
  return deviceTimeZone();
}

export function scheduleSettingsFrom(settings: ReadonlyMap<string, SettingValue>, timeZone: string): ScheduleSettings {
  const text = (key: string) => String(settings.get(key));
  return {
    timeZone,
    morningTime: text('schedule.morning_time'),
    eveningTime: text('schedule.evening_time'),
    weekendTimesEnabled: settings.get('schedule.weekend_times_enabled') === true,
    weekendMorningTime: text('schedule.weekend_morning_time'),
    weekendEveningTime: text('schedule.weekend_evening_time'),
  };
}

export function reviewContextFrom(settings: ReadonlyMap<string, SettingValue>, today: string, timeZone: string): ReviewDayContext {
  const { start, end } = logicalDayBounds(today, timeZone);
  return {
    dayStart: start,
    dayEnd: end,
    cap: Number(settings.get('a2.daily_review_cap') ?? 20),
    a4Language: String(settings.get('a4.target_language') ?? 'es-419'),
  };
}

export function enabledModulesFrom(settings: ReadonlyMap<string, SettingValue>): string[] {
  const value = settings.get('modules.enabled');
  return Array.isArray(value) ? [...(value as readonly string[])] : [];
}

/** Closes logical days up to (not including) `today`, applying streak and freeze events to the database. */
export function closeDaysThrough(executor: SqlExecutor, today: string, freezeEarnDays: number): { state: StreakState; closed: number; events: StreakEvent[] } {
  return runInTransaction(executor, () => {
    let start = readInternalValue(executor, 'cycle_start_date');
    if (typeof start !== 'string') {
      start = today;
      writeInternalValue(executor, 'cycle_start_date', today);
    }
    const stored = readInternalValue(executor, 'streak_state') as StreakState | undefined;
    let state: StreakState = stored ?? { ...INITIAL_STREAK_STATE, lastClosedDate: addDays(start as string, -1) };
    const events: StreakEvent[] = [];
    let closed = 0;
    const firstToClose = addDays(state.lastClosedDate ?? addDays(start as string, -1), 1);
    for (let date = firstToClose; daysBetween(date, today) > 0; date = addDays(date, 1)) {
      const result = closeDay(state, date, dayCounted(executor, date), freezeEarnDays);
      for (const event of result.events) {
        if (event.kind === 'freeze_earned') {
          executor.run('INSERT INTO streak_freeze (earned_on) VALUES (?)', [date]);
        } else if (event.kind === 'freeze_used') {
          executor.run('INSERT OR IGNORE INTO daily_session (date) VALUES (?)', [date]);
          executor.run('UPDATE daily_session SET freeze_used = 1 WHERE date = ?', [date]);
          executor.run(
            `UPDATE streak_freeze SET used_on = ? WHERE id =
               (SELECT id FROM streak_freeze WHERE used_on IS NULL ORDER BY earned_on, id LIMIT 1)`,
            [date],
          );
        }
      }
      events.push(...result.events);
      state = result.state;
      closed += 1;
    }
    writeInternalValue(executor, 'streak_state', state);
    return { state, closed, events };
  });
}

export async function runDailyCycle(deps: DailyCycleDeps): Promise<DailyCycleReport> {
  const { executor, now } = deps;
  const settings = readAllSettings(executor);
  const timeZone = resolveTimeZone(settings);
  const today = logicalDate(now, timeZone);
  const enabled = enabledModulesFrom(settings);

  const { state, closed, events } = closeDaysThrough(executor, today, Number(settings.get('streaks.freeze_earn_days')));

  writeInternalValue(executor, 'last_cycle_today', today);
  const assignment = assignDailyContent(executor, { today, settings: selectionSettingsFrom(settings) });
  const review = reviewContextFrom(settings, today, timeZone);
  const dayStatus = computeDayStatus(executor, today, enabled, review);
  recordDayStatus(executor, dayStatus, now);

  let backup: DailyCycleReport['backup'] = 'not_due';
  const yesterday = addDays(today, -1);
  if (settings.get('backup.daily_file_enabled') !== true) {
    backup = 'disabled';
  } else if (!deps.backupKey || !deps.backupStore) {
    backup = 'no_passphrase';
  } else if (!listBackupNames(deps.backupStore).some((name) => name.includes(yesterday))) {
    const lastBackup = readInternalValue(executor, 'last_backup_date');
    if (typeof lastBackup !== 'string' || lastBackup < yesterday) {
      backup = writeDailyBackup(executor, deps.crypto, deps.backupStore, {
        keyMaterial: deps.backupKey,
        date: yesterday,
        appVersion: deps.appVersion,
        retention: Number(settings.get('backup.retention_files')),
        now,
      });
      writeInternalValue(executor, 'last_backup_date', yesterday);
    }
  }

  let notifications: ApplyReport | null = null;
  if (deps.notifier) {
    const todayComplete = {
      morning: dayStatus.windows.morning === 'complete',
      evening: dayStatus.windows.evening === 'complete',
    };
    const plan = buildNotificationPlan({
      now,
      today,
      settings: scheduleSettingsFrom(settings, timeZone),
      windowsWithTasks: { morning: dayStatus.windows.morning !== 'no_tasks', evening: dayStatus.windows.evening !== 'no_tasks' },
      todayComplete,
      contentFor: createNotificationText(executor, { enabled, timeZone, reviewCap: review.cap, a4Language: review.a4Language }),
    });
    notifications = await applyNotificationPlan(executor, deps.notifier, { plan, now, today, todayComplete });
  }

  return { today, timeZone, streak: state, closedDays: closed, events, dayStatus, assignment, review, backup, notifications };
}
