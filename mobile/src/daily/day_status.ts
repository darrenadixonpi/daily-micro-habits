import { assignedItem } from '../content/content_repository';
import { pendingRecall } from '../learning/a3_concept';
import { a2State, reviewProgress, type ReviewDayContext } from '../learning/review_queue';
import { completionFor } from '../learning/task_completion_repository';
import { runInTransaction, type SqlExecutor } from '../platform/sql_executor';
import { activeModules, MODULES, type ModuleId, type WindowId } from './module_catalog';
import { getJournalEntry, journalEntryCounts, listPriorities } from './reflection_repository';

/**
 * no_content: the module is on but has nothing to serve today (no bundled or generated item,
 * e.g. an A1 tier without words, or an A5 date without an entry). It counts like
 * not_applicable, so a content gap never blocks a window or breaks a streak.
 */
export type ModuleState = 'complete' | 'incomplete' | 'not_applicable' | 'no_content' | 'disabled' | 'not_implemented';

/** Modules whose task_completion row is derived from other tables at every status update. */
export const DERIVED_MODULES: readonly ModuleId[] = ['D1', 'D2', 'D3', 'A2'];
export type WindowState = 'complete' | 'incomplete' | 'no_tasks';

export interface DayStatus {
  readonly date: string;
  readonly modules: Readonly<Record<ModuleId, ModuleState>>;
  readonly windows: Readonly<Record<WindowId, WindowState>>;
}

/**
 * Completion rules (spec Sections 1–2):
 * A1 — a sentence using the word; A3 — the concept read to the end and the delayed-recall
 * question answered; A4 — a passing typed phrase; A5 — the entry opened; A2 — queue empty or
 * daily cap reached (not applicable when nothing was due); D1 — at least one priority;
 * D2 — every priority has a status, or not applicable without priorities; D3 — an entry
 * containing at least one word. A window is complete when all its active modules are
 * complete, not applicable or without content, and at least one is actually complete.
 * Without a review context (scratch databases in diagnostics), A2 is not applicable.
 */
export function computeDayStatus(
  executor: SqlExecutor,
  date: string,
  enabledModules: readonly string[],
  review?: ReviewDayContext,
): DayStatus {
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
    } else if (module.id === 'A2') {
      modules[module.id] = review ? a2State(reviewProgress(executor, review)) : 'not_applicable';
    } else if (module.id === 'A3') {
      const read = executor.get("SELECT 1 AS present FROM task_completion WHERE date = ? AND module = 'A3'", [date]) !== undefined;
      const recallDue = pendingRecall(executor, date) !== null;
      const item = assignedItem(executor, 'A3', date);
      modules[module.id] = read && !recallDue ? 'complete' : item || recallDue || read ? 'incomplete' : 'no_content';
    } else {
      const learning = module.id as 'A1' | 'A4' | 'A5';
      modules[module.id] = completionFor(executor, date, learning)
        ? 'complete'
        : assignedItem(executor, learning, date) ? 'incomplete' : 'no_content';
    }
  }
  const windowState = (window: WindowId): WindowState => {
    const active = activeModules(enabledModules, window);
    if (active.length === 0) return 'no_tasks';
    const states = active.map((module) => modules[module.id]);
    const allDone = states.every((state) => state === 'complete' || state === 'not_applicable' || state === 'no_content');
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
    executor.run('UPDATE daily_session SET module_states_json = ? WHERE date = ?', [JSON.stringify(status.modules), status.date]);
    for (const [window, column] of [['morning', 'morning_completed_at'], ['evening', 'evening_completed_at']] as const) {
      if (status.windows[window] === 'complete') {
        executor.run(`UPDATE daily_session SET ${column} = COALESCE(${column}, ?) WHERE date = ?`, [nowIso, status.date]);
      } else {
        executor.run(`UPDATE daily_session SET ${column} = NULL WHERE date = ?`, [status.date]);
      }
    }
    for (const module of MODULES.filter((m) => DERIVED_MODULES.includes(m.id))) {
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
