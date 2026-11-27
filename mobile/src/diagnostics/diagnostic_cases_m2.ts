import { computeTableChecksums, decryptBackup } from '../backup/backup_codec';
import { listBackupNames, writeDailyBackup } from '../backup/daily_backup';
import { closeDaysThrough } from '../daily/daily_cycle';
import { computeDayStatus, recordDayStatus } from '../daily/day_status';
import {
  carryOverCandidates,
  getJournalEntry,
  listPriorities,
  saveJournalEntry,
  savePriorities,
  searchJournal,
  setPriorityStatus,
} from '../daily/reflection_repository';
import { CURRENT_SCHEMA_VERSION, DATA_TABLES_IN_DEPENDENCY_ORDER, EXPECTED_COLUMNS } from '../db/database_schema';
import { readSchemaVersion, runMigrations } from '../db/run_migrations';
import { createFakeNotifier } from '../notifications/fake_notifier';
import { applyNotificationPlan, readPingLog } from '../notifications/notification_ledger';
import { buildNotificationPlan, windowFireAt, type ScheduleSettings } from '../notifications/notification_plan';
import type { SqlExecutor } from '../platform/sql_executor';
import { derivePassphraseKey } from '../security/passphrase_encryption';
import { writeInternalValue } from '../settings/settings_repository';
import { closeDay, INITIAL_STREAK_STATE, type StreakState } from '../streaks/streak_engine';
import {
  addDays,
  deviceTimeZone,
  isValidTimeZone,
  logicalDate,
  zonedTimeToInstant,
} from '../time/logical_day';
import { bytesToHex } from '../util/byte_encoding';
import { check, type DiagnosticCase, type DiagnosticEnvironment } from './diagnostic_environment';
import { insertSampleRows } from './sample_data';

const ALL_MODULES = ['A1', 'A2', 'A3', 'A4', 'A5', 'D1', 'D2', 'D3'];
const NEW_YORK = 'America/New_York';

export async function withScratch<Result>(
  environment: DiagnosticEnvironment,
  name: string,
  work: (executor: SqlExecutor) => Result | Promise<Result>,
  targetVersion?: number,
): Promise<Result> {
  const keyHex = environment.supportsEncryption ? bytesToHex(environment.crypto.randomBytes(32)) : null;
  const drop = () => {
    try {
      environment.deleteScratchDatabase(name);
    } catch {
      // Not present.
    }
  };
  drop();
  const executor = environment.openScratchDatabase(name, keyHex);
  try {
    runMigrations(executor, targetVersion);
    return await work(executor);
  } finally {
    executor.close();
    drop();
  }
}

const iso = (date: Date) => date.toISOString();

const t8DayBoundary: DiagnosticCase = {
  id: 'T8',
  title: 'Day boundary and time zones',
  async run() {
    const device = deviceTimeZone();
    check(isValidTimeZone(device), `device time zone ${device} not usable by Intl`);
    check(!isValidTimeZone('Not/AZone'), 'invalid time zone accepted');
    check(logicalDate(new Date('2026-11-27T07:30:00Z'), 'America/Indiana/Indianapolis') === '2026-11-26', '02:30 should belong to the previous day');
    check(logicalDate(new Date('2026-11-27T08:00:00Z'), 'America/Indiana/Indianapolis') === '2026-11-27', '03:00 should start the new day');
    check(logicalDate(new Date('2026-03-08T06:59:00Z'), NEW_YORK) === '2026-03-07', 'DST night 01:59 EST');
    check(logicalDate(new Date('2026-03-08T07:00:00Z'), NEW_YORK) === '2026-03-08', 'DST night 03:00 EDT');
    const cases: [string, string, string, string][] = [
      ['2026-03-08', '02:30', NEW_YORK, '2026-03-08T07:30:00.000Z'], // skipped hour → 03:30 EDT
      ['2026-11-01', '07:30', NEW_YORK, '2026-11-01T12:30:00.000Z'], // after fall-back (EST)
      ['2026-07-01', '21:00', 'America/Indiana/Indianapolis', '2026-07-02T01:00:00.000Z'],
      ['2026-01-01', '07:30', 'Asia/Kolkata', '2026-01-01T02:00:00.000Z'],
      ['2026-06-15', '08:00', 'Europe/London', '2026-06-15T07:00:00.000Z'],
    ];
    for (const [date, time, zone, expected] of cases) {
      const actual = iso(zonedTimeToInstant(date, time, zone));
      check(actual === expected, `${date} ${time} ${zone}: expected ${expected}, got ${actual}`);
    }
    check(addDays('2028-02-28', 1) === '2028-02-29' && addDays('2027-01-01', -1) === '2026-12-31', 'calendar arithmetic');
    return `03:00 rollover, DST gaps and 4 zones correct; device zone ${device}`;
  },
};

const t9Streaks: DiagnosticCase = {
  id: 'T9',
  title: 'Streak and freeze rules',
  async run(environment) {
    let state: StreakState = INITIAL_STREAK_STATE;
    let earned = 0;
    let date = '2026-01-01';
    for (let i = 0; i < 21; i += 1) {
      const result = closeDay(state, date, true, 7);
      earned += result.events.filter((e) => e.kind === 'freeze_earned').length;
      state = result.state;
      date = addDays(date, 1);
    }
    check(state.currentStreak === 21 && earned === 2 && state.bankedFreezes === 2, `after 21 days: streak ${state.currentStreak}, earned ${earned}`);
    const kinds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = closeDay(state, date, false, 7);
      kinds.push(...result.events.map((e) => e.kind));
      state = result.state;
      date = addDays(date, 1);
    }
    check(kinds.join(',') === 'freeze_used,freeze_used,reset', `miss sequence gave ${kinds.join(',')}`);
    check(state.currentStreak === 0 && state.longestStreak === 21, 'reset or longest wrong');

    const dbDetail = await withScratch(environment, 'diag_t9_streaks.db', (executor) => {
      writeInternalValue(executor, 'cycle_start_date', '2026-01-01');
      for (let i = 0; i < 8; i += 1) {
        executor.run('INSERT INTO daily_session (date, morning_completed_at) VALUES (?, ?)', [addDays('2026-01-01', i), '2026-01-01T12:00:00Z']);
      }
      const first = closeDaysThrough(executor, '2026-01-09', 7);
      check(first.closed === 8 && first.state.currentStreak === 8 && first.state.bankedFreezes === 1, `first close: ${JSON.stringify(first.state)}`);
      const second = closeDaysThrough(executor, '2026-01-11', 7);
      check(second.state.currentStreak === 0 && second.state.longestStreak === 8, `second close: ${JSON.stringify(second.state)}`);
      const freeze = executor.get<{ earned_on: string; used_on: string | null }>('SELECT earned_on, used_on FROM streak_freeze');
      check(freeze?.earned_on === '2026-01-07' && freeze.used_on === '2026-01-09', `freeze row ${JSON.stringify(freeze)}`);
      const session = executor.get<{ freeze_used: number }>("SELECT freeze_used FROM daily_session WHERE date = '2026-01-09'");
      check(session?.freeze_used === 1, 'freeze use not recorded on the session');
      const again = closeDaysThrough(executor, '2026-01-11', 7);
      check(again.closed === 0, 'closing the same days twice');
      return 'database close: earn, use, reset, idempotent';
    });
    return `21-day run banks 2 (cap), misses use 2 then reset; ${dbDetail}`;
  },
};

const T10_SETTINGS: ScheduleSettings = {
  timeZone: NEW_YORK,
  morningTime: '07:30',
  eveningTime: '21:00',
  weekendTimesEnabled: true,
  weekendMorningTime: '08:30',
  weekendEveningTime: '21:00',
};

const t10NotificationPlan: DiagnosticCase = {
  id: 'T10',
  title: 'Notification plan and ping ledger',
  async run(environment) {
    const now = new Date('2026-11-27T15:00:00Z'); // Fri 10:00 EST
    const both = { morning: true, evening: true };
    const none = { morning: false, evening: false };
    const plan = buildNotificationPlan({ now, today: '2026-11-27', settings: T10_SETTINGS, windowsWithTasks: both, todayComplete: none });
    check(plan.length === 27, `plan has ${plan.length} entries, expected 27`);
    const saturdayMorning = plan.find((p) => p.date === '2026-11-28' && p.window === 'morning');
    check(saturdayMorning && iso(saturdayMorning.fireAt) === '2026-11-28T13:30:00.000Z', 'weekend morning time');
    const mondayMorning = plan.find((p) => p.date === '2026-11-30' && p.window === 'morning');
    check(mondayMorning && iso(mondayMorning.fireAt) === '2026-11-30T12:30:00.000Z', 'weekday morning time');
    const late = windowFireAt({ ...T10_SETTINGS, eveningTime: '01:00' }, '2026-11-27', 'evening');
    check(iso(late) === '2026-11-28T06:00:00.000Z', 'an evening time after midnight belongs to the next calendar date');
    const suppressed = buildNotificationPlan({ now, today: '2026-11-27', settings: T10_SETTINGS, windowsWithTasks: both, todayComplete: { morning: false, evening: true } });
    check(suppressed.length === 26, 'completed window not suppressed in plan');

    const ledgerDetail = await withScratch(environment, 'diag_t10_ledger.db', async (executor) => {
      const notifier = createFakeNotifier();
      const first = await applyNotificationPlan(executor, notifier, { plan, now, today: '2026-11-27', todayComplete: none });
      check(first.scheduled === 27 && notifier.pending.size === 27, 'not all entries scheduled');
      const afterEvening = new Date('2026-11-28T02:00:00Z'); // 21:00 EST, still 2026-11-27
      check(notifier.deliverDueAt(afterEvening) === 1, 'fake delivery');
      const replan = buildNotificationPlan({ now: afterEvening, today: '2026-11-27', settings: T10_SETTINGS, windowsWithTasks: both, todayComplete: none });
      const second = await applyNotificationPlan(executor, notifier, { plan: replan, now: afterEvening, today: '2026-11-27', todayComplete: none });
      check(second.markedFired === 1, `fired rows ${second.markedFired}`);
      const saturdayEarly = new Date('2026-11-28T12:00:00Z'); // 07:00 EST Saturday, before 08:30
      const third = await applyNotificationPlan(executor, notifier, {
        plan: buildNotificationPlan({ now: saturdayEarly, today: '2026-11-28', settings: T10_SETTINGS, windowsWithTasks: both, todayComplete: { morning: true, evening: false } }),
        now: saturdayEarly,
        today: '2026-11-28',
        todayComplete: { morning: true, evening: false },
      });
      check(third.markedSuppressed === 1, 'completed morning not suppressed');
      const log = readPingLog(executor, '2026-11-28', 2);
      check(log[0]?.evening === 'fired' && log[1]?.morning === 'suppressed', `ping log ${JSON.stringify(log)}`);
      return 'ledger records fired and suppressed';
    });

    let live = 'live check n/a';
    // The daily cycle may be rebuilding the schedule while diagnostics run; retry briefly.
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const snapshot = await environment.inspectLiveNotifications?.();
      if (!snapshot) break;
      const pending = new Set(snapshot.pending);
      const missing = snapshot.tracked.filter((id) => !pending.has(id)).length;
      const consistent = missing === 0 && snapshot.pending.length === snapshot.tracked.length;
      if (consistent) {
        live = `iOS holds ${snapshot.pending.length} pending, matching the ledger`;
        break;
      }
      check(attempt < 4, `iOS holds ${snapshot.pending.length} pending, ledger expects ${snapshot.tracked.length} (${missing} missing)`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return `27-entry plan, weekend times, suppression; ${ledgerDetail}; ${live}`;
  },
};

const t11DailyBackup: DiagnosticCase = {
  id: 'T11',
  title: 'Daily backup files and retention',
  async run(environment) {
    const scheduler = await environment.createScheduler(0.9);
    const store = environment.createScratchBackupStore();
    const passphrase = 'm2-diagnostic-passphrase';
    try {
      return await withScratch(environment, 'diag_t11_backup.db', async (executor) => {
        insertSampleRows(executor, scheduler);
        const keyMaterial = await derivePassphraseKey(environment.crypto, passphrase);
        let pruned = 0;
        for (const date of ['2026-11-24', '2026-11-25', '2026-11-26']) {
          pruned += writeDailyBackup(executor, environment.crypto, store, {
            keyMaterial, date, appVersion: 'diagnostic', retention: 2, now: new Date(),
          }).pruned.length;
        }
        const names = listBackupNames(store);
        check(
          JSON.stringify(names) === JSON.stringify(['microhabits_backup_2026-11-25.mhbak', 'microhabits_backup_2026-11-26.mhbak']),
          `kept ${names.join(', ')}`,
        );
        const document = await decryptBackup(environment.crypto, passphrase, await store.readText(names[1] as string));
        const live = computeTableChecksums(executor, environment.crypto);
        check(DATA_TABLES_IN_DEPENDENCY_ORDER.every((table) => live[table] === document.checksums[table]), 'backup checksums differ from the database');
        return `3 written, ${pruned} pruned to keep 2; newest decrypts with the passphrase and matches`;
      });
    } finally {
      store.dispose();
    }
  },
};

const t12ReflectionRules: DiagnosticCase = {
  id: 'T12',
  title: 'D1, D2 and D3 rules',
  async run(environment) {
    return withScratch(environment, 'diag_t12_reflection.db', (executor) => {
      const day1 = '2026-11-26';
      const day2 = '2026-11-27';
      const day3 = '2026-11-28';
      const now = new Date('2026-11-26T15:00:00Z');
      for (const bad of [[], ['a', 'b', 'c', 'd'], ['x'.repeat(121)]]) {
        let threw = false;
        try {
          savePriorities(executor, day1, bad.map((text) => ({ text, carriedFromId: null })));
        } catch {
          threw = true;
        }
        check(threw, `invalid priorities accepted: ${bad.length} items`);
      }
      const saved = savePriorities(executor, day1, ['Ship M2', 'Read chapter 4', 'Call the bank'].map((text) => ({ text, carriedFromId: null })));
      let status = computeDayStatus(executor, day1, ALL_MODULES);
      check(status.modules.D1 === 'complete' && status.modules.D2 === 'incomplete', 'D1/D2 after saving priorities');
      check(status.windows.morning === 'complete' && status.windows.evening === 'incomplete', 'windows after D1');
      setPriorityStatus(executor, (saved[0] as { id: number }).id, 'done', null);
      setPriorityStatus(executor, (saved[1] as { id: number }).id, 'partial', 'halfway');
      setPriorityStatus(executor, (saved[2] as { id: number }).id, 'not_done', null);
      saveJournalEntry(executor, { date: day1, today: day1, body: 'Good day overall.', mood: 4, promptId: null, now });
      status = computeDayStatus(executor, day1, ALL_MODULES);
      check(status.modules.D2 === 'complete' && status.modules.D3 === 'complete' && status.windows.evening === 'complete', 'evening after D2+D3');
      recordDayStatus(executor, status, now);
      const session = executor.get<{ m: string | null; e: string | null }>('SELECT morning_completed_at AS m, evening_completed_at AS e FROM daily_session WHERE date = ?', [day1]);
      check(session?.m && session.e, 'daily_session completion times not recorded');
      const completions = executor.get<{ n: number }>('SELECT count(*) AS n FROM task_completion WHERE date = ?', [day1])?.n;
      check(completions === 3, `task_completion rows ${completions}`);
      check(getJournalEntry(executor, day1)?.last_edited_at === null, 'same-day save stamped last_edited_at');

      const candidates = carryOverCandidates(executor, day2);
      check(candidates.map((c) => c.text).join('|') === 'Read chapter 4|Call the bank', 'carry-over candidates');
      savePriorities(executor, day2, [{ text: 'Read chapter 4', carriedFromId: (candidates[0] as { id: number }).id }]);
      check(carryOverCandidates(executor, day2).length === 1, 'carried item still offered');
      check(listPriorities(executor, day2)[0]?.carried_from_id === (candidates[0] as { id: number }).id, 'carried_from_id');

      saveJournalEntry(executor, { date: day3, today: day3, body: 'Quiet day.', mood: null, promptId: null, now });
      const day3Status = computeDayStatus(executor, day3, ALL_MODULES);
      check(day3Status.modules.D2 === 'not_applicable' && day3Status.windows.evening === 'complete', 'D2 not applicable without D1');
      saveJournalEntry(executor, { date: day1, today: day3, body: 'Good day overall, edited.', mood: 4, promptId: null, now });
      check(getJournalEntry(executor, day1)?.last_edited_at !== null, 'past edit not stamped');
      check(searchJournal(executor, 'overa').length === 1 && searchJournal(executor, 'quiet day').length === 1, 'journal search');
      return 'limits, carry-over, D2 not-applicable, completion times, past-edit stamp, prefix search';
    });
  },
};

const t13MigrationWithData: DiagnosticCase = {
  id: 'T13',
  title: 'Migration v1 → current keeps data',
  async run(environment) {
    const scheduler = await environment.createScheduler(0.9);
    return withScratch(
      environment,
      'diag_t13_migration.db',
      (executor) => {
        check(readSchemaVersion(executor) === 1, 'scratch database not at version 1');
        insertSampleRows(executor, scheduler);
        const count = (table: string) => executor.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n ?? -1;
        const before = DATA_TABLES_IN_DEPENDENCY_ORDER.map(count);
        const report = runMigrations(executor);
        check(report.fromVersion === 1 && report.toVersion === CURRENT_SCHEMA_VERSION, `migrated ${report.fromVersion}→${report.toVersion}`);
        const after = DATA_TABLES_IN_DEPENDENCY_ORDER.map(count);
        check(JSON.stringify(before) === JSON.stringify(after), `row counts changed ${before} → ${after}`);
        for (const table of DATA_TABLES_IN_DEPENDENCY_ORDER) {
          const columns = executor.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
          check(JSON.stringify(columns) === JSON.stringify(EXPECTED_COLUMNS[table]), `${table} columns ${columns.join(',')}`);
        }
        const status = executor.get<{ status: string }>('SELECT status FROM notification_schedule')?.status;
        check(status === 'scheduled', `existing notification row status ${status}`);
        const rows = after.reduce((sum, n) => sum + n, 0);
        return `${rows} rows unchanged; new columns present with defaults`;
      },
      1,
    );
  },
};

export const M2_DIAGNOSTIC_CASES: readonly DiagnosticCase[] = [
  t8DayBoundary,
  t9Streaks,
  t10NotificationPlan,
  t11DailyBackup,
  t12ReflectionRules,
  t13MigrationWithData,
];
