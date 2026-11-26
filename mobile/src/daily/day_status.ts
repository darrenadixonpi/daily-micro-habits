import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { activeModules, MODULES, type ModuleId, type WindowId } from './module_catalog';
import { getJournalEntry, journalEntryCounts, listPriorities } from './reflection_repository';

export type ModuleState = 'complete' | 'incomplete' | 'not_applicable' | 'disabled' | 'not_implemented';
export type WindowState = 'complete' | 'incomplete' | 'no_tasks';

export interface DayStatus {
  readonly date: string;
  readonly modules: Readonly<Record<ModuleId, ModuleState>>;
  readonly windows: Readonly<Record<WindowId, WindowState>>;
}

/**
 * Completion rules (spec Sections 1–2) for the modules implemented so far:
 * D1 — at least one priority; D2 — every priority has a status, or "not applicable"
 * when the day has no priorities; D3 — an entry containing at least one word.
 * A window is complete when all its active modules are complete or not applicable,
 * and at least one is actually complete.
 */
export function computeDayStatus(executor: SqlExecutor, date: string, enabledModules: readonly string[]): DayStatus {
  const priorities = listPriorities(executor, date);
  const journal = getJournalEntry(executor, date);
  const modules = {} as Record<ModuleId, ModuleState>;
  for (const module of MODULES) {
    if (!enabledModules.includes(module.id)) modules[module.id] = 'disabled';
    else if (!module.implemented) modules[module.id] = 'not_implemented';
    else if (module.id === 'D1') modules[module.id] = priorities.length > 0 ? 'complete' : 'incomplete';
    else if (module.id === 'D2') {
      modules[module.id] = priorities.length === 0
        ? 'not_applicable'
        : priorities.every((p) => p.status !== 'open') ? 'complete' : 'incomplete';
    } else if (module.id === 'D3') {
      modules[module.id] = journal && journalEntryCounts(journal.body_md) ? 'complete' : 'incomplete';
    }
  }
  const windowState = (window: WindowId): WindowState => {
    const active = activeModules(enabledModules, window);
    if (active.length === 0) return 'no_tasks';
    const states = active.map((module) => modules[module.id]);
    const allDone = states.every((state) => state === 'complete' || state === 'not_applicable');
    return allDone && states.includes('complete') ? 'complete' : 'incomplete';
  };
  return { date, modules, windows: { morning: windowState('morning'), evening: windowState('evening') } };
}

/**
 * Persists the open day's status: daily_session completion times (kept from the first
 * completion; cleared if the window is no longer complete) and one task_completion row
 * per completed module.
 */
export function recordDayStatus(executor: SqlExecutor, status: DayStatus, now: Date): void {
  const nowIso = now.toISOString();
  runInTransaction(executor, () => {
    executor.run('INSERT OR IGNORE INTO daily_session (date) VALUES (?)', [status.date]);
    for (const [window, column] of [['morning', 'morning_completed_at'], ['evening', 'evening_completed_at']] as const) {
      if (status.windows[window] === 'complete') {
        executor.run(`UPDATE daily_session SET ${column} = COALESCE(${column}, ?) WHERE date = ?`, [nowIso, status.date]);
      } else {
        executor.run(`UPDATE daily_session SET ${column} = NULL WHERE date = ?`, [status.date]);
      }
    }
    for (const module of MODULES.filter((m) => m.implemented)) {
      const done = status.modules[module.id] === 'complete';
      const exists = executor.get<{ n: number }>(
        'SELECT count(*) AS n FROM task_completion WHERE date = ? AND module = ?',
        [status.date, module.id],
      )?.n;
      if (done && !exists) {
        executor.run('INSERT INTO task_completion (date, module, completed_at) VALUES (?, ?, ?)', [status.date, module.id, nowIso]);
      } else if (!done && exists) {
        executor.run('DELETE FROM task_completion WHERE date = ? AND module = ?', [status.date, module.id]);
      }
    }
  });
}

/** A closed day counts toward the streak when at least one window was complete. */
export function dayCounted(executor: SqlExecutor, date: string): boolean {
  const row = executor.get<{ m: string | null; e: string | null }>(
    'SELECT morning_completed_at AS m, evening_completed_at AS e FROM daily_session WHERE date = ?',
    [date],
  );
  return Boolean(row && (row.m || row.e));
}
